import { basename, extname } from 'node:path'

/**
 * Splitting a repository into citable pieces.
 *
 * A chunk boundary is the citation granularity (as in rag/ids.ts): a plan that says "change
 * OrderService#cancel" should point at exactly that method. Java files are split into a
 * type summary (annotations, declaration, fields, method signatures) plus one chunk per
 * method or nested type; small files stay whole.
 *
 * This is a scanner, not a parser. It masks comments and string/char/text-block literals so
 * braces inside them do not count, then tracks brace depth. That is enough for well-formed
 * Java, and a file it cannot make sense of still becomes one whole-file chunk.
 */

export type ChunkKind = 'code' | 'test' | 'config' | 'sql' | 'doc'

export type ProjectChunk = {
  key: string
  kind: ChunkKind
  path: string
  symbol: string | null
  startLine: number // 1-based, inclusive
  endLine: number
  text: string
}

const MAX_CHUNK_CHARS = 6000
const SMALL_FILE_LINES = 60

const clip = (s: string) =>
  s.length <= MAX_CHUNK_CHARS ? s : `${s.slice(0, MAX_CHUNK_CHARS)}\n// … truncated (${s.length - MAX_CHUNK_CHARS} more chars)`

/** Which files are worth indexing, and as what. Null means skip. */
export function classify(path: string): ChunkKind | null {
  const p = path.replace(/\\/g, '/')
  const name = basename(p).toLowerCase()
  const ext = extname(name)
  if (ext === '.java' || ext === '.kt') return /(^|\/)src\/test\//.test(p) ? 'test' : 'code'
  if (/^application([-.][\w-]+)?\.(ya?ml|properties)$/.test(name) || name === 'bootstrap.yml') return 'config'
  if (name === 'pom.xml' || name === 'build.gradle' || name === 'build.gradle.kts' || name === 'settings.gradle') return 'config'
  if (ext === '.sql') return 'sql'
  if (/(^|\/)(db\/changelog|liquibase)\//.test(p) && (ext === '.xml' || ext === '.yaml' || ext === '.yml')) return 'sql'
  if (ext === '.md' && !/(^|\/)(node_modules|target|build)\//.test(p)) return 'doc'
  return null
}

/** Replace comments and literals with spaces, keeping newlines and offsets intact. */
export function maskJava(src: string): string {
  const out = src.split('')
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' '
  }
  let i = 0
  while (i < src.length) {
    const c = src[i]!, n = src[i + 1]
    if (c === '/' && n === '/') {
      const end = src.indexOf('\n', i); const e = end === -1 ? src.length : end
      blank(i, e); i = e
    } else if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2); const e = end === -1 ? src.length : end + 2
      blank(i, e); i = e
    } else if (c === '"' && src.startsWith('"""', i)) {
      const end = src.indexOf('"""', i + 3); const e = end === -1 ? src.length : end + 3
      blank(i, e); i = e
    } else if (c === '"' || c === "'") {
      let j = i + 1
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1
      blank(i, j + 1); i = j + 1
    } else i++
  }
  return out.join('')
}

const lineAt = (src: string, offset: number) => {
  let n = 1
  for (let k = 0; k < offset && k < src.length; k++) if (src.charCodeAt(k) === 10) n++
  return n
}

const TYPE_RE = /\b(class|interface|enum|record|@interface)\s+(\w+)/
const METHOD_RE = /(\w+)\s*\([^()]*(?:\([^()]*\)[^()]*)*\)\s*(?:throws\s+[\w.,\s<>]+)?\s*$/
const NOT_METHOD = /^(if|for|while|switch|catch|synchronized|try|else|do|return|new|static)$/

type Member = { name: string; start: number; end: number; isType: boolean }

/** Split one Java file. Falls back to a single whole-file chunk when the shape is unclear. */
export function chunkJava(path: string, src: string, kind: 'code' | 'test'): ProjectChunk[] {
  const lines = src.split('\n')
  const fileName = basename(path, extname(path))
  const whole = (): ProjectChunk[] => [{
    key: `${path}#${fileName}`, kind, path, symbol: fileName, startLine: 1, endLine: lines.length,
    text: clip(src.trimEnd()),
  }]
  if (lines.length <= SMALL_FILE_LINES) return whole()

  const m = maskJava(src)
  // Find the primary type's opening brace.
  const typeMatch = TYPE_RE.exec(m)
  if (!typeMatch) return whole()
  const typeName = typeMatch[2]!
  const open = m.indexOf('{', typeMatch.index)
  if (open === -1) return whole()

  // Walk the type body at depth 1, collecting members that open a block.
  const members: Member[] = []
  let depth = 1
  let segStart = open + 1 // start of the current member's header text
  let i = open + 1
  let closeOfType = -1
  while (i < m.length) {
    const c = m[i]
    if (c === '{') {
      if (depth === 1) {
        const header = m.slice(segStart, i)
        const flat = header.replace(/\s+/g, ' ').trim()
        // Skip initialiser blocks, lambdas/anonymous classes in field initialisers, enum bodies.
        const typeIn = TYPE_RE.exec(flat)
        const meth = METHOD_RE.exec(flat)
        // An "=" outside parentheses means a field initialiser (lambda, anonymous class, array).
        const isField = /=/.test(flat.replace(/\([^()]*\)/g, ''))
        let name: string | null = null, isType = false
        if (isField) name = null
        else if (typeIn) { name = typeIn[2]!; isType = true }
        else if (meth && !NOT_METHOD.test(meth[1]!)) name = meth[1]!
        // Find the matching close brace.
        let d = 0, j = i
        for (; j < m.length; j++) {
          if (m[j] === '{') d++
          else if (m[j] === '}' && --d === 0) break
        }
        if (name) {
          // Header starts at the first non-blank character after the previous member,
          // which keeps annotations and javadoc with their method.
          let hs = segStart
          while (hs < i && /\s/.test(src[hs]!)) hs++
          members.push({ name, start: hs, end: j + 1, isType })
        }
        i = j + 1
        segStart = i
        continue
      }
      depth++
    } else if (c === '}') {
      depth--
      if (depth === 0) { closeOfType = i; break }
    } else if (c === ';' && depth === 1) {
      segStart = i + 1
    }
    i++
  }
  if (closeOfType === -1 || members.length === 0) return whole()

  const out: ProjectChunk[] = []
  // Type summary: everything outside the member bodies, imports dropped, with each member's
  // signature kept so the summary still lists what the type can do.
  let summary = ''
  let cursor = 0
  for (const mb of members) {
    summary += src.slice(cursor, mb.start)
    const sigEnd = m.indexOf('{', mb.start) // masked, so a brace in an annotation string is skipped
    summary += src.slice(mb.start, sigEnd).trimEnd() + ' { … }\n'
    cursor = mb.end
  }
  summary += src.slice(cursor)
  summary = summary
    .split('\n').filter((l) => !/^\s*import\s/.test(l)).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim()
  out.push({
    // An outline, not the file: annotations, fields and signatures with bodies elided.
    key: `${path}#${typeName}`, kind, path, symbol: `${typeName} (outline)`,
    startLine: lineAt(src, typeMatch.index), endLine: lineAt(src, closeOfType),
    text: clip(summary),
  })

  const seen = new Map<string, number>()
  for (const mb of members) {
    const n = (seen.get(mb.name) ?? 0) + 1
    seen.set(mb.name, n)
    const symbol = `${typeName}.${mb.name}`
    out.push({
      // Overloads share a name; keep keys unique and still readable.
      key: `${path}#${symbol}${n > 1 ? `~${n}` : ''}`,
      kind, path, symbol,
      startLine: lineAt(src, mb.start), endLine: lineAt(src, mb.end - 1),
      text: clip(src.slice(mb.start, mb.end)),
    })
  }
  return out
}

/** Markdown split on headings; YAML/properties/SQL/build files kept whole (clipped). */
export function chunkText(path: string, src: string, kind: ChunkKind): ProjectChunk[] {
  const lines = src.split('\n')
  if (kind !== 'doc' || lines.length <= SMALL_FILE_LINES) {
    return [{ key: `${path}#file`, kind, path, symbol: null, startLine: 1, endLine: lines.length,
              text: clip(src.trimEnd()) }]
  }
  const heads = lines.map((l, i) => (/^#{1,3}\s/.test(l) ? i : -1)).filter((i) => i >= 0)
  if (heads[0] !== 0) heads.unshift(0)
  return heads.map((h, idx) => {
    const end = idx + 1 < heads.length ? heads[idx + 1]! : lines.length
    const title = lines[h]!.replace(/^#+\s*/, '').trim() || 'intro'
    return { key: `${path}#${idx}-${title.slice(0, 40)}`, kind, path, symbol: title,
             startLine: h + 1, endLine: end, text: clip(lines.slice(h, end).join('\n').trimEnd()) }
  }).filter((c) => c.text.trim().length > 0)
}

export function chunkFile(path: string, src: string): ProjectChunk[] {
  const kind = classify(path)
  if (!kind) return []
  if ((kind === 'code' || kind === 'test') && path.endsWith('.java')) return chunkJava(path, src, kind)
  return chunkText(path, src, kind)
}

/**
 * What gets embedded: a short header naming the place, then the start of the text.
 * The header matters for retrieval — "OrderController / @PostMapping("/orders")" matches
 * a requirement about placing orders even when the body is mostly plumbing.
 */
export function embeddingText(c: ProjectChunk): string {
  const annotations = [...new Set(c.text.match(/@(RestController|Controller|Service|Repository|Entity|Table|Component|Configuration|[A-Z]\w*Mapping)\b(\([^)]*\))?/g) ?? [])]
    .slice(0, 6).join(' ')
  return `${c.path}${c.symbol ? ` — ${c.symbol}` : ''}${annotations ? ` ${annotations}` : ''}\n${c.text.slice(0, 1500)}`
}

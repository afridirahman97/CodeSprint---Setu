import { sql } from '../db/client.ts'
import { detectStack } from './plan.ts'

type Item = {
  ref: string; requirement: string; status: string; analysis: string
  changes: { file: string; action: string; what: string }[]
  tasks: string[]; risks: string[]; questions: string[]; evidence: string[]
}

const STATUS_LABEL: Record<string, string> = {
  missing: 'to build', partial: 'to extend', conflict: 'conflicts with current code',
  exists: 'already implemented', unclear: 'needs investigation',
}
/** Build order: what conflicts first (it changes assumptions), then new work, then extensions. */
const ORDER = ['conflict', 'missing', 'partial', 'unclear', 'exists']
const MAX_EXCERPT_CHARS = 60_000

const fence = (path: string) =>
  path.endsWith('.java') ? 'java' : path.endsWith('.kt') ? 'kotlin' : path.endsWith('.sql') ? 'sql'
    : /\.ya?ml$/.test(path) ? 'yaml' : path.endsWith('.xml') ? 'xml' : path.endsWith('.properties') ? 'properties'
      : path.endsWith('.gradle') || path.endsWith('.kts') ? 'groovy' : ''

async function load(planId: number) {
  const [plan] = await sql<any[]>`
    SELECT dp.*, d.filename, p.name AS project, p.repo_url, p.local_path, p.branch, p.id AS project_id
    FROM dev_plans dp JOIN documents d ON d.id = dp.document_id JOIN projects p ON p.id = dp.project_id
    WHERE dp.id = ${planId}`
  if (!plan) throw new Error('plan not found')
  const items = await sql<Item[]>`
    SELECT ref, requirement, status, analysis, changes, tasks, risks, questions, evidence
    FROM dev_plan_items WHERE plan_id = ${planId} ORDER BY order_index`
  const stack = await detectStack(plan.project_id)
  return { plan, items, stack }
}

function header(plan: any, stack: string) {
  const source = plan.repo_url ?? `local: ${plan.local_path}`
  return [
    `- **Project:** ${plan.project}`,
    `- **Repository:** ${source}`,
    `- **Branch:** \`${plan.branch}\`${plan.commit_sha ? ` at commit \`${String(plan.commit_sha).slice(0, 12)}\`` : ''}`,
    `- **Stack:** ${stack}`,
    `- **Source document:** ${plan.filename}`,
    `- **Generated:** ${new Date(plan.finished_at ?? Date.now()).toISOString().slice(0, 16).replace('T', ' ')} UTC by Setu${plan.llm_model ? ` (${plan.llm_model})` : ''}`,
  ].join('\n')
}

function itemSection(it: Item, n: number, forAssistant: boolean) {
  const out: string[] = [`### ${n}. ${it.ref} — ${STATUS_LABEL[it.status] ?? it.status}`, '', `> ${it.requirement}`, '']
  out.push(`**Current state.** ${it.analysis}`, '')
  if (it.changes.length) {
    out.push('**Files:**', ...it.changes.map((c) => `- \`${c.file}\` (${c.action}) — ${c.what}`), '')
  }
  if (it.tasks.length) out.push('**Steps:**', ...it.tasks.map((t, i) => `${i + 1}. ${t}`), '')
  if (it.risks.length) out.push('**Take care:**', ...it.risks.map((r) => `- ${r}`), '')
  if (it.questions.length) {
    out.push(forAssistant ? '**Open — ask before assuming:**' : '**Open questions:**',
             ...it.questions.map((q) => `- ${q}`), '')
  }
  if (forAssistant) out.push(`**Done when:** the behaviour above is implemented and covered by a test that would fail without it.`, '')
  if (it.evidence.length) out.push(`<sub>Based on: ${it.evidence.map((e) => `\`${e}\``).join(', ')}</sub>`, '')
  return out.join('\n')
}

async function excerpts(projectId: number, keys: string[]) {
  if (keys.length === 0) return ''
  const rows = await sql<any[]>`
    SELECT chunk_key, path, symbol, start_line, end_line, text FROM project_chunks
    WHERE project_id = ${projectId} AND chunk_key = ANY(${keys})`
  const byKey = new Map(rows.map((r) => [r.chunk_key, r]))
  let total = 0
  const out: string[] = []
  for (const k of keys) {
    const r = byKey.get(k)
    if (!r) continue
    if (total + r.text.length > MAX_EXCERPT_CHARS) {
      out.push(`_…${keys.length - out.length} more excerpts omitted to keep this prompt a usable size — open the files listed above._`)
      break
    }
    total += r.text.length
    const what = String(r.symbol ?? '').endsWith('(outline)') ? `outline of ${r.symbol.replace(' (outline)', '')}` : `lines ${r.start_line}-${r.end_line}`
    out.push(`#### \`${r.path}\` — ${what}`, '', '```' + fence(r.path), r.text, '```', '')
  }
  return out.join('\n')
}

/** For a coding assistant: instructions, ordered plan, and the code it needs to see. */
export async function buildPromptMd(planId: number): Promise<string> {
  const { plan, items, stack } = await load(planId)
  const todo = [...items].filter((i) => i.status !== 'exists')
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status))
  const done = items.filter((i) => i.status === 'exists')
  const keys = [...new Set(todo.flatMap((i) => i.evidence))]
  const questions = items.flatMap((i) => i.questions.map((q) => `- **${i.ref}:** ${q}`))

  return [
    `# Implementation brief — ${plan.filename}`,
    '',
    header(plan, stack),
    '',
    '## Your task',
    '',
    `You are working in the repository above (${stack}). Implement the requirements in the`,
    'implementation plan below, in the order given. For each one:',
    '',
    '1. Read the files listed for it, and the excerpts at the end of this brief, before writing code.',
    '2. Follow the package layout, naming, layering (controller → service → repository) and error',
    '   handling the existing code already uses. Do not restructure code a requirement does not touch.',
    '3. Add or update a database migration when the schema changes; never edit an applied migration.',
    '4. Write tests next to the existing ones, in the same style (unit tests for services,',
    '   slice or integration tests for controllers and repositories).',
    '5. If an item under "Open — ask before assuming" affects your change, stop and ask rather than guess.',
    '',
    'The plan was drafted automatically from the codebase at the commit above. Treat file paths and',
    'class names as strong hints, and verify them — if the code has moved on, follow the code.',
    '',
    '## Implementation plan',
    '',
    todo.length ? todo.map((it, i) => itemSection(it, i + 1, true)).join('\n') : '_Nothing to build: every requirement is already implemented._',
    done.length ? ['## Already implemented — verify, do not rebuild', '',
      ...done.map((it) => `- **${it.ref}** — ${it.requirement}\n  ${it.analysis}`), ''].join('\n') : null,
    questions.length ? ['## All open questions', '', ...questions, ''].join('\n') : null,
    '## Definition of done',
    '',
    '- The project builds and the full test suite passes.',
    '- Every requirement in the plan has at least one test that exercises it.',
    '- No unrelated files are changed.',
    '',
    keys.length ? '## Relevant code (excerpts)\n\n' + await excerpts(plan.project_id, keys) : null,
  ].filter((s) => s !== null).join('\n')
}

/** For people: the same analysis, without assistant instructions or code excerpts. */
export async function buildPlanMd(planId: number): Promise<string> {
  const { plan, items, stack } = await load(planId)
  const counts = ORDER.map((s) => [s, items.filter((i) => i.status === s).length] as const).filter(([, n]) => n)
  const files = new Map<string, Set<string>>()
  for (const it of items) for (const c of it.changes) {
    if (!files.has(c.file)) files.set(c.file, new Set())
    files.get(c.file)!.add(`${c.action}: ${it.ref}`)
  }
  return [
    `# Development plan — ${plan.filename}`,
    '',
    header(plan, stack),
    '',
    '## Summary',
    '',
    '| status | requirements |', '|---|---|',
    ...counts.map(([s, n]) => `| ${STATUS_LABEL[s]} | ${n} |`),
    '',
    files.size ? ['## Files touched', '', '| file | by |', '|---|---|',
      ...[...files].sort().map(([f, by]) => `| \`${f}\` | ${[...by].join(', ')} |`), ''].join('\n') : null,
    '## Requirements',
    '',
    items.map((it, i) => itemSection(it, i + 1, false)).join('\n'),
  ].filter((s) => s !== null).join('\n')
}

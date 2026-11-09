import { execFile } from 'node:child_process'
import { mkdir, readdir, readFile, realpath, rm, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { env } from '../env.ts'

const run = promisify(execFile)

export type RepoSource = {
  repoUrl: string | null
  localPath: string | null
  branch: string
  username?: string | null
  token?: string | null
}

/** Keep a token out of anything shown to a user or written to a log. */
const scrub = (s: string, token?: string | null) => {
  let out = s.replace(/(https?:\/\/)[^@/\s]+@/g, '$1***@')
  if (token) out = out.split(token).join('***')
  return out
}

async function git(args: string[], opts: { cwd?: string; token?: string | null } = {}) {
  try {
    return await run('git', args, {
      cwd: opts.cwd,
      timeout: 10 * 60_000,
      maxBuffer: 16 * 1024 * 1024,
      // Never wait on a credential prompt nobody can answer.
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    })
  } catch (err) {
    const e = err as { stderr?: string; message: string; code?: string }
    if (e.code === 'ENOENT') throw new Error('git is not installed where the worker runs.')
    const detail = scrub((e.stderr || e.message).trim(), opts.token).split('\n').slice(-3).join(' ')
    throw new Error(explain(detail))
  }
}

/** Turn git's terse failures into something a developer can act on. */
function explain(detail: string): string {
  if (/Remote branch .* not found|couldn't find remote ref/i.test(detail)) {
    return 'That branch does not exist in the repository. Check the name (it is case-sensitive), then use Change branch.'
  }
  if (/Authentication failed|could not read Username|terminal prompts disabled|\b40[13]\b/i.test(detail)) {
    return 'The repository refused access. For a private repository, add an access token that can read it (Change branch / token).'
  }
  if (/repository .* not found/i.test(detail)) {
    return 'Repository not found. Check the URL — a private repository also reports "not found" without a valid token.'
  }
  if (/Could not resolve host|unable to access|Failed to connect|timed out/i.test(detail)) {
    return 'Could not reach the repository host from the server. Check the URL, and the server\'s network, DNS or proxy settings.'
  }
  if (/does not appear to be a git repository|not a git repository/i.test(detail)) {
    return 'That folder is not a git repository.'
  }
  // Unknown failure: keep git's own words, minus where Setu keeps its files.
  return detail.split(env.reposDir).join('…').split(env.localReposRoot).join('…')
    .replace(/Cloning into '[^']*'\.\.\.\s*/g, '')
}

/**
 * A local project must live under the mounted folder; a path that escapes it (../, a
 * symlink out) is refused, so a project cannot be pointed at the server's own files.
 */
export async function resolveLocal(localPath: string): Promise<string> {
  const root = await realpath(env.localReposRoot).catch(() => {
    throw new Error(
      `No local repositories folder is mounted at ${env.localReposRoot}. ` +
      `Set LOCAL_REPOS_DIR in .env to the folder holding your repositories and restart.`)
  })
  const target = await realpath(resolve(root, localPath.replace(/^\/+/, ''))).catch(() => {
    throw new Error(`Folder "${localPath}" was not found under the local repositories folder.`)
  })
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error('That path is outside the local repositories folder.')
  }
  return target
}

/** Folders directly under the mounted root, for the "local repository" picker. */
export async function listLocalRepos(): Promise<string[]> {
  try {
    const entries = await readdir(env.localReposRoot, { withFileTypes: true })
    const out: string[] = []
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      const isRepo = await stat(join(env.localReposRoot, e.name, '.git')).then(() => true, () => false)
      if (isRepo) out.push(e.name)
    }
    return out.sort()
  } catch {
    return []
  }
}

/**
 * Shallow clone of exactly one branch into the worker's repos volume, fresh each time.
 * Returns the checkout directory and the commit the plan will be true of.
 */
export async function checkout(projectId: number, src: RepoSource): Promise<{ dir: string; commit: string }> {
  const dir = join(env.reposDir, String(projectId))
  await rm(dir, { recursive: true, force: true })
  await mkdir(env.reposDir, { recursive: true })

  const args: string[] = []
  let from: string
  if (src.localPath) {
    from = `file://${await resolveLocal(src.localPath)}`
    // The mount is owned by the host user; git refuses "dubious ownership" without this.
    args.push('-c', 'safe.directory=*')
  } else {
    if (!src.repoUrl || !/^(https?:\/\/|git@|ssh:\/\/)/.test(src.repoUrl)) {
      throw new Error('Repository URL must start with https://, http://, ssh:// or git@')
    }
    from = src.repoUrl
    if (src.token) {
      // Sent as a header for this one command: never written to .git/config or the URL.
      const basic = Buffer.from(`${src.username || 'oauth2'}:${src.token}`).toString('base64')
      args.push('-c', `http.extraHeader=Authorization: Basic ${basic}`)
    }
  }
  args.push('clone', '--depth', '1', '--single-branch', '--branch', src.branch, '--no-tags', from, dir)
  await git(args, { token: src.token })

  const { stdout } = await git(['-c', 'safe.directory=*', 'rev-parse', 'HEAD'], { cwd: dir })
  return { dir, commit: stdout.trim() }
}

const SKIP_DIRS = new Set([
  '.git', 'target', 'build', 'out', 'bin', 'dist', 'node_modules', '.idea', '.gradle', '.mvn',
  '.vscode', 'generated', 'generated-sources', '.settings',
])
export const MAX_FILES = 5000
const MAX_FILE_BYTES = 300_000

/** Every indexable file, relative to the checkout, skipping build output and huge files. */
export async function walk(dir: string, accept: (rel: string) => boolean): Promise<{ path: string; text: string }[]> {
  const out: { path: string; text: string }[] = []
  const visit = async (d: string) => {
    if (out.length >= MAX_FILES) return
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (out.length >= MAX_FILES) return
      const full = join(d, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await visit(full)
      } else if (e.isFile()) {
        const rel = relative(dir, full).split(sep).join('/')
        if (!accept(rel)) continue
        const s = await stat(full)
        if (s.size > MAX_FILE_BYTES) continue
        out.push({ path: rel, text: await readFile(full, 'utf8') })
      }
    }
  }
  await visit(dir)
  return out
}

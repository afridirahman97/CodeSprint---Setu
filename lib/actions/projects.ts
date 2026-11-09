'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { sql } from '../db/client.ts'
import { requireUser } from '../auth/session.ts'
import { can } from '../auth/roles.ts'
import { audit } from '../auth/audit.ts'
import { enqueueIndex } from '../queue.ts'
import { encryptSecret } from '../model/secret.ts'
import { modelBlocker } from '../model/config.ts'

async function requireDev() {
  const user = await requireUser()
  if (!can(user.role, 'project:use')) throw new Error('Projects are for developers.')
  return user
}

export type ProjectFormState = { error?: string } | undefined

const BRANCH_RE = /^(?!-)(?!.*\.\.)[\w./-]{1,200}$/

export async function createProject(_: ProjectFormState, form: FormData): Promise<ProjectFormState> {
  const user = await requireDev()
  const name = String(form.get('name') ?? '').trim()
  const source = String(form.get('source') ?? 'remote')
  const repoUrl = String(form.get('repo_url') ?? '').trim()
  const localPath = String(form.get('local_path') ?? '').trim()
  const branch = String(form.get('branch') ?? '').trim()
  const username = String(form.get('username') ?? '').trim()
  const token = String(form.get('token') ?? '').trim()

  if (!name) return { error: 'Give the project a name.' }
  if (!BRANCH_RE.test(branch)) return { error: 'Enter a valid branch name, e.g. main or develop.' }
  if (source === 'remote') {
    if (!/^(https?:\/\/|ssh:\/\/|git@)\S+$/.test(repoUrl)) {
      return { error: 'Enter the repository URL, e.g. https://github.com/acme/orders-service.git' }
    }
    if (repoUrl.startsWith('git@') || repoUrl.startsWith('ssh://')) {
      return { error: 'SSH URLs are not supported yet — use the HTTPS URL, with an access token for a private repository.' }
    }
  } else if (!localPath || localPath.includes('..')) {
    return { error: 'Choose a folder from the local repositories list.' }
  }

  const blocked = await modelBlocker()
  if (blocked) return { error: `${blocked.reason}. Indexing needs the embedding model — ask an administrator.` }

  const [p] = await sql<{ id: number }[]>`
    INSERT INTO projects (name, repo_url, local_path, branch, repo_username, repo_token, index_status, created_by)
    VALUES (${name}, ${source === 'remote' ? repoUrl : null}, ${source === 'local' ? localPath : null},
            ${branch}, ${source === 'remote' && username ? username : null},
            ${source === 'remote' && token ? encryptSecret(token) : null}, 'queued', ${user.id})
    RETURNING id`
  await enqueueIndex({ projectId: Number(p!.id) })
  await audit({ actorId: user.id, action: 'project:create', entityType: 'project', entityId: p!.id,
                after: { name, source, branch } })
  redirect(`/projects/${p!.id}`)
}

export async function reindexProject(projectId: number) {
  const user = await requireDev()
  const blocked = await modelBlocker()
  if (blocked) throw new Error(`${blocked.reason}. ${blocked.detail}`)
  const [p] = await sql<any[]>`SELECT index_status FROM projects WHERE id = ${projectId}`
  if (!p) throw new Error('project not found')
  if (p.index_status === 'queued' || p.index_status === 'indexing') throw new Error('Indexing is already running.')
  await sql`UPDATE projects SET index_status = 'queued', index_stage = NULL, index_error = NULL WHERE id = ${projectId}`
  await enqueueIndex({ projectId })
  await audit({ actorId: user.id, action: 'project:reindex', entityType: 'project', entityId: projectId })
  revalidatePath(`/projects/${projectId}`)
}

/** Update the branch (and token) — a new branch means a fresh index. */
export async function updateProjectSource(projectId: number, branch: string, token: string | null) {
  const user = await requireDev()
  if (!BRANCH_RE.test(branch.trim())) throw new Error('Enter a valid branch name.')
  await sql`UPDATE projects SET branch = ${branch.trim()},
            repo_token = ${token === null ? sql`repo_token` : token ? encryptSecret(token) : null}
            WHERE id = ${projectId}`
  await audit({ actorId: user.id, action: 'project:update', entityType: 'project', entityId: projectId,
                after: { branch: branch.trim(), tokenChanged: token !== null } })
  await reindexProject(projectId)
}

export async function deleteProject(projectId: number) {
  const user = await requireDev()
  await sql`DELETE FROM projects WHERE id = ${projectId}`
  await audit({ actorId: user.id, action: 'project:delete', entityType: 'project', entityId: projectId })
  redirect('/projects')
}

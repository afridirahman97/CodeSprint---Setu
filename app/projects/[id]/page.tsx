import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/auth/session.ts'
import { can } from '@/lib/auth/roles.ts'
import { sql } from '@/lib/db/client.ts'
import { modelBlocker } from '@/lib/model/config.ts'
import { AppShell } from '@/components/app-shell.tsx'
import { Card, CardContent } from '@/components/ui/card.tsx'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.tsx'
import { DevOnly } from '../forbidden.tsx'
import { IndexBadge, PlanBadge } from '../status.tsx'
import { ProjectActions, UploadSrs } from './controls.tsx'

export const dynamic = 'force-dynamic'

export default async function Project({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser()
  if (!can(user.role, 'project:use')) return <AppShell user={user}><DevOnly /></AppShell>
  const projectId = Number((await params).id)
  if (!Number.isSafeInteger(projectId) || projectId < 1) notFound()

  const [p] = await sql<any[]>`SELECT * FROM projects WHERE id = ${projectId}`
  if (!p) notFound()
  const plans = await sql<any[]>`
    SELECT dp.id, dp.status, dp.stage, dp.progress_done, dp.progress_total, dp.started_at, dp.summary,
           dp.commit_sha, d.filename
    FROM dev_plans dp JOIN documents d ON d.id = dp.document_id
    WHERE dp.project_id = ${projectId} ORDER BY dp.id DESC`
  const kinds = await sql<{ kind: string; n: number }[]>`
    SELECT kind, count(*)::int AS n FROM project_chunks WHERE project_id = ${projectId} GROUP BY kind ORDER BY kind`

  const indexing = p.index_status === 'queued' || p.index_status === 'indexing'
  const planBusy = plans.some((x) => !['ready', 'failed'].includes(x.status))
  const blocked = await modelBlocker()
  const uploadBlocked = blocked ? `${blocked.reason}. Ask an administrator to configure the model.`
    : p.index_status !== 'ready' ? (indexing ? 'Available once indexing finishes.' : 'Index the codebase first.')
    : undefined

  return (
    <AppShell user={user}>
      {(indexing || planBusy) && <meta httpEquiv="refresh" content="4" />}
      <div className="mb-1 text-sm"><Link href="/projects" className="link opacity-70">Projects</Link></div>
      <h1 className="mb-4 text-2xl font-semibold">{p.name}</h1>

      <Card className="mb-4">
        <CardContent className="grid gap-4 pt-5">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
            <dt className="opacity-60">Repository</dt>
            <dd className="break-all font-mono text-xs">{p.repo_url ?? `local: ${p.local_path}`}
              {p.repo_token && <span className="ml-2 opacity-60">(with access token)</span>}</dd>
            <dt className="opacity-60">Branch</dt>
            <dd className="font-mono text-xs">{p.branch}</dd>
            <dt className="opacity-60">Index</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <IndexBadge status={p.index_status} />
              {p.index_status === 'ready' && (
                <span className="text-xs opacity-70">
                  {p.file_count} files, {p.chunk_count} pieces
                  {kinds.length > 0 && ` (${kinds.map((k) => `${k.n} ${k.kind}`).join(', ')})`}
                  {' '}at <code>{String(p.indexed_commit).slice(0, 12)}</code>
                  {p.indexed_at && ` · ${new Date(p.indexed_at).toLocaleString()}`}
                </span>
              )}
              {indexing && <span className="text-xs opacity-70">{p.index_stage ?? 'waiting for the worker'}…</span>}
            </dd>
          </dl>
          {p.index_status === 'failed' && (
            <div role="alert" className="alert alert-error text-sm">
              <span><strong>Indexing failed.</strong> {p.index_error}
                {p.indexed_commit && ' The previous index is still in place.'}</span>
            </div>
          )}
          <ProjectActions projectId={projectId} branch={p.branch} busy={indexing} remote={!!p.repo_url} />
        </CardContent>
      </Card>

      <Card className="mb-6 border-dashed">
        <CardContent className="pt-5">
          <UploadSrs projectId={projectId} disabledReason={uploadBlocked} />
        </CardContent>
      </Card>

      <h2 className="mb-2 text-lg font-semibold">Development plans</h2>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Plan</TableHead>
                <TableHead>Document</TableHead>
                <TableHead className="w-56">Status</TableHead>
                <TableHead>Summary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((x) => (
                <TableRow key={x.id}>
                  <TableCell>
                    <Link href={`/projects/${projectId}/plans/${x.id}`} className="link link-primary font-medium">#{x.id}</Link>
                  </TableCell>
                  <TableCell>
                    <div className="font-mono text-xs">{x.filename}</div>
                    <div className="text-xs opacity-50">{new Date(x.started_at).toLocaleString()}</div>
                  </TableCell>
                  <TableCell>
                    <PlanBadge status={x.status} />
                    {x.progress_total > 0 && x.status === 'analyzing' && (
                      <div className="mt-1 text-xs opacity-60">{x.progress_done}/{x.progress_total} requirements</div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm opacity-80">{x.summary ?? '—'}</TableCell>
                </TableRow>
              ))}
              {plans.length === 0 && (
                <TableRow><TableCell colSpan={4} className="py-8 text-center opacity-60">
                  No plans yet. Upload the final SRS above.
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  )
}

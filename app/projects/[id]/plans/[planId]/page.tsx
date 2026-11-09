import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Download, FileCode2, FileText } from 'lucide-react'
import { requireUser } from '@/lib/auth/session.ts'
import { can } from '@/lib/auth/roles.ts'
import { sql } from '@/lib/db/client.ts'
import { AppShell } from '@/components/app-shell.tsx'
import { Badge } from '@/components/ui/badge.tsx'
import { Card, CardContent } from '@/components/ui/card.tsx'
import { DevOnly } from '../../../forbidden.tsx'
import { PlanBadge, RequirementStatus } from '../../../status.tsx'
import { CopyPrompt } from './copy.tsx'

export const dynamic = 'force-dynamic'

const FILTERS = ['all', 'missing', 'partial', 'conflict', 'unclear', 'exists'] as const

export default async function Plan({ params, searchParams }: {
  params: Promise<{ id: string; planId: string }>; searchParams: Promise<{ status?: string }>
}) {
  const user = await requireUser()
  if (!can(user.role, 'project:use')) return <AppShell user={user}><DevOnly /></AppShell>
  const { id, planId } = await params
  const projectId = Number(id), pid = Number(planId)
  if (![projectId, pid].every((n) => Number.isSafeInteger(n) && n > 0)) notFound()

  const [plan] = await sql<any[]>`
    SELECT dp.*, d.filename, p.name AS project, p.branch, p.repo_url, p.local_path
    FROM dev_plans dp JOIN documents d ON d.id = dp.document_id JOIN projects p ON p.id = dp.project_id
    WHERE dp.id = ${pid} AND dp.project_id = ${projectId}`
  if (!plan) notFound()
  const items = await sql<any[]>`SELECT * FROM dev_plan_items WHERE plan_id = ${pid} ORDER BY order_index`
  const keys = [...new Set(items.flatMap((i) => i.evidence as string[]))]
  const chunks = keys.length ? await sql<any[]>`
    SELECT chunk_key, path, symbol, start_line, end_line, text FROM project_chunks
    WHERE project_id = ${projectId} AND chunk_key = ANY(${keys})` : []
  const chunkByKey = new Map(chunks.map((c) => [c.chunk_key, c]))

  const filter = FILTERS.includes((await searchParams).status as any) ? (await searchParams).status! : 'all'
  const shown = filter === 'all' ? items : items.filter((i) => i.status === filter)
  const count = (s: string) => items.filter((i) => i.status === s).length
  const inFlight = !['ready', 'failed'].includes(plan.status)
  const exportUrl = `/api/projects/${projectId}/plans/${pid}/export`

  return (
    <AppShell user={user}>
      {inFlight && <meta httpEquiv="refresh" content="4" />}
      <div className="mb-1 text-sm">
        <Link href="/projects" className="link opacity-70">Projects</Link>
        <span className="opacity-40"> / </span>
        <Link href={`/projects/${projectId}`} className="link opacity-70">{plan.project}</Link>
      </div>
      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-semibold">Plan #{plan.id}</h1>
        <PlanBadge status={plan.status} />
        <span className="font-mono text-xs opacity-60">
          {plan.filename} · {plan.branch}{plan.commit_sha && ` @ ${String(plan.commit_sha).slice(0, 12)}`}
          {plan.llm_model && ` · ${plan.llm_model}`}
        </span>
      </div>

      {plan.status === 'failed' && (
        <div role="alert" className="alert alert-error mb-4 text-sm">
          <span><strong>Failed.</strong> {plan.error}</span>
        </div>
      )}

      {inFlight && (
        <Card className="mb-4">
          <CardContent className="pt-5">
            <div className="mb-2 font-medium">{plan.stage ?? 'waiting for the worker'}…</div>
            <progress className="progress progress-primary w-full" value={plan.progress_done} max={plan.progress_total || 1} />
            <p className="mt-2 text-sm opacity-60">
              {plan.progress_total > 0 ? `${plan.progress_done} of ${plan.progress_total} requirements planned · ` : ''}
              closing this tab is safe. Requirements appear below as they are done.
            </p>
          </CardContent>
        </Card>
      )}

      {plan.status === 'ready' && (
        <Card className="mb-4">
          <CardContent className="grid gap-3 pt-5">
            <p>{plan.summary}</p>
            <div className="flex flex-wrap gap-2">
              <a href={exportUrl} className="btn btn-primary btn-sm gap-1.5">
                <Download className="h-3.5 w-3.5" aria-hidden /> IMPLEMENTATION_PROMPT.md
              </a>
              <CopyPrompt url={exportUrl} />
              <a href={`${exportUrl}?format=plan`} className="btn btn-outline btn-sm gap-1.5">
                <FileText className="h-3.5 w-3.5" aria-hidden /> Development plan (.md)
              </a>
            </div>
            <p className="text-xs opacity-60">
              The prompt file is written for a coding assistant: instructions, the plan in build order, and the
              code it needs to read. The plan file is the same analysis for people.
            </p>
          </CardContent>
        </Card>
      )}

      {items.length > 0 && (
        <nav aria-label="Filter requirements" className="mb-3 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const n = f === 'all' ? items.length : count(f)
            if (f !== 'all' && n === 0) return null
            return (
              <Link key={f} href={f === 'all' ? '?' : `?status=${f}`} aria-current={filter === f ? 'page' : undefined}
                    className={`btn btn-xs ${filter === f ? 'btn-primary' : 'btn-outline'}`}>
                {f === 'all' ? 'All' : f === 'exists' ? 'Already there' : f === 'missing' ? 'To build'
                  : f === 'partial' ? 'To extend' : f === 'conflict' ? 'Conflicts' : 'Unclear'} ({n})
              </Link>
            )
          })}
        </nav>
      )}

      <div className="grid gap-4">
        {shown.map((it) => (
          <Card key={it.id}>
            <CardContent className="grid gap-3 pt-5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">{it.ref}</h3>
                <RequirementStatus status={it.status} />
              </div>
              <p className="border-l-2 border-[var(--color-primary)] pl-3">{it.requirement}</p>
              <p className="text-sm">{it.analysis}</p>

              {it.changes.length > 0 && (
                <section>
                  <h4 className="mb-1 text-xs font-medium uppercase tracking-wide opacity-60">Files</h4>
                  <ul className="grid gap-1 text-sm">
                    {it.changes.map((c: any, i: number) => (
                      <li key={i} className="flex flex-wrap items-baseline gap-2">
                        <Badge variant={c.action === 'create' ? 'info' : 'secondary'}>{c.action}</Badge>
                        <code className="break-all text-xs">{c.file}</code>
                        <span className="opacity-80">— {c.what}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {it.tasks.length > 0 && (
                <section>
                  <h4 className="mb-1 text-xs font-medium uppercase tracking-wide opacity-60">Steps</h4>
                  <ol className="list-inside list-decimal space-y-0.5 text-sm">
                    {it.tasks.map((t: string, i: number) => <li key={i}>{t}</li>)}
                  </ol>
                </section>
              )}

              {(it.risks.length > 0 || it.questions.length > 0) && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {it.risks.length > 0 && (
                    <section>
                      <h4 className="mb-1 text-xs font-medium uppercase tracking-wide opacity-60">Take care</h4>
                      <ul className="list-inside list-disc space-y-0.5 text-sm">
                        {it.risks.map((r: string, i: number) => <li key={i}>{r}</li>)}
                      </ul>
                    </section>
                  )}
                  {it.questions.length > 0 && (
                    <section>
                      <h4 className="mb-1 text-xs font-medium uppercase tracking-wide opacity-60">Open questions</h4>
                      <ul className="list-inside list-disc space-y-0.5 text-sm">
                        {it.questions.map((q: string, i: number) => <li key={i}>{q}</li>)}
                      </ul>
                    </section>
                  )}
                </div>
              )}

              {it.evidence.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {(it.evidence as string[]).map((k) => {
                    const c = chunkByKey.get(k)
                    if (!c) return null
                    return (
                      <details key={k}>
                        <summary className="badge badge-outline cursor-pointer gap-1 font-mono text-xs">
                          <FileCode2 className="h-3 w-3" aria-hidden />
                          {c.symbol ?? c.path.split('/').pop()}
                        </summary>
                        <div className="mt-2 max-w-3xl">
                          <div className="mb-1 font-mono text-xs opacity-60">{c.path}:{c.start_line}-{c.end_line}</div>
                          <pre className="max-h-72 overflow-auto whitespace-pre rounded-[var(--radius)] bg-[var(--color-base-200)] p-3 text-xs">
                            {c.text}
                          </pre>
                        </div>
                      </details>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  )
}

import { notFound } from 'next/navigation'
import { CheckCircle2 } from 'lucide-react'
import { requireUser } from '@/lib/auth/session.ts'
import { can } from '@/lib/auth/roles.ts'
import { sql } from '@/lib/db/client.ts'
import { AppShell } from '@/components/app-shell.tsx'
import { Badge } from '@/components/ui/badge.tsx'
import { Card, CardContent } from '@/components/ui/card.tsx'
import { DemoBanner } from '@/app/demo-banner.tsx'
import { PendingFilter } from '@/components/pending-filter.tsx'
import { pendingFor } from '@/lib/pending.ts'
import { Artifact } from './artifact.tsx'
import { GenerateButton, ApproveBacklog, AcceptRemaining } from './actions.tsx'
import { generationStalled } from '@/lib/model/stalled.ts'

export const dynamic = 'force-dynamic'

export default async function Backlog(
  { params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string; pending?: string }> },
) {
  const user = await requireUser()
  const runId = Number((await params).id)
  if (!Number.isSafeInteger(runId) || runId < 1) notFound()
  const [run] = await sql<any[]>`
    SELECT r.*, d.filename, u.name AS backlog_approver
    FROM runs r JOIN documents d ON d.id = r.document_id
    LEFT JOIN users u ON u.id = r.backlog_approved_by WHERE r.id = ${runId}`
  if (!run) notFound()

  const stalled = await generationStalled(runId)
  const generating = (run.status === 'generating' || run.stage === 'queued') && !stalled
  const rows = await sql<any[]>`
    SELECT r.id AS req_id, r.ref, coalesce(r.edited_text, r.ai_original) AS req_text,
           s.id AS story_id, s.criteria, s.ai_original AS s_orig, s.edited_text AS s_edit, s.status AS s_status
    FROM requirements r
    LEFT JOIN stories s ON s.requirement_id = r.id
    WHERE r.run_id = ${runId} ORDER BY r.order_index, s.id`
  const tasks = await sql<any[]>`SELECT * FROM tasks WHERE run_id = ${runId} ORDER BY id`
  const tests = await sql<any[]>`
    SELECT t.*, f.question AS gap_question FROM test_scenarios t
    LEFT JOIN findings f ON f.id = t.from_finding_id
    WHERE t.run_id = ${runId} ORDER BY t.id`
  const [pend] = await sql<any[]>`
    SELECT (SELECT count(*)::int FROM stories WHERE run_id=${runId} AND status='proposed')
         + (SELECT count(*)::int FROM tasks WHERE run_id=${runId} AND status='proposed')
         + (SELECT count(*)::int FROM test_scenarios WHERE run_id=${runId} AND status='proposed') AS n`

  /**
   * D10: a role only picks the DEFAULT view. Any signed-in user may look at any of them,
   * so an explicit ?view= wins over the role — a QA can read the developer tasks.
   */
  const sp = await searchParams
  const pendingOnly = sp.pending === '1'
  const requested = sp.view
  const view = requested === 'tasks' || requested === 'tests' || requested === 'all'
    ? requested
    : user.role === 'dev' ? 'tasks' : user.role === 'qa' ? 'tests' : 'all'
  const elapsedMin = run.backlog_approved_at
    ? Math.round((Date.parse(run.backlog_approved_at) - Date.parse(run.started_at)) / 60000)
    : null
  const hasStories = rows.some((r) => r.story_id)
  const pending = await pendingFor(runId)
  // Count and filter by whichever artifact this view is actually about.
  const scope = view === 'tasks'
    ? { pending: pending.tasks, total: tasks.length, noun: 'tasks' }
    : view === 'tests'
      ? { pending: pending.tests, total: tests.length, noun: 'test scenarios' }
      : { pending: pending.backlog, total: rows.filter((r) => r.story_id).length + tasks.length + tests.length,
          noun: 'backlog items' }
  const undecided = (x: { status: string }) => x.status === 'proposed'
  const locked = !!run.backlog_approved_at
  // "Accept remaining" covers exactly what this view shows and counts.
  const bulkKinds = view === 'tasks' ? ['tasks' as const]
    : view === 'tests' ? ['test_scenarios' as const]
    : ['stories' as const, 'tasks' as const, 'test_scenarios' as const]

  return (
    <AppShell user={user} runId={runId}>
      {run.is_demo && <DemoBanner />}
      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-semibold">Backlog</h1>
        <span className="font-mono text-xs opacity-60">{run.filename}</span>
      </div>

      {!run.approved_at && (
        <div role="status" className="alert alert-warning mb-4">
          <span>The requirements are not approved yet. Nothing is generated before sign-off.</span>
        </div>
      )}

      {stalled && (
        <div role="alert" className="alert alert-error mb-4 items-start">
          <div>
            <div className="font-semibold">Generation never started</div>
            <p className="text-sm opacity-80">
              This run was queued but no background job is running for it. Nothing was generated,
              so starting again is safe.
            </p>
            <div className="mt-3"><GenerateButton runId={runId} label="Start generation again" /></div>
          </div>
        </div>
      )}

      {run.approved_at && !hasStories && !generating && !stalled && (
        <div className="mb-4"><GenerateButton runId={runId} label="Generate backlog" /></div>
      )}

      {generating && (
        <>
          <meta httpEquiv="refresh" content="5" />
          <Card className="mb-4"><CardContent className="pt-5">
            <div className="mb-2 font-medium">Drafting the backlog…</div>
            <progress className="progress progress-primary w-full"
                      value={run.progress_done} max={run.progress_total || 1} />
            <p className="mt-2 text-sm opacity-60">{run.progress_done}/{run.progress_total} requirements</p>
          </CardContent></Card>
        </>
      )}

      {run.backlog_approved_at ? (
        <div role="status" className="alert alert-success mb-4">
          <CheckCircle2 className="h-5 w-5" aria-hidden />
          <span>
            <strong>Backlog approved</strong> by {run.backlog_approver}
            {/* D27: the interval that matters runs to HERE, not to SRS sign-off. */}
            {elapsedMin !== null && <> — {elapsedMin} min from upload to approved backlog</>}
          </span>
        </div>
      ) : hasStories && can(user.role, 'backlog:approve') ? (
        <div className="mb-4"><ApproveBacklog runId={runId} pendingCount={pend!.n} /></div>
      ) : null}

      {hasStories && (
        <div className="mb-3">
          <PendingFilter pending={scope.pending} total={scope.total} noun={scope.noun} />
        </div>
      )}

      <div className="grid gap-4">
        {rows.filter((r) => r.story_id).map((r) => {
          const allTasks = tasks.filter((t) => t.story_id === r.story_id)
          const allTests = tests.filter((t) => t.story_id === r.story_id)
          const st = pendingOnly ? allTasks.filter(undecided) : allTasks
          const sc = pendingOnly ? allTests.filter(undecided) : allTests
          const storyPending = (view !== 'tests' ? allTasks.filter(undecided).length : 0)
            + (view !== 'tasks' ? allTests.filter(undecided).length : 0)
            + (view === 'all' && r.s_status === 'proposed' ? 1 : 0)
          if (pendingOnly && storyPending === 0) return null
          return (
            <Card key={r.story_id}>
              <CardContent className="pt-5">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="text-xs opacity-60">{r.ref} — {r.req_text}</span>
                  {storyPending > 0
                    ? <Badge variant="warning" title="still need a decision">{storyPending} pending</Badge>
                    : <Badge variant="success">decided</Badge>}
                  {!locked && (
                    <span className="ml-auto flex items-center gap-2">
                      <AcceptRemaining storyId={r.story_id} kinds={bulkKinds} count={storyPending} />
                    </span>
                  )}
                </div>
                <Artifact kind="stories" id={r.story_id} text={r.s_edit ?? r.s_orig}
                          aiOriginal={r.s_orig} status={r.s_status} className="text-lg font-semibold"
                          locked={locked} />

                {view !== 'tasks' && (r.criteria ?? []).length > 0 && (
                  <ul className="mt-2 grid gap-1 text-sm">
                    {(r.criteria as any[]).map((c, i) => (
                      <li key={i} className="rounded-[var(--radius)] bg-[var(--color-base-200)] px-3 py-2">
                        <b>Given</b> {c.given} <b>When</b> {c.when} <b>Then</b> {c.then}
                      </li>
                    ))}
                  </ul>
                )}

                {view !== 'tests' && st.length > 0 && (
                  <section className="mt-4">
                    <h4 className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide opacity-60">
                      Development tasks
                      {allTasks.filter(undecided).length > 0 && (
                        <Badge variant="warning">{allTasks.filter(undecided).length} pending</Badge>
                      )}
                    </h4>
                    <div className="divide-y divide-[var(--color-border)]">
                      {st.map((t) => (
                        <Artifact key={t.id} kind="tasks" id={t.id} text={t.edited_text ?? t.ai_original}
                                  aiOriginal={t.ai_original} status={t.status} locked={locked}
                                  meta={<span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
                                    {[...new Set<string>([...(t.modules ?? []), ...(t.tables ?? [])])].map((m) => (
                                      <code key={m} className="badge badge-ghost badge-sm font-mono">{m}</code>
                                    ))}
                                  </span>} />
                      ))}
                    </div>
                  </section>
                )}

                {view !== 'tasks' && sc.length > 0 && (
                  <section className="mt-4">
                    <h4 className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide opacity-60">
                      Test scenarios
                      {allTests.filter(undecided).length > 0 && (
                        <Badge variant="warning">{allTests.filter(undecided).length} pending</Badge>
                      )}
                    </h4>
                    <div className="divide-y divide-[var(--color-border)]">
                      {sc.map((t) => (
                        <Artifact key={t.id} kind="test_scenarios" id={t.id} text={t.edited_text ?? t.ai_original}
                                  aiOriginal={t.ai_original} status={t.status} locked={locked}
                                  meta={<span>
                                    <Badge key="kind" variant={t.kind === 'negative' ? 'warning' : 'secondary'} className="ml-1">{t.kind}</Badge>
                                    {t.from_finding_id && (
                                      <Badge key="gap" variant="info" className="ml-1" title={t.gap_question ?? ''}>
                                        covers a reviewed gap
                                      </Badge>
                                    )}
                                  </span>} />
                      ))}
                    </div>
                  </section>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </AppShell>
  )
}

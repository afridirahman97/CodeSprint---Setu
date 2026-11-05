import { notFound } from 'next/navigation'
import { Download, FileText, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { requireUser } from '@/lib/auth/session.ts'
import { can } from '@/lib/auth/roles.ts'
import { sql } from '@/lib/db/client.ts'
import { coverageFor } from '@/lib/export/coverage.ts'
import { AppShell } from '@/components/app-shell.tsx'
import { Badge } from '@/components/ui/badge.tsx'
import { Card, CardContent } from '@/components/ui/card.tsx'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.tsx'
import { DemoBanner } from '@/app/demo-banner.tsx'
import { JiraDryRun } from './push.tsx'

export const dynamic = 'force-dynamic'

export default async function Matrix({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser()
  const runId = Number((await params).id)
  if (!Number.isSafeInteger(runId) || runId < 1) notFound()
  const [run] = await sql<any[]>`
    SELECT r.id, r.is_demo, d.filename FROM runs r JOIN documents d ON d.id = r.document_id WHERE r.id = ${runId}`
  if (!run) notFound()

  const cov = await coverageFor(runId)
  const rows = await sql<any[]>`
    SELECT r.ref, coalesce(r.edited_text, r.ai_original) AS requirement,
           coalesce(s.edited_text, s.ai_original) AS story, s.status AS s_status,
           coalesce(ts.edited_text, ts.ai_original) AS test, ts.kind, ts.status AS t_status,
           ts.from_finding_id IS NOT NULL AS from_gap
    FROM trace_links tl
    JOIN requirements r ON r.id = tl.requirement_id
    LEFT JOIN stories s ON s.id = tl.story_id
    LEFT JOIN test_scenarios ts ON ts.id = tl.test_id
    WHERE tl.run_id = ${runId} ORDER BY r.order_index, s.id, ts.id`

  const full = cov.percent >= 1
  const canExport = can(user.role, 'artifact:export')

  return (
    <AppShell user={user} runId={runId}>
      {run.is_demo && <DemoBanner />}
      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-semibold">Traceability</h1>
        <span className="font-mono text-xs opacity-60">{run.filename}</span>
      </div>

      <Card className="mb-4">
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-center gap-3">
            {full
              ? <CheckCircle2 className="h-5 w-5 text-[var(--color-success)]" aria-hidden />
              : <AlertTriangle className="h-5 w-5 text-[var(--color-warning)]" aria-hidden />}
            <div>
              <div className="font-semibold">Coverage {(cov.percent * 100).toFixed(0)}%</div>
              <div className="text-sm opacity-70">
                {cov.complete} of {cov.total} requirements map to at least one story and one test.
              </div>
            </div>
            <div
              className="radial-progress ml-auto text-[var(--color-primary)]"
              style={{ '--value': Math.round(cov.percent * 100), '--size': '3.5rem' } as React.CSSProperties}
              role="progressbar" aria-valuenow={Math.round(cov.percent * 100)}
            >
              {(cov.percent * 100).toFixed(0)}%
            </div>
          </div>

          {/* D28: below full coverage, refuse and name what is missing. */}
          {!full && (
            <div role="alert" className="alert alert-warning mt-3">
              <div>
                <div className="font-medium">Export is blocked until every requirement is covered:</div>
                <ul className="mt-1 list-inside list-disc text-sm">
                  {cov.unmapped.map((u) => <li key={u.ref}><strong>{u.ref}</strong> — {u.missing}</li>)}
                </ul>
              </div>
            </div>
          )}

          {canExport && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <a href={`/api/runs/${runId}/export?format=xlsx`}
                 className={`btn btn-sm ${full ? 'btn-primary' : 'btn-disabled'}`}
                 aria-disabled={!full}>
                <Download className="h-4 w-4" aria-hidden /> Backlog (XLSX)
              </a>
              <a href={`/api/runs/${runId}/export?format=docx`} className="btn btn-sm btn-outline">
                <FileText className="h-4 w-4" aria-hidden /> Client question sheet (DOCX)
              </a>
            </div>
          )}
          {can(user.role, 'artifact:push') && <JiraDryRun runId={runId} />}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">Requirement</TableHead>
                <TableHead>Story</TableHead>
                <TableHead>Test scenario</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => {
                const first = i === 0 || rows[i - 1]!.ref !== r.ref
                return (
                  <TableRow key={i} className={first ? '' : 'border-t-0'}>
                    <TableCell>
                      {first && (
                        <>
                          <div className="font-medium">{r.ref}</div>
                          <div className="text-xs opacity-60">{r.requirement.slice(0, 70)}…</div>
                        </>
                      )}
                    </TableCell>
                    <TableCell className={r.s_status === 'dismissed' ? 'opacity-50' : ''}>
                      {r.story ?? <em className="text-[var(--color-warning)]">no story</em>}
                    </TableCell>
                    <TableCell className={r.t_status === 'dismissed' ? 'opacity-50' : ''}>
                      {r.test ?? <em className="text-[var(--color-warning)]">no test</em>}
                      {r.kind === 'negative' && <Badge variant="warning" className="ml-2">negative</Badge>}
                      {r.from_gap && <Badge variant="info" className="ml-1">covers a reviewed gap</Badge>}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  )
}

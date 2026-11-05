import Link from 'next/link'
import { requireUser } from '@/lib/auth/session.ts'
import { can } from '@/lib/auth/roles.ts'
import { sql } from '@/lib/db/client.ts'
import { AppShell } from '@/components/app-shell.tsx'
import { Badge } from '@/components/ui/badge.tsx'
import { Card, CardContent } from '@/components/ui/card.tsx'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.tsx'
import { ModelGate } from '@/components/model-gate.tsx'
import { Upload } from './upload.tsx'

export const dynamic = 'force-dynamic'

const STATUS: Record<string, 'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'info'> = {
  failed: 'destructive', review: 'info', approved: 'success', ready: 'success',
  extracting: 'warning', indexing: 'warning', analyzing: 'warning', generating: 'warning',
}

const IN_FLIGHT = ['extracting', 'indexing', 'analyzing', 'generating']
const LABEL: Record<string, string> = {
  extracting: 'extracting', indexing: 'indexing', analyzing: 'analysing', review: 'in review',
  approved: 'approved', generating: 'generating', ready: 'backlog ready', failed: 'failed',
}

export default async function Runs() {
  const user = await requireUser()
  const runs = await sql<any[]>`
    SELECT r.id, r.status, r.stage, r.progress_done, r.progress_total, r.started_at, r.is_demo,
           d.filename,
           (SELECT count(*) FROM findings f WHERE f.run_id = r.id AND f.merged_into_id IS NULL) AS findings,
           (SELECT count(*)::int FROM findings f
              WHERE f.run_id = r.id AND f.merged_into_id IS NULL AND f.status = 'proposed')
           + (SELECT count(*)::int FROM stories s WHERE s.run_id = r.id AND s.status = 'proposed')
           + (SELECT count(*)::int FROM tasks t WHERE t.run_id = r.id AND t.status = 'proposed')
           + (SELECT count(*)::int FROM test_scenarios ts WHERE ts.run_id = r.id AND ts.status = 'proposed')
           AS pending
    FROM runs r JOIN documents d ON d.id = r.document_id
    ORDER BY r.id DESC LIMIT 25`

  // Keep the list live while anything is still being analysed or generated.
  const inFlight = runs.some((r) => IN_FLIGHT.includes(r.status) || r.stage === 'queued')

  return (
    <AppShell user={user}>
      {inFlight && <meta httpEquiv="refresh" content="5" />}
      <h1 className="mb-4 text-2xl font-semibold">Runs</h1>
      <div className="mb-6">
        <ModelGate role={user.role}>
          {can(user.role, 'document:upload') ? <Upload /> : <></>}
        </ModelGate>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Run</TableHead>
                <TableHead>Document</TableHead>
                <TableHead className="w-64">Status</TableHead>
                <TableHead className="w-24 text-right">Findings</TableHead>
                <TableHead className="w-32 text-right">Awaiting you</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <Link href={`/runs/${r.id}`} className="link link-primary font-medium">#{r.id}</Link>
                      {r.is_demo && <Badge variant="info">stored</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Link href={`/runs/${r.id}`} className="font-mono text-xs hover:underline">{r.filename}</Link>
                    {r.started_at && (
                      <div className="mt-0.5 text-xs opacity-50">{new Date(r.started_at).toLocaleString()}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.stage === 'queued' ? 'secondary' : STATUS[r.status] ?? 'secondary'}>
                      {r.stage === 'queued' ? 'queued' : LABEL[r.status] ?? r.status}
                    </Badge>
                    {r.stage && r.stage !== 'queued' && (
                      <div className="mt-1 text-xs opacity-60">
                        {r.stage}
                        {r.progress_total > 0 && ` — ${r.progress_done}/${r.progress_total}`}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {['review', 'approved', 'generating', 'ready'].includes(r.status) ? r.findings : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    {!['review', 'approved', 'generating', 'ready'].includes(r.status) ? '—'
                      : r.pending > 0
                        ? <Badge variant="warning">{r.pending} pending</Badge>
                        : <Badge variant="success">all decided</Badge>}
                  </TableCell>
                </TableRow>
              ))}
              {runs.length === 0 && (
                <TableRow><TableCell colSpan={5} className="py-8 text-center opacity-60">
                  No runs yet. Upload a draft SRS to begin.
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  )
}

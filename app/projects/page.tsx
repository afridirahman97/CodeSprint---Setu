import Link from 'next/link'
import { requireUser } from '@/lib/auth/session.ts'
import { can } from '@/lib/auth/roles.ts'
import { sql } from '@/lib/db/client.ts'
import { env } from '@/lib/env.ts'
import { listLocalRepos } from '@/lib/projects/repo.ts'
import { AppShell } from '@/components/app-shell.tsx'
import { Card, CardContent } from '@/components/ui/card.tsx'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.tsx'
import { DevOnly } from './forbidden.tsx'
import { NewProject } from './new-project.tsx'
import { IndexBadge } from './status.tsx'

export const dynamic = 'force-dynamic'

export default async function Projects() {
  const user = await requireUser()
  if (!can(user.role, 'project:use')) return <AppShell user={user}><DevOnly /></AppShell>

  const projects = await sql<any[]>`
    SELECT p.*, (SELECT count(*)::int FROM dev_plans dp WHERE dp.project_id = p.id) AS plans
    FROM projects p ORDER BY p.id DESC`
  const busy = projects.some((p) => p.index_status === 'queued' || p.index_status === 'indexing')

  return (
    <AppShell user={user}>
      {busy && <meta httpEquiv="refresh" content="5" />}
      <h1 className="mb-1 text-2xl font-semibold">Projects</h1>
      <p className="mb-5 text-sm opacity-70">
        Upload a final SRS to a project and get an analysis against its codebase, a development plan,
        and a prompt file to start implementing with.
      </p>

      <Card className="mb-6">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Repository</TableHead>
                <TableHead className="w-32">Branch</TableHead>
                <TableHead className="w-40">Index</TableHead>
                <TableHead className="w-20 text-right">Plans</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={`/projects/${p.id}`} className="link link-primary font-medium">{p.name}</Link>
                  </TableCell>
                  <TableCell className="max-w-xs truncate font-mono text-xs" title={p.repo_url ?? p.local_path}>
                    {p.repo_url ?? `local: ${p.local_path}`}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{p.branch}</TableCell>
                  <TableCell><IndexBadge status={p.index_status} /></TableCell>
                  <TableCell className="text-right tabular-nums">{p.plans}</TableCell>
                </TableRow>
              ))}
              {projects.length === 0 && (
                <TableRow><TableCell colSpan={5} className="py-8 text-center opacity-60">
                  No projects yet. Create one below.
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <NewProject localRepos={await listLocalRepos()} localRoot={env.localReposRoot} />
    </AppShell>
  )
}

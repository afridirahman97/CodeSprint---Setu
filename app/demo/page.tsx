import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Archive } from 'lucide-react'
import { requireUser } from '@/lib/auth/session.ts'
import { sql } from '@/lib/db/client.ts'
import { AppShell } from '@/components/app-shell.tsx'
import { Card, CardContent } from '@/components/ui/card.tsx'

export const dynamic = 'force-dynamic'

/** D22: opens the stored run instead of generating a new one. */
export default async function Demo() {
  const user = await requireUser()
  const [run] = await sql<{ id: number }[]>`
    SELECT id FROM runs WHERE is_demo ORDER BY id DESC LIMIT 1`
  if (run) redirect(`/runs/${run.id}`)

  return (
    <AppShell user={user}>
      <Card className="mx-auto max-w-xl">
        <CardContent className="pt-5">
          <div className="flex items-start gap-3">
            <Archive className="mt-0.5 h-6 w-6 shrink-0 opacity-70" aria-hidden />
            <div>
              <h1 className="text-lg font-semibold">No stored run yet</h1>
              <p className="mt-1 text-sm opacity-80">
                The demo opens a previously captured analysis, so it never depends on the model
                answering live. Load it on the server with:
              </p>
              <pre className="mt-3 overflow-x-auto rounded-[var(--radius)] bg-[var(--color-base-200)] p-3 text-xs">
{`npm run index       # once — indexes the fixture system
npm run seed:demo   # loads the stored run`}
              </pre>
              <p className="mt-2 text-xs opacity-60">
                With Docker, prefix each with <code>docker compose exec app</code>.
              </p>
              <Link href="/runs" className="btn btn-sm btn-outline mt-4">Back to runs</Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  )
}

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db/client.ts'
import { apiUser, isResponse } from '@/lib/auth/api.ts'
import { audit } from '@/lib/auth/audit.ts'
import { buildPlanMd, buildPromptMd } from '@/lib/projects/markdown.ts'

/** ?format=prompt -> IMPLEMENTATION_PROMPT.md, ?format=plan -> DEVELOPMENT_PLAN.md. &inline=1 to view. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; planId: string }> }) {
  const user = await apiUser('project:use')
  if (isResponse(user)) return user
  const { id, planId } = await ctx.params
  const [plan] = await sql<any[]>`
    SELECT status FROM dev_plans WHERE id = ${Number(planId)} AND project_id = ${Number(id)}`
  if (!plan) return NextResponse.json({ error: 'plan not found' }, { status: 404 })
  if (plan.status !== 'ready') return NextResponse.json({ error: 'the plan is not finished yet' }, { status: 409 })

  const url = new URL(req.url)
  const format = url.searchParams.get('format') === 'plan' ? 'plan' : 'prompt'
  const md = format === 'plan' ? await buildPlanMd(Number(planId)) : await buildPromptMd(Number(planId))
  await audit({ actorId: user.id, action: 'devplan:export', entityType: 'dev_plan', entityId: Number(planId),
                after: { format } })
  const name = format === 'plan' ? `DEVELOPMENT_PLAN-${planId}.md` : `IMPLEMENTATION_PROMPT-${planId}.md`
  return new NextResponse(md, { headers: {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Content-Disposition': `${url.searchParams.get('inline') ? 'inline' : 'attachment'}; filename="${name}"`,
  } })
}

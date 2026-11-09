import { NextResponse } from 'next/server'
import { sql } from '@/lib/db/client.ts'
import { readDocument } from '@/lib/ingest/read.ts'
import { enqueuePlan } from '@/lib/queue.ts'
import { apiUser, isResponse } from '@/lib/auth/api.ts'
import { audit } from '@/lib/auth/audit.ts'
import { modelBlocker } from '@/lib/model/config.ts'

/** Upload a final SRS to a project; starts a development-plan job. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await apiUser('project:use')
  if (isResponse(user)) return user
  const projectId = Number((await ctx.params).id)

  const [project] = await sql<any[]>`SELECT index_status FROM projects WHERE id = ${projectId}`
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 })
  if (project.index_status !== 'ready') {
    return NextResponse.json({ error: 'The codebase is not indexed yet. Wait for indexing to finish.' }, { status: 409 })
  }
  const blocked = await modelBlocker()
  if (blocked) return NextResponse.json({ error: `${blocked.reason}. ${blocked.detail}` }, { status: 503 })

  const file = (await req.formData()).get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'no file supplied' }, { status: 400 })
  let text: string
  try {
    text = await readDocument(file.name, Buffer.from(await file.arrayBuffer()))
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 415 })
  }
  if (text.length < 200) return NextResponse.json({ error: 'document has too little text to analyse' }, { status: 422 })

  const [doc] = await sql<{ id: number }[]>`
    INSERT INTO documents (filename, mime, text, uploaded_by)
    VALUES (${file.name}, ${file.type || 'application/octet-stream'}, ${text}, ${user.id}) RETURNING id`
  const [plan] = await sql<{ id: number }[]>`
    INSERT INTO dev_plans (project_id, document_id, status, stage, created_by)
    VALUES (${projectId}, ${doc!.id}, 'queued', 'queued', ${user.id}) RETURNING id`
  await enqueuePlan({ planId: Number(plan!.id) })
  await audit({ actorId: user.id, action: 'devplan:create', entityType: 'dev_plan', entityId: plan!.id,
                after: { projectId, filename: file.name, chars: text.length } })
  return NextResponse.json({ planId: Number(plan!.id) }, { status: 202 })
}

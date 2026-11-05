import { readFile } from 'node:fs/promises'
import { sql } from '../lib/db/client.ts'
import { migrate } from '../lib/db/migrate.ts'

/**
 * D22: load the stored run. Repeatable, and it never touches a real run — it deletes
 * only rows belonging to a previous demo run.
 */
const snap = JSON.parse(await readFile('fixtures/demo-run.json', 'utf8'))
await migrate()

// Evidence cites the indexed fixture system (code, schema, RCAs). Without it, the load fails
// deep inside on a foreign key — say what is missing instead, before touching anything.
const runChunk = /@\d+$/
const kbCited = [...new Set<string>(snap.evidence.map((e: any) => e.chunk_id)
  .filter((id: string) => !runChunk.test(id)))]
const present = await sql<{ id: string }[]>`SELECT id FROM chunks WHERE id = ANY(${kbCited})`
const missing = kbCited.filter((id) => !present.some((p) => p.id === id))
if (missing.length) {
  console.error(
    `The stored run cites ${missing.length} fixture chunk(s) that are not indexed ` +
    `(e.g. ${missing.slice(0, 3).join(', ')}).\n` +
    `Index the fixture system first — it needs the embedding endpoint from Settings -> Model:\n\n` +
    `  npm run index        (or: docker compose exec app npm run index)\n`)
  await sql.end()
  process.exit(1)
}

// One transaction: a failure part-way must not leave a half-loaded "ready" run behind.
const runId = await sql.begin(async (sql) => {

  const old = await sql<{ id: number }[]>`SELECT id FROM runs WHERE is_demo`
  for (const r of old) {
    // Order matters. finding_evidence.chunk_id is ON DELETE RESTRICT (D3) — a citation
    // pins its evidence — so the run must go first, cascading its findings and their
    // citations, before the run-scoped requirement chunks can be removed. Deleting chunks
    // first raises finding_evidence_chunk_id_fkey, which is the constraint working.
    await sql`DELETE FROM runs WHERE id = ${r.id}`   // cascades findings, evidence, backlog
    await sql`DELETE FROM chunks WHERE run_id = ${r.id}`
    await sql`DELETE FROM documents WHERE id NOT IN (SELECT document_id FROM runs)`
  }
  if (old.length) console.log(`replaced ${old.length} previous demo run(s)`)

  const [doc] = await sql<any[]>`
    INSERT INTO documents (filename, mime, text)
    VALUES (${snap.document.filename}, ${snap.document.mime}, ${snap.document.text}) RETURNING id`
  const [ba] = await sql<any[]>`SELECT id FROM users WHERE role = 'ba' ORDER BY id LIMIT 1`
  const r = snap.run
  const [run] = await sql<any[]>`
    INSERT INTO runs (document_id, status, is_demo, llm_model, embed_model, started_at, finished_at,
                      approved_at, approved_by, backlog_approved_at, backlog_approved_by,
                      progress_done, progress_total)
    VALUES (${doc!.id}, ${r.status}, true, ${r.llm_model}, ${r.embed_model}, ${r.started_at},
            ${r.finished_at}, ${r.approved_at}, ${ba?.id ?? null}, ${r.backlog_approved_at},
            ${r.backlog_approved_at ? ba?.id ?? null : null}, ${r.progress_done}, ${r.progress_total})
    RETURNING id`
  const runId = run!.id

  // Old id -> new id, so every cross-reference survives the reload.
  const reqId = new Map<number, number>()
  for (const q of snap.requirements) {
    const [row] = await sql<any[]>`
      INSERT INTO requirements (run_id, ref, classification, ai_original, edited_text, order_index)
      VALUES (${runId}, ${q.ref}, ${q.classification}, ${q.ai_original}, ${q.edited_text}, ${q.order_index})
      RETURNING id`
    reqId.set(q.id, row!.id)
  }

  // Requirement chunk ids embed the run (D23), so they are rewritten on import.
  const chunkId = new Map<string, string>()
  for (const c of snap.chunks) {
    const next = c.id.replace(/@\d+$/, `@${runId}`)
    chunkId.set(c.id, next)
    // The embedding comes from the snapshot. An earlier version looked it up in the local
    // database and fell back to an arbitrary RCA's vector when the source run was gone —
    // which is silent corruption on any machine that did not produce the run, and exactly
    // the failure mode this project spends its guarantees on.
    if (!c.embedding) {
      throw new Error(
        `chunk ${c.id} has no embedding in fixtures/demo-run.json. ` +
          `Recapture it with: npm run snapshot:demo <runId>`,
      )
    }
    await sql`INSERT INTO chunks (id, kind, run_id, source_ref, text, embedding)
              VALUES (${next}, ${c.kind}, ${runId}, ${c.source_ref}, ${c.text}, ${c.embedding}::vector)
              ON CONFLICT (id) DO NOTHING`
  }

  const findId = new Map<number, number>()
  for (const f of snap.findings) {
    const [row] = await sql<any[]>`
      INSERT INTO findings (run_id, requirement_id, gap_class, merged_classes, severity,
                            ai_original, edited_text, question, status, ba_verdict, resolution_note)
      VALUES (${runId}, ${reqId.get(f.requirement_id)!}, ${f.gap_class}, ${f.merged_classes},
              ${f.severity}, ${f.ai_original}, ${f.edited_text}, ${f.question}, ${f.status},
              ${f.ba_verdict}, ${f.resolution_note}) RETURNING id`
    findId.set(f.id, row!.id)
  }
  for (const f of snap.findings.filter((x: any) => x.merged_into_id)) {
    await sql`UPDATE findings SET merged_into_id = ${findId.get(f.merged_into_id)!}
              WHERE id = ${findId.get(f.id)!}`
  }
  for (const e of snap.evidence) {
    await sql`INSERT INTO finding_evidence (finding_id, chunk_id)
              VALUES (${findId.get(e.finding_id)!}, ${chunkId.get(e.chunk_id) ?? e.chunk_id})
              ON CONFLICT DO NOTHING`
  }
  for (const s of snap.suppressed) {
    await sql`INSERT INTO suppressed (run_id, requirement_ref, gap_class, raw_evidence, reason, gap)
              VALUES (${runId}, ${s.requirement_ref}, ${s.gap_class}, ${s.raw_evidence}, ${s.reason}, ${s.gap})`
  }

  const storyId = new Map<number, number>()
  for (const s of snap.stories) {
    const [row] = await sql<any[]>`
      INSERT INTO stories (run_id, requirement_id, title, criteria, ai_original, edited_text, status)
      VALUES (${runId}, ${reqId.get(s.requirement_id)!}, ${s.title}, ${sql.json(s.criteria)},
              ${s.ai_original}, ${s.edited_text}, ${s.status}) RETURNING id`
    storyId.set(s.id, row!.id)
  }
  for (const t of snap.tasks) {
    await sql`INSERT INTO tasks (run_id, story_id, modules, tables, ai_original, edited_text, status)
              VALUES (${runId}, ${storyId.get(t.story_id)!}, ${t.modules}, ${t.tables},
                      ${t.ai_original}, ${t.edited_text}, ${t.status})`
  }
  const testId = new Map<number, number>()
  for (const t of snap.tests) {
    const [row] = await sql<any[]>`
      INSERT INTO test_scenarios (run_id, story_id, kind, from_finding_id, ai_original, edited_text, status)
      VALUES (${runId}, ${storyId.get(t.story_id)!}, ${t.kind},
              ${t.from_finding_id ? findId.get(t.from_finding_id) ?? null : null},
              ${t.ai_original}, ${t.edited_text}, ${t.status}) RETURNING id`
    testId.set(t.id, row!.id)
  }
  for (const l of snap.links) {
    await sql`INSERT INTO trace_links (run_id, requirement_id, story_id, test_id)
              VALUES (${runId}, ${reqId.get(l.requirement_id)!},
                      ${l.story_id ? storyId.get(l.story_id) ?? null : null},
                      ${l.test_id ? testId.get(l.test_id) ?? null : null})`
  }

  return runId
})

console.log(`seeded demo run #${runId} — captured from run ${snap.capturedFrom} on ${snap.capturedAt.slice(0, 10)}`)
console.log(`  ${snap.requirements.length} requirements · ${snap.findings.length} findings · ` +
            `${snap.stories.length} stories · ${snap.tests.length} tests`)
console.log(`  open it at /demo`)
await sql.end()

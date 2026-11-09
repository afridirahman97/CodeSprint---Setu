import { migrate } from '../lib/db/migrate.ts'
import { sql } from '../lib/db/client.ts'
import {
  getBoss, QUEUE, GENERATE_QUEUE, INDEX_QUEUE, PLAN_QUEUE,
  type RunJob, type GenerateJob, type IndexJob, type PlanJob,
} from '../lib/queue.ts'
import { processRun } from '../lib/pipeline/run.ts'
import { generateBacklog } from '../lib/pipeline/generate.ts'
import { indexProject } from '../lib/projects/indexer.ts'
import { processPlan } from '../lib/projects/plan.ts'

await migrate()

const boss = await getBoss()

await boss.work<RunJob>(QUEUE, { batchSize: 1 }, async ([job]) => {
  const { runId } = job!.data
  console.log(`[worker] run ${runId} starting`)
  try {
    await processRun(runId)
    console.log(`[worker] run ${runId} ready`)
  } catch (err) {
    // Mark the run failed so the UI can say so rather than spinning for ever.
    await sql`UPDATE runs SET status = 'failed', stage = NULL, error = ${(err as Error).message}
              WHERE id = ${runId}`
    console.error(`[worker] run ${runId} failed:`, (err as Error).message)
    throw err // let pg-boss retry (D34: tunnels drop, laptops sleep)
  }
})

await boss.work<GenerateJob>(GENERATE_QUEUE, { batchSize: 1 }, async ([job]) => {
  const { runId } = job!.data
  console.log(`[worker] generating backlog for run ${runId}`)
  try {
    await generateBacklog(runId)
    console.log(`[worker] run ${runId} backlog ready`)
  } catch (err) {
    await sql`UPDATE runs SET status = 'approved', stage = NULL, error = ${(err as Error).message}
              WHERE id = ${runId}`
    console.error(`[worker] run ${runId} generation failed:`, (err as Error).message)
    throw err
  }
})

await boss.work<IndexJob>(INDEX_QUEUE, { batchSize: 1 }, async ([job]) => {
  const { projectId } = job!.data
  console.log(`[worker] indexing project ${projectId}`)
  try {
    const r = await indexProject(projectId)
    console.log(`[worker] project ${projectId} indexed: ${r.files} files, ${r.chunks} pieces at ${r.commit.slice(0, 12)}`)
  } catch (err) {
    // A previous good index, if any, is kept (the swap is transactional) — only the status says failed.
    await sql`UPDATE projects SET index_status = 'failed', index_stage = NULL, index_error = ${(err as Error).message}
              WHERE id = ${projectId}`
    console.error(`[worker] project ${projectId} indexing failed:`, (err as Error).message)
    throw err
  }
})

await boss.work<PlanJob>(PLAN_QUEUE, { batchSize: 1 }, async ([job]) => {
  const { planId } = job!.data
  console.log(`[worker] development plan ${planId} starting`)
  try {
    await processPlan(planId)
    console.log(`[worker] development plan ${planId} ready`)
  } catch (err) {
    await sql`UPDATE dev_plans SET status = 'failed', stage = NULL, error = ${(err as Error).message}
              WHERE id = ${planId}`
    console.error(`[worker] development plan ${planId} failed:`, (err as Error).message)
    throw err
  }
})

console.log('[worker] ready')
process.on('SIGTERM', async () => { await boss.stop(); process.exit(0) })

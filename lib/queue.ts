import PgBoss from 'pg-boss'
import { env } from './env.ts'

/** D5: pg-boss on the same Postgres. No second datastore, nothing extra to approve. */
export const QUEUE = 'setu.run' as const
export const GENERATE_QUEUE = 'setu.generate' as const
export type RunJob = { runId: number; documentId: number }
export type GenerateJob = { runId: number }
export const INDEX_QUEUE = 'setu.project.index' as const
export const PLAN_QUEUE = 'setu.devplan' as const
export type IndexJob = { projectId: number }
export type PlanJob = { planId: number }

let boss: PgBoss | null = null

/**
 * Queue creation must not fail quietly.
 *
 * An earlier version swallowed every error here with `.catch(() => {})`. The generate
 * queue then did not exist, `send()` returned null instead of throwing — pg-boss does not
 * create a queue on demand — and a run sat at "queued" for ever with an audit row saying
 * it had been enqueued. Silence at both ends produced a run nothing was ever going to pick
 * up, and no error anywhere.
 */
async function ensureQueue(b: PgBoss, name: string) {
  try {
    await b.createQueue(name)
  } catch (err) {
    const msg = (err as Error).message ?? ''
    if (/already exists|duplicate key/i.test(msg)) return
    throw new Error(`could not create queue "${name}": ${msg}`)
  }
}

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss
  const b = new PgBoss({ connectionString: env.databaseUrl })
  b.on('error', (err) => console.error('[boss]', err))
  await b.start()
  await ensureQueue(b, QUEUE)
  await ensureQueue(b, GENERATE_QUEUE)
  await ensureQueue(b, INDEX_QUEUE)
  await ensureQueue(b, PLAN_QUEUE)
  boss = b
  return b
}

/** Throws if no job was created, rather than reporting success for nothing. */
async function send(queue: string, data: object): Promise<string> {
  const b = await getBoss()
  // Retries matter: the model lives on another machine over a tunnel that can drop
  // or a laptop that can sleep mid-run (D34).
  const id = await b.send(queue, data, { retryLimit: 2, retryDelay: 10, expireInMinutes: 120 })
  if (!id) throw new Error(`queue "${queue}" accepted no job — it may not exist`)
  return id
}

export const enqueueRun = (job: RunJob) => send(QUEUE, job)
export const enqueueGenerate = (job: GenerateJob) => send(GENERATE_QUEUE, job)
export const enqueueIndex = (job: IndexJob) => send(INDEX_QUEUE, job)
export const enqueuePlan = (job: PlanJob) => send(PLAN_QUEUE, job)

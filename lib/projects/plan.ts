import { sql } from '../db/client.ts'
import { embed } from '../ai/embed.ts'
import { extractRequirements } from '../ai/extract.ts'
import { planRequirement } from '../ai/devplan.ts'
import { getModelConfig } from '../model/config.ts'
import { retrieveProject } from './indexer.ts'

/** What retrieval brings back for each requirement. Main code dominates on purpose. */
const QUOTAS = { code: 8, sql: 2, config: 2, test: 2, doc: 1 } as const

/** "Java 17 / Spring Boot 3.2.4 (Maven)" from the build file, for the prompt and the export. */
export async function detectStack(projectId: number): Promise<string> {
  const rows = await sql<{ path: string; text: string }[]>`
    SELECT path, text FROM project_chunks
    WHERE project_id = ${projectId} AND kind = 'config'
      AND (path ~ '(^|/)pom\\.xml$' OR path ~ '(^|/)build\\.gradle(\\.kts)?$')
    ORDER BY length(path) LIMIT 3`
  const all = rows.map((r) => r.text).join('\n')
  const boot = all.match(/spring-boot-starter-parent<\/artifactId>\s*<version>([^<]+)</)?.[1]
    ?? all.match(/org\.springframework\.boot['"]?\)?\s*version\s*['"]([^'"]+)/)?.[1]
    ?? all.match(/spring-boot-gradle-plugin:([\d.]+)/)?.[1]
  const java = all.match(/<java\.version>([^<]+)</)?.[1]
    ?? all.match(/<maven\.compiler\.(?:release|source)>([^<]+)</)?.[1]
    ?? all.match(/languageVersion\s*=\s*JavaLanguageVersion\.of\((\d+)\)/)?.[1]
    ?? all.match(/sourceCompatibility\s*=\s*['"]?(?:JavaVersion\.VERSION_)?([\d_.]+)/)?.[1]?.replace('_', '.')
  const tool = rows.some((r) => r.path.endsWith('pom.xml')) ? 'Maven'
    : rows.length ? 'Gradle' : null
  const parts = [java && `Java ${java}`, boot ? `Spring Boot ${boot}` : (all.includes('spring-boot') ? 'Spring Boot' : null)]
    .filter(Boolean).join(' / ')
  return parts ? `${parts}${tool ? ` (${tool})` : ''}` : 'Java / Spring Boot'
}

/**
 * Extract the final SRS's requirements, then plan each against the project's index.
 * Idempotent on planId: a retry replaces what a previous attempt wrote.
 */
export async function processPlan(planId: number) {
  const [plan] = await sql<any[]>`
    SELECT dp.*, d.text AS doc_text, p.index_status, p.indexed_commit
    FROM dev_plans dp JOIN documents d ON d.id = dp.document_id JOIN projects p ON p.id = dp.project_id
    WHERE dp.id = ${planId}`
  if (!plan) throw new Error(`plan ${planId} not found`)
  if (plan.index_status !== 'ready') throw new Error('The project is not indexed yet. Index it, then try again.')

  const cfg = await getModelConfig()
  await sql`DELETE FROM dev_plan_items WHERE plan_id = ${planId}`
  await sql`UPDATE dev_plans SET status = 'extracting', stage = 'extracting requirements', error = NULL,
                                 progress_done = 0, progress_total = 0, commit_sha = ${plan.indexed_commit},
                                 llm_model = ${cfg.chatModel}
            WHERE id = ${planId}`

  const reqs = await extractRequirements(plan.doc_text)
  if (reqs.length === 0) throw new Error('No requirements were found in the document.')
  const stack = await detectStack(plan.project_id)

  await sql`UPDATE dev_plans SET status = 'analyzing', stage = 'planning against the codebase',
                                 progress_total = ${reqs.length} WHERE id = ${planId}`

  const vectors = await embed(reqs.map((r) => r.text))
  for (const [i, r] of reqs.entries()) {
    const hits = await retrieveProject(plan.project_id, vectors[i]!, QUOTAS)
    const p = await planRequirement({ ref: r.ref, requirement: r.text, stack, hits })
    await sql`
      INSERT INTO dev_plan_items (plan_id, order_index, ref, requirement, status, analysis,
                                  changes, tasks, risks, questions, evidence)
      VALUES (${planId}, ${i}, ${r.ref}, ${r.text}, ${p.status}, ${p.analysis},
              ${sql.json(p.changes)}, ${sql.json(p.tasks)}, ${sql.json(p.risks)},
              ${sql.json(p.questions)}, ${sql.json(p.evidence)})`
    await sql`UPDATE dev_plans SET progress_done = ${i + 1} WHERE id = ${planId}`
  }

  const counts = await sql<{ status: string; n: number }[]>`
    SELECT status, count(*)::int AS n FROM dev_plan_items WHERE plan_id = ${planId} GROUP BY status`
  const c = Object.fromEntries(counts.map((r) => [r.status, r.n]))
  const summary = `${reqs.length} requirements against ${stack}: ` +
    ['missing', 'partial', 'conflict', 'exists', 'unclear']
      .filter((s) => c[s]).map((s) => `${c[s]} ${s}`).join(', ') + '.'

  await sql`UPDATE dev_plans SET status = 'ready', stage = NULL, summary = ${summary}, finished_at = now()
            WHERE id = ${planId}`
}

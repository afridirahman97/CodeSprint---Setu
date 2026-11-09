import { getLlm, reasoningParam } from './client.ts'
import type { ProjectHit } from '../projects/indexer.ts'

export type PlanStatus = 'exists' | 'partial' | 'missing' | 'conflict' | 'unclear'
export type Change = { file: string; action: 'create' | 'modify'; what: string }
export type RequirementPlan = {
  status: PlanStatus
  analysis: string
  changes: Change[]
  tasks: string[]
  risks: string[]
  questions: string[]
  /** Chunk keys, already filtered to what the model was actually shown. */
  evidence: string[]
}

const SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'requirement_plan',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['exists', 'partial', 'missing', 'conflict', 'unclear'] },
        analysis: { type: 'string' },
        evidence: { type: 'array', items: { type: 'string' } },
        changes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string' },
              action: { type: 'string', enum: ['create', 'modify'] },
              what: { type: 'string' },
            },
            required: ['file', 'action', 'what'],
            additionalProperties: false,
          },
        },
        tasks: { type: 'array', items: { type: 'string' } },
        risks: { type: 'array', items: { type: 'string' } },
        questions: { type: 'array', items: { type: 'string' } },
      },
      required: ['status', 'analysis', 'evidence', 'changes', 'tasks', 'risks', 'questions'],
      additionalProperties: false,
    },
  },
} as const

export async function planRequirement(opts: {
  ref: string
  requirement: string
  stack: string
  hits: ProjectHit[]
}): Promise<RequirementPlan> {
  const labels = opts.hits.map((h, i) => ({ label: `E${i + 1}`, hit: h }))
  const evidenceBlock = labels
    .map(({ label, hit }) =>
      `[${label}] ${hit.path}:${hit.startLine}-${hit.endLine}${hit.symbol ? ` (${hit.symbol})` : ''}\n${hit.text}`)
    .join('\n\n')

  const prompt = `You are a senior ${opts.stack} developer planning how to implement one requirement
in an existing codebase. Below are the parts of the codebase most related to it.

Decide:
- status:
    exists    the code already does this; nothing or almost nothing to build
    partial   some of it exists; it needs extending
    missing   nothing relevant exists; it must be built
    conflict  the existing code does something that contradicts the requirement
    unclear   the excerpts are not enough to tell
- analysis: 2-4 sentences on what exists today and what is missing, naming classes and methods.
- evidence: the labels (E1, E2, ...) of the excerpts your analysis relies on. Only labels shown below.
- changes: files to modify (use paths exactly as shown below) or create (follow the package
  layout and naming conventions of the files shown). "what" says what to change, concretely.
- tasks: ordered, concrete development steps (entity/migration, repository, service, controller,
  validation, tests). Each one a single sentence.
- risks: what could break or needs care (transactions, existing callers, data migration, security).
- questions: only what the requirement leaves genuinely open and the code cannot answer.

Rules:
- Base every claim about existing code on the excerpts. Do not invent classes that are not shown;
  propose new ones only under "changes" with action "create".
- Keep the existing architecture and style. Do not propose rewrites.
- If nothing needs doing, return empty changes and tasks.

Codebase excerpts:
${evidenceBlock || '(none found)'}

Requirement ${opts.ref}:
${opts.requirement}`

  const { client, chatModel, reasoningEffort } = await getLlm()
  const res = await client.chat.completions.create({
    model: chatModel,
    messages: [{ role: 'user', content: prompt }],
    response_format: SCHEMA as never,
    ...reasoningParam(reasoningEffort),
  })
  const raw = res.choices[0]?.message?.content ?? '{}'
  let p: Partial<RequirementPlan> & { evidence?: string[] }
  try {
    p = JSON.parse(raw)
  } catch {
    throw new Error(`the model returned something that is not JSON for ${opts.ref}`)
  }

  // Citation filter: only labels that were really shown survive, mapped back to chunk keys.
  const byLabel = new Map(labels.map((l) => [l.label.toUpperCase(), l.hit.key]))
  const evidence = [...new Set((p.evidence ?? [])
    .map((e) => byLabel.get(String(e).replace(/[\[\]\s]/g, '').toUpperCase()))
    .filter((k): k is string => !!k))]

  const str = (xs: unknown) => (Array.isArray(xs) ? xs : []).map(String).map((s) => s.trim()).filter(Boolean)
  const status = (['exists', 'partial', 'missing', 'conflict', 'unclear'] as const)
    .includes(p.status as PlanStatus) ? p.status as PlanStatus : 'unclear'
  return {
    status,
    analysis: String(p.analysis ?? '').trim() || 'No analysis returned.',
    evidence,
    changes: (Array.isArray(p.changes) ? p.changes : [])
      .filter((c) => c && c.file && c.what)
      .map((c) => ({ file: String(c.file).trim(), action: c.action === 'create' ? 'create' : 'modify', what: String(c.what).trim() })),
    tasks: str(p.tasks),
    risks: str(p.risks),
    questions: str(p.questions),
  }
}

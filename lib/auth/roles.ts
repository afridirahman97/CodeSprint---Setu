/**
 * D10: everyone signed in reads everything. This is an internal tool — a QA hiding
 * findings from a BA has no value, and a full permission matrix would be a lot of code
 * defending a threat that does not exist.
 *
 * Roles mainly choose which artifact you land on. Only these actions gate.
 * Exception: developer projects and their plans are visible to devs (and superadmin) only.
 */
export const ROLES = ['superadmin', 'ba', 'dev', 'qa', 'pm'] as const
export type Role = (typeof ROLES)[number]

export const GATED = {
  'model:configure': ['superadmin'], // the endpoint decides where client data goes
  'document:upload': ['ba', 'superadmin'], // starts an expensive run; BA owns the document
  'finding:dismiss': ['ba', 'superadmin'],
  'srs:approve': ['ba', 'superadmin'], // the human gate the whole design turns on
  'backlog:approve': ['ba', 'superadmin'],
  'artifact:export': ['ba', 'pm', 'superadmin'],
  'artifact:push': ['ba', 'pm', 'superadmin'],
  // Developer projects: point Setu at a repository, upload the final SRS, get a plan.
  // The plan is the developer's working material, so it is the one thing others do not see.
  'project:use': ['dev', 'superadmin'],
} as const satisfies Record<string, readonly Role[]>

export type GatedAction = keyof typeof GATED

export const can = (role: Role, action: GatedAction): boolean =>
  (GATED[action] as readonly Role[]).includes(role)

/** Where each role starts. Reading is open to all of them (D10). */
export const LANDING: Record<Role, string> = {
  superadmin: '/runs',
  ba: '/runs',
  dev: '/projects',
  qa: '/runs?view=tests',
  pm: '/runs?view=matrix',
}

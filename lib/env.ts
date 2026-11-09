/**
 * Configuration only. No node:* imports — this is pulled in by pages and components,
 * and anything platform-specific here breaks the bundler. The egress assertion that
 * enforces D31 lives in ./egress.ts, which only the boot path imports.
 */
export const env = {
  /** Bootstrap only, until a config is saved. D34: the OmniRoute gateway, not a local GPU. */
  llmBaseUrl: process.env.LLM_BASE_URL ?? 'http://localhost:20128/v1',
  llmModel: process.env.LLM_MODEL ?? '',
  llmApiKey: process.env.LLM_API_KEY ?? '',
  /** D7: measured 215s -> 4s. Not a tuning knob. */
  reasoningEffort: process.env.LLM_REASONING_EFFORT ?? 'none',
  embedModel: process.env.EMBED_MODEL ?? 'text-embedding-nomic-embed-text-v1.5',
  /**
   * Must match the vector(N) the schema stores, so changing it is an env change PLUS a
   * migration PLUS a full re-index (see README). Everything that cares reads it from here:
   * the width guard in ai/embed.ts, the blocker in model/config.ts, the connection test.
   */
  embedDims: Number(process.env.EMBED_DIMS ?? 768),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://setu:setu@localhost:5433/setu',
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-only-secret-at-least-32-chars-long!',
  /** Where the worker clones project repositories. A volume in compose. */
  reposDir: process.env.SETU_REPOS_DIR ?? '/data/repos',
  /** Host folders mounted read-only for "local repository" projects. */
  localReposRoot: process.env.SETU_LOCAL_REPOS ?? '/repos',
  jiraPushEnabled: process.env.JIRA_PUSH_ENABLED === 'true',
  jiraBaseUrl: process.env.JIRA_BASE_URL ?? '',
  jiraProjectKey: process.env.JIRA_PROJECT_KEY ?? 'SETU',
  jiraToken: process.env.JIRA_TOKEN ?? '',
}

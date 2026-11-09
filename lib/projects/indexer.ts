import { rm } from 'node:fs/promises'
import { sql } from '../db/client.ts'
import { embed, toVector } from '../ai/embed.ts'
import { decryptSecret } from '../model/secret.ts'
import { checkout, walk, MAX_FILES } from './repo.ts'
import { chunkFile, classify, embeddingText, type ChunkKind, type ProjectChunk } from './chunk.ts'

const EMBED_BATCH = 32

/**
 * Clone the project's branch, split it into chunks, embed and store them.
 *
 * The old index is replaced in one transaction at the end, so a failed or interrupted
 * re-index leaves the previous index usable rather than half-deleted.
 */
export async function indexProject(projectId: number) {
  const [p] = await sql<any[]>`SELECT * FROM projects WHERE id = ${projectId}`
  if (!p) throw new Error(`project ${projectId} not found`)
  const stage = (s: string) => sql`UPDATE projects SET index_stage = ${s} WHERE id = ${projectId}`

  await sql`UPDATE projects SET index_status = 'indexing', index_error = NULL WHERE id = ${projectId}`
  await stage(`fetching ${p.branch}`)
  const { dir, commit } = await checkout(projectId, {
    repoUrl: p.repo_url, localPath: p.local_path, branch: p.branch,
    username: p.repo_username, token: decryptSecret(p.repo_token),
  })

  try {
    await stage('reading files')
    const files = await walk(dir, (rel) => classify(rel) !== null)
    const chunks: ProjectChunk[] = files.flatMap((f) => chunkFile(f.path, f.text))
    if (chunks.length === 0) {
      throw new Error('No Java, Spring configuration, SQL or Markdown files were found on that branch.')
    }

    const vectors: number[][] = []
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      await stage(`embedding ${Math.min(i + EMBED_BATCH, chunks.length)} of ${chunks.length} pieces`)
      vectors.push(...await embed(chunks.slice(i, i + EMBED_BATCH).map(embeddingText)))
    }

    await stage('saving')
    await sql.begin(async (tx) => {
      await tx`DELETE FROM project_chunks WHERE project_id = ${projectId}`
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i]!
        await tx`
          INSERT INTO project_chunks (project_id, chunk_key, kind, path, symbol, start_line, end_line, text, embedding)
          VALUES (${projectId}, ${c.key}, ${c.kind}, ${c.path}, ${c.symbol}, ${c.startLine}, ${c.endLine},
                  ${c.text}, ${toVector(vectors[i]!)}::vector)
          ON CONFLICT (project_id, chunk_key) DO NOTHING`
      }
      await tx`
        UPDATE projects SET index_status = 'ready', index_stage = NULL, index_error = NULL,
               indexed_commit = ${commit}, indexed_at = now(),
               file_count = ${files.length}, chunk_count = ${chunks.length}
        WHERE id = ${projectId}`
    })
    return { files: files.length, chunks: chunks.length, commit, truncated: files.length >= MAX_FILES }
  } finally {
    // The index holds what plans need; the checkout is only a means to it.
    await rm(dir, { recursive: true, force: true })
  }
}

export type ProjectHit = {
  key: string; kind: ChunkKind; path: string; symbol: string | null
  startLine: number; endLine: number; text: string; score: number
}

/**
 * Per-kind quotas, as in the BA flow (rag/store.ts, D8): without them, long Markdown or
 * test code out-scores the service class a requirement is really about.
 */
export async function retrieveProject(projectId: number, vector: number[],
                                      quotas: Partial<Record<ChunkKind, number>>): Promise<ProjectHit[]> {
  const v = toVector(vector)
  const groups = await Promise.all(Object.entries(quotas).map(async ([kind, k]) => {
    const rows = await sql<any[]>`
      SELECT chunk_key, kind, path, symbol, start_line, end_line, text,
             1 - (embedding <=> ${v}::vector) AS score
      FROM project_chunks
      WHERE project_id = ${projectId} AND kind = ${kind}
      ORDER BY embedding <=> ${v}::vector
      LIMIT ${k!}`
    return rows.map((r) => ({
      key: r.chunk_key, kind: r.kind, path: r.path, symbol: r.symbol,
      startLine: r.start_line, endLine: r.end_line, text: r.text, score: Number(r.score),
    }))
  }))
  return groups.flat().sort((a, b) => b.score - a.score)
}

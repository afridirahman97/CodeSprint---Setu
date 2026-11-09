-- Developer projects: a codebase (git repo + starting branch) that a developer analyses
-- final SRS documents against, producing a development plan per document.
--
-- Kept apart from runs/chunks on purpose. The BA review flow checks a draft against the
-- fixed reference system; this flow checks a final SRS against a repository the developer
-- chose. Sharing `chunks` would let one project's code be retrieved — and cited — by
-- another project's plan, or by a BA run.
CREATE TABLE projects (
    id              bigserial PRIMARY KEY,
    name            text NOT NULL,
    -- Exactly one source: a remote URL, or a path under the mounted local repos folder.
    repo_url        text,
    local_path      text,
    branch          text NOT NULL,
    -- Optional credentials for a private remote. Token is AES-GCM encrypted (model/secret.ts).
    repo_username   text,
    repo_token      text,
    index_status    text NOT NULL DEFAULT 'pending'
                    CHECK (index_status IN ('pending', 'queued', 'indexing', 'ready', 'failed')),
    index_stage     text,
    index_error     text,
    indexed_commit  text,
    indexed_at      timestamptz,
    file_count      int NOT NULL DEFAULT 0,
    chunk_count     int NOT NULL DEFAULT 0,
    created_by      bigint REFERENCES users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    CHECK ((repo_url IS NULL) <> (local_path IS NULL))
);

CREATE TABLE project_chunks (
    id          bigserial PRIMARY KEY,
    project_id  bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- Stable within a project: "path#Symbol" — what a plan cites, read as a place.
    chunk_key   text NOT NULL,
    kind        text NOT NULL CHECK (kind IN ('code', 'test', 'config', 'sql', 'doc')),
    path        text NOT NULL,
    symbol      text,
    start_line  int NOT NULL,
    end_line    int NOT NULL,
    text        text NOT NULL,
    embedding   vector(768) NOT NULL,
    UNIQUE (project_id, chunk_key)
);
CREATE INDEX idx_project_chunks_embedding ON project_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_project_chunks_project ON project_chunks (project_id);

CREATE TABLE dev_plans (
    id              bigserial PRIMARY KEY,
    project_id      bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_id     bigint NOT NULL REFERENCES documents(id),
    status          text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'extracting', 'analyzing', 'ready', 'failed')),
    stage           text,
    progress_done   int NOT NULL DEFAULT 0,
    progress_total  int NOT NULL DEFAULT 0,
    error           text,
    -- The commit the plan was made against: a plan is only true of that code.
    commit_sha      text,
    llm_model       text,
    summary         text,
    created_by      bigint REFERENCES users(id),
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz
);

CREATE TABLE dev_plan_items (
    id              bigserial PRIMARY KEY,
    plan_id         bigint NOT NULL REFERENCES dev_plans(id) ON DELETE CASCADE,
    order_index     int NOT NULL,
    ref             text NOT NULL,
    requirement     text NOT NULL,
    status          text NOT NULL CHECK (status IN ('exists', 'partial', 'missing', 'conflict', 'unclear')),
    analysis        text NOT NULL,
    -- [{file, action: create|modify, what}]
    changes         jsonb NOT NULL DEFAULT '[]',
    tasks           jsonb NOT NULL DEFAULT '[]',
    risks           jsonb NOT NULL DEFAULT '[]',
    questions       jsonb NOT NULL DEFAULT '[]',
    -- Only chunk keys that were actually shown to the model survive (the citation filter).
    evidence        jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX idx_dev_plan_items_plan ON dev_plan_items (plan_id, order_index);

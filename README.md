# Setu

An AI reviewer that checks a draft SRS against the system we have already built — then drafts the
backlog the delivery team works from.

- **`docs/USER_GUIDE.md`** — how to use the app, step by step, per role.
- **`DESIGN.md`** — 35 decisions and why each won. Read this to understand *why*.
- **`SPEC.md`** — what to build. Read this to understand *what*.
- **`.scratch/setu/issues/`** — the work, as 15 tickets in dependency order.

## Quick start

You need **Docker** (Docker Desktop on macOS/Windows, Docker Engine + Compose on Linux). The model
comes from [OmniRoute](#omniroute-the-default-model-endpoint), which compose runs for you — the
deploy server has no GPU, so there is no local model runtime to install.

```bash
git clone git@github.com:arifonoy05/CodeSprint---Setu.git setu
cd setu
cp .env.example .env
# INITIAL_PASSWORD is required — it is the OmniRoute dashboard login, which holds provider keys
echo "INITIAL_PASSWORD=$(openssl rand -base64 24)" >> .env

docker compose up -d --build           # app :3000, worker, pgvector :5433, omniroute :20128
docker compose exec app npm run seed   # five users, one per role; prints the password
open http://localhost:3000/login
```

Then:

1. Sign in as `admin@bracits.com` (password printed by `npm run seed`, default `setu-demo-password`;
   choose your own with `docker compose exec -e SEED_PASSWORD=... app npm run seed`).
2. Set up the model: add a provider and mint a key in the OmniRoute dashboard
   (`http://localhost:20128`), then open **Model** in the header (`/settings/model`) and save that
   endpoint. Nothing runs until its **Test connection** passes — see
   [OmniRoute](#omniroute-the-default-model-endpoint).
3. Sign in as `ba@bracits.com` and upload an SRS on **Runs**. The [user guide](docs/USER_GUIDE.md)
   walks through the rest.

For production, set a real `SESSION_SECRET` (32+ characters) in `.env` before `docker compose up`.

### Stopping and resetting

```bash
docker compose down        # stop; data is kept in the setu-db and omniroute-data volumes
docker compose down -v     # stop and delete both — including OmniRoute's providers and keys
docker compose logs -f app worker
```

## Deploying on a local network

On a LAN there is no certificate to have, so Setu serves plain HTTP. Set this in `.env`:

```
SETU_ALLOW_HTTP=true
SESSION_SECRET=<32+ random chars>
INITIAL_PASSWORD=<strong password>
```

`SETU_ALLOW_HTTP` exists because the login cookie is marked `secure` in production, and a secure
cookie is **dropped over plain HTTP** — sign-in would appear to do nothing at all. Leave it unset
anywhere reachable from outside the LAN, and terminate TLS in front instead.

```bash
docker compose up -d --build
docker compose exec -e SEED_PASSWORD='<a real password>' app npm run seed
# http://<server-ip>:3000
```

The published ports are `3000` (Setu) and `20128` (the OmniRoute dashboard, which holds your
provider API keys). That is fine on a trusted network and wrong on a public one.

Back up both volumes — `setu-db` holds runs and approvals, `omniroute-data` holds provider keys:

```bash
docker run --rm -v codesprint_setu_setu-db:/v -v "$PWD":/b alpine \
  tar czf /b/setu-db-$(date +%F).tar.gz -C /v .
```

Update with `git pull && docker compose up -d --build`.

## OmniRoute: the default model endpoint

[OmniRoute](https://github.com/diegosouzapw/OmniRoute) is an OpenAI-compatible gateway that fronts
many providers behind one `/v1` endpoint. **D34: the deploy server has no GPU**, so the models come
from providers through the gateway instead of a local runtime, and compose runs it as the
`omniroute` service:

```yaml
omniroute:
  image: diegosouzapw/omniroute:latest
  environment:
    INITIAL_PASSWORD: ${INITIAL_PASSWORD:?set INITIAL_PASSWORD in .env}
  ports: ["20128:20128"]
  volumes: ["omniroute-data:/app/data"]
  stop_grace_period: 40s
```

- The dashboard and the API share port `20128`; it is published so you can reach the dashboard in a
  browser.
- Its database, provider keys and settings live in the **`omniroute-data`** volume at `/app/data`,
  so they survive `docker compose down` and `up`. `stop_grace_period: 40s` lets its SQLite
  checkpoint instead of being killed mid-write.
- `INITIAL_PASSWORD` has no default — compose refuses to start without one. This container holds
  your provider API keys, and OmniRoute's own fallback is the literal string `CHANGEME`.
- `app` and `worker` default to `LLM_BASE_URL=http://omniroute:20128/v1` and `depends_on` it, so
  the name `omniroute` resolves before anything tries the endpoint. Compose only resolves a service
  name while that service's container is running.

### Setting it up (first run)

1. Open `http://localhost:20128`, sign in with your `INITIAL_PASSWORD`, then use the Quick Start to
   **connect a provider** and **create an API key**.
2. Check the gateway answers:
   `curl -H "Authorization: Bearer <key>" http://localhost:20128/v1/models`
3. In Setu, as `admin@bracits.com`, open **Model** (`/settings/model`):

| field | value |
|---|---|
| Endpoint URL | `http://omniroute:20128/v1` — the service name, resolved inside compose |
| API key | the key you minted in OmniRoute |
| Chat model | **Load from endpoint**, then pick one |
| Advanced → Embedding endpoint | a **768-dimension** embedder, see below |
| Advanced → Reasoning effort | `none` |

Then **Test connection** and **Save and verify**.

### Two things compose cannot do for you

Wiring the gateway in is not the same as switching it on. Both of these are deliberate design
(D31), not gaps to patch:

1. **A superadmin must save and verify a config.** Until then the environment is only a bootstrap,
   and every run is blocked with *No model configured*.
2. **A superadmin must allow external models.** OmniRoute sits on a private address, but it
   forwards prompts to third-party providers, and Setu infers that from the size and vendor names
   of the model list. Runs stay blocked with *External models are not permitted* until someone
   clicks **Allow models outside the network…** and records a reason, which is then shown on
   `/health`. That choice sends requirement text, source code and incident history outside your
   network — make it deliberately.

### Embeddings: OmniRoute can do it, with the right model id

The schema stores `vector(768)`, and Setu refuses any other width. Setu does **not** send a
`dimensions` parameter, so the model has to return 768 *natively* — `openai/text-embedding-3-small`
returns 1536 and is rejected, even though it could be truncated.

OmniRoute serves `/v1/embeddings`, and its model ids need a **`provider/model` prefix** — a bare id
is refused. Ids that are natively 768:

| embedding model id | needs |
|---|---|
| `fireworks/nomic-ai/nomic-embed-text-v1.5` | a Fireworks API key |
| `deepinfra/BAAI/bge-base-en-v1.5` | a DeepInfra API key |
| `together/togethercomputer/m2-bert-80M-8k-retrieval` | a Together API key |
| `ollama-local/nomic-embed-text` | Ollama reachable from OmniRoute |

Embeddings always need a provider API key — OmniRoute's keyless pools are chat-only. So:

- **Simplest, no extra service:** leave **Advanced → Embedding endpoint** blank so embeddings use
  the gateway, and set **Embedding model** to `fireworks/nomic-ai/nomic-embed-text-v1.5`. Costs a
  key; the text leaves your network like the chat calls do.
- **Keeps text in-network:** run `nomic-embed-text` in Ollama or LM Studio (768 wide, fine on CPU —
  no GPU needed) and point **Embedding endpoint** straight at it, e.g.
  `http://host.docker.internal:11434/v1`, leaving chat on the gateway. Going *through* OmniRoute to
  reach your own Ollama only adds a hop.

Model ids and widths above come from OmniRoute's embedding registry, not from a live run — confirm
before relying on either route. The probe takes the endpoint as an argument:

```bash
docker compose exec app npm run probe:endpoint -- http://host.docker.internal:1234/v1
#   dimensions: 768  (matches the schema)
```

If OmniRoute runs on a different machine instead of in compose, use that machine's address and set
`LLM_BASE_URL` accordingly.

### Or: 9router for embeddings, on a free tier

OmniRoute's 768-wide options all need a paid provider key. [9router](https://github.com/decolua/9router)
reaches `jina-embeddings-v2-base-en` — 768 native, and Jina's free tier is 10M tokens on signup. It
is a second gateway used **only for embeddings**; chat stays on OmniRoute. Enable it in `.env`:

```
COMPOSE_FILE=docker-compose.yml:docker-compose.9router.yml
NINEROUTER_PASSWORD=<strong password>
NINEROUTER_JWT_SECRET=<32+ random chars>
```

`docker compose up -d` then also starts it, published on **20129** (inside the network it listens on
20128 like OmniRoute — only published ports have to differ). Add a Jina key and mint an API key at
`http://localhost:20129`, then in **Settings → Model → Advanced**:

| field | value |
|---|---|
| Embedding endpoint | `http://9router:20128/v1` |
| Embedding endpoint API key | your 9router key |
| Embedding model | `jina/jina-embeddings-v2-base-en` — type it, see below |

Two traps:

- **The model list will not offer it.** 9router's `/v1/models` returns chat models only, so
  **Load from endpoint** never shows embedding ids. Type the id in.
- **Keep the `jina/` prefix.** An unprefixed id is silently routed to OpenAI, which returns
  1536-wide vectors from a provider you did not intend — a wrong answer, not an error.
- **Add Jina from the built-in provider list**, not as a custom OpenAI-compatible endpoint. A custom
  node is typed for chat and serves no embeddings, and the model id resolves to provider `jina-ai`,
  which then has no credentials.

Measured through this setup: `jina-embeddings-v2-base-en` returns 768 with or without a `dimensions`
request; `jina-embeddings-v3` is 1024 natively and returns 768 because Setu asks for it. A 32-input
batch came back as 32 vectors of 768, in order, in about a second. Note `/v1/models/embedding` lists
only v3 — the v2 id is not advertised but works when sent.

### Running at a width other than 768

`EMBED_DIMS` sets the width Setu expects, and everything that cares reads it: the guard in
`lib/ai/embed.ts`, the run blocker, the connection test. It is deliberately **not** enough on its
own — the schema stores `vector(N)`, and Postgres rejects anything else.

Changing width is three steps, in this order:

1. Add a migration, e.g. `lib/db/migrations/0013_embed_dims.sql`. Stored vectors cannot be
   converted to a new width, so they go:

   ```sql
   TRUNCATE chunks;
   ALTER TABLE chunks ALTER COLUMN embedding TYPE vector(1024);
   DROP INDEX idx_chunks_embedding;
   CREATE INDEX idx_chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops);
   ```

2. Set `EMBED_DIMS=1024` in `.env` (app and worker both read it — they must agree).
3. Re-index: `docker compose exec app npm run index`, and re-run any analysis, since old
   findings cite chunks that no longer exist.

A numbered migration on purpose, not a width check at boot: migrations are tracked by filename and
run once, so the `TRUNCATE` happens when a human writes it — not on every start, where a typo in
`EMBED_DIMS` would quietly empty the table.

The quality figures below were measured at 768; another width invalidates them.

### Using an OpenAI embedding model

`text-embedding-3-small` returns 1536 and `-large` 3072, but both support Matryoshka truncation:
Setu sends `dimensions` with every embedding request, so they return `EMBED_DIMS` wide and need
**no migration and no re-index**. Set the Embedding model to `openai/text-embedding-3-small`
(through a gateway) and leave `EMBED_DIMS=768`.

This costs per token, and the endpoint is public — prompts leave your network, so a superadmin has
to allow external models, exactly as for chat. Endpoints that reject an unknown `dimensions` field
say so at the connection test.

Leave `COMPOSE_FILE` unset and nothing about the default stack changes — `docker-compose.9router.yml`
is never read, so its two secrets are not required either. (A compose *profile* cannot do this:
variables are interpolated before profiles are filtered, so a profiled service with required secrets
breaks `docker compose` for everyone who has not set them.)

## Connecting the model

The endpoint is configured in the app, not the environment: sign in as a superadmin and open
**Settings → Model** (`/settings/model`). Set the URL, an optional API key, and the model names,
then **Test connection**.

The test checks what Setu depends on, not merely that the endpoint replies:

| | |
|---|---|
| reachable | can it list models |
| network | does it resolve inside your network |
| chat + `json_schema` | structured output, or findings will not parse |
| `reasoning_effort` | honoured, or runs take hours instead of minutes |
| embedding width | must match the `vector(768)` the schema stores |

**Nothing runs until that test passes** — uploads return 503 and generation refuses. API keys are
encrypted at rest and never shown again.

A public endpoint (a hosted provider) works, but only after explicitly acknowledging that
requirement text, source code and incident history will leave your network. That contradicts the
BRD's zero-egress requirement, so it is a deliberate, recorded choice rather than a default.

`LLM_BASE_URL` and friends remain as a bootstrap for a fresh install, before anything is saved.

### Connecting a model that runs outside the container

The URL is resolved by **Setu**, not by your browser. Inside a container `127.0.0.1` is the
container itself, so a model on your machine is not reachable there.

| where the model runs | what to enter |
|---|---|
| OmniRoute, as compose runs it | `http://omniroute:20128/v1` + API key |
| the machine hosting Setu (LM Studio, Ollama) | `http://host.docker.internal:1234/v1` |
| another machine on the network | `http://10.0.4.20:1234/v1` |
| a hosted provider | `https://api.provider.com/v1` + API key |

Enter a loopback address and the settings page says why it cannot work and offers the corrected
URL as a one-click fix, rather than failing with a bare "Connection error".

Demonstrated:

```
from your Mac:              127.0.0.1:1234       -> 200
from inside the container:  127.0.0.1:1234       -> CONNECTION REFUSED
                            host.docker.internal -> reachable (192.168.65.254)
```

Running without Docker (`npm run dev`), the app *is* on your machine, so `127.0.0.1` is correct
and `host.docker.internal` will not resolve.

### Where the private-network check runs

The app sends client business logic to the model endpoint, so that endpoint must be private. The
check (D31) runs in the **connection test**, not at boot — the endpoint lives in the database now, so
refusing to start would only lock you out of the page where you fix it. `lib/model/test.ts` resolves
the host, records whether it is private, and reports the reason when it is not:

```
The endpoint resolves to a public address (172.66.0.243, 162.159.140.245). Setu sends client
business logic to this endpoint and will not do so over a public network. Use a reverse tunnel
or VPN so it is reachable privately.
```

A public endpoint — or a private one that forwards outward, like OmniRoute — then blocks every run
until a superadmin allows external models and records a reason.

### Reaching a model on a laptop

The app can run on a remote server while the model runs in LM Studio on a laptop. Join them
with a reverse tunnel — the laptop dials out, nothing on it ever listens publicly:

```bash
# from the laptop running LM Studio
ssh -R 0.0.0.0:1234:localhost:1234 user@server
```

### The gotcha that eats a demo morning

`ssh -R` binds to the server's `127.0.0.1` by default, which **a container cannot reach**. It has to
bind where the Docker bridge can see it — hence `0.0.0.0` above, which needs
`GatewayPorts clientspecified` in the server's `sshd_config`.

Always verify from *inside* the container, never from the server shell:

```bash
docker compose exec app wget -qO- http://host.docker.internal:1234/v1/models
```

Tailscale works too; its CGNAT range is already allowed by the egress check.

## The demo path

Runs inside the container, so no local checkout or Node install is needed. Configure the model
first — indexing needs the embedding endpoint.

```bash
docker compose exec app npm run seed        # five users, one per role
docker compose exec app npm run index       # index the fixture system (30 chunks)
docker compose exec app npm run seed:demo   # load the stored run, so the walkthrough never depends on a live model
open http://localhost:3000/demo
```

Sign in as `ba@bracits.com` (password from `npm run seed`), then:
**findings → approve → backlog → matrix → export**.

## UI

Tailwind v4, **daisyUI 5** (all 35 default themes) and **shadcn/ui** primitives.

The two libraries have competing theme systems, so daisyUI owns theming and shadcn's
variables are defined in terms of it in `app/globals.css`:

```css
@theme inline {
  --color-background: var(--color-base-100);
  --color-destructive: var(--color-error);
  ...
}
```

A stock shadcn component using `bg-card` or `bg-destructive` therefore compiles straight to
the daisy palette and repaints with the theme, instead of staying on its own colours and
looking broken on 34 of the 35. Nothing in a component hardcodes a colour.

The theme picker is in the header; the choice is stored per-browser and applied before
first paint (`ThemeScript`) so there is no flash on navigation. "system" follows the OS.

## Development

Needs Node 24.

```bash
npm install
docker compose up -d db omniroute   # the bootstrap endpoint is omniroute on :20128
npm run dev             # migrate, then Next on :3000
npm run worker          # pg-boss consumer — runs analysis and generation jobs
npm run seed            # users
npm test                # node --test, no framework

npm run fixtures:check  # the answer key must cite evidence that exists
npm run eval:extraction # segmentation + classification vs the answer key
npm run eval:gaps       # gap recall per check, ~8 min
npm run snapshot:demo   # capture a finished run as fixtures/demo-run.json
```

Without the worker, uploads queue but never progress.

### Without Docker

Any Postgres 16+ with the `pgvector` extension works in place of the `db` container (on
Ubuntu: `apt install postgresql-16-pgvector`). Create a `setu` superuser and database on port
5433 (or change `DATABASE_URL` in `.env`), then run `npm run dev` and `npm run worker` as above.
For the demo, `npm run index` must succeed before `npm run seed:demo` — the stored run cites the
indexed fixture system, and `seed:demo` now says so instead of failing on a foreign key.

## Measured quality

| | |
|---|---|
| strict gap recall | **0.70** median over 3 runs (0.67 / 0.83 / 0.70), target ≥0.60 |
| loose gap recall | 0.93 — right gap on the right requirement |
| retrieval@k | 0.91 |
| extraction recall | 0.94–1.00, classification 0.93 |
| traceability coverage | 100%, and export is blocked below it |
| uncited findings | 0, across every run |

Numbers vary by up to ±0.15 between identical runs. Report medians, never one run.

`eval:gaps` matches against a widened evidence key that is **pending BA sign-off** — see
`fixtures/EVIDENCE-REVIEW.md`. Until that comes back, treat the headline as internal.

## Configuration

See `.env.example`. Two values are load-bearing:

| variable | why it matters |
|---|---|
| `LLM_BASE_URL` | bootstrap endpoint, asserted private by the connection test (D31). Defaults to the `omniroute` service; OpenAI-compatible, so a gateway today and vLLM later is an env change, not a code change (D7). |
| `INITIAL_PASSWORD` | OmniRoute's dashboard login. No default — compose will not start without it. |
| `LLM_REASONING_EFFORT` | must stay `none`. Measured 215s → 4s per call. With reasoning on, an analysis run takes 3.6 hours instead of 3 minutes (D7). |

Others: `SETU_ALLOW_HTTP` (serve over plain HTTP on a LAN — unset it wherever TLS is available),
`SESSION_SECRET` (32+ chars, signs the login cookie), `SEED_PASSWORD` (password for the
seeded users), `COMPOSE_PROFILES=9router` plus `NINEROUTER_PASSWORD` and `NINEROUTER_JWT_SECRET`
(the optional embeddings-only gateway), `JIRA_PUSH_ENABLED` / `JIRA_BASE_URL` / `JIRA_PROJECT_KEY` / `JIRA_TOKEN` (Jira push;
off by default).

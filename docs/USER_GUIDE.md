# Setu user guide

Setu reads a draft SRS, checks every requirement against the system you have already built (its
code, database schema and incident history), and flags the gaps. A Business Analyst decides on each
gap and approves the requirements; only then does Setu draft the backlog — stories, development
tasks and test scenarios — and trace every requirement to a story and a test.

To install and run Setu, see the [README](../README.md).

## The flow at a glance

```
Upload SRS ─▶ Analysis ─▶ Review findings ─▶ Approve requirements ─▶ Generate backlog
                                                                          │
      Export / Jira ◀── Traceability (100% coverage) ◀── Approve backlog ◀─ Review backlog
```

Every run page shows this as a stepper with three phases:

| phase | tabs |
|---|---|
| **Review** | **Findings** |
| **Backlog** | **Stories**, **Tasks**, **Tests** — locked 🔒 until the requirements are approved |
| **Delivery** | **Traceability** |

A number on a tab is how many items still need a decision; a ✓ means all are decided. A small dot
marks the tab your role usually works in.

## Roles

Everyone who is signed in can **read** everything. Only these actions are restricted:

| action | who |
|---|---|
| Configure the model and network policy | superadmin |
| Upload an SRS, dismiss findings, approve requirements, generate and approve the backlog | BA, superadmin |
| Export (XLSX / DOCX) and Jira push | BA, PM, superadmin |
| Accept or edit findings, answer "Worth asking the client?", add client notes, revise requirement text, accept/edit/drop backlog items | everyone |
| **Projects**: create projects, upload a final SRS, read and download development plans | Dev lead, superadmin — the only area other roles cannot see |

The seeded accounts (password printed by `npm run seed`):

| account | role |
|---|---|
| `admin@bracits.com` | superadmin |
| `ba@bracits.com` | BA |
| `dev@bracits.com` | Dev lead |
| `qa@bracits.com` | QA lead |
| `pm@bracits.com` | Delivery manager |

There is no sign-up and no user management screen — users are created by the seed script.

## 1. Sign in

Open `http://localhost:3000`, enter **Email** and **Password**, and click **Sign in**. The header
then shows **Runs**, **Health**, your name and role, a theme picker and **Sign out**. Superadmins
also see **Model**.

## 2. Connect the model (superadmin, once)

Until a model endpoint is configured and verified, the upload card on **Runs** is replaced by a
notice such as *No model configured* or *Model connection not verified*.

1. Click **Model** in the header.
2. Enter the **Endpoint URL** — any OpenAI-compatible `/v1` URL. Setu ships with the OmniRoute
   gateway, so this is usually **`http://omniroute:20128/v1`**. Setu calls the endpoint from its
   container, so never use `localhost`: for a model running on the host machine use
   `http://host.docker.internal:<port>/v1`. If you type `localhost`, a warning offers the corrected
   URL — click **Use this instead**.
3. Add the **API key** if the endpoint needs one. It is encrypted and never shown again.
4. Click **Load from endpoint** and choose the **Chat model**.
5. Under **Advanced**, check the **Embedding model** (must produce 768-dimension vectors) and keep
   **Reasoning effort** at *none — recommended*. If the chat endpoint cannot do embeddings (common
   for gateways such as OmniRoute), set a separate **Embedding endpoint**.
6. Click **Test connection**, then **Save and verify**.

The connection test lists each check — *Endpoint reachable*, *Inside your network*,
*Chat completion*, *Structured output*, *Reasoning setting honoured*, *Embeddings* — so you can
see exactly what failed.

### Network policy

By default Setu is **Internal models only**: requirement text, source code and incident history
must not leave your network. A hosted provider, or a gateway that forwards to one, is blocked with
*External models are not permitted*.

To use one anyway, click **Allow models outside the network…**, give a reason (at least 10
characters) and confirm with **Allow external models**. The reason is recorded against your name
and shown on the **Health** page. **Restrict to internal models** reverses it.

## 3. Upload a draft SRS (BA)

On **Runs**, use **Upload a draft SRS**: choose a file and click **Analyse**.

- Accepted formats: **DOCX, PDF, Markdown (.md), plain text (.txt)**.
- The document needs at least 200 characters of text.

The run appears in the table and moves through *queued* → *extracting requirements* →
*checking requirements against the system*. A progress bar shows how many checks are done. You
can close the tab — the analysis runs in the background. A typical run takes a few minutes.

The **Runs** table shows each run's status, number of findings, and how many still await a
decision.

## 4. Review findings

Open a run to land on **Findings**. The top row summarises **Requirements**, **Findings**,
**Suppressed** (duplicates merged away), **Signal quality** and **Elapsed** time.

Each requirement is a card with its reference, a classification, and the requirement text. Under
it are the findings — gaps Setu found in that requirement. There are four kinds of check:

| check | what it catches |
|---|---|
| **missing ac** | no acceptance criteria, so nobody can tell when it is done |
| **failure path** | what happens when it goes wrong is not specified |
| **contradiction** | it conflicts with how the existing system behaves |
| **dependency** | it relies on something that is not stated or not in place |

Each finding shows a **severity** (high / medium / low), the gap, a **question for the client**,
and **evidence chips** — click one to see the code, schema or incident report it cites. Every
finding is backed by evidence.

For each finding, decide:

- **Accept** — the gap is real and should be raised.
- **Edit** — reword it, then **Save**. The original AI text stays visible for reference.
- **Dismiss** (BA only) — not a real gap.

Optionally:

- **Worth asking the client? Yes / No** — feeds the *Signal quality* figure; it is not a decision.
- **What the client said** — record the answer and click **Save note**.
- **revise** next to the requirement text — correct the requirement itself. The original stays
  visible under *As extracted from the document*.

Tick **Show pending only** to hide what is already decided.

## 5. Approve the requirements (BA)

The banner above the findings reads **Awaiting sign-off** — nothing is generated, exported or
pushed before this step.

When every finding is decided, click **Approve requirements** and confirm with **Yes, approve**.
This fixes the requirement set: findings and requirement text become read-only, and the
**Backlog** tabs unlock. It cannot be undone from the UI.

## 6. Generate and review the backlog

Open **Stories** and click **Generate backlog** (BA). Setu drafts, for each requirement:

- **Stories**, with Given / When / Then acceptance criteria.
- **Tasks** for developers, tagged with the code modules and database tables they touch.
- **Tests** — positive and negative scenarios; some are marked *covers a reviewed gap*.

Progress shows as *Drafting the backlog… n/total requirements*. If it shows
*Generation never started*, click **Start generation again**.

Each role reviews its own tab — BA on **Stories**, developers on **Tasks**, QA on **Tests** — and
decides each item with **Accept**, **Edit** or **Drop**.

When nothing is pending, the BA clicks **Approve backlog**. The banner then records who approved it
and how long it took from upload to approved backlog.

## 7. Traceability, export and Jira

Open **Traceability**. It shows **Coverage %** — the share of requirements that map to at least one
story *and* one test (dropped items do not count) — and a table of
**Requirement / Story / Test scenario**. Gaps show as *no story* or *no test*.

Exports (BA, PM, superadmin):

- **Backlog (XLSX)** — sheets for Stories, Tasks, Tests and Traceability. **Blocked below 100%
  coverage**; the page lists which requirements are missing a story or test. Fix them on the
  backlog tabs.
- **Client question sheet (DOCX)** — *Questions for the client*, built from every finding that was not dismissed.
  Available at any time.

**Preview Jira push (dry run)** shows the Jira issues Setu would create, one per story, without
contacting Jira. A real push must be enabled by an administrator (`JIRA_PUSH_ENABLED=true`) and
needs an approved backlog.

## 8. Projects — plan development against a codebase (developer)

Once the BA has the client's answers, the developer takes the **final SRS** and checks it against
the code the work will be built on. Developers land on **Projects**.

### Create a project (once per codebase)

1. **Projects → New project.** Give it a name.
2. Choose where the code is:
   - **Remote** — the repository's **HTTPS** URL (GitHub, GitLab, Bitbucket, self-hosted). For a
     private repository, open *Private repository?* and add a **read-only access token** (GitHub
     fine-grained token with *Contents: read*; GitLab *read_repository*). Bitbucket also needs the
     **username**. The token is encrypted and never shown again. SSH URLs are not supported yet.
   - **Local folder** — any git repository inside the folder shared with Setu (see
     [Sharing local repositories](#sharing-local-repositories)).
3. Enter the **branch** development starts from (e.g. `main`, `develop`).
4. **Create and index.** Setu fetches that branch and builds a searchable index of it: Java/Kotlin
   classes (an outline per class plus one piece per method), `application*.yml`/`.properties`,
   `pom.xml`/`build.gradle`, SQL and Liquibase migrations, and Markdown docs. Build output
   (`target`, `build`, …) is skipped. A medium Spring Boot service takes a minute or two with a
   local embedding model.

The project page shows the commit that was indexed. After new commits land, click **Re-index**;
to work from another branch, use **Change branch**. If indexing fails, the previous index is
kept and the error says why (wrong branch, no access, host unreachable).

### Upload the final SRS

On the project page, **Upload the final SRS** and click **Analyse against code**. Setu extracts
the requirements, then, for each one, finds the related code and asks the model:

| status | meaning |
|---|---|
| **to build** | nothing relevant exists |
| **to extend** | some of it exists and needs extending |
| **conflicts** | current code does something the requirement contradicts |
| **already there** | the code already does it |
| **unclear** | the code found was not enough to tell |

Each requirement shows what exists today, the **files** to modify or create, ordered **steps**,
**risks**, **open questions**, and the code it is based on (click a chip to read it). Only code
that was actually shown to the model can be cited.

A project keeps every plan, so you can upload a revised SRS later and compare.

### Use the plan

- **IMPLEMENTATION_PROMPT.md** — written for a coding assistant (Claude Code, Copilot, Cursor…):
  how to work in this repository, the plan in build order (conflicts first, then new work, then
  extensions), every open question, a definition of done, and the relevant code excerpts. Put it
  in the repository and ask the assistant to follow it, or use **Copy prompt** to paste it.
- **Development plan (.md)** — the same analysis for people: a summary, every file touched and
  by which requirement, then each requirement in full.

The plan is drafted from the code at the indexed commit. Treat paths and class names as strong
hints and verify them — the prompt file tells the assistant the same.

### Sharing local repositories

Setu runs in Docker, so it only sees folders you share with it. In `.env`, set
`LOCAL_REPOS_DIR` to the **absolute path** of the folder that holds your repositories (Docker
does not expand `~`):

```
LOCAL_REPOS_DIR=/home/you/IdeaProjects
```

then `docker compose up -d`. Each subfolder that is a git repository appears under
**Local folder**. The folder is mounted read-only; Setu clones the chosen branch from it and
never writes to your working copy.

## Demo run

`/demo` opens a stored, already-approved run, so you can walk through the whole flow without a live
model. A **Stored run** banner marks it. If it says *No stored run*, an administrator needs to run
`npm run seed:demo` (see the README).

## Health

**Health** shows whether Setu is ready: **Database**, **Model endpoint**, **Chat model**,
**Embedding model**, **Network policy**, **Endpoint** and **Ready to run**. Check it first when
something is blocked.

## Troubleshooting

Projects:

| symptom | fix |
|---|---|
| *That branch does not exist* | branch names are case-sensitive — **Change branch** |
| *The repository refused access* | private repository: add a token that can read it (**Change branch / token**) |
| *Could not reach the repository host* | the worker cannot reach it — same DNS/proxy fix as the Docker build |
| *No local repositories are shared* | set `LOCAL_REPOS_DIR` in `.env` (absolute path), then `docker compose up -d` |
| Plans cite the wrong code | **Re-index** after new commits; a larger chat model also helps |

Review runs:

| you see | meaning / fix |
|---|---|
| *No model configured* / *Model connection not verified* | a superadmin must set up **Model** and pass **Test connection** |
| *External models are not permitted* | the endpoint is outside your network or forwards there; switch to an internal model, or a superadmin allows external models with a reason |
| *Embedding width mismatch* | the embedding model is not 768-dimension; pick one that is |
| *That address is not reachable from Setu* | use `host.docker.internal` or the model machine's address instead of `localhost` |
| **Approve requirements** is greyed out | some finding is still undecided, or you are not a BA |
| Backlog tabs are locked | the requirements are not approved yet |
| **Backlog (XLSX)** is greyed out | coverage is below 100% — see the list on **Traceability** |
| A run stays *queued* | the worker is not running (`docker compose ps`, `docker compose logs worker`) |
| *not permitted to …* | your role cannot perform that action — see [Roles](#roles) |

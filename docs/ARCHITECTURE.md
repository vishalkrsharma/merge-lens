# Architecture

MergeLens is a NestJS application that provides AI-powered GitHub PR reviews through a multi-agent pipeline.

## Request Flow

```
GitHub Webhook → POST /api/webhooks/github
  → PullRequestHandler (verify HMAC, check repo.isActive)
  → pg-boss job queue (PostgreSQL-backed, no Redis)
  → ReviewProcessor (job worker)
      ├── GithubService: fetch PR details, head SHA, changed files (parallel)
      ├── RetrievalService: RAG lookup against in-memory vector store
      ├── OrchestratorService: run agents
      │     ├── Ollama: bug → security → performance → style (sequential)
      │     └── Cloud providers: all 4 agents in parallel (Promise.all)
      │   → SummaryAgent (after all 4 complete)
      ├── CommentsService: post inline comments + summary to GitHub
      └── PrismaService: persist Review, Finding[], ReviewSummary, ApiUsageLog
```

## AI Pipeline (`src/pipeline/`)

### Agents

All four review agents extend `BaseAgent` and return `{ findings: AgentFinding[], summary: string }`:

| Agent | Looks for |
|---|---|
| `BugAgent` | Logic errors, null dereferences, race conditions |
| `SecurityAgent` | Auth flaws, injection, hardcoded secrets |
| `PerformanceAgent` | N+1 queries, expensive loops, blocking I/O |
| `StyleAgent` | Naming, readability, dead code, maintainability |

`SummaryAgent` synthesizes all four outputs into an overall verdict and merge recommendation.

### LLM Layer (`src/pipeline/llm/`)

`LlmService` dispatches to the right provider:
- **Google Gemini** — via `@google/generative-ai`
- **Anthropic Claude** — via `@anthropic-ai/sdk`
- **OpenAI GPT** — via `openai`
- **Ollama** — via `openai` (OpenAI-compatible API); uses **streaming mode** so tokens flow continuously and Ollama's 5-minute server-side idle timeout is never triggered

`model-catalog.ts` lists all known models with provider, display name, and context window. Ollama models are discovered dynamically at runtime via `/api/tags`.

### Orchestrator (`src/pipeline/orchestrator/`)

`OrchestratorService.execute()` resolves the provider, API key, and model from user settings, then dispatches agents. Cloud providers run agents in `Promise.all` for speed; Ollama runs them sequentially because it has a single inference slot.

### RAG (`src/pipeline/rag/`)

On startup, `RepositoryIndexService` reads every `.md` file from `./docs/`, splits into 500-word chunks with 50-word overlap, and embeds them with `gemini-embedding-2`. `VectorService` stores embeddings **in-memory** (no persistence). The first 2,000 characters of the PR diff are used as the retrieval query to find the top-5 relevant chunks.

## GitHub Integration (`src/integrations/github/`)

`GithubService` wraps `octokit/App` for GitHub App authentication (reads private key from `keys/merge-lens-private-key.pem` or the `GITHUB_PRIVATE_KEY` env var). Provides:
- Installation-token-based calls: fetch PR data, post inline comments and summary comment
- User-token-based calls: list repositories, manage installations

Webhook signature verification (`verify-signature.ts`) uses `GITHUB_WEBHOOK_SECRET` and is checked in every webhook handler before processing.

## Authentication (`src/core/auth/`)

Uses **better-auth** with a Prisma adapter and GitHub OAuth as the only social provider.

`useSecureCookies: true` is set — the session cookie is named `__Secure-better-auth.session_token`. The `AuthGuard` calls `auth.api.getSession()` on every protected request and attaches `session.user` to `request.user`.

`skipStateCookieCheck: true` avoids false `state_mismatch` errors on OAuth flows that take longer than 5 minutes.

### Auth Proxy Architecture

The frontend and backend are on different domains. The frontend proxies all auth traffic through `/api/auth/[...all]` so session cookies are set on the frontend domain:

```
signIn.social() on frontend
  → POST vercel.app/api/auth/...    (same-origin, no CORS)
  → proxy → onrender.com/api/auth/...
  → GitHub OAuth callback → GET vercel.app/api/auth/callback/github
  → backend sets Set-Cookie (no explicit Domain)
  → browser assigns cookie to vercel.app ✓
```

**`BETTER_AUTH_URL` must be the frontend URL** — better-auth generates OAuth callback URLs from this value, and those callbacks must land on the frontend proxy.

## Real-time Updates (`src/core/realtime/`)

`RealtimeGateway` is a Socket.io WebSocket gateway. On connection:
1. Reads the session token from `socket.handshake.auth.token`
2. Calls `auth.api.getSession()` with `cookie: __Secure-better-auth.session_token=<token>`
3. If valid, joins the socket to room `user:<userId>`

`RealtimeService.emitToUser()` broadcasts events to that room. `ReviewProcessor` emits:
- `review:started` — when the job begins processing
- `review:completed` — when the review finishes with findings
- `review:failed` — when an unrecoverable error occurs

The gateway is configured with `pingInterval: 10000` / `pingTimeout: 5000` to survive Render's 55-second proxy idle timeout.

## Webhook Handlers (`src/modules/webhooks/handlers/`)

| Handler | Events | Action |
|---|---|---|
| `PullRequestHandler` | `opened`, `synchronize`, `reopened` | Enqueue review job |
| `InstallationHandler` | `installation`, `installation_repositories` | Sync `Repository` records |
| `IssuesHandler` | all issue events | Log only |

## API Modules (`src/modules/`)

| Module | Endpoints | Purpose |
|---|---|---|
| `RepositoriesModule` | `GET/POST/PATCH/DELETE /repositories` | CRUD + GitHub App installation sync |
| `ReviewsModule` | `GET /reviews`, `GET /reviews/:id` | Paginated review list + detail |
| `FindingsModule` | `GET /findings`, `GET /findings/hotspots` | Cross-review findings + hotspot files |
| `StatsModule` | `GET /stats` | Dashboard aggregates |
| `SettingsModule` | `GET/PATCH /settings/api-keys`, `GET /settings/usage`, `GET/PATCH/DELETE /settings/agent-prompts/:agent` | API keys, usage, custom agent prompts |

## Data Models (Prisma)

Key tables: `User`, `Session`, `Account`, `Repository`, `Review`, `Finding`, `ReviewSummary`, `ApiUsageLog`, `AgentPrompt`, `PendingInstallation`.

`AgentPrompt` stores per-user overrides for each agent's system prompt. When no row exists for a given `(userId, agent)` pair, the pipeline falls back to `DEFAULT_AGENT_PROMPTS[agent]`.

## Observability (`src/core/observability/`)

- **MetricsService** — Prometheus histograms and counters; exposed at `GET /api/metrics`
- **TracingService** — lightweight span wrapper (no external tracing backend)
- **Logging** — structured via `nestjs-pino`

## Module Structure

```
src/
  core/
    auth/           # better-auth config and AuthGuard
    observability/  # MetricsService, TracingService
    prisma/         # PrismaService singleton
    realtime/       # Socket.io gateway + service
  integrations/
    github/         # GithubService, webhook handlers, signature verification
    comments/       # GitHub PR comment formatting and posting
  modules/
    findings/       # FindingsService + controller
    repositories/   # RepositoriesService + controller
    reviews/        # ReviewsService + controller
    settings/       # API keys, usage, agent prompts
    stats/          # StatsService + controller
    webhooks/       # WebhooksController + PullRequestHandler
  pipeline/
    agents/         # BugAgent, SecurityAgent, PerformanceAgent, StyleAgent, SummaryAgent
    llm/            # LlmService, model catalog
    orchestrator/   # OrchestratorService
    processor/      # ReviewProcessor (pg-boss job handler)
    rag/            # RepositoryIndexService, VectorService, RetrievalService
```

# MergeLens Backend

NestJS backend for MergeLens — an AI-powered GitHub PR review pipeline. Automatically reviews pull requests using a multi-agent AI system and posts findings as inline GitHub comments.

## Features

- **Multi-agent AI review** — four specialized agents (Bug, Security, Performance, Style) run sequentially for Ollama or in parallel for cloud providers, followed by a Summary agent that synthesizes findings into an overall PR verdict
- **Custom agent prompts** — users can override the system prompt for any agent; customizations are stored per-user and reset to defaults at any time
- **Provider-agnostic LLM layer** — supports Anthropic (Claude), Google (Gemini), OpenAI (GPT), and Ollama (local); users bring their own API keys
- **Ollama GPU support** — local inference via Ollama using ROCm (AMD) or CUDA; streaming mode bypasses Ollama's idle timeout
- **RAG-enhanced context** — repository docs are embedded at startup with Gemini embedding-2 and injected into each agent's prompt for project-aware analysis
- **GitHub App integration** — installs on personal accounts or organisations; webhooks trigger reviews on PR open/sync/reopen
- **Live PR status comments** — posts a running status comment on GitHub during review, updated as each agent completes
- **Real-time frontend updates** — Socket.io gateway emits review lifecycle events (`review:started`, `review:completed`, `review:failed`) so the dashboard updates without polling
- **PostgreSQL job queue** — pg-boss handles review jobs with retry on failure; no Redis required
- **Observability** — Prometheus metrics at `/api/metrics`, structured Pino logging, lightweight span tracing
- **Neon preview databases** — each PR automatically gets an isolated Neon DB branch; migrations are applied and the connection string is posted as a PR comment

## Local development

### Prerequisites

- Node.js 20+
- pnpm
- PostgreSQL (via [Neon](https://neon.tech))
- ngrok (for GitHub webhook tunnel)

### Ports

| Port | Service | How to start |
|------|---------|--------------|
| `8080` | NestJS backend | `pnpm start:dev` |
| `3000` | Next.js frontend | `pnpm dev` (frontend repo) |
| `9090` | Prometheus | `pnpm monitoring:up` |
| `4000` | Grafana | `pnpm monitoring:up` |
| `5000` | Prisma Studio | `pnpm studio` |

### Setup

```bash
pnpm install
```

Copy `.env.example` to `.env.local` and fill in the required values.

### Run

```bash
pnpm start:dev     # watch mode
pnpm dev           # watch mode + ngrok tunnel (parallel)
```

### Database

```bash
pnpm studio              # open Prisma Studio
npx prisma migrate dev   # create and apply a new migration
npx prisma generate      # regenerate Prisma client
pnpm migrate:deploy      # apply existing migrations (used in CI)
pnpm db:push             # push schema without migrations (prototyping only)
```

### Other scripts

```bash
pnpm github:jwt     # print a signed GitHub App JWT
pnpm db:reset       # clear all data
pnpm github:reset   # reset GitHub App installation state
```

## Neon preview databases

Every pull request automatically gets an isolated Neon DB branch (`preview/<branch-name>`). Migrations are applied via `prisma migrate deploy` and the connection string is posted as a PR comment.

### One-time local setup

Install `neonctl` and authenticate once, then install the git hook so your local `DATABASE_URL` switches automatically when you change branches:

```bash
npm i -g neonctl         # install Neon CLI
neonctl auth login       # authenticate with your Neon account
pnpm hooks:install       # install the post-checkout git hook
```

After that, `git checkout feat/my-feature` will automatically update `DATABASE_URL` in `.env.local` to the preview branch for that feature.

### GitHub Actions secrets required

| Secret | Value |
|--------|-------|
| `NEON_PROJECT_ID` | Your Neon project ID |
| `NEON_API_KEY` | Generate at console.neon.tech → Account settings → API keys |

## Environment variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL (Neon) connection string |
| `GOOGLE_API_KEY` | Gemini LLM + embeddings (required if using Google provider) |
| `ANTHROPIC_API_KEY` | Anthropic Claude (optional — users can supply their own) |
| `OPENAI_API_KEY` | OpenAI GPT (optional — users can supply their own) |
| `OLLAMA_BASE_URL` | Ollama server URL (default: `http://localhost:11434`) |
| `GITHUB_APP_ID` | GitHub App numeric ID |
| `GITHUB_CLIENT_ID` | OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | OAuth app client secret |
| `GITHUB_WEBHOOK_SECRET` | HMAC webhook verification |
| `BETTER_AUTH_SECRET` | Session signing key |
| `BETTER_AUTH_URL` | Must be the **frontend** URL — better-auth generates OAuth callback URLs from this so they land on the frontend auth proxy |
| `FRONTEND_URLS` | Comma-separated allowed origins for CORS and trusted auth origins |
| `PORT` | HTTP listen port (default: `8080` locally, `10000` on Render) |

The GitHub App private key must be placed at `keys/merge-lens-private-key.pem`.

## Testing

```bash
pnpm test           # unit tests
pnpm test:watch     # watch mode
pnpm test:cov       # coverage report
```

## API docs

Scalar UI: `/api/docs` · OpenAPI JSON: `/api/swagger-json/json`

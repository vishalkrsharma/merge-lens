# Contributing

## Setup

```bash
pnpm install
cp .env.example .env.local   # fill in required values
pnpm start:dev
```

No Docker or Redis needed — the job queue runs on PostgreSQL via pg-boss.

### Required environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon (or any PostgreSQL) connection string |
| `GOOGLE_API_KEY` | Gemini LLM + embeddings |
| `GITHUB_APP_ID` | GitHub App ID |
| `GITHUB_CLIENT_ID` | OAuth client ID |
| `GITHUB_CLIENT_SECRET` | OAuth client secret |
| `GITHUB_WEBHOOK_SECRET` | Webhook HMAC secret |
| `BETTER_AUTH_SECRET` | Session signing key (any random 32+ char string) |
| `BETTER_AUTH_URL` | Must be the **frontend** URL (e.g. `http://localhost:3000`) |
| `FRONTEND_URLS` | Comma-separated CORS origins (e.g. `http://localhost:3000`) |

For GitHub webhooks in local dev, start the ngrok tunnel: `pnpm dev` runs both the server and the tunnel in parallel.

## Development Workflow

1. Create a feature branch from `master`: `git checkout -b feat/my-feature`
2. Make changes following the style guide (`docs/STYLE_GUIDE.md`)
3. Run `pnpm lint` and fix all issues
4. Run `pnpm build` to verify TypeScript compiles
5. Open a PR — MergeLens will review it automatically

## Adding a New Agent

1. Create `src/pipeline/agents/<name>.agent.ts` extending `BaseAgent`
2. Implement `review(context: ReviewContext, provider, apiKey, modelId, customPrompt?): Promise<AgentResponse>`
3. Register it in `src/pipeline/pipeline.module.ts`
4. Add it to `OrchestratorService` in `src/pipeline/orchestrator/orchestrator.service.ts` (both the parallel and sequential branches)
5. Add the agent type to `AgentType` enum in the Prisma schema and run `npx prisma migrate dev`
6. Add a default prompt to `DEFAULT_AGENT_PROMPTS` in the settings module

## Adding a New LLM Provider

1. Add the provider to `ApiProvider` enum in the Prisma schema
2. Add a case to `LlmService.generate()` in `src/pipeline/llm/llm.service.ts`
3. Add models to `model-catalog.ts`
4. Add API key handling in `src/modules/settings/api-keys.service.ts`

## Code Review Checklist

- No secrets or credentials in code
- All async functions have proper error handling
- No `any` types — use `unknown` and narrow
- Services are `@Injectable()` singletons injected via NestJS DI
- New modules are imported in `app.module.ts` or the relevant feature module
- External API calls (GitHub, LLM providers) have appropriate timeout handling

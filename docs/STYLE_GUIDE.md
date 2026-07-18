# Style Guide

## TypeScript

- Use strict TypeScript with `strictNullChecks` and `noImplicitAny`
- Prefer `const` over `let`. Never use `var`
- Use explicit return types on all public methods
- Prefer `async/await` over raw Promises
- Always handle errors: catch exceptions or propagate them explicitly
- Avoid `any` — use `unknown` and narrow it instead

## NestJS Conventions

- One module per feature directory
- Services are `@Injectable()` singletons
- Controllers handle only HTTP concerns (validation, parsing, status codes)
- Business logic lives in services, never in controllers
- Use `process.env` directly (no `ConfigService` wrapper — env is validated at startup)
- Use `Logger` from `@nestjs/common` with the class name as context

## Naming

- Files: `kebab-case.ts` (e.g. `review.processor.ts`)
- Classes: `PascalCase`
- Methods and variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Interfaces: `PascalCase` without `I` prefix

## Error Handling

- Log warnings for recoverable errors (e.g. a single inline comment that fails)
- Throw and let the pg-boss processor retry for job-level failures
- Never swallow errors silently — always log or rethrow
- Wrap external API calls (GitHub, LLM providers) in try-catch and surface errors via `Logger.error`

## Testing

- Unit tests live next to source files: `*.spec.ts`
- Integration tests in `test/` directory
- Mock LLM providers and GitHub API in unit tests
- Do not mock Prisma — use a real Neon branch for integration tests

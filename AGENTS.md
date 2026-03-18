# gh-actions-secrets

CLI for setting GitHub Actions secrets from local env files, process env, JSON, or stdin. Built for both humans and AI agents: fast defaults, script-friendly output, and repo auto-detection.

## Architecture

- **Runtime**: Bun + TypeScript, published as a Node CLI
- **CLI**: CAC in `src/cli.ts`
- **GitHub API**: native `fetch` + `zod`, with LibSodium encryption before upload
- **Input sources**: dotenv files, JSON, stdin, and live process env
- **Linting**: `bun fix` (Biome-based via Ultracite)
- **Tests**: `bun test`
- **Type check**: `bun typecheck`

## Core Features

- **`set`**: Create or update one secret from an argument, stdin, or a local env var.
- **`sync`**: Bulk upload secrets from `.env`, JSON, stdin, or the current process env.
- **`list`**: Show secret names and timestamps without exposing values.
- **`delete`**: Remove one or more secrets.
- **`doctor`**: Explain auth, repo resolution, and scope before writing anything.

## Scope Resolution

- **Repository**: Default scope. Resolve from `--repo`, `GH_REPO`, `GITHUB_REPOSITORY`, or local git remotes.
- **Environment**: Optional `--env <name>` targets environment secrets inside the resolved repository.
- **Auth**: Resolve from `--token`, `GITHUB_TOKEN`, `GH_TOKEN`, or `gh auth token`.

---

## Code Standards (Ultracite)

This project uses Ultracite (Biome-based) for formatting and linting.

- **Fix**: `bun fix` (run before committing, also runs via lefthook pre-commit)
- **Check**: `bun lint`

Write code that is type-safe and explicit. Use `unknown` over `any`, const assertions for immutable values, early returns over nested conditionals, `for...of` over `.forEach()`, `async/await` over promise chains, and template literals over concatenation. Remove `console.log`/`debugger` from production code. Throw `Error` objects, not strings.

# gh-actions-secrets

GitHub Actions secrets CLI built with Bun and published as a regular Node CLI.

Main point: manage GitHub Actions secrets fast. Local env files, JSON, stdin, and process env are just input sources.

Runtime target: publish a regular Node CLI that also works fine from Bun-driven development workflows.

Package and command:

- npm package: `gha-secrets`
- command: `gha-secrets`
- one-off usage: `bunx gha-secrets doctor`

What it does:

- set one secret quickly from args, stdin, or a local env var
- bulk sync `.env`, JSON, stdin, or process env into repo secrets
- target repo secrets by default or environment secrets with `--env`
- auto-detect the current GitHub repo, but let you override it
- keep output clean for both humans and AI agents

Commands:

- `gha-secrets doctor`
- `gha-secrets set OPENAI_API_KEY sk-...`
- `gha-secrets list`
- `printenv OPENAI_API_KEY | gha-secrets set OPENAI_API_KEY`
- `gha-secrets set OPENAI_API_KEY --from-env OPENAI_API_KEY`
- `gha-secrets sync`
- `gha-secrets sync --from-process --env production`
- `gha-secrets sync --from-json secrets.json --delete-missing`
- `cat secrets.json | gha-secrets sync --dry-run --json`

Resolution order:

- repo: `--repo`, `GH_REPO`, `GITHUB_REPOSITORY`, local git remote
- token: `--token`, `GITHUB_TOKEN`, `GH_TOKEN`, `gh auth token`

# gh-secrets

CLI for managing GitHub Actions secrets.

```bash
bunx gh-secrets set OPENAI_API_KEY sk-...
```

## Install

```bash
# one-off
bunx gh-secrets <command>
npx gh-secrets <command>

# global
bun add -g gh-secrets
npm install -g gh-secrets
```

## Commands

### `set` - create or update a secret

```bash
gh-secrets set SECRET_NAME value
gh-secrets set SECRET_NAME --from-env SECRET_NAME
echo "value" | gh-secrets set SECRET_NAME
```

### `sync` - bulk upload secrets

```bash
# from .env files (auto-detected)
gh-secrets sync

# from explicit sources
gh-secrets sync --from-file .env.production
gh-secrets sync --from-json secrets.json
gh-secrets sync --from-process

# filter and prefix
gh-secrets sync --include "APP_*" --prefix PROD_
gh-secrets sync --exclude "DEBUG_*"

# remove remote secrets not in local input
gh-secrets sync --delete-missing --include "APP_*"

# preview without writing
gh-secrets sync --dry-run
```

### `list` - show secret names

```bash
gh-secrets list
gh-secrets list --env production
```

### `delete` - remove secrets

```bash
gh-secrets delete SECRET_A SECRET_B
```

### `doctor` - check setup

```bash
gh-secrets doctor
```

## Repo and token resolution

The CLI auto-detects your repo and token. Override with flags or env vars.

**Repo:** `--repo` > `GH_REPO` > `GITHUB_REPOSITORY` > local git remote

**Token:** `--token` > `GITHUB_TOKEN` > `GH_TOKEN` > `gh auth token`

## Global options

```
--repo <owner/repo>   Target repository
--env <name>          Target environment secrets
--token <token>       GitHub token override
--json                Machine-readable JSON output
-y, --yes             Skip confirmation prompts
```

## Safety

- `set` prompts before overwriting an existing secret
- `delete` requires confirmation (or `--yes`)
- `sync` prompts before updating or deleting existing secrets
- `sync --delete-missing` refuses broad deletes without `--include` or `--prefix` (override with `--yes`)
- `--json` mode returns structured errors with `error`, `message`, and `hint` fields

## License

MIT

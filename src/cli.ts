#!/usr/bin/env node

import { cac } from "cac";
import packageJson from "../package.json";

import { CliError, getCliErrorPayload } from "./core/errors";
import { formatSecretScope } from "./core/github";
import {
  confirmAction,
  isInteractiveSession,
  printJson,
  printLine,
  readStdin,
} from "./core/io";
import { resolveRuntime } from "./core/runtime";
import { assertSecretName } from "./core/secret-name";
import { resolveSecretValue } from "./core/secret-value";
import {
  applySecretSync,
  loadSyncEntries,
  planSecretSync,
  selectManagedNames,
} from "./core/sync";

const cli = cac("gh-secrets");
const wantsJsonOutput = process.argv.includes("--json");

type ConfirmOptions = {
  json?: boolean;
  yes?: boolean;
};

type ConfirmConfig = {
  requireYesWithoutTty?: boolean;
};

const formatCount = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

const printOutput = (
  json: boolean | undefined,
  jsonValue: unknown,
  lines: string[]
) => {
  if (json) {
    printJson(jsonValue);
    return;
  }

  for (const line of lines) {
    printLine(line);
  }
};

const readOptionalStdin = () => (process.stdin.isTTY ? null : readStdin());

const shouldPrompt = (options: ConfirmOptions) =>
  !options.json && !options.yes && isInteractiveSession();

const ensureConfirmed = async (
  options: ConfirmOptions,
  message: string,
  config: ConfirmConfig = {}
) => {
  if (!shouldPrompt(options)) {
    if (config.requireYesWithoutTty && !options.json && !options.yes) {
      throw new CliError("Refusing to continue without confirmation.", {
        code: "confirmation_required",
        hint: "Re-run with --yes.",
      });
    }

    return;
  }

  if (await confirmAction(message)) {
    return;
  }

  throw new CliError("Aborted.", {
    code: "aborted",
  });
};

const hasScopedDeleteFilters = (options: {
  include?: string[];
  prefix?: string;
}) => Boolean(options.prefix || options.include?.length);

cli
  .option("--repo <owner/repo>", "Target repository")
  .option("--env <name>", "Target environment")
  .option("--json", "Output JSON")
  .option("--token <token>", "GitHub token override")
  .option("-y, --yes", "Skip interactive confirmations")
  .help()
  .version(packageJson.version ?? "0.0.0");

cli
  .command("doctor", "Check auth, repo resolution, and scope")
  .action(async (options) => {
    const runtime = resolveRuntime(options);
    const [repository, secrets] = await Promise.all([
      runtime.client.getRepository(runtime.repo),
      runtime.client.getSecretCount(runtime.scope),
    ]);

    const result = {
      authSource: runtime.tokenSource,
      defaultBranch: repository.default_branch,
      private: repository.private,
      repo: repository.full_name,
      scope: runtime.scope,
      secretCount: secrets,
      url: repository.html_url,
    };

    printOutput(options.json, result, [
      `Repo: ${repository.full_name}`,
      `Scope: ${formatSecretScope(runtime.scope)}`,
      `Auth: ${runtime.tokenSource}`,
      `Secrets: ${secrets}`,
      `Private: ${repository.private ? "yes" : "no"}`,
    ]);
  });

cli
  .command("list", "List secret names and timestamps")
  .action(async (options) => {
    const runtime = resolveRuntime(options);
    const result = await runtime.client.listSecrets(runtime.scope);

    printOutput(
      options.json,
      {
        scope: runtime.scope,
        ...result,
      },
      result.secrets.length
        ? result.secrets.map((secret) => `${secret.name}\t${secret.updatedAt}`)
        : [`No secrets found for ${formatSecretScope(runtime.scope)}.`]
    );
  });

cli
  .command("set <name> [value]", "Create or update one secret")
  .option("--from-env <name>", "Read the secret value from a local env var")
  .action(async (name, value, options) => {
    const runtime = resolveRuntime(options);
    const secretName = assertSecretName(name);
    const secretValue = await resolveSecretValue(value, options.fromEnv);
    const scope = formatSecretScope(runtime.scope);

    if (await runtime.client.secretExists(runtime.scope, secretName)) {
      await ensureConfirmed(
        options,
        `Secret ${secretName} already exists in ${scope}. Overwrite it?`
      );
    }

    const result = await runtime.client.upsertSecret(
      runtime.scope,
      secretName,
      secretValue
    );

    printOutput(
      options.json,
      {
        ...result,
        scope: runtime.scope,
      },
      [`${result.created ? "Created" : "Updated"} ${secretName} in ${scope}.`]
    );
  });

cli
  .command("sync", "Bulk sync secrets from dotenv, JSON, stdin, or process env")
  .option("--from-file <path>", "Load dotenv file", { type: [String] })
  .option("--from-json <path>", "Load JSON object file", { type: [String] })
  .option("--from-process", "Load current process env")
  .option("--prefix <value>", "Prefix every secret name")
  .option("--include <pattern>", "Only include matching secret names", {
    type: [String],
  })
  .option("--exclude <pattern>", "Exclude matching secret names", {
    type: [String],
  })
  .option("--delete-missing", "Delete remote secrets missing from local input")
  .option("--dry-run", "Show the sync plan without writing")
  .action(async (options) => {
    const runtime = resolveRuntime(options);
    const stdin = await readOptionalStdin();
    const entries = await loadSyncEntries({
      env: options.env,
      exclude: options.exclude,
      fromFile: options.fromFile,
      fromJson: options.fromJson,
      fromProcess: options.fromProcess,
      include: options.include,
      prefix: options.prefix,
      stdin,
    });
    const remote = await runtime.client.listSecrets(runtime.scope);
    const plan = planSecretSync(
      entries,
      selectManagedNames(
        remote.secrets.map((secret) => secret.name),
        options
      ),
      Boolean(options.deleteMissing)
    );
    const scope = formatSecretScope(runtime.scope);
    const updateCount = plan.upserts.filter(
      (entry) => entry.action === "update"
    ).length;

    if (options.dryRun) {
      printOutput(
        options.json,
        {
          dryRun: true,
          plan,
          scope: runtime.scope,
        },
        [
          `Plan for ${scope}: ${formatCount(plan.upserts.length, "upsert")}, ${formatCount(plan.deletes.length, "delete")}.`,
          ...plan.upserts.map(
            (entry) => `${entry.action}\t${entry.name}\t${entry.source}`
          ),
          ...plan.deletes.map((name) => `delete\t${name}`),
        ]
      );
      return;
    }

    if (
      options.deleteMissing &&
      plan.deletes.length > 0 &&
      !options.yes &&
      !hasScopedDeleteFilters(options)
    ) {
      throw new CliError(
        "Refusing to run --delete-missing without a scope filter.",
        {
          code: "delete_missing_requires_scope",
          hint: "Add --prefix or --include, or re-run with --yes if you really want a full-scope delete.",
        }
      );
    }

    const changes: string[] = [];
    if (updateCount > 0) {
      changes.push(`update ${formatCount(updateCount, "existing secret")}`);
    }

    if (plan.deletes.length > 0) {
      changes.push(`delete ${formatCount(plan.deletes.length, "secret")}`);
    }

    if (changes.length > 0) {
      await ensureConfirmed(
        options,
        `This will ${changes.join(" and ")} in ${scope}. Continue?`,
        {
          requireYesWithoutTty: plan.deletes.length > 0,
        }
      );
    }

    const result = await applySecretSync(runtime.client, runtime.scope, plan);
    printOutput(
      options.json,
      {
        result,
        scope: runtime.scope,
      },
      [
        `Synced ${scope}: ${result.created.length} created, ${result.updated.length} updated, ${result.deleted.length} deleted.`,
      ]
    );
  });

cli
  .command("delete <...names>", "Delete one or more secrets")
  .action(async (names, options) => {
    const runtime = resolveRuntime(options);
    const secretNames = names.map(assertSecretName);
    const scope = formatSecretScope(runtime.scope);

    await ensureConfirmed(
      options,
      `Delete ${formatCount(secretNames.length, "secret")} from ${scope}?`,
      {
        requireYesWithoutTty: true,
      }
    );

    for (const name of secretNames) {
      await runtime.client.deleteSecret(runtime.scope, name);
    }

    printOutput(
      options.json,
      {
        deleted: secretNames,
        scope: runtime.scope,
      },
      [`Deleted ${formatCount(secretNames.length, "secret")} from ${scope}.`]
    );
  });

try {
  const parsed = cli.parse(process.argv, { run: false });
  if (
    !cli.matchedCommandName &&
    parsed.args.length === 0 &&
    !parsed.options.help &&
    !parsed.options.version
  ) {
    cli.outputHelp();
    process.exit(0);
  }

  await cli.runMatchedCommand();
} catch (error) {
  if (wantsJsonOutput) {
    printJson(getCliErrorPayload(error));
    process.exit(1);
  }

  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  if (error instanceof CliError && error.hint !== undefined) {
    process.stderr.write(`${error.hint}\n`);
  }

  process.exit(1);
}

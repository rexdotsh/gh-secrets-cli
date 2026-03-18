#!/usr/bin/env node

import { cac } from "cac";
import packageJson from "../package.json";

import { formatSecretScope } from "./core/github";
import { printJson, printLine, readStdin } from "./core/io";
import { resolveRuntime } from "./core/runtime";
import { assertSecretName } from "./core/secret-name";
import { resolveSecretValue } from "./core/secret-value";
import {
  applySecretSync,
  loadSyncEntries,
  planSecretSync,
  selectManagedNames,
} from "./core/sync";

const cli = cac("gha-secrets");
const wantsJsonOutput = process.argv.includes("--json");

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

cli
  .option("--repo <owner/repo>", "Target repository")
  .option("--env <name>", "Target environment")
  .option("--json", "Output JSON")
  .option("--token <token>", "GitHub token override")
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
      [
        `${result.created ? "Created" : "Updated"} ${secretName} in ${formatSecretScope(runtime.scope)}.`,
      ]
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

    for (const name of secretNames) {
      await runtime.client.deleteSecret(runtime.scope, name);
    }

    printOutput(
      options.json,
      {
        deleted: secretNames,
        scope: runtime.scope,
      },
      [
        `Deleted ${formatCount(secretNames.length, "secret")} from ${formatSecretScope(runtime.scope)}.`,
      ]
    );
  });

try {
  cli.parse(process.argv, { run: false });
  await cli.runMatchedCommand();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (wantsJsonOutput) {
    printJson({
      error: "cli_error",
      message,
    });
    process.exit(1);
  }

  process.stderr.write(`${message}\n`);
  process.exit(1);
}

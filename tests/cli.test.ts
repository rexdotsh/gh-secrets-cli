import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { runCli } from "../src/app";

const createArgv = (...args: string[]) => ["node", "gh-secrets", ...args];
type CliOverrides = NonNullable<Parameters<typeof runCli>[1]>;
type CommandRuntime = ReturnType<NonNullable<CliOverrides["resolveRuntime"]>>;

const repoScope = { owner: "acme", repo: "app" } as const;
const secretTimestamp = "2026-03-19T00:00:00Z";
const confirmationRequiredJson = {
  error: "confirmation_required",
  hint: "Re-run with --yes.",
  message: "Refusing to continue without confirmation.",
};

const listedSecret = (name: string) => ({
  createdAt: secretTimestamp,
  name,
  updatedAt: secretTimestamp,
});

const listedSecrets = (...names: string[]) =>
  Promise.resolve({
    totalCount: names.length,
    secrets: names.map(listedSecret),
  });

const writeTempEnv = async (content: string) => {
  const directory = await mkdtemp(join(tmpdir(), "gh-secrets-"));
  const file = join(directory, ".env");
  await writeFile(file, content);
  return file;
};

const createHarness = (
  options: {
    client?: Partial<CommandRuntime["client"]>;
    confirmResult?: boolean;
    interactive?: boolean;
    runtime?: Partial<CommandRuntime>;
    secretValue?: string;
    stdin?: string | null;
  } = {}
) => {
  const errors: string[] = [];
  const jsonValues: unknown[] = [];
  const lines: string[] = [];
  const prompts: string[] = [];
  const resolveSecretValueCalls: Array<{
    fromEnv: string | undefined;
    value: string | undefined;
  }> = [];

  const deleteCalls: string[] = [];
  const existenceChecks: string[] = [];
  const upsertCalls: Array<{ name: string; value: string }> = [];

  const client: CommandRuntime["client"] = {
    deleteSecret: (_scope, name) => {
      deleteCalls.push(name);
      return Promise.resolve();
    },
    getPublicKey: () => Promise.resolve({ key: "key", key_id: "key-id" }),
    getRepository: () =>
      Promise.resolve({
        default_branch: "main",
        full_name: "acme/app",
        html_url: "https://github.com/acme/app",
        private: true,
      }),
    getSecretCount: () => Promise.resolve(2),
    listSecrets: () => Promise.resolve({ totalCount: 0, secrets: [] }),
    secretExists: (_scope, name) => {
      existenceChecks.push(name);
      return Promise.resolve(false);
    },
    upsertSecret: (_scope, name, value) => {
      upsertCalls.push({ name, value });
      return Promise.resolve({ created: true, name });
    },
    ...(options.client ?? {}),
  } as CommandRuntime["client"];

  const runtime: CommandRuntime = {
    client,
    repo: repoScope,
    scope: repoScope,
    tokenSource: "option",
    ...(options.runtime ?? {}),
  };

  const dependencies: CliOverrides = {
    confirmAction: (message) => {
      prompts.push(message);
      return Promise.resolve(options.confirmResult ?? true);
    },
    isInteractiveSession: () => options.interactive ?? false,
    printJson: (value) => {
      jsonValues.push(value);
    },
    printLine: (value) => {
      lines.push(value);
    },
    readOptionalStdin: () => Promise.resolve(options.stdin ?? null),
    resolveRuntime: () => runtime,
    resolveSecretValue: (value, fromEnv) => {
      resolveSecretValueCalls.push({ fromEnv, value });
      return Promise.resolve(options.secretValue ?? value ?? "stdin-value");
    },
    writeStderr: (value) => {
      errors.push(value);
    },
  };

  return {
    deleteCalls,
    dependencies,
    errors,
    existenceChecks,
    jsonValues,
    lines,
    prompts,
    resolveSecretValueCalls,
    upsertCalls,
  };
};

describe("cli commands", () => {
  test("doctor prints repository diagnostics", async () => {
    const harness = createHarness();

    const exitCode = await runCli(createArgv("doctor"), harness.dependencies);

    expect(exitCode).toBe(0);
    expect(harness.lines).toEqual([
      "Repo: acme/app",
      "Scope: acme/app",
      "Auth: option",
      "Secrets: 2",
      "Private: yes",
    ]);
  });

  test("list emits json output", async () => {
    const harness = createHarness({
      client: {
        listSecrets: () => listedSecrets("API_KEY"),
      },
      runtime: {
        scope: { ...repoScope, environment: "prod" },
      },
    });

    const exitCode = await runCli(
      createArgv("list", "--json"),
      harness.dependencies
    );

    expect(exitCode).toBe(0);
    expect(harness.jsonValues).toEqual([
      {
        scope: { ...repoScope, environment: "prod" },
        totalCount: 1,
        secrets: [listedSecret("API_KEY")],
      },
    ]);
  });

  test("set writes a provided value", async () => {
    const harness = createHarness({ secretValue: "super-secret" });

    const exitCode = await runCli(
      createArgv("set", "api_key", "ignored"),
      harness.dependencies
    );

    expect(exitCode).toBe(0);
    expect(harness.resolveSecretValueCalls).toEqual([
      { fromEnv: undefined, value: "ignored" },
    ]);
    expect(harness.existenceChecks).toEqual(["API_KEY"]);
    expect(harness.upsertCalls).toEqual([
      { name: "API_KEY", value: "super-secret" },
    ]);
    expect(harness.lines).toEqual(["Created API_KEY in acme/app."]);
  });

  test("set prompts before overwriting in interactive mode", async () => {
    const harness = createHarness({
      client: {
        secretExists: () => Promise.resolve(true),
      },
      confirmResult: false,
      interactive: true,
    });

    const exitCode = await runCli(
      createArgv("set", "API_KEY", "value"),
      harness.dependencies
    );

    expect(exitCode).toBe(1);
    expect(harness.prompts).toEqual([
      "Secret API_KEY already exists in acme/app. Overwrite it?",
    ]);
    expect(harness.errors).toEqual(["Aborted.\n"]);
    expect(harness.upsertCalls).toEqual([]);
  });

  test("set requires yes when json mode suppresses overwrite prompts", async () => {
    const harness = createHarness({
      client: {
        secretExists: () => Promise.resolve(true),
      },
      interactive: true,
    });

    const exitCode = await runCli(
      createArgv("set", "API_KEY", "value", "--json"),
      harness.dependencies
    );

    expect(exitCode).toBe(1);
    expect(harness.jsonValues).toEqual([confirmationRequiredJson]);
  });

  test("sync dry-run honors source filters before prefixing", async () => {
    const file = await writeTempEnv("APP_KEY=1\nDEBUG_KEY=2\n");

    const harness = createHarness({
      client: {
        listSecrets: () => listedSecrets("PROD_APP_KEY", "PROD_APP_OLD"),
      },
    });

    const exitCode = await runCli(
      createArgv(
        "sync",
        "--from-file",
        file,
        "--include",
        "APP_*",
        "--prefix",
        "PROD_",
        "--delete-missing",
        "--dry-run"
      ),
      harness.dependencies
    );

    expect(exitCode).toBe(0);
    expect(harness.lines).toEqual([
      "Plan for acme/app: 1 upsert, 1 delete.",
      `update\tPROD_APP_KEY\t${file}`,
      "delete\tPROD_APP_OLD",
    ]);
  });

  test("sync refuses broad delete-missing runs without yes", async () => {
    const harness = createHarness({
      client: {
        listSecrets: () => listedSecrets("APP_OLD"),
      },
      stdin: "APP_KEY=1\n",
    });

    const exitCode = await runCli(
      createArgv("sync", "--delete-missing"),
      harness.dependencies
    );

    expect(exitCode).toBe(1);
    expect(harness.errors).toEqual([
      "Refusing to run --delete-missing without a scope filter.\n",
      "Add --prefix or --include, or re-run with --yes if you really want a full-scope delete.\n",
    ]);
  });

  test("sync applies updates and deletes when confirmed with yes", async () => {
    const harness = createHarness({
      client: {
        listSecrets: () => listedSecrets("APP_KEY", "APP_OLD"),
        upsertSecret: (_scope, name, value) => {
          harness.upsertCalls.push({ name, value });
          return Promise.resolve({ created: false, name });
        },
      },
      stdin: "APP_KEY=1\n",
    });

    const exitCode = await runCli(
      createArgv("sync", "--delete-missing", "--include", "APP_*", "--yes"),
      harness.dependencies
    );

    expect(exitCode).toBe(0);
    expect(harness.upsertCalls).toEqual([{ name: "APP_KEY", value: "1" }]);
    expect(harness.deleteCalls).toEqual(["APP_OLD"]);
    expect(harness.lines).toEqual([
      "Synced acme/app: 0 created, 1 updated, 1 deleted.",
    ]);
  });

  test("sync json mode still requires yes for destructive plans", async () => {
    const harness = createHarness({
      client: {
        listSecrets: () => listedSecrets("APP_KEY"),
      },
      stdin: "APP_KEY=1\n",
    });

    const exitCode = await runCli(
      createArgv("sync", "--include", "APP_*", "--json"),
      harness.dependencies
    );

    expect(exitCode).toBe(1);
    expect(harness.jsonValues).toEqual([confirmationRequiredJson]);
  });

  test("delete requires yes when no prompt can be shown", async () => {
    const harness = createHarness();

    const exitCode = await runCli(
      createArgv("delete", "API_KEY"),
      harness.dependencies
    );

    expect(exitCode).toBe(1);
    expect(harness.errors).toEqual([
      "Refusing to continue without confirmation.\n",
      "Re-run with --yes.\n",
    ]);
    expect(harness.deleteCalls).toEqual([]);
  });

  test("delete de-duplicates secret names before deleting", async () => {
    const harness = createHarness();

    const exitCode = await runCli(
      createArgv("delete", "api_key", "API_KEY", "--yes", "--json"),
      harness.dependencies
    );

    expect(exitCode).toBe(0);
    expect(harness.deleteCalls).toEqual(["API_KEY"]);
    expect(harness.jsonValues).toEqual([
      {
        deleted: ["API_KEY"],
        scope: repoScope,
      },
    ]);
  });

  test("json errors keep structured cli payloads", async () => {
    const harness = createHarness({
      client: {
        getRepository: () => Promise.reject(new Error("boom")),
      },
    });

    const exitCode = await runCli(
      createArgv("doctor", "--json"),
      harness.dependencies
    );

    expect(exitCode).toBe(1);
    expect(harness.jsonValues).toEqual([
      {
        error: "cli_error",
        message: "boom",
      },
    ]);
  });
});

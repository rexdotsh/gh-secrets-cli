import { access, readFile } from "node:fs/promises";

import { parse as parseDotenv } from "dotenv";
import picomatch from "picomatch";
import { z } from "zod";

import type { GitHubSecretsClient, SecretScope } from "./github";

import { CliError } from "./errors";
import { assertSecretName } from "./secret-name";

type SecretEntry = {
  name: string;
  source: string;
  value: string;
};

type SyncPlan = {
  deletes: string[];
  upserts: Array<
    SecretEntry & {
      action: "create" | "update";
    }
  >;
};

type SyncSourceOptions = {
  env?: string;
  exclude?: string[];
  fromFile?: string[];
  fromJson?: string[];
  fromProcess?: boolean;
  include?: string[];
  prefix?: string;
  stdin?: string | null;
};

type SyncFilters = Pick<SyncSourceOptions, "exclude" | "include" | "prefix">;

const jsonSecretsSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()])
);

const fileExists = async (path: string) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const coerceSecretValue = (value: string | number | boolean | null) => {
  if (value === null) {
    return "";
  }

  return String(value);
};

const toArray = (value: string | string[] | undefined) => {
  if (Array.isArray(value)) {
    return value;
  }

  return value ? [value] : [];
};

const createMatcher = (patterns: string[], fallback: boolean) =>
  patterns.length ? picomatch(patterns, { nocase: true }) : () => fallback;

const normalizeEntries = (
  entries: SecretEntry[],
  prefix: string,
  include: string[],
  exclude: string[]
) => {
  const matchesInclude = createMatcher(include, true);
  const matchesExclude = createMatcher(exclude, false);
  const merged = new Map<string, SecretEntry>();

  for (const entry of entries) {
    const name = assertSecretName(`${prefix}${entry.name}`);
    if (!matchesInclude(name) || matchesExclude(name)) {
      continue;
    }

    merged.set(name, {
      ...entry,
      name,
    });
  }

  return [...merged.values()];
};

export const selectManagedNames = (names: string[], filters: SyncFilters) =>
  normalizeEntries(
    names.map((name) => ({
      name,
      source: "remote",
      value: "",
    })),
    filters.prefix ?? "",
    toArray(filters.include),
    toArray(filters.exclude)
  ).map((entry) => entry.name);

const loadEntriesFromFiles = async (
  paths: string[],
  parser: (text: string, source: string) => SecretEntry[]
) => {
  const entries: SecretEntry[] = [];

  for (const path of paths) {
    entries.push(...parser(await readFile(path, "utf8"), path));
  }

  return entries;
};

const readProcessEnvEntries = (): SecretEntry[] =>
  Object.entries(process.env).flatMap(([name, value]) =>
    value === undefined ? [] : [{ name, source: "process.env", value }]
  );

export const parseJsonSecrets = (
  text: string,
  source: string
): SecretEntry[] => {
  const parsed = jsonSecretsSchema.parse(JSON.parse(text));

  return Object.entries(parsed).map(([name, value]) => ({
    name,
    source,
    value: coerceSecretValue(value),
  }));
};

export const parseDotenvSecrets = (
  text: string,
  source: string
): SecretEntry[] => {
  return Object.entries(parseDotenv(text)).map(([name, value]) => ({
    name,
    source,
    value,
  }));
};

const parseSecretsText = (text: string, source: string): SecretEntry[] => {
  if (/^\s*[{[]/u.test(text)) {
    return parseJsonSecrets(text, source);
  }

  return parseDotenvSecrets(text, source);
};

const resolveDefaultEnvFiles = async (environment?: string) => {
  const candidates = [
    ".env",
    ".env.local",
    environment ? `.env.${environment}` : null,
    environment ? `.env.${environment}.local` : null,
  ].filter((value): value is string => Boolean(value));

  const resolved: string[] = [];
  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      resolved.push(candidate);
    }
  }

  return resolved;
};

export const loadSyncEntries = async (
  options: SyncSourceOptions
): Promise<SecretEntry[]> => {
  const prefix = options.prefix ?? "";
  const include = toArray(options.include);
  const exclude = toArray(options.exclude);
  const dotenvFiles = toArray(options.fromFile);
  const jsonFiles = toArray(options.fromJson);
  const sources: SecretEntry[] = [];

  const hasExplicitSources =
    dotenvFiles.length > 0 ||
    jsonFiles.length > 0 ||
    Boolean(options.fromProcess);
  const stdin = options.stdin?.trim() ? options.stdin : null;

  if (!hasExplicitSources && stdin) {
    return normalizeEntries(
      parseSecretsText(stdin, "stdin"),
      prefix,
      include,
      exclude
    );
  }

  const filesToLoad = hasExplicitSources
    ? dotenvFiles
    : await resolveDefaultEnvFiles(options.env);

  sources.push(
    ...(await loadEntriesFromFiles(filesToLoad, parseDotenvSecrets))
  );
  sources.push(...(await loadEntriesFromFiles(jsonFiles, parseJsonSecrets)));

  if (options.fromProcess) {
    sources.push(...readProcessEnvEntries());
  }

  if (stdin) {
    sources.push(...parseSecretsText(stdin, "stdin"));
  }

  const entries = normalizeEntries(sources, prefix, include, exclude);
  if (entries.length) {
    return entries;
  }

  if (!hasExplicitSources && !stdin) {
    throw new CliError(
      "No input secrets found. Add a .env file, pipe JSON or dotenv on stdin, or pass --from-file, --from-json, or --from-process."
    );
  }

  throw new CliError("No secrets matched the selected sync filters.");
};

export const planSecretSync = (
  entries: SecretEntry[],
  remoteNames: string[],
  deleteMissing: boolean
): SyncPlan => {
  const remoteSet = new Set(remoteNames);
  const localSet = new Set(entries.map((entry) => entry.name));

  return {
    deletes: deleteMissing
      ? remoteNames.filter((name) => !localSet.has(name)).sort()
      : [],
    upserts: entries.map((entry) => ({
      ...entry,
      action: remoteSet.has(entry.name) ? "update" : "create",
    })),
  };
};

export const applySecretSync = async (
  client: GitHubSecretsClient,
  scope: SecretScope,
  plan: SyncPlan
) => {
  const created: string[] = [];
  const updated: string[] = [];

  for (const entry of plan.upserts) {
    const result = await client.upsertSecret(scope, entry.name, entry.value);
    if (result.created) {
      created.push(entry.name);
      continue;
    }

    updated.push(entry.name);
  }

  for (const name of plan.deletes) {
    await client.deleteSecret(scope, name);
  }

  return {
    created,
    deleted: [...plan.deletes],
    updated,
  };
};

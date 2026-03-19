import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  loadSyncEntries,
  parseDotenvSecrets,
  parseJsonSecrets,
  planSecretSync,
  selectManagedNames,
} from "../src/core/sync";

describe("sync parsing", () => {
  test("parses dotenv secrets", () => {
    expect(parseDotenvSecrets("A=1\nB=2\n", ".env")).toEqual([
      { name: "A", source: ".env", value: "1" },
      { name: "B", source: ".env", value: "2" },
    ]);
  });

  test("parses json secrets", () => {
    expect(
      parseJsonSecrets('{"A":"1","B":2,"C":true,"D":null}', "secrets.json")
    ).toEqual([
      { name: "A", source: "secrets.json", value: "1" },
      { name: "B", source: "secrets.json", value: "2" },
      { name: "C", source: "secrets.json", value: "true" },
      { name: "D", source: "secrets.json", value: "" },
    ]);
  });

  test("wraps invalid json file errors clearly", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gh-secrets-"));
    const file = join(directory, "bad.json");
    await writeFile(file, '{"A": }');

    await expect(
      loadSyncEntries({
        fromJson: [file],
      })
    ).rejects.toMatchObject({
      code: "invalid_json_input",
      message: `Failed to parse ${file} as JSON secrets.`,
    });
  });

  test("ignores CAC undefined sentinels for omitted array options", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gh-secrets-"));
    const file = join(directory, ".env");
    await writeFile(file, "A=1\n");

    await expect(
      loadSyncEntries({
        exclude: ["undefined"],
        fromFile: [file],
        fromJson: ["undefined"],
        include: ["undefined"],
      })
    ).resolves.toEqual([{ name: "A", source: file, value: "1" }]);
  });

  test("filters source names before applying a prefix", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gh-secrets-"));
    const file = join(directory, ".env");
    await writeFile(file, "APP_KEY=1\nDEBUG_KEY=2\n");

    await expect(
      loadSyncEntries({
        fromFile: [file],
        include: ["APP_*"],
        prefix: "prod_",
      })
    ).resolves.toEqual([{ name: "PROD_APP_KEY", source: file, value: "1" }]);
  });
});

describe("sync planning", () => {
  test("filters managed remote names before delete planning", () => {
    expect(
      selectManagedNames(["APP_A", "OTHER_B", "app_old"], {
        include: ["app_*"],
        prefix: "",
      })
    ).toEqual(["APP_A", "APP_OLD"]);
  });

  test("matches remote managed names against the unprefixed source name", () => {
    expect(
      selectManagedNames(["PROD_APP_A", "PROD_DEBUG_A", "OTHER_A"], {
        exclude: ["DEBUG_*"],
        include: ["APP_*"],
        prefix: "prod_",
      })
    ).toEqual(["PROD_APP_A"]);
  });

  test("classifies create, update, and delete work", () => {
    expect(
      planSecretSync(
        [
          { name: "A", source: ".env", value: "1" },
          { name: "B", source: ".env", value: "2" },
        ],
        ["B", "C"],
        true
      )
    ).toEqual({
      deletes: ["C"],
      upserts: [
        { action: "create", name: "A", source: ".env", value: "1" },
        { action: "update", name: "B", source: ".env", value: "2" },
      ],
    });
  });

  test("keeps prefixed remote names aligned with prefixed local entries", () => {
    expect(
      planSecretSync(
        [{ name: "PROD_APP_A", source: ".env", value: "1" }],
        selectManagedNames(["PROD_APP_A", "PROD_APP_OLD"], {
          include: ["APP_*"],
          prefix: "prod_",
        }),
        true
      )
    ).toEqual({
      deletes: ["PROD_APP_OLD"],
      upserts: [
        {
          action: "update",
          name: "PROD_APP_A",
          source: ".env",
          value: "1",
        },
      ],
    });
  });
});

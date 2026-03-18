import { describe, expect, test } from "bun:test";

import { formatSecretScope, resolveSecretScope } from "../src/core/github";

describe("secret scopes", () => {
  test("formats repo scopes", () => {
    expect(formatSecretScope({ owner: "octocat", repo: "hello-world" })).toBe(
      "octocat/hello-world"
    );
  });

  test("formats environment scopes", () => {
    expect(
      formatSecretScope({
        owner: "octocat",
        repo: "hello-world",
        environment: "production",
      })
    ).toBe("octocat/hello-world (production)");
  });

  test("resolves environment scope when provided", () => {
    expect(
      resolveSecretScope(
        { owner: "octocat", repo: "hello-world" },
        "production"
      )
    ).toEqual({
      owner: "octocat",
      repo: "hello-world",
      environment: "production",
    });
  });
});

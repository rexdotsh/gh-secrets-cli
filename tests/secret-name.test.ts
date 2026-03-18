import { describe, expect, test } from "bun:test";

import { assertSecretName } from "../src/core/secret-name";

describe("secret names", () => {
  test("accepts typical github secret names", () => {
    expect(assertSecretName("OPENAI_API_KEY")).toBe("OPENAI_API_KEY");
    expect(assertSecretName("my_secret_2")).toBe("MY_SECRET_2");
  });

  test("rejects invalid names", () => {
    expect(() => assertSecretName("2FAST")).toThrow();
    expect(() => assertSecretName("bad-name")).toThrow();
  });

  test("rejects reserved github secret names", () => {
    expect(() => assertSecretName("GITHUB_TOKEN")).toThrow();
    expect(() => assertSecretName("github_actions")).toThrow();
  });
});

import { describe, expect, test } from "bun:test";

import { resolveRepoRef } from "../src/core/repo-ref";

describe("repo parsing", () => {
  test("parses owner slash repo refs", () => {
    expect(resolveRepoRef("octocat/hello-world")).toEqual({
      owner: "octocat",
      repo: "hello-world",
    });
  });

  test("parses github https urls", () => {
    expect(
      resolveRepoRef("https://github.com/octocat/hello-world.git")
    ).toEqual({
      owner: "octocat",
      repo: "hello-world",
    });
  });

  test("parses github ssh urls", () => {
    expect(resolveRepoRef("git@github.com:octocat/hello-world.git")).toEqual({
      owner: "octocat",
      repo: "hello-world",
    });
  });

  test("parses github ssh protocol urls", () => {
    expect(
      resolveRepoRef("ssh://git@github.com/octocat/hello-world.git")
    ).toEqual({
      owner: "octocat",
      repo: "hello-world",
    });
  });
});

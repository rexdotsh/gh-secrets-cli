import { describe, expect, test } from "bun:test";

import {
  formatRepoRef,
  parseGitHubRepoUrl,
  parseRepoRef,
} from "../src/core/repo-ref";

describe("repo parsing", () => {
  test("parses owner slash repo refs", () => {
    expect(parseRepoRef("octocat/hello-world")).toEqual({
      owner: "octocat",
      repo: "hello-world",
    });
  });

  test("rejects malformed repo refs", () => {
    expect(parseRepoRef("octocat")).toBeNull();
    expect(parseRepoRef("octocat/hello-world/extra")).toBeNull();
  });

  test("parses github https urls", () => {
    expect(
      parseGitHubRepoUrl("https://github.com/octocat/hello-world.git")
    ).toEqual({
      owner: "octocat",
      repo: "hello-world",
    });
  });

  test("parses github ssh urls", () => {
    expect(
      parseGitHubRepoUrl("git@github.com:octocat/hello-world.git")
    ).toEqual({
      owner: "octocat",
      repo: "hello-world",
    });
  });

  test("parses github ssh protocol urls", () => {
    expect(
      parseGitHubRepoUrl("ssh://git@github.com/octocat/hello-world.git")
    ).toEqual({
      owner: "octocat",
      repo: "hello-world",
    });
  });

  test("formats repo refs", () => {
    expect(formatRepoRef({ owner: "octocat", repo: "hello-world" })).toBe(
      "octocat/hello-world"
    );
  });
});

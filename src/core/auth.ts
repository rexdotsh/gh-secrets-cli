import { execFileSync } from "node:child_process";

import { CliError } from "./errors";

type ResolvedToken = {
  source: "option" | "GITHUB_TOKEN" | "GH_TOKEN" | "gh";
  value: string;
};

const readGhAuthToken = (): string | null => {
  try {
    const value = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return value || null;
  } catch {
    return null;
  }
};

export const resolveAuthToken = (explicit?: string): ResolvedToken => {
  const candidates: Array<ResolvedToken | null> = [
    explicit ? { source: "option", value: explicit } : null,
    process.env.GITHUB_TOKEN
      ? { source: "GITHUB_TOKEN", value: process.env.GITHUB_TOKEN }
      : null,
    process.env.GH_TOKEN
      ? { source: "GH_TOKEN", value: process.env.GH_TOKEN }
      : null,
  ] as const;

  for (const candidate of candidates) {
    if (candidate?.value) {
      return candidate;
    }
  }

  const ghToken = readGhAuthToken();
  if (ghToken) {
    return {
      source: "gh",
      value: ghToken,
    };
  }

  throw new CliError("Missing GitHub token.", {
    code: "missing_token",
    hint: "Pass --token, set GITHUB_TOKEN or GH_TOKEN, or log in with gh auth login.",
  });
};

import { execFileSync } from "node:child_process";

export type RepoRef = {
  owner: string;
  repo: string;
};

const sanitizeRepoPath = (value: string) => value.replace(/\.git$/u, "");

const parseRepoParts = (parts: string[]) => {
  const [owner, repo, extra] = parts;
  if (!owner || !repo || extra) {
    return null;
  }

  return buildRepoRef(owner, repo);
};

const buildRepoRef = (owner: string, repo: string): RepoRef | null => {
  const normalizedOwner = owner.trim();
  const normalizedRepo = sanitizeRepoPath(repo.trim());

  if (!normalizedOwner || !normalizedRepo) {
    return null;
  }

  if (normalizedOwner.includes("/") || normalizedRepo.includes("/")) {
    return null;
  }

  return {
    owner: normalizedOwner,
    repo: normalizedRepo,
  };
};

export const formatRepoRef = ({ owner, repo }: RepoRef) => `${owner}/${repo}`;

export const parseRepoRef = (value: string): RepoRef | null =>
  parseRepoParts(value.trim().split("/"));

export const parseGitHubRepoUrl = (value: string): RepoRef | null => {
  const trimmed = value.trim();
  const sshMatch =
    /^git@github\.com:(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?$/u.exec(
      trimmed
    );
  if (sshMatch?.groups) {
    const { owner, repo } = sshMatch.groups;
    if (!owner || !repo) {
      return null;
    }

    return buildRepoRef(owner, repo);
  }

  try {
    const url = new URL(trimmed);
    if (url.hostname !== "github.com") {
      return null;
    }

    return parseRepoParts(url.pathname.split("/").filter(Boolean));
  } catch {
    return null;
  }
};

const parseRepoCandidate = (value?: string | null) => {
  if (!value) {
    return null;
  }

  return parseRepoRef(value) ?? parseGitHubRepoUrl(value);
};

const readGitRemoteUrl = (name: string) => {
  try {
    return execFileSync("git", ["remote", "get-url", name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};

const readGitRemoteUrls = (): string[] => {
  try {
    const output = execFileSync("git", ["remote", "-v"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    const urls = new Set<string>();
    for (const line of output.split("\n")) {
      const [, url] = line.trim().split(/\s+/u);
      if (url) {
        urls.add(url);
      }
    }

    return [...urls];
  } catch {
    return [];
  }
};

export const resolveRepoRef = (explicit?: string): RepoRef | null => {
  for (const candidate of [
    explicit,
    process.env.GH_REPO,
    process.env.GITHUB_REPOSITORY,
    readGitRemoteUrl("origin"),
  ]) {
    const parsed = parseRepoCandidate(candidate);
    if (parsed) {
      return parsed;
    }
  }

  for (const candidate of readGitRemoteUrls()) {
    const parsed = parseRepoCandidate(candidate);
    if (parsed) {
      return parsed;
    }
  }

  return null;
};

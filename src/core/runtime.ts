import type { RepoRef } from "./repo-ref";

import { resolveAuthToken } from "./auth";
import { CliError } from "./errors";
import {
  GitHubSecretsClient,
  resolveSecretScope,
  type SecretScope,
} from "./github";
import { resolveRepoRef } from "./repo-ref";

type GlobalOptions = {
  env?: string;
  repo?: string;
  token?: string;
};

type CommandRuntime = {
  client: GitHubSecretsClient;
  repo: RepoRef;
  scope: SecretScope;
  tokenSource: string;
};

export const resolveRuntime = (options: GlobalOptions): CommandRuntime => {
  const repo = resolveRepoRef(options.repo);
  if (!repo) {
    throw new CliError(
      "Missing GitHub repo. Pass --repo owner/repo, set GH_REPO or GITHUB_REPOSITORY, or run inside a git checkout with a GitHub remote."
    );
  }

  const token = resolveAuthToken(options.token);

  return {
    client: new GitHubSecretsClient(token.value),
    repo,
    scope: resolveSecretScope(repo, options.env),
    tokenSource: token.source,
  };
};

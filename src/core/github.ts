import { z } from "zod";

import type { RepoRef } from "./repo-ref";

import { encryptSecretValue } from "./encrypt";

export type SecretScope = RepoRef & {
  environment?: string;
};

type SecretSummary = {
  name: string;
  createdAt: string;
  updatedAt: string;
};

const apiErrorSchema = z.object({
  message: z.string(),
});

const publicKeySchema = z.object({
  key: z.string(),
  key_id: z.string(),
});

const secretSchema = z.object({
  name: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

const listSecretsSchema = z.object({
  total_count: z.number(),
  secrets: z.array(secretSchema),
});

const repositorySchema = z.object({
  default_branch: z.string(),
  full_name: z.string(),
  html_url: z.string().url(),
  private: z.boolean(),
});

const githubApiOrigin = "https://api.github.com";
const githubApiVersion = "2026-03-10";
const userAgent = "gha-secrets";

const mapSecretSummary = (
  secret: z.infer<typeof secretSchema>
): SecretSummary => ({
  name: secret.name,
  createdAt: secret.created_at,
  updatedAt: secret.updated_at,
});

const buildSecretsBasePath = ({ owner, repo, environment }: SecretScope) => {
  if (environment) {
    return `/repos/${owner}/${repo}/environments/${encodeURIComponent(environment)}/secrets`;
  }

  return `/repos/${owner}/${repo}/actions/secrets`;
};

const buildRequestInit = (
  token: string,
  method: string,
  body?: unknown
): RequestInit => {
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": userAgent,
    "X-GitHub-Api-Version": githubApiVersion,
  };
  const init: RequestInit = {
    method,
    headers,
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  return init;
};

const readErrorMessage = async (response: Response) => {
  const payload = apiErrorSchema.safeParse(
    await response.json().catch(() => null)
  );
  if (payload.success) {
    return payload.data.message;
  }

  return `${response.status} ${response.statusText}`.trim();
};

export class GitHubSecretsClient {
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async request<Schema extends z.ZodType>(
    path: string,
    schema: Schema,
    init: RequestInit
  ): Promise<z.infer<Schema>> {
    const response = await fetch(`${githubApiOrigin}${path}`, init);
    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    return schema.parse(await response.json());
  }

  private async requestEmpty(path: string, method: string, body?: unknown) {
    const response = await fetch(
      `${githubApiOrigin}${path}`,
      buildRequestInit(this.token, method, body)
    );
    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    return response.status;
  }

  getRepository(repo: RepoRef) {
    return this.request(
      `/repos/${repo.owner}/${repo.repo}`,
      repositorySchema,
      buildRequestInit(this.token, "GET")
    );
  }

  getPublicKey(scope: SecretScope) {
    return this.request(
      `${buildSecretsBasePath(scope)}/public-key`,
      publicKeySchema,
      buildRequestInit(this.token, "GET")
    );
  }

  async getSecretCount(scope: SecretScope) {
    const payload = await this.request(
      `${buildSecretsBasePath(scope)}?per_page=1&page=1`,
      listSecretsSchema,
      buildRequestInit(this.token, "GET")
    );

    return payload.total_count;
  }

  async listSecrets(scope: SecretScope, perPage = 100) {
    const secrets: SecretSummary[] = [];
    let page = 1;
    let totalCount = 0;

    while (page === 1 || secrets.length < totalCount) {
      const payload = await this.request(
        `${buildSecretsBasePath(scope)}?per_page=${perPage}&page=${page}`,
        listSecretsSchema,
        buildRequestInit(this.token, "GET")
      );

      totalCount = payload.total_count;
      secrets.push(...payload.secrets.map(mapSecretSummary));

      if (payload.secrets.length < perPage) {
        break;
      }

      page += 1;
    }

    return {
      totalCount,
      secrets,
    };
  }

  async upsertSecret(scope: SecretScope, name: string, value: string) {
    const publicKey = await this.getPublicKey(scope);
    const encryptedValue = await encryptSecretValue(value, publicKey.key);
    const status = await this.requestEmpty(
      `${buildSecretsBasePath(scope)}/${encodeURIComponent(name)}`,
      "PUT",
      {
        encrypted_value: encryptedValue,
        key_id: publicKey.key_id,
      }
    );

    return {
      created: status === 201,
      name,
    };
  }

  async deleteSecret(scope: SecretScope, name: string) {
    await this.requestEmpty(
      `${buildSecretsBasePath(scope)}/${encodeURIComponent(name)}`,
      "DELETE"
    );
  }
}

export const formatSecretScope = ({ owner, repo, environment }: SecretScope) =>
  environment ? `${owner}/${repo} (${environment})` : `${owner}/${repo}`;

export const resolveSecretScope = (
  repo: RepoRef,
  environment?: string
): SecretScope => {
  const normalizedEnvironment = environment?.trim();
  if (!normalizedEnvironment) {
    return repo;
  }

  return {
    ...repo,
    environment: normalizedEnvironment,
  };
};

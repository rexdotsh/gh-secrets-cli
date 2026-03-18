import { CliError } from "./errors";

const secretNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const reservedSecretPrefix = "GITHUB_";

export const assertSecretName = (value: string) => {
  const normalized = value.trim().toUpperCase();
  if (!secretNamePattern.test(normalized)) {
    throw new CliError(
      `Invalid secret name: ${value}. Use letters, numbers, and underscores, and do not start with a number.`
    );
  }

  if (normalized.startsWith(reservedSecretPrefix)) {
    throw new CliError(
      `Invalid secret name: ${value}. GitHub Actions secrets cannot start with ${reservedSecretPrefix}.`
    );
  }

  return normalized;
};

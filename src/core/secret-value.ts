import { CliError } from "./errors";
import { readStdin } from "./io";

const stripFinalLineBreak = (value: string) => value.replace(/\r?\n$/u, "");

export const resolveSecretValue = async (
  value: string | undefined,
  fromEnv: string | undefined
) => {
  if (value !== undefined && fromEnv) {
    throw new CliError("Pass either a value argument or --from-env, not both.");
  }

  if (fromEnv) {
    const resolved = process.env[fromEnv];
    if (resolved === undefined) {
      throw new CliError(`Missing local env var: ${fromEnv}`);
    }

    return resolved;
  }

  if (value !== undefined) {
    return value;
  }

  if (!process.stdin.isTTY) {
    return stripFinalLineBreak(await readStdin());
  }

  throw new CliError(
    "Missing secret value. Pass it as an argument, use --from-env, or pipe it on stdin."
  );
};

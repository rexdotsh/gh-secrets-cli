type CliErrorOptions = {
  code?: string;
  hint?: string;
};

type CliErrorPayload = {
  error: string;
  hint?: string;
  message: string;
};

export class CliError extends Error {
  code: string;
  hint?: string;

  constructor(message: string, options: CliErrorOptions = {}) {
    super(message);
    this.name = "CliError";
    this.code = options.code ?? "cli_error";
    if (options.hint !== undefined) {
      this.hint = options.hint;
    }
  }
}

export const getCliErrorPayload = (error: unknown): CliErrorPayload => {
  if (error instanceof CliError) {
    const payload: CliErrorPayload = {
      error: error.code,
      message: error.message,
    };

    if (error.hint !== undefined) {
      payload.hint = error.hint;
    }

    return payload;
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    error: "cli_error",
    message,
  };
};

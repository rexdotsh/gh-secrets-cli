import { createInterface } from "node:readline/promises";

export const printJson = (value: unknown) => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

export const printLine = (value: string) => {
  process.stdout.write(`${value}\n`);
};

export const readStdin = async () => {
  let output = "";

  for await (const chunk of process.stdin) {
    output += String(chunk);
  }

  return output;
};

export const isInteractiveSession = () =>
  Boolean(process.stdin.isTTY && process.stdout.isTTY);

export const confirmAction = async (message: string) => {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = (await readline.question(`${message} [y/N] `))
      .trim()
      .toLowerCase();

    return answer === "y" || answer === "yes";
  } finally {
    readline.close();
  }
};

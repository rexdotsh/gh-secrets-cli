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

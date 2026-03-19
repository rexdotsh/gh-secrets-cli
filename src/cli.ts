#!/usr/bin/env node

import { runCli } from "./app";

process.exit(await runCli(process.argv));

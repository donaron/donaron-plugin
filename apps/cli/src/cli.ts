#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runCli } from './index.js';

const argv = process.argv.slice(2);
let stdin = '';
if (argv[0] === 'hook') {
  try {
    stdin = readFileSync(0, 'utf8');
  } catch {
    stdin = '';
  }
}

const result = runCli(argv, {
  cwd: process.cwd(),
  stdin,
  isInteractiveTty: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  cliEntryPath: resolve(import.meta.dirname, 'cli.js'),
});

if (result.stdout.length > 0) {
  process.stdout.write(result.stdout);
}
if (result.stderr.length > 0) {
  process.stderr.write(result.stderr);
}
process.exitCode = result.exitCode;

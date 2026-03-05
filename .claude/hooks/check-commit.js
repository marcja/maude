#!/usr/bin/env node
// PreToolUse hook on Bash: intercepts git commit and runs the pre-commit quality
// gate before the OS-level hook. This gives Claude Code a chance to self-correct
// (fix type errors, lint violations, failing tests) before the git hook blocks it.

const { execSync } = require('node:child_process');
const { readHookInput } = require('./utils.js');

readHookInput((input) => {
  const command = input?.tool_input?.command ?? '';

  // Only run checks when the bash command is a git commit
  if (!/git\s+commit/.test(command)) {
    process.exit(0);
  }

  process.stderr.write('Running pre-commit checks before git commit...\n');
  try {
    execSync('pnpm type-check && pnpm lint && pnpm test --passWithNoTests', {
      stdio: 'inherit',
      shell: true,
    });
  } catch {
    process.stderr.write('Pre-commit checks failed. Fix all errors before committing.\n');
    process.exit(1);
  }

  process.exit(0);
});

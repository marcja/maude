---
name: run-pre-commit-check
description: Run the full pre-commit quality gate before committing. Invoke
  manually before any git commit to catch failures before the OS hook blocks
  the commit.
disable-model-invocation: true
allowed-tools: Bash
---

# Run Pre-Commit Check

Run in sequence. Stop on the first failure and report the exact error output.

1. `pnpm type-check` — zero TypeScript errors
2. `pnpm lint` — zero Biome errors or warnings
3. `pnpm test` — all tests pass
4. `pnpm test:coverage` — coverage has not decreased
5. `/simplify` — review staged changes for reuse, quality, and efficiency;
   apply any fixes and re-stage

Only proceed to `git commit` when all five steps complete without error.
Fix all failures before retrying. Do not suppress errors.

# CLAUDE.md — Project Constitution

## What Maude is

"Marc's Claude" — a pedagogical LLM chat application for learning to design and
build a streaming LLM-based AI assistant. Every architectural decision optimizes for making LLM UI
concerns visible and exercisable. Comments explain *why*, not just *what*.

## Enforcement — do not bypass

Hard gates run automatically. Do not use `--no-verify`. Do not suppress lint errors.

- Git pre-commit hook blocks commits that fail type-check, lint, or tests
- Claude Code PreToolUse hooks intercept `git commit` and TASKS.md writes
- Claude Code PostToolUse hook signals that `analyze-refactoring` skill must
  run after every commit before the next task begins
- `run-pre-commit-check` skill activates manually before commit attempts
- `validate-tasks-edit` skill activates automatically before TASKS.md edits

## Non-negotiable constraints

- TypeScript strict mode. No `any`. No `as` casts without an explanatory comment.
- No client component may import from `src/lib/server/`.
- All `startTransition` and `useDeferredValue` usages must have comments explaining
  why they are needed at that specific location.
- The model adapter is the only file that references `OLLAMA_BASE_URL` or `MODEL_NAME`.
- MSW intercepts `/api/chat`. No test requires Ollama to be running.
- Always use `pnpm`. Never `npm` or `yarn`.
- Always use `biome` for linting and formatting. No ESLint. No Prettier.

## TDD workflow — mandatory for every task

1. Read the task definition in TASKS.md
2. Write failing tests that specify the behavior
3. Implement the minimum code to make tests pass
4. Run `run-pre-commit-check` skill (or `pnpm type-check && pnpm lint && pnpm test`)
5. Run Playwright tests if the task touches UI behavior
6. Self-review every changed file before committing
7. Commit (one commit per task)
8. After commit: invoke `analyze-refactoring` skill; act on its output before
   the next task
9. Mark task done in TASKS.md; update milestone status if applicable

## Self-review checklist (before every commit)

- [ ] Implementation matches the SPEC.md definition for this task
- [ ] Each function/hook/component does one thing
- [ ] Comments explain *why*, not *what*
- [ ] `startTransition`/`useDeferredValue` usages are commented with specific reasons
- [ ] No client component imports from `src/lib/server/`
- [ ] Error paths are handled explicitly, not silently swallowed
- [ ] Change is the smallest complete working increment

## Commit message format

```
<type>(<scope>): <imperative summary, max 72 chars>

Goal:        what problem this solves or capability it adds
Approach:    key technical decisions and why
Accomplished: bullet list of what is now true
Gaps:        known limitations (or "None known")
Next steps:  what follows and why it depends on this commit
```

Types: `feat` / `fix` / `test` / `refactor` / `docs` / `chore`
Scope: task ID or module — `feat(T05)`, `refactor(sseParser)`, `docs(CLAUDE.md)`

## Post-commit refactoring

After every commit, the `analyze-refactoring` skill runs automatically via
the PostToolUse hook. If it identifies improvements, create a `refactor(<scope>)`
task in TASKS.md and complete it before the next feature task. Refactoring commits
change structure only — behavior and tests are unchanged before and after.

## Subagent coordination

When using the Task tool to spawn subagents:
- Each subagent receives its task ID, the relevant SPEC.md section, and the
  TypeScript interface contracts it depends on
- Each subagent updates TASKS.md status fields when complete
- Subagents do not modify CLAUDE.md or TASKS.md structure — only status fields

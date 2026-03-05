#!/usr/bin/env node
// PostToolUse hook on Bash: detects a successful git commit and emits a context
// signal. Claude Code reads this signal and invokes the analyze-refactoring skill
// before starting the next task. This is a soft trigger — the hook signals intent;
// Claude acts on it.

const { readHookInput } = require('./utils.js');

readHookInput((input) => {
  const command = input?.tool_input?.command ?? '';

  if (/git\s+commit/.test(command)) {
    process.stdout.write('MAUDE_POST_COMMIT_REQUIRED=1\n');
  }

  process.exit(0);
});

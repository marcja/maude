#!/usr/bin/env node
// PreToolUse hook on Write/Edit/MultiEdit: validates TASKS.md structure before
// any write. This is the hard gate — it runs regardless of whether the
// validate-tasks-edit skill was consulted first.

const fs = require('node:fs');
const { validate } = require('./validate_tasks.js');
const { readHookInput } = require('./utils.js');

readHookInput((input) => {
  const toolName = input?.tool_name ?? '';
  const filePath = input?.tool_input?.file_path ?? '';

  // Only validate writes targeting TASKS.md
  if (!filePath.endsWith('TASKS.md')) {
    process.exit(0);
  }

  let content;

  if (toolName === 'Write') {
    // Full file content is in the Write input — validate it directly
    content = input.tool_input.content;
  } else if (toolName === 'Edit') {
    // Apply the proposed edit in memory and validate the result
    try {
      const current = fs.readFileSync(filePath, 'utf8');
      content = current.replace(input.tool_input.old_string, input.tool_input.new_string);
    } catch {
      // If we can't read the current file, skip validation
      process.exit(0);
    }
  } else {
    // MultiEdit or unknown: validate the current file as-is
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      process.exit(0);
    }
  }

  const errors = validate(content);
  if (errors.length > 0) {
    for (const err of errors) {
      process.stderr.write(`ERROR: ${err}\n`);
    }
    process.stderr.write('TASKS.md validation failed. Fix structural errors before saving.\n');
    process.exit(1);
  }

  process.exit(0);
});

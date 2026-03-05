#!/usr/bin/env node
// Validate TASKS.md structural integrity.
//
// Checks:
// 1. File starts with the correct title
// 2. Status legend section present with all four status markers
// 3. Milestone overview section present
// 4. All five Phase sections present (Phase 0 through Phase 4)
// 5. Task IDs in T## format, sequential from T00 with no gaps, unique
// 6. Status markers only from the allowed set: [ ] [~] [x] [!]
// 7. All Depends: references resolve to real task IDs in the file
// 8. Blocked tasks ([!]) include a note explaining the blocker
//
// Exports validate(content: string) => string[] for use by other hooks.
// Also runnable as a CLI: node validate_tasks.js TASKS.md

const fs = require('node:fs');

const ALLOWED_STATUSES = new Set(['[ ]', '[~]', '[x]', '[!]']);

const REQUIRED_SECTIONS = [
  '## Status legend',
  '## Milestone overview',
  '## Phase 0',
  '## Phase 1',
  '## Phase 2',
  '## Phase 3',
  '## Phase 4',
];

const STATUS_LEGEND_MARKERS = ['`[ ]`', '`[~]`', '`[x]`', '`[!]`'];

const TASK_LINE_RE = /^- (\[[ ~x!]\]) (T\d+) /;
const DEPENDS_RE = /Depends:\s*(.+)/;

// validate accepts the file content as a string and returns an array of error
// strings. An empty array means the file is valid.
function validate(content) {
  const lines = content.split('\n');
  const errors = [];

  // 1. Title
  if (!lines[0] || !lines[0].startsWith('# TASKS.md')) {
    errors.push("File must start with '# TASKS.md — Maude Build Plan'");
  }

  // 2. Required sections
  for (const section of REQUIRED_SECTIONS) {
    if (!lines.some((l) => l.startsWith(section))) {
      errors.push(`Missing required section: ${section}`);
    }
  }

  // 3. Status legend markers
  for (const marker of STATUS_LEGEND_MARKERS) {
    if (!content.includes(marker)) {
      errors.push(`Status legend missing marker: ${marker}`);
    }
  }

  // 4–6. Parse tasks: IDs, statuses, blocked notes
  const tasks = new Map(); // task_id -> { num, lineIdx }
  const blockedLines = []; // [task_id, lineIdx]

  for (let i = 0; i < lines.length; i++) {
    const m = TASK_LINE_RE.exec(lines[i]);
    if (!m) continue;

    const status = m[1];
    const taskId = m[2];
    const taskNum = Number.parseInt(taskId.slice(1), 10);

    if (!ALLOWED_STATUSES.has(status)) {
      errors.push(`Line ${i + 1}: Invalid status "${status}" for ${taskId}`);
    }

    if (tasks.has(taskId)) {
      errors.push(`Duplicate task ID: ${taskId}`);
    } else {
      tasks.set(taskId, { num: taskNum, lineIdx: i });
    }

    if (status === '[!]') {
      blockedLines.push([taskId, i]);
    }
  }

  // 5. Sequential IDs with no gaps
  if (tasks.size > 0) {
    const nums = [...tasks.values()].map((t) => t.num).sort((a, b) => a - b);
    for (let expected = 0; expected < nums.length; expected++) {
      if (expected !== nums[expected]) {
        errors.push(
          `Task IDs not sequential: expected T${String(expected).padStart(2, '0')}, ` +
            `found T${String(nums[expected]).padStart(2, '0')}`
        );
        break;
      }
    }
  }

  // 7. Depends: references resolve
  for (let i = 0; i < lines.length; i++) {
    const m = DEPENDS_RE.exec(lines[i]);
    if (!m) continue;
    const deps = m[1];
    for (const match of deps.matchAll(/T(\d+)/g)) {
      const ref = `T${match[1]}`;
      if (!tasks.has(ref)) {
        errors.push(`Line ${i + 1}: Depends: references unknown task ${ref}`);
      }
    }
  }

  // 8. Blocked tasks must have a note
  for (const [taskId, lineIdx] of blockedLines) {
    let noteFound = false;
    for (let j = lineIdx + 1; j < Math.min(lineIdx + 8, lines.length); j++) {
      const stripped = lines[j].trim();
      if (stripped && !stripped.startsWith('- [')) {
        noteFound = true;
        break;
      }
    }
    if (!noteFound) {
      errors.push(`${taskId} is [!] blocked but has no note explaining the blocker`);
    }
  }

  return errors;
}

module.exports = { validate };

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error('Usage: validate_tasks.js TASKS.md');
    process.exit(1);
  }

  const content = fs.readFileSync(args[0], 'utf8');
  const errors = validate(content);
  if (errors.length > 0) {
    for (const err of errors) {
      console.error(`ERROR: ${err}`);
    }
    process.exit(1);
  }

  console.log('TASKS.md validation passed');
  process.exit(0);
}

#!/usr/bin/env node
// Shared utilities for Claude Code hook scripts.

// readHookInput reads stdin, parses the JSON hook payload, and calls callback
// with the parsed object. Exits 0 silently if input is missing or invalid —
// hooks must be permissive to avoid blocking normal Claude Code operation.
function readHookInput(callback) {
  const chunks = [];
  process.stdin.on('data', (d) => chunks.push(d));
  process.stdin.on('end', () => {
    let input;
    try {
      input = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      process.exit(0);
    }
    callback(input);
  });
}

module.exports = { readHookInput };

/**
 * @jest-environment node
 *
 * Validates that shared types are the single source of truth — no duplicate
 * interface definitions remain in consumer modules.
 */

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// The shared types module must exist and export the expected interfaces.
// TypeScript compilation verifies shape correctness; these tests verify that
// duplicates have been removed from consumer files.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

/** Read a source file relative to the project root. */
function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('shared types — single source of truth', () => {
  it('exports Settings, ConversationSummary, and Message types', () => {
    const source = readSrc('src/lib/shared/types.ts');
    expect(source).toMatch(/export interface Settings\b/);
    expect(source).toMatch(/export interface ConversationSummary\b/);
    expect(source).toMatch(/export interface Message\b/);
  });

  it('db.ts re-exports from shared types instead of defining its own', () => {
    const source = readSrc('src/lib/server/db.ts');
    // Should import from shared types
    expect(source).toMatch(/from ['"]\.\.\/shared\/types['"]/);
    // Should NOT have local interface definitions for the shared types
    expect(source).not.toMatch(/^export interface UserSettings\b/m);
    expect(source).not.toMatch(/^export interface ConversationRow\b/m);
    expect(source).not.toMatch(/^export interface MessageRow\b/m);
  });

  it('settings/page.tsx imports Settings from shared types', () => {
    const source = readSrc('src/app/settings/page.tsx');
    expect(source).toMatch(/from ['"].*shared\/types['"]/);
    // No local Settings interface
    expect(source).not.toMatch(/^interface Settings\b/m);
  });

  it('HistoryPane.tsx imports from shared types', () => {
    const source = readSrc('src/components/layout/HistoryPane.tsx');
    expect(source).toMatch(/from ['"].*shared\/types['"]/);
    // No local Conversation or HistoryMessage interfaces
    expect(source).not.toMatch(/^interface Conversation\b/m);
    expect(source).not.toMatch(/^export interface HistoryMessage\b/m);
  });
});

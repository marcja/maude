/**
 * src/lib/server/db.ts
 *
 * Single entry point for all SQLite access. Import ONLY from server-side code.
 *
 * The `server-only` import below causes a build-time error if any client
 * component (directly or transitively) imports this module. This is Next.js's
 * built-in boundary enforcement — a harder guarantee than convention or grep.
 *
 * better-sqlite3 is synchronous by design. This is intentional: Next.js API
 * routes run in Node.js where synchronous I/O on a local file is faster than
 * the async overhead of a remote database driver, and it eliminates a whole
 * class of async/await bugs in query code.
 */

import 'server-only';

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserSettings {
  name: string;
  personalizationPrompt: string;
}

export interface ConversationRow {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking: string | null;
  created_at: number;
}

// ---------------------------------------------------------------------------
// Database instance type — returned by createDatabase()
// ---------------------------------------------------------------------------

export interface DatabaseInstance {
  /** Raw better-sqlite3 connection — exposed for ad-hoc queries in tests. */
  db: InstanceType<typeof Database>;
  getSettings(): UserSettings;
  upsertSettings(settings: UserSettings): void;
  createConversation(id: string, title: string, now: number): void;
  updateConversation(id: string, fields: Partial<{ title: string; updated_at: number }>): void;
  getConversations(): ConversationRow[];
  getConversation(id: string): ConversationRow | undefined;
  deleteConversation(id: string): void;
  insertMessage(msg: MessageRow): void;
  getMessages(conversationId: string): MessageRow[];
}

// ---------------------------------------------------------------------------
// Factory — creates a fresh database connection with all query functions bound
// to it. Tests call this directly with ':memory:' to get isolated instances
// without the fragile jest.resetModules() + require() pattern.
// ---------------------------------------------------------------------------

// Run the migration synchronously at module load time. Using readFileSync here
// (rather than a dynamic import or require) keeps the initialization path simple
// and avoids introducing async state into module startup.
//
// process.cwd() instead of __dirname: Next.js webpack rewrites __dirname to
// the bundle output directory, making it point to .next/ rather than src/.
// process.cwd() reliably gives the project root in both dev and production.
const migrationSql = fs.readFileSync(
  path.join(process.cwd(), 'src', 'lib', 'server', 'migrations', '001_initial.sql'),
  'utf8'
);

export function createDatabase(dbPath: string): DatabaseInstance {
  const conn = new Database(dbPath);

  // Foreign key enforcement is off by default in SQLite — enable it so that
  // ON DELETE CASCADE on messages.conversation_id is actually respected.
  conn.pragma('foreign_keys = ON');
  conn.exec(migrationSql);

  // -------------------------------------------------------------------------
  // Prepared statements — cached per-instance so SQL is compiled once, not on
  // every call. updateConversation is excluded because it builds SQL dynamically.
  // -------------------------------------------------------------------------

  const stmtGetSettings = conn.prepare('SELECT key, value FROM settings');
  const stmtUpsertSetting = conn.prepare(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
  );
  // Transaction wraps two writes for atomicity — a failure between them would leave
  // settings in a partial state. Single-statement functions below don't need
  // transactions because SQLite guarantees each statement is atomic on its own.
  const txUpsertSettings = conn.transaction((s: UserSettings) => {
    stmtUpsertSetting.run('name', s.name);
    stmtUpsertSetting.run('personalizationPrompt', s.personalizationPrompt);
  });
  const stmtCreateConversation = conn.prepare(
    'INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)'
  );
  const stmtGetConversations = conn.prepare('SELECT * FROM conversations ORDER BY updated_at DESC');
  const stmtGetConversation = conn.prepare('SELECT * FROM conversations WHERE id = ?');
  const stmtDeleteConversation = conn.prepare('DELETE FROM conversations WHERE id = ?');
  const stmtInsertMessage = conn.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, thinking, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const stmtGetMessages = conn.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
  );

  // -------------------------------------------------------------------------
  // Query functions — bound to this connection instance
  // -------------------------------------------------------------------------

  function getSettings(): UserSettings {
    // better-sqlite3's .all() returns `unknown[]` because the library cannot
    // infer column types from SQL strings. The shape is guaranteed by the
    // settings table schema (key TEXT, value TEXT) defined in 001_initial.sql.
    const rows = stmtGetSettings.all() as { key: string; value: string }[];
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      name: map.name ?? '',
      personalizationPrompt: map.personalizationPrompt ?? '',
    };
  }

  function upsertSettings(settings: UserSettings): void {
    txUpsertSettings(settings);
  }

  function createConversation(id: string, title: string, now: number): void {
    stmtCreateConversation.run(id, title, now, now);
  }

  function updateConversation(
    id: string,
    fields: Partial<{ title: string; updated_at: number }>
  ): void {
    // Build SET clause dynamically from whichever fields are provided.
    // This avoids overwriting untouched columns with undefined values.
    // Cannot use a cached statement here because the SET clause varies.
    const sets: string[] = [];
    const values: (string | number)[] = [];
    if (fields.title !== undefined) {
      sets.push('title = ?');
      values.push(fields.title);
    }
    if (fields.updated_at !== undefined) {
      sets.push('updated_at = ?');
      values.push(fields.updated_at);
    }
    if (sets.length === 0) return;
    values.push(id);
    conn.prepare(`UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  function getConversations(): ConversationRow[] {
    // better-sqlite3 returns `unknown[]`; shape matches the conversations table
    // schema (id, title, created_at, updated_at) defined in 001_initial.sql.
    return stmtGetConversations.all() as ConversationRow[];
  }

  function getConversation(id: string): ConversationRow | undefined {
    // better-sqlite3's .get() returns `unknown`; the WHERE clause guarantees at
    // most one row, and the shape matches ConversationRow from 001_initial.sql.
    return stmtGetConversation.get(id) as ConversationRow | undefined;
  }

  function deleteConversation(id: string): void {
    stmtDeleteConversation.run(id);
  }

  function insertMessage(msg: MessageRow): void {
    stmtInsertMessage.run(
      msg.id,
      msg.conversation_id,
      msg.role,
      msg.content,
      msg.thinking,
      msg.created_at
    );
  }

  function getMessages(conversationId: string): MessageRow[] {
    // better-sqlite3 returns `unknown[]`; shape matches the messages table
    // schema (id, conversation_id, role, content, thinking, created_at).
    return stmtGetMessages.all(conversationId) as MessageRow[];
  }

  return {
    db: conn,
    getSettings,
    upsertSettings,
    createConversation,
    updateConversation,
    getConversations,
    getConversation,
    deleteConversation,
    insertMessage,
    getMessages,
  };
}

// ---------------------------------------------------------------------------
// Singleton connection — used by production code and API routes
// ---------------------------------------------------------------------------

// DB_PATH is overridden in tests to ':memory:' so no filesystem access is needed.
const dbPath = process.env.DB_PATH ?? '/data/chat.db';
const instance = createDatabase(dbPath);

export const db = instance.db;
export const getSettings = instance.getSettings;
export const upsertSettings = instance.upsertSettings;
export const createConversation = instance.createConversation;
export const updateConversation = instance.updateConversation;
export const getConversations = instance.getConversations;
export const getConversation = instance.getConversation;
export const deleteConversation = instance.deleteConversation;
export const insertMessage = instance.insertMessage;
export const getMessages = instance.getMessages;

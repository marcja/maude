/**
 * @jest-environment node
 *
 * Must run in Node (not jsdom) because better-sqlite3 is a native Node addon.
 * Tests use createDatabase(':memory:') so no /data/ directory is needed and
 * each call gets a fresh, isolated SQLite instance — no jest.resetModules()
 * or require() hacks needed.
 */

// Neutralise the server-only guard so the real module can load in plain Node.
jest.mock('server-only', () => ({}));

import { createDatabase } from '../db';
import type { DatabaseInstance } from '../db';

/** Create a fresh in-memory database for each test or suite. */
function freshDb(): DatabaseInstance {
  return createDatabase(':memory:');
}

describe('database migration', () => {
  it('when the database is initialized, creates conversations, messages, and settings tables', () => {
    const { db } = freshDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('conversations');
    expect(names).toContain('messages');
    expect(names).toContain('settings');
  });
});

describe('settings operations', () => {
  it('when the database is freshly created, returns empty default settings', () => {
    const { getSettings } = freshDb();
    const settings = getSettings();
    expect(settings).toEqual({ name: '', personalizationPrompt: '' });
  });

  it('when settings are upserted, persists and retrieves the updated values', () => {
    const { getSettings, upsertSettings } = freshDb();
    upsertSettings({ name: 'Alice', personalizationPrompt: 'Be concise.' });
    expect(getSettings()).toEqual({ name: 'Alice', personalizationPrompt: 'Be concise.' });
  });

  it('when only the name field is provided, accepts the partial update', () => {
    const { getSettings, upsertSettings } = freshDb();
    upsertSettings({ name: 'Bob', personalizationPrompt: '' });
    expect(getSettings().name).toBe('Bob');
  });
});

describe('conversation operations', () => {
  it('when a conversation is created, stores and retrieves it by ID', () => {
    const { createConversation, getConversation } = freshDb();
    const now = Date.now();
    createConversation('conv-1', 'My first chat', now);
    const row = getConversation('conv-1');
    expect(row).toMatchObject({ id: 'conv-1', title: 'My first chat' });
  });

  it('when multiple conversations exist, lists them sorted by updated_at descending', () => {
    const { createConversation, getConversations } = freshDb();
    createConversation('conv-a', 'Older', 1000);
    createConversation('conv-b', 'Newer', 2000);
    const list = getConversations();
    expect(list[0].id).toBe('conv-b');
    expect(list[1].id).toBe('conv-a');
  });

  it('when the requested conversation does not exist, returns undefined', () => {
    const { getConversation } = freshDb();
    expect(getConversation('nonexistent')).toBeUndefined();
  });

  it('when a conversation is deleted, it is no longer retrievable', () => {
    const { createConversation, deleteConversation, getConversation } = freshDb();
    createConversation('conv-del', 'To delete', Date.now());
    deleteConversation('conv-del');
    expect(getConversation('conv-del')).toBeUndefined();
  });

  it('when updateConversation is called with new values, updates the title and timestamp', () => {
    const { createConversation, updateConversation, getConversation } = freshDb();
    const now = Date.now();
    createConversation('conv-upd', 'Old title', now);
    updateConversation('conv-upd', { title: 'New title', updated_at: now + 1000 });
    const row = getConversation('conv-upd');
    expect(row?.title).toBe('New title');
    expect(row?.updated_at).toBe(now + 1000);
  });

  it('when updateConversation is called with no fields, leaves the row unchanged', () => {
    // Calling with an empty fields object must return early without touching the DB.
    const { createConversation, updateConversation, getConversation } = freshDb();
    const now = Date.now();
    createConversation('conv-noop', 'Unchanged', now);
    // Should not throw and must leave the row intact.
    updateConversation('conv-noop', {});
    expect(getConversation('conv-noop')?.title).toBe('Unchanged');
  });
});

describe('message operations', () => {
  it('when messages are inserted, returns them in insertion order for the conversation', () => {
    const { createConversation, insertMessage, getMessages } = freshDb();
    createConversation('conv-msg', 'Chat', Date.now());
    insertMessage({
      id: 'msg-1',
      conversation_id: 'conv-msg',
      role: 'user',
      content: 'Hello',
      thinking: null,
      created_at: 1000,
    });
    insertMessage({
      id: 'msg-2',
      conversation_id: 'conv-msg',
      role: 'assistant',
      content: 'Hi there',
      thinking: null,
      created_at: 2000,
    });
    const msgs = getMessages('conv-msg');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].id).toBe('msg-1');
    expect(msgs[1].id).toBe('msg-2');
  });

  it('when an assistant message includes reasoning, persists the thinking field', () => {
    const { createConversation, insertMessage, getMessages } = freshDb();
    createConversation('conv-think', 'Think', Date.now());
    insertMessage({
      id: 'msg-t',
      conversation_id: 'conv-think',
      role: 'assistant',
      content: 'Answer',
      thinking: 'Let me reason…',
      created_at: 1000,
    });
    expect(getMessages('conv-think')[0].thinking).toBe('Let me reason…');
  });

  it('when a conversation is deleted, removes all its associated messages', () => {
    const { createConversation, insertMessage, deleteConversation, getMessages } = freshDb();
    createConversation('conv-cas', 'Cascade', Date.now());
    insertMessage({
      id: 'msg-cas',
      conversation_id: 'conv-cas',
      role: 'user',
      content: 'Will be deleted',
      thinking: null,
      created_at: 1000,
    });
    deleteConversation('conv-cas');
    expect(getMessages('conv-cas')).toHaveLength(0);
  });
});

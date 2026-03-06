/**
 * @jest-environment node
 *
 * Must run in Node (not jsdom) because better-sqlite3 is a native Node addon.
 * Tests use an in-memory database so no /data/ directory is needed and each
 * module re-import gets a fresh, isolated SQLite instance.
 */

// Helper: re-import the db module in isolation so each suite gets a fresh DB.
// jest.resetModules() clears the module registry; the next require() re-runs
// the module initializer (which opens a new :memory: connection and re-runs the migration).
function freshDb() {
  jest.resetModules();
  process.env.DB_PATH = ':memory:';
  return require('../db') as typeof import('../db');
}

describe('migration', () => {
  it('creates all three tables', () => {
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

describe('settings', () => {
  it('inserts default settings on migration', () => {
    const { getSettings } = freshDb();
    const settings = getSettings();
    expect(settings).toEqual({ name: '', personalizationPrompt: '' });
  });

  it('round-trips updated settings', () => {
    const { getSettings, upsertSettings } = freshDb();
    upsertSettings({ name: 'Alice', personalizationPrompt: 'Be concise.' });
    expect(getSettings()).toEqual({ name: 'Alice', personalizationPrompt: 'Be concise.' });
  });

  it('allows partial updates (only name)', () => {
    const { getSettings, upsertSettings } = freshDb();
    upsertSettings({ name: 'Bob', personalizationPrompt: '' });
    expect(getSettings().name).toBe('Bob');
  });
});

describe('conversations', () => {
  it('creates and retrieves a conversation', () => {
    const { createConversation, getConversation } = freshDb();
    const now = Date.now();
    createConversation('conv-1', 'My first chat', now);
    const row = getConversation('conv-1');
    expect(row).toMatchObject({ id: 'conv-1', title: 'My first chat' });
  });

  it('lists conversations sorted by updated_at descending', () => {
    const { createConversation, getConversations } = freshDb();
    createConversation('conv-a', 'Older', 1000);
    createConversation('conv-b', 'Newer', 2000);
    const list = getConversations();
    expect(list[0].id).toBe('conv-b');
    expect(list[1].id).toBe('conv-a');
  });

  it('returns undefined for a missing conversation', () => {
    const { getConversation } = freshDb();
    expect(getConversation('nonexistent')).toBeUndefined();
  });

  it('deletes a conversation', () => {
    const { createConversation, deleteConversation, getConversation } = freshDb();
    createConversation('conv-del', 'To delete', Date.now());
    deleteConversation('conv-del');
    expect(getConversation('conv-del')).toBeUndefined();
  });

  it('updates conversation fields', () => {
    const { createConversation, updateConversation, getConversation } = freshDb();
    const now = Date.now();
    createConversation('conv-upd', 'Old title', now);
    updateConversation('conv-upd', { title: 'New title', updated_at: now + 1000 });
    const row = getConversation('conv-upd');
    expect(row?.title).toBe('New title');
    expect(row?.updated_at).toBe(now + 1000);
  });
});

describe('messages', () => {
  it('inserts and retrieves messages in order', () => {
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

  it('stores thinking content when provided', () => {
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

  it('cascade-deletes messages when conversation is deleted', () => {
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

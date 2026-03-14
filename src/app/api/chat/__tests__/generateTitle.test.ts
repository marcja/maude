/**
 * @jest-environment node
 *
 * Unit tests for generateTitle — the smart title-truncation helper that
 * replaced raw .slice(0, 50). Tests exercise sentence boundaries, word
 * boundaries, newline splitting, and the empty-content fallback.
 */

// Mock server-only modules to avoid side effects (DB connection, model adapter)
// when importing the route module solely for the generateTitle helper.
jest.mock('../../../../lib/server/db', () => ({
  getSettings: jest.fn(() => ({ name: '', personalizationPrompt: '' })),
  createConversation: jest.fn(),
  insertMessage: jest.fn(),
  updateConversation: jest.fn(),
}));
jest.mock('../../../../lib/server/modelAdapter', () => ({
  streamCompletion: jest.fn(),
  ModelAdapterError: class extends Error {},
}));
jest.mock('../../../../lib/server/promptBuilder', () => ({
  buildSystemPrompt: jest.fn(() => ''),
}));

import { generateTitle } from '../route';

describe('generateTitle', () => {
  it('returns short messages as-is', () => {
    expect(generateTitle('How do I set up Docker?')).toBe('How do I set up Docker?');
  });

  it('uses the first sentence when it ends with a period', () => {
    expect(generateTitle('Hello. I need help with Docker.')).toBe('Hello.');
  });

  it('uses the first sentence when it ends with a question mark', () => {
    expect(generateTitle('What is Docker? I want to learn more about it.')).toBe('What is Docker?');
  });

  it('uses the first sentence when it ends with an exclamation mark', () => {
    expect(generateTitle('Wow! That is amazing stuff right there.')).toBe('Wow!');
  });

  it('truncates at last word boundary with ellipsis when first sentence exceeds 50 chars', () => {
    const longSentence =
      'I need to understand how containerization works in a production environment with Kubernetes.';
    const result = generateTitle(longSentence);
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result.endsWith('\u2026')).toBe(true);
    expect(result).toBe('I need to understand how containerization works\u2026');
  });

  it('hard truncates with ellipsis when no space found', () => {
    const noSpaces = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const result = generateTitle(noSpaces);
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result.endsWith('\u2026')).toBe(true);
    // 49 chars of content + ellipsis = 50 chars total
    expect(result).toBe('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVW\u2026');
  });

  it('returns "New conversation" for empty content', () => {
    expect(generateTitle('')).toBe('New conversation');
  });

  it('returns "New conversation" for whitespace-only content', () => {
    expect(generateTitle('   \n\t  ')).toBe('New conversation');
  });

  it('uses the first line when content contains newlines', () => {
    expect(generateTitle('First line\nSecond line\nThird line')).toBe('First line');
  });

  it('still truncates a long first line at word boundary', () => {
    const input =
      'This is a very long first line that definitely exceeds the fifty character limit\nSecond line';
    const result = generateTitle(input);
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result.endsWith('\u2026')).toBe(true);
  });
});

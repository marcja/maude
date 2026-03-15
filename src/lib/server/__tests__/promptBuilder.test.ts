/**
 * @jest-environment node
 *
 * src/lib/server/__tests__/promptBuilder.test.ts
 *
 * Unit tests for the system prompt builder. All tests are pure functions —
 * no DB, no network, no filesystem access needed.
 */

import type { UserSettings } from '../db';
import { BASE_SYSTEM_PROMPT, buildSystemPrompt } from '../promptBuilder';

const EMPTY: UserSettings = { name: '', personalizationPrompt: '' };

describe('buildSystemPrompt', () => {
  it('when both name and personalization are empty, returns only the base prompt', () => {
    expect(buildSystemPrompt(EMPTY)).toBe(BASE_SYSTEM_PROMPT);
  });

  it('when a name is provided, includes it in the prompt', () => {
    const result = buildSystemPrompt({ name: 'Alice', personalizationPrompt: '' });
    expect(result).toContain("The user's name is Alice.");
  });

  it('when a personalization prompt is provided, appends it after the base prompt', () => {
    const custom = 'Always respond in bullet points.';
    const result = buildSystemPrompt({ name: '', personalizationPrompt: custom });
    expect(result).toContain(custom);
    // Personalization comes after base prompt
    expect(result.indexOf(BASE_SYSTEM_PROMPT)).toBeLessThan(result.indexOf(custom));
  });

  it('when both name and personalization are provided, orders sections: base then name then personalization', () => {
    const result = buildSystemPrompt({
      name: 'Bob',
      personalizationPrompt: 'Be concise.',
    });
    const baseIdx = result.indexOf(BASE_SYSTEM_PROMPT);
    const nameIdx = result.indexOf("The user's name is Bob.");
    const personIdx = result.indexOf('Be concise.');
    expect(baseIdx).toBeLessThan(nameIdx);
    expect(nameIdx).toBeLessThan(personIdx);
  });
});

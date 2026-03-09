/**
 * src/lib/server/promptBuilder.ts
 *
 * Constructs the system prompt sent to the model on each request.
 * Responsible for: assembling the base prompt and injecting user settings.
 * NOT responsible for: reading settings from DB, sending to Ollama.
 *
 * The `server-only` import causes a build-time error if any client component
 * transitively imports this module — enforced by the Next.js bundler.
 *
 * Settings take effect on the next conversation, not mid-conversation.
 * This simplification is intentional — changing the prompt mid-stream would
 * invalidate the prompt_used field already emitted in message_start.
 */

import 'server-only';

import type { UserSettings } from './db';

// ---------------------------------------------------------------------------
// Base prompt
// ---------------------------------------------------------------------------

// Exported so tests can assert against it without hard-coding the full string.
export const BASE_SYSTEM_PROMPT =
  'You are Maude, a helpful AI assistant. You are knowledgeable, thoughtful, ' +
  'and direct. You give accurate, well-reasoned answers. When you are ' +
  'uncertain, you say so. You do not make up facts.';

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildSystemPrompt(settings: UserSettings): string {
  const parts = [BASE_SYSTEM_PROMPT];
  if (settings.name) parts.push(`The user's name is ${settings.name}.`);
  if (settings.personalizationPrompt) parts.push(settings.personalizationPrompt);
  return parts.join('\n\n');
}

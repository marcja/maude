/**
 * src/app/api/conversations/[id]/route.ts
 *
 * GET    /api/conversations/:id — returns messages for a single conversation
 * DELETE /api/conversations/:id — removes a conversation and its messages (CASCADE)
 *
 * Both endpoints verify the conversation exists before proceeding. Returning
 * 404 for missing IDs prevents silent failures in the HistoryPane UI.
 */

import { jsonResponse } from '../../../../lib/server/apiHelpers';
import { deleteConversation, getConversation, getMessages } from '../../../../lib/server/db';

// Next.js App Router passes dynamic segment params as a Promise.
interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;

  const conversation = getConversation(id);
  if (!conversation) {
    return jsonResponse({ error: 'Conversation not found' }, 404);
  }

  const messages = getMessages(id);
  return jsonResponse({ messages });
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;

  const conversation = getConversation(id);
  if (!conversation) {
    return jsonResponse({ error: 'Conversation not found' }, 404);
  }

  deleteConversation(id);
  return new Response(null, { status: 204 });
}

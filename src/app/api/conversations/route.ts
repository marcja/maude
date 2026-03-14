/**
 * src/app/api/conversations/route.ts
 *
 * GET /api/conversations — returns all conversations ordered by updated_at DESC.
 *
 * This is the list endpoint consumed by HistoryPane to populate the sidebar.
 * The ordering is handled by the DB query (see db.ts getConversations), so
 * no additional sorting is needed here.
 */

import { jsonResponse } from '../../../lib/server/apiHelpers';
import { getConversations } from '../../../lib/server/db';

export function GET(): Response {
  return jsonResponse(getConversations());
}

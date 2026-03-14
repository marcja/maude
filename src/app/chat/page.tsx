/**
 * src/app/chat/page.tsx
 *
 * Server component that reads conversations directly from SQLite and passes
 * them as props to the ChatShell client component. This eliminates the
 * mount-time fetch waterfall — the HistoryPane renders with data immediately,
 * no loading flash.
 *
 * Follows the same pattern as settings/page.tsx (T33).
 */

import ChatShell from '../../components/chat/ChatShell';
import { getConversations } from '../../lib/server/db';

export default async function ChatPage() {
  // await is a no-op for the synchronous better-sqlite3 driver but
  // future-proofs against an async DB driver swap.
  const conversations = await getConversations();
  return <ChatShell initialConversations={conversations} />;
}

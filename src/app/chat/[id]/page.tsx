/**
 * src/app/chat/[id]/page.tsx
 *
 * Dynamic server component for direct-URL and refresh scenarios. Pre-fetches
 * the conversation + messages from SQLite so ChatShell renders with data
 * immediately — no client-side fetch waterfall on page load.
 *
 * Follows the same pattern as src/app/chat/page.tsx (T34).
 */

import { notFound } from 'next/navigation';
import ChatShell from '../../../components/chat/ChatShell';
import { getConversation, getConversations, getMessages } from '../../../lib/server/db';

interface ChatByIdPageProps {
  params: Promise<{ id: string }>;
}

export default async function ChatByIdPage({ params }: ChatByIdPageProps) {
  const { id } = await params;
  const conversation = getConversation(id);
  if (!conversation) notFound();

  const conversations = getConversations();
  const messages = getMessages(id);

  return (
    <ChatShell
      initialConversations={conversations}
      initialConversationId={id}
      initialConversationTitle={conversation.title}
      initialMessages={messages}
    />
  );
}

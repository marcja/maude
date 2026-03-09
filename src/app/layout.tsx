import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { MSWProvider } from './MSWProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Maude',
  description: "Marc's Claude — a pedagogical LLM chat application",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <MSWProvider>{children}</MSWProvider>
      </body>
    </html>
  );
}

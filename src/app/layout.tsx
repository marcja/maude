import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ObservabilityProvider } from '../context/ObservabilityContext';
import { MSWProvider } from './MSWProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Maude',
  description: "Marc's Claude — a pedagogical LLM chat application",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* Preconnect to Google Fonts origins for faster font loading —
            avoids the render-blocking CSS @import that serializes DNS+TLS. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300..700;1,9..40,300..700&display=swap"
        />
      </head>
      <body className="font-sans">
        <ObservabilityProvider>
          <MSWProvider>{children}</MSWProvider>
        </ObservabilityProvider>
      </body>
    </html>
  );
}

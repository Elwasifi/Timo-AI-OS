import './globals.css';
import type { Metadata } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import { Providers } from '@/components/providers';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-grotesk',
});

// M7-13: openGraph/twitter images used to point at Bolt's own default OG
// asset (bolt.new/static/og_default.png) — a scaffold leftover, not a
// Temo asset. No real Temo social-share image exists in public/ yet, so
// the tags are removed rather than pointed at something fake; add them
// back once a real asset exists.
export const metadata: Metadata = {
  metadataBase: new URL('https://temo.ai'),
  title: 'Temo — AI Operating System',
  description: 'A premium AI workspace for interacting naturally with multiple AI agents.',
  twitter: {
    card: 'summary_large_image',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} ${spaceGrotesk.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

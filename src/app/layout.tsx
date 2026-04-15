import type { Metadata } from 'next';
import { Fraunces, Inter } from 'next/font/google';
import './globals.css';

const serif = Fraunces({
  variable: '--font-serif',
  subsets: ['latin'],
  display: 'swap',
});

const sans = Inter({
  variable: '--font-sans',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Artisanship Agents',
  description: "Briana's agentic operating interface",
  applicationName: 'Artisanship',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Artisanship',
  },
  formatDetection: { telephone: false },
};

export const viewport: import('next').Viewport = {
  themeColor: '#0c0a07',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}

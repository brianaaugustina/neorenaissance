import type { Metadata } from 'next';
import { Fraunces, Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const serif = Fraunces({
  variable: '--font-serif',
  subsets: ['latin'],
  display: 'swap',
});

const sans = Inter({
  variable: '--font-sans',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  display: 'swap',
});

const mono = JetBrains_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Agent.os',
  description: "Briana's agentic operating interface",
  applicationName: 'Agent.os',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Agent.os',
  },
  formatDetection: { telephone: false },
};

export const viewport: import('next').Viewport = {
  themeColor: '#f0e9d9',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${serif.variable} ${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}

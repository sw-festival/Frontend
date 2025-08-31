// src/app/layout.tsx
import 'bootstrap/dist/css/bootstrap.min.css';
import type { Metadata } from 'next';
import Providers from './provider';

export const viewport = {
  title: '코알라 주점',
  description: '소프트웨어융합대학 가을 축제 주점',
  manifest: '/manifest.json',
  themeColor: '#111827',
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/icon-192.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
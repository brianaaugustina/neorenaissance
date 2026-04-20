import { ImageResponse } from 'next/og';

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

// Inter ExtraBold via Google Fonts. Using a minimal desktop UA gets the TTF
// src URL (Satori handles TTF natively; woff2 has been flaky in this Next
// build). Returns null on any error so the icon still renders with the
// Satori default font rather than 500ing.
async function loadInterExtraBold(): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(
      'https://fonts.googleapis.com/css2?family=Inter:wght@800',
      {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        cache: 'force-cache',
      },
    ).then((r) => r.text());
    const url = css.match(/url\((https:\/\/[^)]+\.ttf)\)/)?.[1];
    if (!url) return null;
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

export default async function Icon() {
  const interBold = await loadInterExtraBold();
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f0e9d9',
          fontFamily: interBold ? 'Inter' : 'sans-serif',
          fontWeight: 800,
          color: '#1a140c',
          fontSize: 210,
          letterSpacing: -10,
        }}
      >
        B.os
      </div>
    ),
    {
      ...size,
      ...(interBold
        ? {
            fonts: [
              {
                name: 'Inter',
                data: interBold,
                weight: 800,
                style: 'normal',
              },
            ],
          }
        : {}),
    },
  );
}

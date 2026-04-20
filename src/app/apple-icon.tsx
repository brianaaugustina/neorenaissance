import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

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

export default async function AppleIcon() {
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
          fontSize: 74,
          letterSpacing: -3.6,
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

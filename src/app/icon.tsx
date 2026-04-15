import { ImageResponse } from 'next/og';

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#ffffff',
          fontFamily: 'Georgia, serif',
          fontWeight: 400,
          color: '#0c0a07',
          fontSize: 240,
          letterSpacing: -10,
        }}
      >
        BOs
      </div>
    ),
    { ...size },
  );
}

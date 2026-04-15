import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
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
          fontSize: 86,
          letterSpacing: -3,
        }}
      >
        BOs
      </div>
    ),
    { ...size },
  );
}

import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'B.os',
    short_name: 'B.os',
    description: "Briana's agentic operating interface",
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f0e9d9',
    theme_color: '#f0e9d9',
    icons: [
      {
        src: '/icon',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/apple-icon',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
  };
}

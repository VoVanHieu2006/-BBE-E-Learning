import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    start_url: '/',
    scope: '/',
    name: 'BBE E-Learning',
    short_name: 'BBE Learn',
    description: 'Nền tảng học tập và phát triển kỹ năng BBE',
    lang: 'vi',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#172554',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

import type { MetadataRoute } from 'next'

// Web app manifest — makes StateGen installable to the home screen ("Add to Home
// Screen") and gives it an app icon, splash colours, and a standalone (no browser
// chrome) window. Served at /manifest.webmanifest.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'StateGen — Real estate CRM',
    short_name: 'StateGen',
    description:
      'The CRM for Lebanese real estate agencies — property matching, a shared client & deal pipeline, and a WhatsApp assistant.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0E1F3D',
    theme_color: '#0E1F3D',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}

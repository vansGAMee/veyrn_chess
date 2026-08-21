import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/room/'],
    },
    sitemap: 'https://veyrn-chess.vercel.app/sitemap.xml',
    host: 'https://veyrn-chess.vercel.app',
  };
}

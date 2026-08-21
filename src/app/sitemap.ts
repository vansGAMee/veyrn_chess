import type { MetadataRoute } from 'next';

const origin = 'https://veyrn-chess.vercel.app';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: origin, lastModified: new Date('2026-08-21'), changeFrequency: 'weekly', priority: 1 },
    { url: `${origin}/play`, lastModified: new Date('2026-08-21'), changeFrequency: 'monthly', priority: 0.9 },
    { url: `${origin}/stats`, lastModified: new Date('2026-08-21'), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${origin}/privacy`, lastModified: new Date('2026-08-21'), changeFrequency: 'yearly', priority: 0.3 },
  ];
}

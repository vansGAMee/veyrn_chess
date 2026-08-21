import { NextRequest } from 'next/server';
import { normalizeCountryCode } from '@/lib/countries';

export async function GET(request: NextRequest) {
  const headerCountry = normalizeCountryCode(
    request.headers.get('x-vercel-ip-country') || request.headers.get('cf-ipcountry')
  );

  if (headerCountry) {
    return Response.json({ country: headerCountry, source: 'edge' }, { headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    const isPublic = forwarded && !/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$)/.test(forwarded);
    const endpoint = isPublic
      ? `https://api.country.is/${encodeURIComponent(forwarded)}`
      : 'https://api.country.is/';
    const response = await fetch(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(2500) });
    const data = await response.json() as { country?: string };
    const country = normalizeCountryCode(data.country);
    if (country) {
      return Response.json({ country, source: 'ip' }, { headers: { 'Cache-Control': 'no-store' } });
    }
  } catch {}

  return Response.json({ country: null, source: 'unavailable' }, { headers: { 'Cache-Control': 'no-store' } });
}

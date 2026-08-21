import { NextRequest } from 'next/server';
import { getWaitlistCount, joinWaitlist } from '@/lib/waitlist';
import { normalizeCountryCode } from '@/lib/countries';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function GET() {
  try {
    return Response.json(
      { count: await getWaitlistCount(), target: 3000 },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return Response.json({ error: 'Не удалось прочитать список ожидания' }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  let body: { email?: unknown; country?: unknown; website?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Некорректный запрос' }, { status: 400 });
  }

  if (body.website) return Response.json({ error: 'Запрос отклонён' }, { status: 400 });
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return Response.json({ error: 'Введите корректный email' }, { status: 400 });
  }

  const country = normalizeCountryCode(body.country) || 'XX';
  try {
    const result = await joinWaitlist({ email, country, joinedAt: new Date().toISOString() });
    return Response.json({ ...result, target: 3000 });
  } catch {
    return Response.json(
      { error: 'Список ожидания не настроен. Подключите Upstash Redis в Vercel.' },
      { status: 503 }
    );
  }
}

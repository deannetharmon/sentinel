import { isAuthorized } from '@/lib/auth';
import { getTickers, setTickers } from '@/lib/store/redis';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!isAuthorized(req, 'SENTINEL_ADMIN_SECRET')) return new Response('Unauthorized', { status: 401 });
  return Response.json({ tickers: await getTickers() });
}

export async function PUT(req: Request) {
  if (!isAuthorized(req, 'SENTINEL_ADMIN_SECRET')) return new Response('Unauthorized', { status: 401 });
  const body = await req.json().catch(() => null);
  return Response.json({ tickers: await setTickers(body?.tickers ?? []) });
}

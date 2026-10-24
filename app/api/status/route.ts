import { isAuthorized } from '@/lib/auth';
import { recentDecisions, redis, KEYS } from '@/lib/store/redis';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!isAuthorized(req, 'SENTINEL_ADMIN_SECRET')) return new Response('Unauthorized', { status: 401 });
  const last = await redis().get(KEYS.lastScan);
  return Response.json({ lastScan: last ? JSON.parse(last) : null, decisions: await recentDecisions(50) });
}

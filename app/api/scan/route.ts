import { isAuthorized } from '@/lib/auth';
import { runScan } from '@/lib/scan/run';
import { fetchMarketMetrics } from '@/lib/tastytrade/client';
import { acquireScanLock, getTickers, logDecisions, releaseScanLock, redis, KEYS } from '@/lib/store/redis';

export const dynamic = 'force-dynamic';

// Vercel cron sends GET with Authorization: Bearer <secret>.
export async function GET(req: Request) {
  if (!isAuthorized(req, 'SENTINEL_CRON_SECRET') && !isAuthorized(req, 'SENTINEL_ADMIN_SECRET')) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (!(await acquireScanLock())) return Response.json({ skipped: 'scan already running' });
  try {
    const result = await runScan({
      getTickers: () => getTickers(),
      fetchMetrics: fetchMarketMetrics,
      logDecisions: (ds, at) => logDecisions(ds, at),
    });
    await redis().set(KEYS.lastScan, JSON.stringify(result));
    return Response.json({
      at: result.at,
      scanned: result.tickers.length,
      eligible: result.decisions.filter((d) => d.eligible).map((d) => d.symbol),
      missing: result.missing,
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  } finally {
    await releaseScanLock();
  }
}

// worker/index.ts
// Always-on Sentinel worker. Paper mode, scan only (slice 1). No orders.
import { runScan } from '../lib/scan/run';
import { fetchMarketMetrics } from '../lib/tastytrade/client';
import { isMarketOpen } from '../lib/time/market';
import { acquireScanLock, getTickers, KEYS, logDecisions, redis, releaseScanLock } from '../lib/store/redis';

const TICK_MS = 30_000;
const SCAN_EVERY_MS = Number(process.env.SCAN_INTERVAL_SEC ?? 300) * 1000;
let lastScanAt = 0;
let stopping = false;

function log(msg: string) {
  console.log(`${new Date().toISOString()} ${msg}`);
}

async function tick() {
  const now = new Date();
  await redis().set(`${KEYS.lastScan}:heartbeat`, now.toISOString());
  if (!isMarketOpen(now) || now.getTime() - lastScanAt < SCAN_EVERY_MS) return;
  if (!(await acquireScanLock(120))) return;
  try {
    const result = await runScan({
      getTickers: () => getTickers(),
      fetchMetrics: fetchMarketMetrics,
      logDecisions: (ds, at) => logDecisions(ds, at),
    });
    await redis().set(KEYS.lastScan, JSON.stringify(result));
    lastScanAt = now.getTime();
    const eligible = result.decisions.filter((d) => d.eligible).map((d) => d.symbol);
    log(`scan ok: ${result.tickers.length} tickers, eligible=[${eligible.join(',')}], missing=[${result.missing.join(',')}]`);
  } finally {
    await releaseScanLock();
  }
}

async function main() {
  log(`sentinel worker starting (paper mode, scan every ${SCAN_EVERY_MS / 1000}s during market hours)`);
  for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => { stopping = true; });
  while (!stopping) {
    try {
      await tick();
    } catch (e) {
      log(`tick error: ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
  log('sentinel worker stopped');
  process.exit(0);
}

main();

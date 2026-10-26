// worker/index.ts
// Always-on Sentinel worker. Paper mode, scan only (slice 1). No orders.
import { runScan } from '../lib/scan/run';
import { fetchMarketMetrics } from '../lib/tastytrade/client';
import { fetchChainSnapshot, fetchLegQuotes, fetchUnderlyingPrice } from '../lib/tastytrade/chain';
import { runTradeCycle } from '../lib/trade/loop';
import { getAccount, listPositions, logTrade, savePosition, saveAccount } from '../lib/store/ledger';
import { inEntryWindow, isMarketOpen } from '../lib/time/market';
import { randomUUID } from 'node:crypto';
import { acquireScanLock, getTickers, KEYS, logDecisions, redis, releaseScanLock } from '../lib/store/redis';

const TICK_MS = 30_000;
const SCAN_EVERY_MS = Number(process.env.SCAN_INTERVAL_SEC ?? 300) * 1000;
let lastScanAt = 0;
let lastEntryAt = 0;
const TRADING_ON = (process.env.SENTINEL_TRADING ?? 'paper') !== 'off';
let stopping = false;

function log(msg: string) {
  console.log(`${new Date().toISOString()} ${msg}`);
}

async function trade(now: Date) {
  const entriesAllowed = inEntryWindow(now) && now.getTime() - lastEntryAt >= SCAN_EVERY_MS;
  const raw = await redis().get(KEYS.lastScan);
  const scan = raw ? JSON.parse(raw) : { decisions: [] };
  const decisions: any[] = scan.decisions ?? [];
  const eligible = decisions.filter((d) => d.eligible).map((d) => d.symbol as string);
  const earnings = new Map<string, string | null>(decisions.map((d) => [d.symbol, d.metrics?.earningsDate ?? null]));
  const r = await runTradeCycle(
    {
      now: () => now,
      eligibleSymbols: async () => eligible,
      earningsInDays: (sym) => {
        const d = earnings.get(sym);
        return d ? Math.round((new Date(`${d}T00:00:00Z`).getTime() - now.getTime()) / 86400000) : null;
      },
      fetchChain: (sym) => fetchChainSnapshot(sym, now),
      fetchLegQuotes,
      fetchUnderlying: (sym) => fetchUnderlyingPrice(sym),
      listPositions: () => listPositions(),
      savePosition: (p) => savePosition(p),
      getAccount: () => getAccount(),
      saveAccount: (a) => saveAccount(a),
      log: (e) => logTrade(e),
      newId: () => randomUUID(),
    },
    { entriesAllowed },
  );
  if (entriesAllowed) lastEntryAt = now.getTime();
  if (r.opened || r.closed) log(`trade cycle: opened=${r.opened} closed=${r.closed} netLiq=${r.netLiq}`);
}

async function tick() {
  const now = new Date();
  await redis().set(KEYS.heartbeat, now.toISOString());
  if (!isMarketOpen(now)) return;
  if (TRADING_ON && lastScanAt > 0) {
    try {
      await trade(now);
    } catch (e) {
      log(`trade error: ${(e as Error).message}`);
    }
  }
  if (now.getTime() - lastScanAt < SCAN_EVERY_MS) return;
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

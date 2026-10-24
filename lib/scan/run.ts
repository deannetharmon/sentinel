// One scan pass: Dean's tickers -> metrics -> filters -> decision log. No orders in slice 1.
import { evaluate, type Decision } from '../rules/filters';
import type { MetricRow } from '../tastytrade/client';

export interface ScanDeps {
  getTickers: () => Promise<string[]>;
  fetchMetrics: (symbols: string[]) => Promise<MetricRow[]>;
  logDecisions: (ds: Decision[], at: string) => Promise<void>;
  now?: () => Date;
}

export interface ScanResult {
  at: string;
  tickers: string[];
  decisions: Decision[];
  missing: string[];
}

export async function runScan(deps: ScanDeps): Promise<ScanResult> {
  const now = (deps.now ?? (() => new Date()))();
  const tickers = await deps.getTickers();
  if (!tickers.length) return { at: now.toISOString(), tickers, decisions: [], missing: [] };

  const rows = await deps.fetchMetrics(tickers);
  const bySym = new Map(rows.map((r) => [r.symbol.toUpperCase(), r]));
  const decisions: Decision[] = [];
  const missing: string[] = [];
  for (const t of tickers) {
    const m = bySym.get(t);
    if (!m) missing.push(t);
    else decisions.push(evaluate(m, now));
  }
  await deps.logDecisions(decisions, now.toISOString());
  return { at: now.toISOString(), tickers, decisions, missing };
}

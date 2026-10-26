// lib/trade/loop.ts
// One paper-trading cycle: manage exits on open positions, then (if allowed) open new ones. All I/O is injected.
import { closeDebit, closePosition, openPosition, unrealizedPnl, type PaperPosition } from '../paper/ledger';
import { evaluateExit } from '../exit/rules';
import { riskGate, DEFAULT_RISK, type RiskConfig } from '../risk/gate';
import { DEFAULT_SELECT, selectSpread, type SelectConfig } from '../trading/select';
import { dteOf, type ChainSnapshot, type OptionQuote } from '../trading/types';
import { etDate } from '../time/market';
import type { AccountRow, TradeLogEntry } from '../store/ledger';

export interface TradeDeps {
  now: () => Date;
  eligibleSymbols: () => Promise<string[]>;
  earningsInDays: (symbol: string) => number | null;
  fetchChain: (symbol: string) => Promise<ChainSnapshot>;
  fetchLegQuotes: (symbols: string[]) => Promise<Map<string, OptionQuote>>;
  fetchUnderlying: (symbol: string) => Promise<number>;
  listPositions: () => Promise<PaperPosition[]>;
  savePosition: (p: PaperPosition) => Promise<void>;
  getAccount: () => Promise<AccountRow>;
  saveAccount: (a: AccountRow) => Promise<void>;
  log: (e: TradeLogEntry) => Promise<void>;
  newId: () => string;
  selectCfg?: SelectConfig;
  riskCfg?: RiskConfig;
}

export interface CycleResult {
  opened: number;
  closed: number;
  skipped: number;
  netLiq: number;
}

export async function runTradeCycle(deps: TradeDeps, opts: { entriesAllowed: boolean }): Promise<CycleResult> {
  const now = deps.now();
  const at = now.toISOString();
  const res: CycleResult = { opened: 0, closed: 0, skipped: 0, netLiq: 0 };
  const log = (type: TradeLogEntry['type'], symbol: string, message: string, extra: Partial<TradeLogEntry> = {}) =>
    deps.log({ at, type, symbol, message, ...extra });

  const all = await deps.listPositions();
  let open = all.filter((p) => p.status === 'OPEN');
  const closedAlready = all.filter((p) => p.status === 'CLOSED');
  const account = await deps.getAccount();

  // ---- exits ----
  const unrealizedByOpen = new Map<string, number>();
  for (const p of [...open]) {
    try {
      const quotes = await deps.fetchLegQuotes([p.shortSymbol, p.longSymbol]);
      const sq = quotes.get(p.shortSymbol);
      const lq = quotes.get(p.longSymbol);
      if (!sq || !lq) {
        res.skipped++;
        await log('SKIP', p.underlying, 'no quotes for open position; holding');
        continue;
      }
      const debit = closeDebit(sq, lq);
      const underlyingPrice = await deps.fetchUnderlying(p.underlying);
      const decision = evaluateExit({
        position: p,
        debit,
        underlyingPrice,
        dte: dteOf(p.expiration, now),
        earningsInDays: deps.earningsInDays(p.underlying),
      });
      if (decision.close) {
        const closed = closePosition(p, debit, decision.reason, now);
        await deps.savePosition(closed);
        closedAlready.push(closed);
        open = open.filter((x) => x.id !== p.id);
        res.closed++;
        await log('CLOSE', p.underlying, `${decision.reason}; bought back at ${closed.closeDebit}`, {
          positionId: p.id, pnl: closed.realizedPnl,
        });
      } else {
        unrealizedByOpen.set(p.id, unrealizedPnl(p, debit));
      }
    } catch (e) {
      res.skipped++;
      await log('SKIP', p.underlying, `exit check failed: ${(e as Error).message}`);
    }
  }

  // ---- account ----
  const today = etDate(now);
  const realizedTotal = closedAlready.reduce((s, p) => s + (p.realizedPnl ?? 0), 0);
  const realizedToday = closedAlready
    .filter((p) => p.closedAt && etDate(new Date(p.closedAt)) === today)
    .reduce((s, p) => s + (p.realizedPnl ?? 0), 0);
  const unrealized = [...unrealizedByOpen.values()].reduce((s, v) => s + v, 0);
  const netLiq = Math.round((account.startingEquity + realizedTotal + unrealized) * 100) / 100;
  const peakEquity = Math.max(account.peakEquity, netLiq);
  if (peakEquity !== account.peakEquity) await deps.saveAccount({ ...account, peakEquity });
  res.netLiq = netLiq;

  // ---- entries ----
  if (!opts.entriesAllowed) return res;
  const riskCfg = deps.riskCfg ?? DEFAULT_RISK;
  const symbols = await deps.eligibleSymbols();
  for (const symbol of symbols) {
    if (open.some((p) => p.underlying === symbol)) continue;
    try {
      const chain = await deps.fetchChain(symbol);
      const base = deps.selectCfg ?? DEFAULT_SELECT;
      const oiAvailable = chain.quotes.some((q) => q.openInterest > 0);
      const cfg = {
        ...base,
        maxLossPerContract: riskCfg.maxLossPerPosition * netLiq,
        minOpenInterest: oiAvailable ? base.minOpenInterest : 0,
      };
      // Trend input is not wired yet (needs price history); NEUTRAL picks whichever side pays better.
      const sel = selectSpread(chain, 'NEUTRAL', now, cfg);
      if (!sel.candidate) {
        res.skipped++;
        await log('SKIP', symbol, `no trade: ${sel.reasons.join('; ')}`);
        continue;
      }
      const gate = riskGate(
        sel.candidate,
        {
          netLiq, peakEquity, realizedToday, halted: account.halted,
          open: open.map((p) => ({ underlying: p.underlying, maxLoss: p.maxLoss })),
        },
        riskCfg,
      );
      if (!gate.allowed) {
        res.skipped++;
        await log('SKIP', symbol, `risk gate: ${gate.reasons.join('; ')}`);
        continue;
      }
      const pos = openPosition(sel.candidate, gate.contracts, now, deps.newId());
      await deps.savePosition(pos);
      open.push(pos);
      res.opened++;
      const c = sel.candidate;
      await log(
        'OPEN', symbol,
        `${c.strategy} ${c.short.strike}/${c.long.strike} exp ${c.expiration} x${gate.contracts} credit ${c.creditFill} (max loss $${pos.maxLoss})`,
        { positionId: pos.id },
      );
    } catch (e) {
      res.skipped++;
      await log('SKIP', symbol, `entry check failed: ${(e as Error).message}`);
    }
  }
  return res;
}

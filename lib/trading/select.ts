// lib/trading/select.ts
// Picks one credit spread for an underlying from a chain snapshot. Pure function.
import {
  type ChainSnapshot, type OptionQuote, type SpreadCandidate, type Strategy, type Trend,
  dteOf, fillPrice, mid, round2,
} from './types';

export interface SelectConfig {
  minDte: number;
  maxDte: number;
  targetDte: number;
  targetDelta: number;
  minDelta: number;
  maxDelta: number;
  minCreditToWidth: number;
  maxLossPerContract: number;
  maxSpreadToCredit: number; // total leg bid-ask spread / credit
  minOpenInterest: number;
  maxQuoteAgeMs: number;
  fillK: number; // pessimism of modeled fills
}

export const DEFAULT_SELECT: SelectConfig = {
  minDte: 30,
  maxDte: 45,
  targetDte: 38,
  targetDelta: 0.18,
  minDelta: 0.12,
  maxDelta: 0.25,
  minCreditToWidth: 0.15, // at ~18 delta, credits run roughly 15-20% of width
  maxLossPerContract: 300, // dollars; 3% of a $10k account
  maxSpreadToCredit: 0.1,
  minOpenInterest: 500,
  maxQuoteAgeMs: 60_000,
  fillK: 0.75,
};

export interface SelectResult {
  candidate: SpreadCandidate | null;
  reasons: string[];
}

function targetWidth(price: number): number {
  return price < 50 ? 1 : price < 150 ? 2.5 : 5;
}

function build(
  chain: ChainSnapshot, strategy: Strategy, now: Date, cfg: SelectConfig, wantWidth: number,
): { candidate: SpreadCandidate | null; reason?: string } {
  const right = strategy === 'PUT_CREDIT_SPREAD' ? 'P' : 'C';
  const own = chain.quotes.filter((q) => q.right === right && q.bid > 0 && q.ask >= q.bid);

  // expiration closest to target within window
  const exps = [...new Set(own.map((q) => q.expiration))]
    .map((e) => ({ e, dte: dteOf(e, now) }))
    .filter((x) => x.dte >= cfg.minDte && x.dte <= cfg.maxDte)
    .sort((a, b) => Math.abs(a.dte - cfg.targetDte) - Math.abs(b.dte - cfg.targetDte));
  if (!exps.length) return { candidate: null, reason: `${strategy}: no expiration in ${cfg.minDte}-${cfg.maxDte} DTE` };
  const { e: expiration, dte } = exps[0];
  const sameExp = own.filter((q) => q.expiration === expiration);

  const otm = (q: OptionQuote) => (right === 'P' ? q.strike < chain.price : q.strike > chain.price);
  const shorts = sameExp
    .filter((q) => otm(q) && Math.abs(q.delta) >= cfg.minDelta && Math.abs(q.delta) <= cfg.maxDelta)
    .sort((a, b) => Math.abs(Math.abs(a.delta) - cfg.targetDelta) - Math.abs(Math.abs(b.delta) - cfg.targetDelta));
  if (!shorts.length) return { candidate: null, reason: `${strategy}: no short strike with delta ${cfg.minDelta}-${cfg.maxDelta}` };
  const short = shorts[0];

  const wingStrike = right === 'P' ? short.strike - wantWidth : short.strike + wantWidth;
  const wings = sameExp
    .filter((q) => (right === 'P' ? q.strike < short.strike : q.strike > short.strike))
    .sort((a, b) => Math.abs(a.strike - wingStrike) - Math.abs(b.strike - wingStrike));
  if (!wings.length) return { candidate: null, reason: `${strategy}: no protective strike` };
  const long = wings[0];
  const width = round2(Math.abs(short.strike - long.strike));
  if (width < wantWidth * 0.5 || width > wantWidth * 2) {
    return { candidate: null, reason: `${strategy}: nearest wing gives width ${width}, wanted ${wantWidth}` };
  }

  const creditMid = round2(mid(short) - mid(long));
  const creditFill = round2(fillPrice(short, 'SELL', cfg.fillK) - fillPrice(long, 'BUY', cfg.fillK));
  if (creditFill <= 0) return { candidate: null, reason: `${strategy}: no credit after modeled fills` };
  if (creditFill < width * cfg.minCreditToWidth) {
    return { candidate: null, reason: `${strategy}: credit ${creditFill} < ${round2(width * cfg.minCreditToWidth)} (min credit-to-width)` };
  }
  const legSpread = short.ask - short.bid + (long.ask - long.bid);
  if (legSpread > creditMid * cfg.maxSpreadToCredit) {
    return { candidate: null, reason: `${strategy}: bid-ask ${round2(legSpread)} too wide for credit ${creditMid}` };
  }
  if (short.openInterest < cfg.minOpenInterest || long.openInterest < cfg.minOpenInterest) {
    return { candidate: null, reason: `${strategy}: open interest below ${cfg.minOpenInterest}` };
  }

  return {
    candidate: {
      underlying: chain.underlying, strategy, expiration, dte, short, long, width,
      creditMid, creditFill, maxLossPerContract: round2((width - creditFill) * 100),
    },
  };
}

export function selectSpread(
  chain: ChainSnapshot, trend: Trend, now: Date, cfg: SelectConfig = DEFAULT_SELECT,
): SelectResult {
  const reasons: string[] = [];
  const newest = Math.max(...chain.quotes.map((q) => new Date(q.quotedAt).getTime()), 0);
  if (now.getTime() - new Date(chain.asOf).getTime() > cfg.maxQuoteAgeMs || now.getTime() - newest > cfg.maxQuoteAgeMs) {
    return { candidate: null, reasons: ['stale quotes'] };
  }

  const order: Strategy[] =
    trend === 'UP' ? ['PUT_CREDIT_SPREAD'] : trend === 'DOWN' ? ['CALL_CREDIT_SPREAD'] : ['PUT_CREDIT_SPREAD', 'CALL_CREDIT_SPREAD'];

  const widths = [5, 4, 3, 2.5, 2, 1].filter((w) => w <= targetWidth(chain.price));
  const found: SpreadCandidate[] = [];
  for (const s of order) {
    let lastReason: string | undefined;
    let picked: SpreadCandidate | null = null;
    for (const w of widths) {
      const r = build(chain, s, now, cfg, w);
      if (!r.candidate) { lastReason = r.reason; continue; }
      if (r.candidate.maxLossPerContract > cfg.maxLossPerContract) {
        lastReason = `${s}: width ${r.candidate.width} risks $${r.candidate.maxLossPerContract} > $${cfg.maxLossPerContract} cap`;
        continue;
      }
      picked = r.candidate;
      break;
    }
    if (picked) found.push(picked);
    else if (lastReason) reasons.push(lastReason);
  }
  if (!found.length) return { candidate: null, reasons };
  found.sort((a, b) => b.creditFill / b.width - a.creditFill / a.width);
  return { candidate: found[0], reasons: [`chose ${found[0].strategy}`] };
}

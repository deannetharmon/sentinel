// lib/__tests__/fixtures.ts
import type { ChainSnapshot, OptionQuote } from '../trading/types';

export const NOW = new Date('2026-10-26T15:00:00Z');
export const EXP = '2026-12-03'; // 38 DTE

function q(right: 'P' | 'C', strike: number, expiration = EXP, oi = 1000): OptionQuote {
  const mid = right === 'P' ? 3.05 * Math.exp((strike - 470) / 15) : 3.05 * Math.exp(-(strike - 530) / 15);
  const delta = right === 'P' ? -0.18 * Math.exp((strike - 470) / 25) : 0.18 * Math.exp(-(strike - 530) / 25);
  return {
    symbol: `SPY ${expiration} ${right}${strike}`,
    right, strike, expiration,
    bid: Math.round((mid - 0.01) * 100) / 100,
    ask: Math.round((mid + 0.01) * 100) / 100,
    delta, openInterest: oi, quotedAt: NOW.toISOString(),
  };
}

export function chain(opts: { expiration?: string; oi?: number } = {}): ChainSnapshot {
  const quotes: OptionQuote[] = [];
  for (let k = 440; k <= 495; k++) quotes.push(q('P', k, opts.expiration ?? EXP, opts.oi ?? 1000));
  for (let k = 505; k <= 560; k++) quotes.push(q('C', k, opts.expiration ?? EXP, opts.oi ?? 1000));
  return { underlying: 'SPY', price: 500, asOf: NOW.toISOString(), quotes };
}

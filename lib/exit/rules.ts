// lib/exit/rules.ts
// Exit priority: earnings safety, stop, tested short strike, profit target, time. Pure function.
import type { PaperPosition } from '../paper/ledger';

export interface ExitInput {
  position: PaperPosition;
  debit: number; // modeled cost to close now, per share
  underlyingPrice: number;
  dte: number;
  earningsInDays: number | null;
}

export interface ExitDecision {
  close: boolean;
  reason: string;
}

export function evaluateExit(i: ExitInput): ExitDecision {
  const p = i.position;
  const credit = p.openCredit;

  if (i.earningsInDays !== null && i.earningsInDays >= 0 && i.earningsInDays <= 1) {
    return { close: true, reason: 'earnings within 1 day' };
  }
  // 2x stop: loss equals twice the credit, i.e. debit = 3x credit
  if (i.debit >= credit * 3) return { close: true, reason: 'stop: loss reached 2x credit' };

  const tested = p.right === 'P' ? i.underlyingPrice <= p.shortStrike : i.underlyingPrice >= p.shortStrike;
  if (tested) {
    return { close: true, reason: i.dte <= 1 ? 'short strike in the money near expiry' : 'short strike tested' };
  }
  if (i.debit <= credit * 0.5) return { close: true, reason: 'profit target: 50% of credit captured' };
  if (i.dte <= 21) return { close: true, reason: 'time exit: 21 DTE' };
  return { close: false, reason: 'hold' };
}

// lib/risk/gate.ts
// Every entry passes through here. No bypass path. Pure function.
import type { SpreadCandidate } from '../trading/types';

export interface OpenRisk {
  underlying: string;
  maxLoss: number; // dollars, total for the position
}

export interface AccountState {
  netLiq: number;
  peakEquity: number;
  realizedToday: number; // dollars, negative = loss
  open: OpenRisk[];
  halted: boolean; // kill switch
}

export interface RiskConfig {
  maxLossPerPosition: number; // fraction of netLiq
  maxPositions: number;
  maxTotalRisk: number;
  maxClusterRisk: number;
  dailyLossHalt: number;
  drawdownHalt: number;
  maxBuyingPower: number;
  clusters: Record<string, string>;
}

export const DEFAULT_RISK: RiskConfig = {
  maxLossPerPosition: 0.03,
  maxPositions: 6,
  maxTotalRisk: 0.2,
  maxClusterRisk: 0.08,
  dailyLossHalt: 0.03,
  drawdownHalt: 0.1,
  maxBuyingPower: 0.5,
  clusters: {
    SPY: 'US_INDEX', IWM: 'US_INDEX', QQQ: 'US_INDEX', DIA: 'US_INDEX',
    XLF: 'FINANCIALS', AAPL: 'MEGA_TECH', NVDA: 'SEMIS', MRVL: 'SEMIS', AMD: 'SEMIS',
  },
};

export interface GateResult {
  allowed: boolean;
  contracts: number;
  reasons: string[];
}

export function riskGate(
  c: SpreadCandidate, acct: AccountState, cfg: RiskConfig = DEFAULT_RISK,
): GateResult {
  const block = (r: string): GateResult => ({ allowed: false, contracts: 0, reasons: [r] });

  if (acct.halted) return block('kill switch on');
  if (acct.netLiq <= 0) return block('no equity');
  if (acct.realizedToday <= -cfg.dailyLossHalt * acct.netLiq) return block('daily loss limit hit');
  if (acct.netLiq <= acct.peakEquity * (1 - cfg.drawdownHalt)) return block('drawdown halt');
  if (acct.open.length >= cfg.maxPositions) return block(`already ${cfg.maxPositions} open positions`);
  if (acct.open.some((p) => p.underlying === c.underlying)) return block(`already have a position in ${c.underlying}`);

  const perPosCap = cfg.maxLossPerPosition * acct.netLiq;
  if (c.maxLossPerContract > perPosCap) {
    return block(`max loss $${c.maxLossPerContract} per contract exceeds $${perPosCap} cap`);
  }
  // size: as many contracts as the caps allow, at least 1 already guaranteed above
  const totalUsed = acct.open.reduce((s, p) => s + p.maxLoss, 0);
  const cluster = cfg.clusters[c.underlying] ?? c.underlying;
  const clusterUsed = acct.open
    .filter((p) => (cfg.clusters[p.underlying] ?? p.underlying) === cluster)
    .reduce((s, p) => s + p.maxLoss, 0);

  const room = [
    cfg.maxTotalRisk * acct.netLiq - totalUsed,
    cfg.maxClusterRisk * acct.netLiq - clusterUsed,
    cfg.maxBuyingPower * acct.netLiq - totalUsed,
    perPosCap,
  ];
  const contracts = Math.floor(Math.min(...room) / c.maxLossPerContract);
  if (contracts < 1) {
    if (room[0] < c.maxLossPerContract) return block('total risk limit reached');
    if (room[1] < c.maxLossPerContract) return block(`${cluster} cluster limit reached`);
    return block('buying power limit reached');
  }
  return { allowed: true, contracts, reasons: ['passed risk gate'] };
}

// app/page.tsx
import { cookies } from 'next/headers';
import { COOKIE, cookieOk } from '@/lib/auth';
import { getTickers, KEYS, recentDecisions, redis } from '@/lib/store/redis';
import { getAccount, listPositions, recentTrades, type TradeLogEntry } from '@/lib/store/ledger';
import type { PaperPosition } from '@/lib/paper/ledger';

export const dynamic = 'force-dynamic';

const box = { border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 16 } as const;
const cell = { padding: '6px 10px', borderBottom: '1px solid #eee', textAlign: 'left' } as const;

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

export default async function Home({ searchParams }: { searchParams: { error?: string } }) {
  const authed = cookieOk(cookies().get(COOKIE)?.value);

  if (!authed) {
    return (
      <main style={{ maxWidth: 360 }}>
        <h1>Sentinel</h1>
        <form method="post" action="/api/login">
          <input name="password" type="password" placeholder="Password" autoFocus style={{ padding: 8, width: '100%' }} />
          <button type="submit" style={{ padding: 8, marginTop: 8 }}>Sign in</button>
          {searchParams.error && <p style={{ color: '#b91c1c' }}>Wrong password.</p>}
        </form>
      </main>
    );
  }

  let tickers: string[], heartbeat: string | null, decisions: any[];
  let positions: PaperPosition[], startEquity: number, trades: TradeLogEntry[];
  try {
    const r = redis();
    let acct;
    [tickers, heartbeat, decisions, positions, acct, trades] = await Promise.all([
      getTickers(r),
      r.get(KEYS.heartbeat),
      recentDecisions(200, r) as Promise<any[]>,
      listPositions(r),
      getAccount(r),
      recentTrades(30, r),
    ]);
    startEquity = acct.startingEquity;
  } catch (e) {
    const missing = !process.env.REDIS_URL;
    return (
      <main style={{ maxWidth: 600 }}>
        <h1>Sentinel</h1>
        <p style={{ color: '#b91c1c' }}>
          {missing
            ? 'REDIS_URL is not set in this Vercel project. Add it under Settings > Environment Variables, then redeploy.'
            : 'Could not reach Redis. Check that REDIS_URL starts with rediss:// and has no extra text in front.'}
        </p>
        <p style={{ color: '#666', fontSize: 13 }}>Reason: {String((e as Error).message).replace(/\w+:\/\/\S+/g, '<url hidden>').slice(0, 200)}</p>
      </main>
    );
  }
  const openPos = positions.filter((p) => p.status === 'OPEN');
  const closedPos = positions
    .filter((p) => p.status === 'CLOSED')
    .sort((a, b) => String(b.closedAt).localeCompare(String(a.closedAt)));
  const realized = closedPos.reduce((s, p) => s + (p.realizedPnl ?? 0), 0);
  const wins = closedPos.filter((p) => (p.realizedPnl ?? 0) > 0).length;
  const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;
  const beatAge = heartbeat ? Date.now() - new Date(heartbeat).getTime() : Infinity;
  const alive = beatAge < 120_000;

  const latest = new Map<string, any>();
  for (const d of decisions) if (!latest.has(d.symbol)) latest.set(d.symbol, d);

  return (
    <main style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Sentinel</h1>
        <form method="post" action="/api/logout"><button type="submit">Sign out</button></form>
      </div>

      <section style={box}>
        <strong>Worker: </strong>
        <span style={{ color: alive ? '#15803d' : '#b91c1c' }}>{alive ? '● running' : '● not responding'}</span>
        <span style={{ color: '#666' }}> · last heartbeat {ago(heartbeat)} · paper mode</span>
      </section>

      <section style={box}>
        <h2 style={{ marginTop: 0 }}>Paper account</h2>
        <p style={{ margin: 0 }}>
          Starting {money(startEquity)} · Realized P&amp;L{' '}
          <strong style={{ color: realized >= 0 ? '#15803d' : '#b91c1c' }}>{money(realized)}</strong> · Equity (closed trades){' '}
          <strong>{money(startEquity + realized)}</strong> · {closedPos.length} closed ({wins} wins) · {openPos.length} open
        </p>
      </section>

      <section style={box}>
        <h2 style={{ marginTop: 0 }}>Open positions</h2>
        {openPos.length === 0 ? (
          <p style={{ color: '#666' }}>None.</p>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr>{['Ticker', 'Spread', 'Expires', 'Qty', 'Credit', 'Max loss', 'Opened'].map((h) => <th key={h} style={cell}>{h}</th>)}</tr></thead>
            <tbody>
              {openPos.map((p) => (
                <tr key={p.id}>
                  <td style={cell}><strong>{p.underlying}</strong></td>
                  <td style={cell}>{p.strategy === 'PUT_CREDIT_SPREAD' ? 'Put credit' : 'Call credit'} {p.shortStrike}/{p.longStrike}</td>
                  <td style={cell}>{p.expiration}</td>
                  <td style={cell}>{p.contracts}</td>
                  <td style={cell}>{p.openCredit.toFixed(2)}</td>
                  <td style={cell}>{money(p.maxLoss)}</td>
                  <td style={cell}>{ago(p.openedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={box}>
        <h2 style={{ marginTop: 0 }}>Closed trades</h2>
        {closedPos.length === 0 ? (
          <p style={{ color: '#666' }}>None yet.</p>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr>{['Ticker', 'Spread', 'P&L', 'Why closed', 'Closed'].map((h) => <th key={h} style={cell}>{h}</th>)}</tr></thead>
            <tbody>
              {closedPos.slice(0, 20).map((p) => (
                <tr key={p.id}>
                  <td style={cell}><strong>{p.underlying}</strong></td>
                  <td style={cell}>{p.shortStrike}/{p.longStrike} x{p.contracts}</td>
                  <td style={{ ...cell, color: (p.realizedPnl ?? 0) >= 0 ? '#15803d' : '#b91c1c' }}>{money(p.realizedPnl ?? 0)}</td>
                  <td style={cell}>{p.closeReason}</td>
                  <td style={cell}>{ago(p.closedAt ?? null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={box}>
        <h2 style={{ marginTop: 0 }}>Activity</h2>
        {trades.length === 0 ? (
          <p style={{ color: '#666' }}>Nothing yet. Trades are considered during entry windows (10:15-11:30 and 14:00-15:30 ET).</p>
        ) : (
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            {trades.map((t, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                <strong>{t.type}</strong> {t.symbol}: {t.message} <span style={{ color: '#888' }}>({ago(t.at)})</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={box}>
        <h2 style={{ marginTop: 0 }}>Tickers</h2>
        <form method="post" action="/api/tickers">
          <textarea name="tickers" defaultValue={tickers.join('\n')} rows={6} style={{ width: 160, padding: 8 }} />
          <div><button type="submit" style={{ padding: 8, marginTop: 8 }}>Save tickers</button></div>
          <p style={{ color: '#666', fontSize: 13 }}>One per line. The worker picks up changes on its next scan.</p>
        </form>
      </section>

      <section style={box}>
        <h2 style={{ marginTop: 0 }}>Latest decisions</h2>
        {latest.size === 0 ? (
          <p style={{ color: '#666' }}>No scans yet. The worker scans every 5 minutes while the market is open.</p>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>{['Ticker', 'Status', 'IV rank', 'Why', 'When'].map((h) => <th key={h} style={cell}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {[...latest.values()].map((d) => (
                <tr key={d.symbol}>
                  <td style={cell}><strong>{d.symbol}</strong></td>
                  <td style={{ ...cell, color: d.eligible ? '#15803d' : '#b45309' }}>{d.eligible ? 'Eligible' : 'Blocked'}</td>
                  <td style={cell}>{d.metrics?.ivRank ?? '–'}</td>
                  <td style={cell}>{d.reasons.join('; ')}</td>
                  <td style={cell}>{ago(d.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

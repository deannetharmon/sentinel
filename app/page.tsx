// app/page.tsx
import { cookies } from 'next/headers';
import { COOKIE, cookieOk } from '@/lib/auth';
import { getTickers, KEYS, recentDecisions, redis } from '@/lib/store/redis';

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

  const r = redis();
  const [tickers, heartbeat, decisions] = await Promise.all([
    getTickers(r),
    r.get(KEYS.heartbeat),
    recentDecisions(200, r) as Promise<any[]>,
  ]);
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
        <span style={{ color: '#666' }}> · last heartbeat {ago(heartbeat)} · paper mode · scan only (no trades yet)</span>
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

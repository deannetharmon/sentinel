// lib/time/market.ts
// US equity market hours (ET). Holiday calendar is a later ticket; until then holidays are scanned harmlessly.

function et(now: Date): { weekday: string; mins: number; date: string } {
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', ...o });
  const parts = f({ weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    weekday: get('weekday'),
    mins: (Number(get('hour')) % 24) * 60 + Number(get('minute')),
    date: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now),
  };
}

export const etDate = (now: Date) => et(now).date;

export function isMarketOpen(now: Date): boolean {
  const t = et(now);
  if (t.weekday === 'Sat' || t.weekday === 'Sun') return false;
  return t.mins >= 9 * 60 + 30 && t.mins < 16 * 60;
}

// Entry windows: 10:15-11:30 and 14:00-15:30 ET.
export function inEntryWindow(now: Date): boolean {
  const t = et(now);
  if (t.weekday === 'Sat' || t.weekday === 'Sun') return false;
  return (t.mins >= 10 * 60 + 15 && t.mins < 11 * 60 + 30) || (t.mins >= 14 * 60 && t.mins < 15 * 60 + 30);
}

// lib/time/market.ts
// US equity market hours (ET). Holiday calendar is a later ticket (SENT-calendar); until then holidays are scanned harmlessly.

export function isMarketOpen(now: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const wd = get('weekday');
  if (wd === 'Sat' || wd === 'Sun') return false;
  const mins = (Number(get('hour')) % 24) * 60 + Number(get('minute'));
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

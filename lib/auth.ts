// lib/auth.ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE = 'sentinel_session';

function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function sessionValue(): string | null {
  const secret = process.env.SENTINEL_ADMIN_SECRET;
  return secret ? createHmac('sha256', secret).update('sentinel-session-v1').digest('hex') : null;
}

export function passwordOk(candidate: string): boolean {
  const secret = process.env.SENTINEL_ADMIN_SECRET;
  return !!secret && safeEq(candidate, secret);
}

export function cookieOk(value: string | undefined | null): boolean {
  const expected = sessionValue();
  return !!expected && !!value && safeEq(value, expected);
}

function cookieFromHeader(header: string | null): string | undefined {
  return header
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
}

// Bearer token (cron/scripts) or the dashboard session cookie.
export function isAuthorized(req: Request, envName: string): boolean {
  const secret = process.env[envName];
  if (!secret) return false;
  const h = req.headers.get('authorization') ?? '';
  if (h.startsWith('Bearer ') && safeEq(h.slice(7), secret)) return true;
  return envName === 'SENTINEL_ADMIN_SECRET' && cookieOk(cookieFromHeader(req.headers.get('cookie')));
}

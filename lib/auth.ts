import { timingSafeEqual } from 'node:crypto';

function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function isAuthorized(req: Request, envName: string): boolean {
  const secret = process.env[envName];
  if (!secret) return false;
  const h = req.headers.get('authorization') ?? '';
  return h.startsWith('Bearer ') && safeEq(h.slice(7), secret);
}

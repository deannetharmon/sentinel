// lib/__tests__/auth.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { cookieOk, isAuthorized, passwordOk, sessionValue, COOKIE } from '../auth';

beforeEach(() => {
  process.env.SENTINEL_ADMIN_SECRET = 'test-secret';
});

describe('auth', () => {
  it('accepts the right password only', () => {
    expect(passwordOk('test-secret')).toBe(true);
    expect(passwordOk('nope')).toBe(false);
  });
  it('validates the session cookie', () => {
    expect(cookieOk(sessionValue())).toBe(true);
    expect(cookieOk('bogus')).toBe(false);
    expect(cookieOk(undefined)).toBe(false);
  });
  it('authorizes by cookie or bearer, rejects otherwise', () => {
    const ok1 = new Request('http://x', { headers: { cookie: `${COOKIE}=${sessionValue()}` } });
    const ok2 = new Request('http://x', { headers: { authorization: 'Bearer test-secret' } });
    const bad = new Request('http://x');
    expect(isAuthorized(ok1, 'SENTINEL_ADMIN_SECRET')).toBe(true);
    expect(isAuthorized(ok2, 'SENTINEL_ADMIN_SECRET')).toBe(true);
    expect(isAuthorized(bad, 'SENTINEL_ADMIN_SECRET')).toBe(false);
  });
  it('fails closed when no secret is configured', () => {
    delete process.env.SENTINEL_ADMIN_SECRET;
    expect(cookieOk('anything')).toBe(false);
  });
});

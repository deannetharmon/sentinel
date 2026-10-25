// app/api/login/route.ts
import { COOKIE, passwordOk, sessionValue } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const form = await req.formData();
  const pw = String(form.get('password') ?? '');
  const base = new URL(req.url);
  if (!passwordOk(pw)) {
    return new Response(null, { status: 303, headers: { Location: new URL('/?error=1', base).toString() } });
  }
  const res = new Response(null, { status: 303, headers: { Location: new URL('/', base).toString() } });
  res.headers.append(
    'Set-Cookie',
    `${COOKIE}=${sessionValue()}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`,
  );
  return res;
}

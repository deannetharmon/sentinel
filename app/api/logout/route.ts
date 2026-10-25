// app/api/logout/route.ts
import { COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const res = new Response(null, { status: 303, headers: { Location: new URL('/', req.url).toString() } });
  res.headers.append('Set-Cookie', `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
  return res;
}

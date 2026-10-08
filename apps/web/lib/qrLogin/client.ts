/** The approving device's calls to the QR sign-in routes. Plain fetch with
 *  a JSON body (the routes refuse anything else), same origin, and nothing
 *  logged: 404, 409 and 429 are answers here, not faults, and the bodies
 *  carry no credential either way. */

export type Credential = { token: string } | { code: string };

export interface QrFacts {
  id: string;
  device: string;
  shell: string;
  askedSecondsAgo: number;
  sameNetwork: boolean;
  status: 'pending' | 'approved' | 'used' | 'denied' | 'expired';
}

export async function qrPost<T = Record<string, unknown>>(path: string, body: unknown): Promise<{ status: number; body: T | null }> {
  const res = await fetch(`/api/auth/qr/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as T | null };
}

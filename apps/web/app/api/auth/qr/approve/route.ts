import type { NextRequest } from 'next/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { decide } from '@/lib/qrLogin/server';

/** A signed-in member approves a pending request (plan 2b): POST + JSON,
 *  same origin, the id AND the token or code. The minted session never
 *  comes back here; only the requesting browser collects it. */
export const POST = withRequestLog('auth/qr/approve', (req: NextRequest) => decide(req, 'approve'));

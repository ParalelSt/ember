import type { NextRequest } from 'next/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { decide } from '@/lib/qrLogin/server';

/** "Not me": the same checks as approve, and the requester is told. */
export const POST = withRequestLog('auth/qr/deny', (req: NextRequest) => decide(req, 'deny'));

import { supabaseAdmin, supabaseForToken } from '../supabase.js';

export async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw Object.assign(new Error('Missing bearer token'), { status: 401 });
    if (!supabaseAdmin) throw Object.assign(new Error('Server auth not configured'), { status: 500 });
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) throw Object.assign(new Error('Invalid token'), { status: 401 });
    req.user = data.user;
    req.db = supabaseForToken(token);
    next();
  } catch (e) {
    next(e);
  }
}

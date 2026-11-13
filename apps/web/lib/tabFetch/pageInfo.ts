import { scrubText } from '@/lib/logger/sanitize';
import type { PageMeta } from './polite';

/** What a tab-site page that could not be read looked like, small enough for
 *  a log line: wire facts plus the trimmed <title>, never the HTML. */
export interface PageDiagnosis {
  status: number | null;
  contentType: string | null;
  length: number;
  title: string | null;
  /** Set when the page is a block, captcha or consent wall rather than a
   *  page of the site that merely changed shape. */
  blocked: 'captcha' | 'block' | 'consent' | null;
}

const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const MAX_TITLE = 120;

/** Page title, whitespace-collapsed, entities left alone, URLs with query
 *  strings scrubbed the way the logger does. */
export function pageTitle(html: string): string | null {
  const m = TITLE_RE.exec(html);
  if (!m) return null;
  const t = scrubText(m[1].replace(/\s+/g, ' ').trim());
  if (!t) return null;
  return t.length > MAX_TITLE ? `${t.slice(0, MAX_TITLE)}...` : t;
}

const CAPTCHA_RE = /captcha|are you (a )?human|verify you are|security check|challenge-platform|cf-chl|just a moment/i;
const BLOCK_RE = /access denied|forbidden|blocked|unusual traffic|too many requests|rate.?limit|attention required|request unsuccessful|error 1020/i;
const CONSENT_RE = /consent|before you continue|privacy (choices|settings)|cookie(s)? (preferences|settings)|gdpr/i;

export function diagnosePage(html: string, meta: PageMeta | null): PageDiagnosis {
  const title = pageTitle(html);
  // The title is the cheapest honest signal; the start of the body catches
  // walls that carry no useful title. Only a slice is looked at.
  const probe = `${title ?? ''} ${html.slice(0, 4000)}`;
  const blocked = CAPTCHA_RE.test(probe) ? 'captcha' : BLOCK_RE.test(probe) ? 'block' : CONSENT_RE.test(title ?? '') ? 'consent' : null;
  return {
    status: meta?.status ?? null,
    contentType: meta?.contentType ?? null,
    length: meta?.length ?? html.length,
    title,
    blocked,
  };
}

/** Log fields and message wording for an unreadable page. A wall is the
 *  site's doing (warn); a page that merely changed shape stays an error so a
 *  parser that needs fixing is still noticed. */
export function unreadableLog(what: string, d: PageDiagnosis): { level: 'warn' | 'error'; message: string } {
  if (d.blocked) return { level: 'warn', message: `${what} is a ${d.blocked} page, backing off` };
  return { level: 'error', message: `${what} unreadable, backing off` };
}

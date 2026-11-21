/// <reference types="vite/client" />
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isValidElement, type ComponentType, type ReactElement } from 'react';
import { render, screen } from '@testing-library/react';

/* Every route file under app/(app) in both looks (docs/classic-look.md):
 * a route the Classic look also had renders its frozen page there and the
 * new page otherwise; a route only the redesign has renders its new page in
 * both (inside the legacy shell on a Classic device). The legacy pages
 * stand in as markers: this is about the wiring, not what each page draws. */

// Each case imports a whole route module afresh (vi.resetModules), which is
// slow while the full suite runs in parallel.
vi.setConfig({ testTimeout: 30_000 });

const ui = vi.hoisted(() => ({ mode: 'new' as 'new' | 'legacy' }));
// Plain functions, no context: a client switch can be called directly to
// see which page it picks without rendering the new page and its data.
vi.mock('@/components/providers/UiModeProvider', () => ({
  useUiMode: () => ({ mode: ui.mode, setMode: async () => {} }),
}));
vi.mock('@/components/providers/serverUiMode', () => ({ serverUiMode: async () => ui.mode }));

/** Routes only the redesign has. The Classic look shows these new pages. */
const NEW_ONLY = [
  'chart/[slug]/loading.tsx',
  'chart/[slug]/page.tsx',
  'dizajn/page.tsx',
  'mix/[key]/loading.tsx',
  'mix/[key]/page.tsx',
  'settings/uploads/page.tsx',
  'whats-new/[id]/page.tsx',
];

const APP = __dirname;
const LEGACY = join(__dirname, '../../legacy/app');
const ROUTE_FILE = /^(page|layout|loading)\.tsx$/;

function routeFiles(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) visit(full);
      else if (ROUTE_FILE.test(entry)) out.push(relative(root, full));
    }
  };
  visit(root);
  // The (app) shell itself has its own test (layout.test.tsx).
  return out.filter((f) => f !== 'layout.tsx').sort();
}

const loaders = import.meta.glob<{ default: unknown }>('./**/{page,layout,loading}.tsx');
const newFiles = routeFiles(APP);
const legacyFiles = new Set(routeFiles(LEGACY));
const shared = newFiles.filter((f) => !NEW_ONLY.includes(f));

const props = {
  params: Promise.resolve({ id: 'x1', slug: 'x1', key: 'x1', token: 'x1', code: 'x1', trackId: 'x1' }),
  searchParams: Promise.resolve({}),
  children: <div data-testid="children" />,
};

type Switch = ComponentType<typeof props> & { variants?: { new: unknown; legacy: unknown } };

/** Stands the route's legacy module in with a marker it can be told by. */
function mockLegacy(file: string) {
  const id = file.replace(/\.tsx$/, '');
  const marker = vi.fn(() => <div data-testid={`legacy:${id}`} />);
  vi.doMock(`@legacy/app/${id}`, () => ({ default: marker }));
  return { id, marker };
}

async function load(file: string) {
  const loader = loaders[`./${file}`];
  expect(loader, file).toBeDefined();
  return (await loader()).default as Switch;
}

afterEach(() => {
  ui.mode = 'new';
  vi.resetModules();
});

describe('Classic look: the route table', () => {
  beforeAll(() => {
    expect(newFiles.length).toBeGreaterThan(40);
  });

  it('every route file is either shared with the Classic look or listed as new-only', () => {
    expect(newFiles.filter((f) => !legacyFiles.has(f))).toEqual(NEW_ONLY);
    // And the frozen tree has no page the app cannot reach.
    expect([...legacyFiles].filter((f) => !newFiles.includes(f))).toEqual([]);
  });

  describe.each(shared)('%s', (file) => {
    it('Classic look: renders the frozen page', async () => {
      ui.mode = 'legacy';
      const { id, marker } = mockLegacy(file);
      const Page = await load(file);
      if (Page.variants) {
        render(<Page {...props} />);
        expect(await screen.findByTestId(`legacy:${id}`)).toBeInTheDocument();
      } else {
        // A server route file: decided on the server, from the cookie.
        const out = await (Page as unknown as (p: typeof props) => Promise<unknown>)(props);
        const picked = (isValidElement(out) && (out as ReactElement).type === marker) || marker.mock.calls.length > 0;
        if (!picked) {
          // A Classic client page behind its loader (legacy/app/lazy.tsx).
          expect(isValidElement(out)).toBe(true);
          render(out as ReactElement);
          expect(await screen.findByTestId(`legacy:${id}`)).toBeInTheDocument();
        }
      }
    });

    it('new look: renders the new page', async () => {
      ui.mode = 'new';
      const { marker } = mockLegacy(file);
      const Page = await load(file);
      if (Page.variants) {
        const out = (Page as unknown as (p: typeof props) => ReactElement)(props);
        expect(out.type).toBe(Page.variants.new);
        expect(Page.variants.new).not.toBe(Page.variants.legacy);
      } else {
        let out: unknown = null;
        try {
          out = await (Page as unknown as (p: typeof props) => Promise<unknown>)(props);
        } catch {
          // The new page itself ran (a sign-in check, a redirect): not legacy.
        }
        expect(isValidElement(out) && (out as ReactElement).type === marker).toBe(false);
      }
      expect(marker).not.toHaveBeenCalled();
    });
  });

  describe.each(NEW_ONLY)('%s (new only)', (file) => {
    it('has no Classic variant: the same new page in both looks', async () => {
      const source = readFileSync(join(APP, file), 'utf8');
      expect(source).not.toMatch(/@legacy\//);
      expect(source).not.toMatch(/serverUiMode|uiSwitch/);
      const Page = await load(file);
      expect(Page.variants).toBeUndefined();
    });
  });
});

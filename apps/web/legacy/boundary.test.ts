// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import { join } from 'node:path';

/** The Classic look's import boundary (eslint.config.mjs, docs/classic-look.md): only
 *  app/(app)/ may load legacy/, and legacy/ may not load redesign UI. */
const webRoot = join(__dirname, '..');
const eslint = new ESLint({ cwd: webRoot });

async function restricted(file: string, source: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath: join(webRoot, file) });
  return result.messages.filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.message);
}

describe('Classic look import boundary', () => {
  it('a switch point in app/(app)/ may load the legacy tree', async () => {
    expect(await restricted('app/(app)/radio/page.tsx', "export { default } from '@legacy/app/radio/page';\n")).toEqual([]);
  });

  it('nothing outside app/(app)/ may: a component, lib, hooks, the root layout', async () => {
    for (const file of ['components/nav/Sidebar.tsx', 'components/primitives/X.tsx', 'lib/x.ts', 'hooks/useX.ts', 'app/layout.tsx']) {
      const msgs = await restricted(file, "import { Sidebar } from '@legacy/components/nav/Sidebar';\nexport const x = Sidebar;\n");
      expect(msgs.length, file).toBe(1);
    }
  });

  it('legacy/ may not import redesign components or routes', async () => {
    expect(await restricted('legacy/components/nav/X.tsx', "import { PlayerBar } from '@/components/player/PlayerBar';\nexport const x = PlayerBar;\n")).toHaveLength(1);
    expect(await restricted('legacy/app/x/page.tsx', "import P from '@/app/(app)/radio/page';\nexport const x = P;\n")).toHaveLength(1);
  });

  it('legacy/ may import its own tree and shared engine code', async () => {
    const source = [
      "import { useAuth } from '@/components/providers/AuthProvider';",
      "import { usePlayer } from '@/components/player/PlayerProvider';",
      "import { SessionHostBridge } from '@/components/session/SessionHostBridge';",
      "import { api } from '@/lib/api';",
      "import { useUiStore } from '@/stores/useUiStore';",
      "import { useIsDesktop } from '@/hooks/useIsDesktop';",
      "import { Sidebar } from '@legacy/components/nav/Sidebar';",
      'export const x = [useAuth, usePlayer, SessionHostBridge, api, useUiStore, useIsDesktop, Sidebar];',
      '',
    ].join('\n');
    expect(await restricted('legacy/app/layout.tsx', source)).toEqual([]);
  });
});

/** A popup over a popup (a queue row's menu, the Clear dialog over the queue
 *  sheet) needs its own backdrop: base-ui leaves it out for a nested popup,
 *  and a tap beside the menu then played the song behind it. Read from the
 *  source: the real base-ui dialog does not run under the unit tests
 *  (test-utils/dialogMock). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string) => readFileSync(join(process.cwd(), 'components/ui', file), 'utf8');

describe('nested popups have their own backdrop', () => {
  it.each(['sheet.tsx', 'dialog.tsx'])('%s', (file) => {
    expect(source(file)).toMatch(/Primitive\.Backdrop\s+forceRender/);
  });
});

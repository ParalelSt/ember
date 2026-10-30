import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tabsListVariants } from './tabs';
import { cn } from '@/lib/utils';

const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

describe('Underline tabs (variant="line")', () => {
  const line = cn(tabsListVariants({ variant: 'line' })).split(/\s+/);

  it('the row is plain with a thin divider, no pill box', () => {
    expect(line).toContain('border-b');
    expect(line).toContain('border-border');
    expect(line).toContain('bg-transparent');
    expect(line).toContain('p-0');
    expect(line).toContain('rounded-none');
    expect(line).not.toContain('bg-muted');
    expect(line).not.toContain('rounded-lg');
    expect(line).toContain('group-data-horizontal/tabs:h-auto');
    expect(line).not.toContain('group-data-horizontal/tabs:h-8');
  });

  it('the active one has a 2px ember line sitting on the divider', () => {
    const src = read('components/ui/tabs.tsx');
    expect(src).toContain('after:bg-ember');
    expect(src).toContain('after:h-0.5');
    expect(src).toContain('group-data-horizontal/tabs:after:bottom-[-2px]');
    expect(src).toContain('group-data-[variant=line]/tabs-list:data-active:after:opacity-100');
    expect(src).not.toContain('after:bg-foreground');
  });

  it('the default pill variant is unchanged', () => {
    const def = cn(tabsListVariants({ variant: 'default' })).split(/\s+/);
    expect(def).toContain('bg-muted');
    expect(def).toContain('rounded-lg');
    expect(def).toContain('group-data-horizontal/tabs:h-8');
  });

  it('Send a request uses it', () => {
    expect(read('components/RequestDialog.tsx')).toContain('<TabsList variant="line">');
  });
});

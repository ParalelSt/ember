#!/usr/bin/env node
/** npm run tidy-branches [-- --yes]
 *
 *  Lists the branches already merged into origin/main, with their folders,
 *  and deletes them (branch and folder) after you say yes. A folder with
 *  uncommitted changes is always kept. Branches on GitHub are left alone.
 *  Nobody at the terminal and no --yes: it only lists. */

import { tidyPlan } from './logic.mjs';
import { MAIN, confirm, git, parseArgs, say, tryGit, worktrees } from './lib.mjs';

const { flags } = parseArgs(process.argv.slice(2));
git(['fetch', '-q', '--prune', 'origin'], MAIN);
git(['worktree', 'prune'], MAIN);

const merged = new Set(
  git(['branch', '--format=%(refname:short)', '--merged', 'origin/main'], MAIN).split('\n').filter(Boolean),
);
const dirs = worktrees();
const branches = {};
for (const name of git(['branch', '--format=%(refname:short)'], MAIN).split('\n').filter(Boolean)) {
  const worktree = dirs[name] ?? null;
  const dirty = worktree && worktree !== MAIN ? (tryGit(['status', '--porcelain', '--untracked-files=no'], worktree) ?? '') !== '' : false;
  branches[name] = { merged: merged.has(name), worktree: worktree === MAIN ? null : worktree, dirty };
}
const plan = tidyPlan(branches, git(['rev-parse', '--abbrev-ref', 'HEAD'], MAIN));

if (!plan.remove.length) say('Nothing to tidy: no merged branches left.');
for (const b of plan.remove) say(`  ${b.name}${b.worktree ? `  (${b.worktree})` : ''}`);
for (const b of plan.keep) say(`  kept ${b.name}: ${b.why}`);
const unmerged = Object.values(branches).filter((b) => !b.merged).length;
say(`${plan.remove.length} merged to delete, ${unmerged} not merged yet (kept).`);

if (plan.remove.length && (await confirm(`Delete these ${plan.remove.length}?`, flags))) {
  for (const b of plan.remove) {
    if (b.worktree) tryGit(['worktree', 'remove', b.worktree], MAIN);
    tryGit(['branch', '-d', b.name], MAIN);
  }
  say(`✓ deleted ${plan.remove.length}`);
}

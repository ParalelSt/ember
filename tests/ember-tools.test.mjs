/** The decisions behind the npm run tools (scripts/ember/logic.mjs).
 *
 *      node tests/ember-tools.test.mjs      # or: npm run test:ember-tools */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  branchNameProblem,
  draftNotes,
  hostVerdict,
  isDigest,
  isLivePbData,
  messageHeadline,
  messageLine,
  pickFreePort,
  plainVersion,
  sandboxPortProblem,
  scanAddedLines,
  tidyPlan,
  worktreeFolder,
} from '../scripts/ember/logic.mjs';
import { notesProblems, parseNotes } from '../scripts/release/releaseLib.mjs';

test('sandbox: never the live app or live PocketBase port', () => {
  assert.match(sandboxPortProblem(3000), /live/);
  assert.match(sandboxPortProblem(8090), /live/);
  assert.equal(sandboxPortProblem(3072), null);
  assert.ok(sandboxPortProblem(80));
  assert.equal(pickFreePort([3050, 3051, 3072]), 3052);
  assert.equal(pickFreePort([]), 3050);
});

test('sandbox: the live pb_data is recognised, with or without a slash', () => {
  assert.ok(isLivePbData('/x/spotify-clone/pocketbase/pb_data/', '/x/spotify-clone'));
  assert.ok(!isLivePbData('/x/spotify-clone-wt/_sandbox/pb_data', '/x/spotify-clone'));
});

test('branch: names in the house style, folders from the last part', () => {
  assert.equal(branchNameProblem('fix/search-crash'), null);
  assert.equal(branchNameProblem('release-0.7.31'), null);
  assert.ok(branchNameProblem('Fix Search'));
  assert.ok(branchNameProblem('main'));
  assert.ok(branchNameProblem(''));
  assert.equal(worktreeFolder('fix/reported-1022'), 'reported-1022');
  assert.throws(() => worktreeFolder('fix/..'));
});

test('notes-draft: fixes and features become bullets the release accepts', () => {
  const text = draftNotes('feat/add-to-queue', [
    'feat(web): add to queue from a song menu',
    'fix: queue keeps order',
    'chore(release): web 0.7.31',
    'test: more checks',
    "Merge branch 'x'",
  ]);
  const notes = parseNotes(text);
  assert.equal(notes.id, 'add-to-queue');
  assert.equal(notes.title, 'Add to queue');
  assert.deepEqual(notes.bullets, ['Add to queue from a song menu.', 'Queue keeps order.']);
  assert.deepEqual(notesProblems(notes, []), []);
});

test('pre-push: secrets, em dashes and pranks in What\'s new are caught', () => {
  const diff = [
    '+++ b/apps/web/lib/x.ts',
    '+const hook = "https://discord.com/api/webhooks/123456789/abcdefghijklmnopqrstuvwxyz0123";',
    '+POCKETBASE_ADMIN_PASSWORD=hunter2hunter2',
    '+const ok = process.env.POCKETBASE_ADMIN_PASSWORD;',
    '+// a dash \u2014 here',
    '+++ b/apps/web/lib/changelog.ts',
    "+      'A new prank button.',",
    '+++ b/apps/web/lib/x.test.ts',
    '+POCKETBASE_ADMIN_PASSWORD=fake-for-the-test',
  ].join('\n');
  const problems = scanAddedLines(diff);
  assert.ok(problems.includes('apps/web/lib/x.ts: looks like a Discord webhook URL'));
  assert.ok(problems.includes('apps/web/lib/x.ts: looks like a password in a setting'));
  assert.ok(problems.includes('apps/web/lib/x.ts: em dash'));
  assert.ok(problems.includes("apps/web/lib/changelog.ts: mentions pranks in What's new"));
  assert.ok(!problems.some((p) => p.startsWith('apps/web/lib/x.test.ts')));
  assert.deepEqual(scanAddedLines('+++ b/README.md\n+Run npm run sandbox.\n'), []);
});

test('tidy-branches: only merged branches, never main, never unsaved work', () => {
  const plan = tidyPlan(
    {
      main: { merged: true },
      'fix/a': { merged: true, worktree: '/wt/a' },
      'fix/b': { merged: true, worktree: '/wt/b', dirty: true },
      'feat/c': { merged: false, worktree: '/wt/c' },
      'fix/here': { merged: true },
    },
    'fix/here',
  );
  assert.deepEqual(plan.remove, [{ name: 'fix/a', worktree: '/wt/a' }]);
  assert.deepEqual(plan.keep, [{ name: 'fix/b', why: 'has uncommitted changes' }]);
});

test('host-check: says when ./update.sh is due', () => {
  assert.equal(plainVersion('0.7.30 (9081feae 2026-10-15)'), '0.7.30');
  assert.equal(hostVerdict('0.7.30 (x)', '0.7.31').due, true);
  assert.equal(hostVerdict('0.7.31 (x)', '0.7.31').due, false);
  assert.equal(hostVerdict('0.8.0', '0.7.31').due, false);
  assert.equal(hostVerdict(null, '0.7.31').due, true);
});

test('reports: webhook embeds are read, digests are recognised', () => {
  const report = {
    timestamp: '2026-10-22T13:59:00Z',
    author: { username: 'Bug Report' },
    content: '',
    embeds: [{ title: 'Bug report from a@b.c', description: 'Playlists jump\nto the top', fields: [{ name: 'Where', value: 'tauri 0.7.30' }] }],
    attachments: [{ filename: 'report.json' }],
  };
  assert.match(messageLine(report), /^- 2026-10-22T13:59 Bug Report: Bug report from a@b\.c :: Playlists jump \/ to the top \| Where: tauri 0\.7\.30 \[files: report\.json\]$/);
  assert.equal(messageHeadline(report), 'Bug report from a@b.c Playlists jump to the top');
  assert.ok(isDigest({ embeds: [{ title: 'Daily error digest 2026-10-22' }] }));
  assert.ok(!isDigest(report));
});

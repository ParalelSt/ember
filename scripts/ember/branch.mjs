#!/usr/bin/env node
/** npm run branch -- fix/search-crash [--from ui/info-changes]
 *
 *  A new branch in its own folder (spotify-clone-wt/<name>), made from the
 *  newest origin/main (or --from), with node_modules linked to the main
 *  checkout's. Never runs npm install. Prints the folder. */

import fs from 'node:fs';
import path from 'node:path';
import { branchNameProblem, worktreeFolder } from './logic.mjs';
import { MAIN, WT, ask, fail, git, linkNodeModules, parseArgs, say, tryGit } from './lib.mjs';

const { flags, rest } = parseArgs(process.argv.slice(2));
const name = rest[0] ?? (await ask('Branch name (e.g. fix/search-crash):', { flag: 'the name' }));
const problem = branchNameProblem(name);
if (problem) fail(problem);
if (tryGit(['rev-parse', '--verify', `refs/heads/${name}`], MAIN)) fail(`Branch ${name} already exists.`);

const dir = path.join(WT, worktreeFolder(name));
if (fs.existsSync(dir)) fail(`${dir} already exists. Pick another name.`);

git(['fetch', '-q', 'origin'], MAIN);
const from = flags.from ? (tryGit(['rev-parse', '--verify', `origin/${flags.from}`], MAIN) ? `origin/${flags.from}` : flags.from) : 'origin/main';
git(['worktree', 'add', '-q', '-b', name, dir, from], MAIN);
linkNodeModules(dir);
say(`✓ ${name} (from ${from}) in ${dir}`);

#!/usr/bin/env node
/** npm run hooks: turns on the pre-push check (.githooks/pre-push) for this
 *  repo and every worktree of it. Run once. */

import { MAIN, git, say } from './lib.mjs';

git(['config', 'core.hooksPath', '.githooks'], MAIN);
say("✓ Every push is now checked for secrets, em dashes and pranks in What's new.");

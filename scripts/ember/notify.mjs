#!/usr/bin/env node
/** npm run notify -- "Release 0.7.31 is ready to check on 3072"
 *
 *  Sends the owner a Discord DM from the Ember bot (his phone shows it as a
 *  notification) and shows a notification on this Mac. */

import { OWNER_DM_CHANNEL, ask, discord, parseArgs, say, sh } from './lib.mjs';

const { rest } = parseArgs(process.argv.slice(2));
const text = rest.join(' ').trim() || (await ask('Message:', { flag: 'the message' }));
if (!text) process.exit(0);

await discord(`/channels/${OWNER_DM_CHANNEL}/messages`, {
  method: 'POST',
  body: JSON.stringify({ content: text.slice(0, 1900), allowed_mentions: { parse: [] } }),
});
sh('osascript', ['-e', `display notification ${JSON.stringify(text.slice(0, 200))} with title "Ember"`]);
say('✓ sent');

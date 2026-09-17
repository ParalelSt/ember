# Feature and fix requests

A form where users suggest a new feature or a fix. Each type goes to its own Discord channel.

## Where

Settings > Help, a "Send a request" button next to "Report a bug". It opens one dialog.

## The form

A choice at the top: New feature or Fix. The same three fields sit below. Their labels and placeholders change with the choice.

New feature

- Name: "Short name, e.g. Sleep timer"
- Description: "What should it do, and when would you use it? e.g. Stop playback after 30 minutes so I can fall asleep to music."
- Anything else (optional): "Examples from other apps, edge cases."

Fix

- Name: "What needs fixing, e.g. Queue jumps to the top"
- Recommended approach: "What happens now and what you'd expect instead. For UI: what you'd see, where, and how it should work."
- Anything else (optional): "Steps, device, how often it happens."

Name and the middle field are required.

## Where it goes

- New feature: the recommendations channel.
- Fix: the fix recommendations channel.

The message shows the type and name as the title, the fields, and a footer with the sender, app version, device and page.

Same as bug reports: the two channel webhooks are built into the code (`DEFAULT_WEBHOOKS` in `apps/web/app/api/requests/route.ts`), so every copy sends to your channels. `DISCORD_FEATURE_WEBHOOK_URL` and `DISCORD_FIX_WEBHOOK_URL` in `apps/web/.env.local` override them. Test accounts never post to the built-in channels.

## Limits

- Signed-in users only.
- 5 requests per hour per user.
- Field lengths capped, secrets scrubbed from the text.
- Test accounts never post to the real channels.

## Tests

- The API sends each type to the right channel, rejects empty or too long fields, and applies the rate limit.
- The dialog switches labels and placeholders with the choice.
- A browser test sends one of each to a fake webhook.

## Styling

Chosen: **A**, choice on top (the existing tabs pattern), three labelled
fields below whose labels and placeholders switch with the choice.

## Webhooks

Built in like the bug-report webhook (`DEFAULT_WEBHOOKS` in the route), with
the env vars as overrides. If neither is set for the chosen kind, the API
returns 503 and the dialog shows "Requests are not set up on this server".

## Open questions

- Should requests from friends' self-hosted copies also reach your channels? Yes, the webhooks are built in, same as bug reports.

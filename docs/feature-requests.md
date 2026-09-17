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

Webhooks live in `apps/web/.env.local`:

```
DISCORD_FEATURE_WEBHOOK_URL=
DISCORD_FIX_WEBHOOK_URL=
```

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

Unlike the bug-report webhook, these have **no default baked into source**:
`DISCORD_FEATURE_WEBHOOK_URL` and `DISCORD_FIX_WEBHOOK_URL` are read from env
only. If the one for the chosen kind is unset, the API returns 503 and the
dialog shows "Requests are not set up on this server".

## Open questions

- Should requests from friends' self-hosted copies also reach your channels, or only from your host? Resolved by the webhook decision above: since there is no default webhook, a friend's self-hosted copy sends nowhere until they set their own env vars.

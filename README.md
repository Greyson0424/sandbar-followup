# Sandbar Follow-up

A private, browser-only review tool for Sandbar Scheduling's trade-show conversations.

## What it does

- combines event attendee scans, conversation records and after-show activity;
- keeps different people separate and explains combined records;
- prevents ordinary sales drafts for booked, contacted, bounced or blocked people;
- shows calls and follow-up still needed;
- gives Nadia a four-part day-30 result for every real conversation;
- never sends email automatically.

## Live site

https://sandbar-followup-greyson-sprint3.greysonpmalabanan.chatgpt.site

## Local source

- `sandbar-processor.js` — matching, safety and reporting rules
- `build-browser-engine.mjs` — builds the browser engine
- `dist/index.html` — hosted interface
- `dist/engine.js` — generated browser engine
- `DISCOVERY.md` — the problem summary and interview findings
- `interviews/` — the four original interview transcripts
- `HANDOFF.md` — operating and maintenance handoff
- `THURSDAY-FRIDAY-LOG.md` — paste-ready risk log

## Build and check

```text
node build-browser-engine.mjs
node --check sandbar-processor.js
```

Start with [DISCOVERY.md](DISCOVERY.md) for the problem and interview findings. See [HANDOFF.md](HANDOFF.md) for the operating process, ownership, cost, errors and limits.


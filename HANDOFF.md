# Sandbar Follow-up handoff

## What this tool does

Sandbar Follow-up combines the event attendee export, Sandbar's conversation records and the latest after-show activity into one review. It shows every real conversation, outstanding calls or messages, safety checks and Nadia's four day-30 results.

Nothing sends automatically. A person reviews every suggested message.

## Live website

https://sandbar-followup-greyson-sprint3.greysonpmalabanan.chatgpt.site

The website processes selected files in the browser. It does not store the uploaded contents.

## Files to provide

1. **Who attended** — the organizer's CSV export with names, clinics, emails, notes and contact-sharing choices.
2. **What they asked for** — Sandbar's JSON containing typed cards, voice-note transcripts and Owen's post-show list.
3. **What has happened so far** — a CSV snapshot of emails sent, replies, booked demos, trials, bounces and removal requests.
4. **Earlier results** — required only when file 3 contains new activity rather than the complete history.

## Normal operating steps

1. Owen downloads the event export before its 30-day link expires.
2. Erin saves the original files in the show's restricted folder and checks that the expected columns exist.
3. Erin adds all available cards and notes, then runs the website.
4. Erin checks the conversation total, Stop and check, blocked contacts and record matches first.
5. Owen and Nadia handle their own calls and suggested messages. Nothing is sent without review.
6. Finished demo bookings are labelled **Complete—no follow-up**. Select **Mark reviewed** to hide a finished row during the current review.
7. At day 30, Erin adds the latest complete activity and runs it again. Nadia reads the four totals and the named people behind them.

## What the labels mean

- **Hot—look first:** an important follow-up is still open.
- **Warm—look next:** a larger clinic or a named scheduling system makes the conversation useful to review next.
- **Standard:** a real conversation without an urgent request.
- **Complete—no follow-up:** the requested demo is already booked; do not send another sales message.

## When a result is wrong

- Do not send the suggested message.
- The person who had the conversation confirms what was promised.
- Erin corrects the source record or matching decision and runs the files again.
- If a promise is due before Erin's next Tuesday or Thursday, Owen or Nadia completes it directly instead of waiting.
- Record lasting corrections in the rules with the date and decision-maker.

## Ownership

- **Erin:** primary operator, matching, consent checks, existing-customer checks and corrections.
- **Owen:** downloads the event export and completes his calls and messages from his phone.
- **Nadia:** accountable for the outcome, handles her contacts and acts as backup when Erin is unavailable.
- **Technical maintenance:** still needs a permanent owner. Sam may help in an emergency but is not the long-term plan.

## Cost and limits

- This static version has no per-run AI fee. Hosting terms should be checked before long-term client use.
- Nadia said about $50 per show is acceptable; $100 every month is not.
- The target is one to two staff hours per show, but that must be confirmed by timing a complete real run.
- It cannot recover unrecorded conversations, see missing sent mail, detect every existing customer or historical unsubscribe without those lists, send email, or prove revenue at day 30.
- **Mark reviewed** is intentionally temporary. Running the files again rebuilds the full evidence record.

## Developer maintenance

- `sandbar-processor.js` contains the matching, safety, draft and reporting rules.
- `build-browser-engine.mjs` rebuilds `dist/engine.js` after processor changes.
- `dist/index.html` is the hosted interface.
- Run `node build-browser-engine.mjs` after changing the processor.
- Run `node --check sandbar-processor.js` before publishing.



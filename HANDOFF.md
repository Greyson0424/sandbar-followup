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

## What happens when it gets one wrong

1. Do not send the suggested message.
2. Check whether the problem is the person match, email address, owner, request, consent or later activity.
3. The person who had the conversation confirms what was promised. Erin corrects the source record or matching decision and runs the files again.
4. If a promise is due before Erin's next Tuesday or Thursday, Owen or Nadia completes it directly instead of waiting for the correction.
5. Record any lasting correction with the date and the name of the person who decided it.

The current website does not permanently save a **Wrong** action. The correction must be made in Sandbar's source record before the next run.

## Who looks after it after handoff

- **Erin is the primary operator.** On her first Tuesday or Thursday after a show, she saves the original files, checks the columns, runs the website, reviews uncertain matches, checks consent and flags existing customers. She also corrects the source records.
- **Owen owns his conversations.** He downloads the event export before its link expires and completes his own messages and calls from his phone.
- **Nadia is accountable.** She handles her conversations and is the backup operator when Erin is unavailable. When Nadia is covering, uncertain existing customers wait for Erin rather than being guessed.
- **A permanent technical owner has not been chosen.** Sam may help in an emergency, but Nadia said the process should not depend on him. If code is required, the website should stop clearly rather than produce a partial answer.

## What it costs to run

- **Current build:** there is no paid server and no per-run AI charge. It runs in the browser. Long-term hosting terms still need to be checked before client use.
- **Acceptable cost:** Nadia said roughly $50 for each show would be fine. She would not pay $100 every month for a tool used four times a year.
- **Staff time:** the target is one to two hours for each show instead of Erin's current estimate of about 10 hours. The one-to-two-hour target is still an estimate until a complete real run is timed.
- **Setup:** Nadia said a one-time setup cost of a few hundred dollars would be reasonable if the process helps recover even one clinic.

## What it cannot fix

- It cannot recover unrecorded conversations, see missing sent mail, detect every existing customer or historical unsubscribe without those lists, send email, or prove revenue at day 30.
- It cannot force Nadia to provide late cards, force Owen or Nadia to complete a promised call, or decide which trade show to discontinue from one show alone.
- It cannot permanently save Done or Wrong actions in this version because it has no shared database or approved Google Workspace connection.
- **Mark reviewed** is intentionally temporary. Running the files again rebuilds the full evidence record.
- It cannot decide uncertain consent, legal rules, data retention or Google Workspace approval. Sandbar still needs Sam and the appropriate decision-makers to settle those points before using real client data.

## Developer maintenance

- `sandbar-processor.js` contains the matching, safety, draft and reporting rules.
- `build-browser-engine.mjs` rebuilds `dist/engine.js` after processor changes.
- `dist/index.html` is the hosted interface.
- Run `node build-browser-engine.mjs` after changing the processor.
- Run `node --check sandbar-processor.js` before publishing.



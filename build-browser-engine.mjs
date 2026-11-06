import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(directory, "sandbar-processor.js"), "utf8");
const start = source.indexOf("function parseCsv");
const end = source.indexOf("function evaluate(");
if (start < 0 || end < 0 || end <= start) throw new Error("Could not locate the processor's browser-safe core.");

const core = source.slice(start, end);
const wrapper = `
function previousMatchScore(previous, candidate) {
  const previousEmail = normalizedEmail(previous.email);
  const candidateEmail = normalizedEmail(candidate.email);
  if (previousEmail && candidateEmail && previousEmail === candidateEmail) return { score: 140, reason: "exact email" };
  const previousSources = new Set(String(previous.source_rows || "").split(";").map((value) => value.trim()).filter(Boolean));
  const candidateSources = String(candidate.source_rows || "").split(";").map((value) => value.trim()).filter(Boolean);
  const sharedSources = candidateSources.filter((value) => previousSources.has(value));
  if (sharedSources.length) return { score: 120 + sharedSources.length, reason: "shared source rows" };
  const nameMatch = normalize(previous.name) && normalize(previous.name) === normalize(candidate.name);
  const clinicMatch = normalize(previous.clinic) && normalize(previous.clinic) === normalize(candidate.clinic);
  if (nameMatch && clinicMatch) return { score: 100, reason: "exact name and clinic" };
  return { score: 0, reason: "no reliable previous-state match" };
}

function mergePreviousState(candidates, previousRows) {
  const usedPrevious = new Set();
  let matched = 0;
  const statusRank = { "never followed up": 1, "no reply": 2, demo: 3, trial: 4 };
  const merged = candidates.map((candidate) => {
    const ranked = previousRows
      .map((previous, index) => ({ previous, index, ...previousMatchScore(previous, candidate) }))
      .filter((row) => !usedPrevious.has(row.index))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    const second = ranked[1];
    if (!best || best.score < 100 || second && second.score === best.score) return candidate;
    usedPrevious.add(best.index);
    matched += 1;
    const previous = best.previous;
    const currentRank = statusRank[candidate.day30_result] || 0;
    const previousRank = statusRank[previous.day30_result] || 0;
    const day30 = previousRank > currentRank ? previous.day30_result : candidate.day30_result;
    const previouslySent = previous.raw_email_sent === "yes" || previous.successfully_contacted === "yes" || previous.day30_result === "no reply";
    const currentlySent = candidate.raw_email_sent === "yes" || candidate.successfully_contacted === "yes";
    const suppressed = String(candidate.email_status).startsWith("suppressed") || String(previous.email_status).startsWith("suppressed");
    const demo = day30 === "demo";
    const trial = day30 === "trial";
    const currentDeliveryKnown = candidate.delivery_status && candidate.delivery_status !== "no confirmed delivery";
    const deliveryStatus = currentDeliveryKnown ? candidate.delivery_status : previous.delivery_status || candidate.delivery_status;
    const bounced = String(deliveryStatus).startsWith("bounced");
    let draft = candidate.draft;
    let headsUp = candidate.heads_up;
    if (suppressed) {
      draft = "";
      headsUp = headsUp || "Do not contact: a suppression decision was preserved from the previous run.";
    } else if (demo) {
      draft = "";
      headsUp = headsUp || "Demo already booked in the previous run. No new draft.";
    } else if (currentlySent || previouslySent) {
      draft = "";
      headsUp = headsUp || "Already written to in the previous run. No new draft.";
    } else if (bounced) {
      draft = "";
      headsUp = headsUp || "A previous email bounced. Confirm a better address or call instead.";
    } else if (trial) {
      draft = candidate.language === "French"
        ? "Ravie de vous savoir en train d'essayer Sandbar. Je suis disponible si vous avez besoin d'aide.\\n" + candidate.owner
        : "Glad you're trying Sandbar. I'm around if you get stuck.\\n" + candidate.owner;
      headsUp = headsUp || "Trial already started in the previous run. Use the short support note only.";
    }
    const linkedIds = [...new Set([...String(previous.linked_activity_ids || "").split(";"), ...String(candidate.linked_activity_ids || "").split(";")].map((value) => value.trim()).filter(Boolean))].join("; ");
    const matchReasons = [previous.activity_match_reasons, candidate.activity_match_reasons, "previous state: " + best.reason].filter(Boolean).join(" | ");
    return {
      ...candidate,
      email_status: suppressed ? "suppressed: preserved from previous run" : candidate.email_status,
      delivery_status: deliveryStatus,
      draft,
      heads_up: headsUp,
      day30_result: day30,
      linked_activity_ids: linkedIds,
      activity_match_reasons: matchReasons,
      raw_email_sent: currentlySent || previouslySent ? "yes" : "no",
      successfully_contacted: candidate.successfully_contacted === "yes" || previous.successfully_contacted === "yes" ? "yes" : "no",
    };
  });
  return { candidates: merged, matched, previousCount: previousRows.length };
}

function runBrowserShow({ badgeText, notesText, activityText = "", previousText = "", activityMode = "complete" }) {
  if (!String(badgeText || "").trim()) throw new Error("Select badge-scans.csv. The share flags are required before any drafts can be reviewed.");
  if (!String(notesText || "").trim()) throw new Error("Select booth-notes.json. Cards, voice notes and Owen's list are required.");
  const scans = parseCsv(badgeText);
  requireColumns(scans, ["scan_id", "first_name", "last_name", "company", "email", "phone", "share_with_exhibitors", "notes"], "badge-scans.csv");
  let notes;
  try { notes = JSON.parse(notesText); } catch { throw new Error("booth-notes.json is not valid JSON. Stop and obtain the original file."); }
  requireNotesShape(notes);
  const { candidates: baseCandidates, unresolvedSources } = processShow(scans, notes);
  const activitySupplied = Boolean(String(activityText || "").trim());
  const previousSupplied = Boolean(String(previousText || "").trim());
  if (activitySupplied && !["complete", "incremental"].includes(activityMode)) throw new Error("Choose whether the activity file contains the complete show history or only new rows.");
  if (activityMode === "incremental" && !activitySupplied) throw new Error("Select the new activity CSV before using incremental mode.");
  if (activityMode === "incremental" && !previousSupplied) throw new Error("This activity file contains only new rows. Add the previous all-conversations.csv so earlier bookings, messages and suppressions are not lost.");
  const activity = activitySupplied ? parseCsv(activityText) : [];
  if (activitySupplied) requireColumns(activity, ["event_id", "date_time", "event", "channel", "name", "email", "clinic", "detail"], "after-show-activity.csv");
  const previousRows = previousSupplied ? parseCsv(previousText) : [];
  if (previousSupplied) requireColumns(previousRows, ["name", "clinic", "email", "source_rows", "email_status", "delivery_status", "day30_result", "raw_email_sent", "successfully_contacted"], "previous all-conversations.csv");
  const warnings = [];
  if (!activitySupplied) warnings.push({ warning: "after-show-activity.csv was not supplied. The day-30 result is incomplete and drafts must be held until sent mail and bookings are checked." });
  if (activityMode === "incremental") warnings.push({ warning: "Incremental activity was combined with the previous conversation export. Preserve this run's all-conversations.csv for the next incremental update." });
  const { enriched, unlinked } = attachActivity(baseCandidates, activity);
  const doNotContactUpdates = activity
    .filter((event) => /remove me|unsubscribe|do not email|take me off/.test(normalize(event.detail)))
    .map((event) => ({ name: event.name, email: event.email, clinic: event.clinic, event_id: event.event_id, date_time: event.date_time, reason: event.detail }));
  let candidates = enriched;
  if (activityMode === "incremental") {
    const previousMerge = mergePreviousState(candidates, previousRows);
    const minimumExpected = Math.min(previousRows.length, candidates.length);
    if (minimumExpected && previousMerge.matched < Math.floor(minimumExpected * 0.8)) {
      throw new Error("Only " + previousMerge.matched + " of " + previousRows.length + " previous rows matched. Stop and confirm that the previous export belongs to the same show.");
    }
    candidates = previousMerge.candidates;
  }
  if (!activitySupplied) candidates = candidates.map((candidate) => ({
    ...candidate,
    email_status: candidate.email_status.startsWith("suppressed") ? candidate.email_status : "check first: after-show activity missing",
    heads_up: "After-show activity was not supplied. Verify sent mail and bookings before using this draft.",
    day30_result: "unknown: activity missing",
  }));
  function plainNextStep(step) {
    return ({
      "call back": "call",
      "send info": "send the information they requested",
      "thank-you note": "send a short follow-up note",
      pricing: "send pricing",
      demo: "offer a demo",
      trial: "help with their trial",
    })[step] || step || "follow up";
  }
  function explainResult(candidate) {
    const detail = candidate.booth_detail ? " The recorded conversation says: " + candidate.booth_detail : "";
    if (String(candidate.email_status || "").startsWith("suppressed")) return "No sales email draft was prepared because this person asked not to be contacted or did not give permission.";
    if (String(candidate.delivery_status || "").startsWith("bounced")) return "No email draft is ready because the earlier email bounced. A person must check the address or call instead.";
    if (candidate.day30_result === "unknown: activity missing") return "No email draft can be approved yet because the after-show activity file is missing. The tool cannot safely tell whether this person was already contacted or booked.";
    if (String(candidate.email_status || "").startsWith("check")) return "A person needs to check contact permission or earlier activity before using a note." + detail;
    if (candidate.day30_result === "demo") return "No new sales note is needed because the after-show activity shows that a demo was booked.";
    if (candidate.day30_result === "trial") return "A short trial-support note is suggested because the after-show activity shows that a trial was started.";
    if (candidate.raw_email_sent === "yes") return "No ordinary new note is needed because the after-show activity shows that someone already wrote to this person.";
    if (candidate.promised_next_step === "call back") return "A call is listed because that is what was promised at the booth." + detail;
    if (candidate.draft) return "An email draft is ready to " + plainNextStep(candidate.promised_next_step) + " because that is what the conversation records say this person wanted." + detail;
    return "No automatic action was chosen. A person should read the booth records and decide what happens next." + detail;
  }
  candidates = candidates.map((candidate) => ({ ...candidate, why_this_result: explainResult(candidate) }));
  const views = outputViews(candidates);
  const auditRows = candidates.map((candidate) => ({
    candidate_id: candidate.candidate_id,
    name: candidate.name,
    clinic: candidate.clinic,
    source_rows: candidate.source_rows,
    match_reasons: candidate.match_reasons,
    linked_activity_ids: candidate.linked_activity_ids,
    activity_match_reasons: candidate.activity_match_reasons,
    reviewer: "",
    reviewed_at: "",
    reviewer_decision: "",
  }));
  const denominator = candidates.length || 1;
  const day30Statuses = ["trial", "demo", "no reply", "never followed up"];
  if (!activitySupplied) day30Statuses.push("unknown: activity missing");
  const day30Summary = day30Statuses.map((status) => {
    const count = candidates.filter((candidate) => candidate.day30_result === status).length;
    return { status, count, percent_of_real_conversations: ((count / denominator) * 100).toFixed(1) + "%" };
  });
  const trialCount = candidates.filter((candidate) => candidate.day30_result === "trial").length;
  const demoCount = candidates.filter((candidate) => candidate.day30_result === "demo").length;
  const contactedCount = candidates.filter((candidate) => candidate.successfully_contacted === "yes").length;
  const showCost = 9000;
  const showSummary = [
    { metric: "show cost", value: showCost, note: "Client estimate" },
    { metric: "real conversations", value: candidates.length, note: "Excludes drive-bys" },
    { metric: "successfully contacted", value: contactedCount, note: ((contactedCount / denominator) * 100).toFixed(1) + "% coverage" },
    { metric: "trials started", value: trialCount, note: ((trialCount / denominator) * 100).toFixed(1) + "% of conversations" },
    { metric: "demos booked", value: demoCount, note: ((demoCount / denominator) * 100).toFixed(1) + "% of conversations; booked, not necessarily completed" },
    { metric: "trial or demo", value: trialCount + demoCount, note: (((trialCount + demoCount) / denominator) * 100).toFixed(1) + "% of conversations" },
    { metric: "cost per booked demo", value: demoCount ? (showCost / demoCount).toFixed(2) : "n/a", note: "Does not measure attendance or revenue" },
    { metric: "cost per trial or booked demo", value: trialCount + demoCount ? (showCost / (trialCount + demoCount)).toFixed(2) : "n/a", note: "Does not measure paid conversion" },
  ];
  const files = {
    "all-conversations.csv": toCsv(candidates),
    "ready-drafts.csv": toCsv(views.readyDrafts),
    "heads-up-only.csv": toCsv(views.headsUps),
    "call-schedule.csv": toCsv(views.callSchedule),
    "needs-review.csv": toCsv(views.needsReview),
    "suppressed.csv": toCsv(views.suppressed),
    "unlinked-activity.csv": toCsv(unlinked),
    "unresolved-source-notes.csv": toCsv(unresolvedSources),
    "run-warnings.csv": toCsv(warnings),
    "do-not-contact-updates.csv": toCsv(doNotContactUpdates),
    "audit-log.csv": toCsv(auditRows),
    "day30-report.csv": toCsv(day30Summary),
    "show-summary.csv": toCsv(showSummary),
  };
  const reviewHtml = renderReviewHtml(candidates, views, day30Summary, showSummary, unlinked, unresolvedSources, warnings, doNotContactUpdates);
  return {
    candidates,
    views,
    warnings,
    day30Summary,
    showSummary,
    files: { ...files, "review.html": reviewHtml },
    reviewHtml,
    summary: {
      people: candidates.length,
      drafts: views.readyDrafts.length,
      calls: views.callSchedule.length,
      review: views.needsReview.length,
      headsUps: views.headsUps.length,
      suppressed: views.suppressed.length,
    },
  };
}

window.SandbarEngine = { run: runBrowserShow, parseCsv };
`;

fs.mkdirSync(path.join(directory, "dist"), { recursive: true });
fs.writeFileSync(path.join(directory, "dist", "engine.js"), `"use strict";\n${core}\n${wrapper}`, "utf8");
console.log("Built dist/engine.js");



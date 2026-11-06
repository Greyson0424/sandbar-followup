#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const headers = rows.shift();
  return rows
    .filter((values) => values.some((value) => value !== ""))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function requireColumns(rows, required, fileName) {
  const columns = new Set(Object.keys(rows[0] ?? {}));
  const missing = required.filter((column) => !columns.has(column));
  if (missing.length) {
    throw new Error(`${fileName} is missing required column(s): ${missing.join(", ")}. Stop and obtain the original export before continuing.`);
  }
}

function requireNotesShape(notes) {
  const missing = [];
  if (!Array.isArray(notes.cards)) missing.push("cards");
  if (!Array.isArray(notes.voice_notes)) missing.push("voice_notes");
  if (!notes.owen_list || !Array.isArray(notes.owen_list.lines)) missing.push("owen_list.lines");
  if (missing.length) {
    throw new Error(`booth-notes.json is missing required section(s): ${missing.join(", ")}. Stop and check the written input steps.`);
  }
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n") + "\n";
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(dr|dpt|pt|rmt|dc|rac|pht|mr|mrs|ms)\b/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\bbook stead\b/g, "bookstead")
    .replace(/\bclean evo\b/g, "clinivo")
    .replace(/\bprac(?:t)? shift\b/g, "pracshift")
    .replace(/\bjen\b/g, "jennifer")
    .replace(/\bsteve\b/g, "stephen")
    .replace(/\bdan\b/g, "daniel")
    .replace(/\bgord\b/g, "gordon")
    .replace(/\braj\b/g, "rajesh")
    .replace(/\bpeggy\b/g, "margaret");
}

function normalizedEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizedPhone(value) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 10);
}

function editDistance(a, b) {
  if (!a) return b.length;
  if (!b) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length];
}

function wordSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  return 1 - editDistance(a, b) / Math.max(a.length, b.length);
}

function importantTokens(value) {
  const stop = new Set(["and", "the", "clinic", "physio", "physiotherapy", "massage", "therapy", "health", "wellness", "centre", "center", "rehab", "collective", "sports"]);
  return normalize(value).split(" ").filter((token) => token.length > 2 && !stop.has(token));
}

function tokenCoverage(needles, haystackText) {
  if (!needles.length) return 0;
  const haystack = normalize(haystackText).split(" ").filter(Boolean);
  let total = 0;
  for (const needle of needles) {
    const best = haystack.reduce((score, word) => Math.max(score, wordSimilarity(needle, word)), 0);
    if (best >= 0.72) total += best;
  }
  return total / needles.length;
}

function sourceText(source) {
  return [source.name, source.title, source.clinic, source.city, source.email, source.phone, source.text].filter(Boolean).join(" ");
}

function makeScan(row) {
  return {
    id: row.scan_id,
    type: "scan",
    name: `${row.first_name} ${row.last_name}`.trim(),
    title: row.title,
    clinic: row.company,
    city: row.city,
    email: row.email,
    phone: row.phone,
    text: [row.rating, row.notes].filter(Boolean).join(" | "),
    rating: row.rating,
    share: row.share_with_exhibitors,
    raw: row,
  };
}

function makeCard(row) {
  return {
    id: row.card_id,
    type: "card",
    name: row.name,
    title: row.title,
    clinic: row.clinic,
    city: "",
    email: row.email,
    phone: row.phone,
    text: row.back_of_card,
    raw: row,
  };
}

function makeNarrative(row, type, idField, textField) {
  return {
    id: row[idField],
    type,
    name: "",
    clinic: "",
    city: "",
    email: "",
    phone: "",
    text: row[textField],
    raw: row,
  };
}

function isExplicitNonConversation(source) {
  const text = normalize(source.text);
  const company = normalize(source.clinic);
  return /\b(draw|swag|didnt talk|did not talk|exhibitor|vendor|student)\b/.test(text)
    || /\bcomp\b.*\brep\b/.test(text)
    || (["bookstead", "clinivo", "pracshift"].includes(company) && /\brep\b/.test(text));
}

function isMetaNarrative(source) {
  const text = normalize(source.text);
  return /\b(wrap up|do a list on the plane)\b/.test(text);
}

function isMeaningfulScan(source) {
  return !isExplicitNonConversation(source) && Boolean(normalize(source.text));
}

function newEntity(source) {
  return {
    sources: [source],
    reasons: [`seeded from ${source.id}`],
  };
}

function representative(entity, field) {
  const values = entity.sources.map((source) => source[field]).filter(Boolean);
  return values.sort((a, b) => b.length - a.length)[0] ?? "";
}

function entityText(entity) {
  return entity.sources.map(sourceText).join(" ");
}

function matchScore(source, entity) {
  const entitySources = entity.sources;
  const email = normalizedEmail(source.email);
  const phone = normalizedPhone(source.phone);
  if (email && entitySources.some((item) => normalizedEmail(item.email) === email)) return { score: 100, reason: "exact email" };
  if (phone.length === 10 && entitySources.some((item) => normalizedPhone(item.phone) === phone)) return { score: 98, reason: "exact phone" };

  const text = entityText(entity);
  const sourceNameTokens = importantTokens(source.name);
  const sourceClinicTokens = importantTokens(source.clinic);
  const nameCoverage = tokenCoverage(sourceNameTokens, text);
  const clinicCoverage = tokenCoverage(sourceClinicTokens, text);
  let score = nameCoverage * 45 + clinicCoverage * 40;
  const sourceCity = normalize(source.city);
  if (sourceCity && normalize(text).includes(sourceCity)) score += 10;
  if (sourceNameTokens.length && nameCoverage >= 0.85 && sourceClinicTokens.length && clinicCoverage >= 0.75) score += 15;
  return { score, reason: `name ${(nameCoverage * 100).toFixed(0)}%, clinic ${(clinicCoverage * 100).toFixed(0)}%` };
}

function narrativeMatchScore(source, entity) {
  const text = source.text;
  const nameTokens = importantTokens(representative(entity, "name"));
  const clinicTokens = importantTokens(representative(entity, "clinic"));
  const cityTokens = importantTokens(representative(entity, "city"));
  const nameCoverage = tokenCoverage(nameTokens, text);
  const clinicCoverage = tokenCoverage(clinicTokens, text);
  const cityCoverage = tokenCoverage(cityTokens, text);
  const contextCoverage = tokenCoverage(importantTokens(source.text), entityText(entity));
  const score = nameCoverage * 45 + clinicCoverage * 30 + cityCoverage * 8 + contextCoverage * 17;
  return { score, reason: `narrative name ${(nameCoverage * 100).toFixed(0)}%, clinic ${(clinicCoverage * 100).toFixed(0)}%` };
}

function attachNarrative(source, entities) {
  if (isMetaNarrative(source)) return true;
  const ranked = entities
    .map((entity) => ({ entity, ...narrativeMatchScore(source, entity) }))
    .sort((a, b) => b.score - a.score);
  const sourceWords = new Set(normalize(source.text).split(" "));
  const namedMatches = ranked.filter((match) => {
    const names = [...new Set(match.entity.sources.flatMap((item) => importantTokens(item.name)))];
    return match.score >= 28 && names.some((name) => [...sourceWords].some((word) => wordSimilarity(name, word) >= 0.85));
  });
  const selected = namedMatches.length ? namedMatches : ranked.slice(0, 1).filter((match) => match.score >= 25);
  for (const match of selected) {
    match.entity.sources.push(source);
    match.entity.reasons.push(`${source.id}: ${match.reason} (${match.score.toFixed(1)})`);
  }
  return selected.length > 0;
}

function attachNarrativeLoose(source, entities) {
  if (isMetaNarrative(source)) return true;
  const ranked = entities
    .map((entity) => ({ entity, ...narrativeMatchScore(source, entity) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const second = ranked[1];
  if (!best || best.score < 15 || second && best.score - second.score < 3) return false;
  best.entity.sources.push(source);
  best.entity.reasons.push(`${source.id}: contextual fallback ${best.reason} (${best.score.toFixed(1)})`);
  return true;
}

function bestNarrativeSuggestion(source, entities) {
  const best = entities
    .map((entity) => ({ entity, ...narrativeMatchScore(source, entity) }))
    .sort((a, b) => b.score - a.score)[0];
  return {
    source_id: source.id,
    source_type: source.type,
    source_text: source.text,
    best_guess_name: best ? representative(best.entity, "name") : "",
    best_guess_clinic: best ? representative(best.entity, "clinic") : "",
    match_score: best ? best.score.toFixed(1) : "0.0",
    reason: best ? best.reason : "no candidate",
    decision: "manual review required",
  };
}

function attachBest(source, entities, scorer, threshold, margin = 8) {
  const ranked = entities
    .map((entity) => ({ entity, ...scorer(source, entity) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const second = ranked[1];
  if (!best || best.score < threshold || (second && best.score - second.score < margin)) return false;
  best.entity.sources.push(source);
  best.entity.reasons.push(`${source.id}: ${best.reason} (${best.score.toFixed(1)})`);
  return true;
}

function mergeSeeds(sources) {
  const entities = [];
  for (const source of sources) {
    if (!attachBest(source, entities, matchScore, 70, 10)) entities.push(newEntity(source));
  }
  return entities;
}

function extractLocations(text) {
  const normalized = normalize(text);
  const wordNumbers = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  let maximum = 1;
  const pattern = /\b(\d+|one|two|three|four|five|six)\s+(?:locations?|locs?|sites?|clinics?)\b/g;
  for (const match of normalized.matchAll(pattern)) {
    maximum = Math.max(maximum, Number(match[1]) || wordNumbers[match[1]] || 1);
  }
  return maximum;
}

function extractSystem(text) {
  const value = normalize(text).replace(/book stead/g, "bookstead").replace(/clean evo/g, "clinivo").replace(/prac(?:t)? shift/g, "pracshift");
  if (value.includes("clinivo")) return "Clinivo";
  if (value.includes("bookstead")) return "Bookstead";
  if (value.includes("pracshift")) return "Pracshift";
  if (value.includes("google calendar") || value.includes("gcal")) return "Google Calendar";
  if (value.includes("spreadsheet") || value.includes("excel") || value.includes("sheets")) return "spreadsheet";
  if (value.includes("paper")) return "paper book";
  return "unknown";
}

function extractStep(text) {
  const value = normalize(text);
  if (/call (after|once|when)|call back|not before|after thanksgiving/.test(value)) return "call back";
  if (/\bpricing\b|price per|send me the numbers|\$\$/.test(value)) return "pricing";
  if (/\btrial\b|try it/.test(value)) return "trial";
  if (/\bdemo\b|book me/.test(value)) return "demo";
  if (/send (info|information|brochure|stuff|something)|send (him|her|them) something|something (he|she|they) can take|one pager|security doc|info for (the )?owner|for the owner/.test(value)) return "send info";
  return "thank-you note";
}

function extractEntityStep(entity) {
  const weights = { voice: 3, card: 2.5, list: 2, scan: 1 };
  const scores = new Map();
  for (const source of entity.sources) {
    const step = extractStep(sourceText(source));
    if (step === "thank-you note") continue;
    scores.set(step, (scores.get(step) ?? 0) + (weights[source.type] ?? 1));
  }
  if (!scores.size) return "thank-you note";
  return [...scores.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function classify(entity, index, showLocation) {
  const text = entityText(entity);
  const step = extractEntityStep(entity);
  const locations = extractLocations(text);
  const system = extractSystem(text);
  const priority = ["demo", "pricing", "trial", "call back"].includes(step)
    ? "hot"
    : locations >= 2 || ["Clinivo", "Bookstead", "Pracshift"].includes(system)
      ? "warm"
      : "cold";
  const priorityReason = priority === "hot"
    ? `Look first: the conversation records show a specific request to ${step === "call back" ? "call" : step}.`
    : priority === "warm"
      ? locations >= 2
        ? `Look after Hot: the records describe ${locations} clinic locations.`
        : `Look after Hot: the records say this clinic already uses ${system}.`
      : "Standard: this was a real conversation, but the records do not show an urgent request, several locations or one of the named scheduling systems.";
  const scans = entity.sources.filter((source) => source.type === "scan");
  const shareN = scans.some((source) => source.share === "N");
  const hasCard = entity.sources.some((source) => source.type === "card");
  const personalOnly = /do not put.*mail|no mailing|pricing only/.test(normalize(text));
  const language = /french|francais|francophone|massotherapie|physio cote|action de grace/.test(normalize(text)) ? "French" : "English";
  const owner = language === "French" ? "Nadia" : "Owen";
  const professionalDetail = buildProfessionalDetail(text, system, locations);
  const boothDetail = buildBoothDetail(professionalDetail, system, step, locations);
  return {
    candidate_id: `X${String(index + 1).padStart(3, "0")}`,
    name: representative(entity, "name"),
    clinic: representative(entity, "clinic"),
    email: representative(entity, "email"),
    source_rows: entity.sources.map((source) => source.id).sort().join("; "),
    locations,
    booking_system: system,
    priority,
    priority_reason: priorityReason,
    promised_next_step: step,
    email_status: personalOnly ? "personal reply only" : shareN && !hasCard ? "check first" : "eligible pending human check",
    language,
    owner,
    booth_detail: boothDetail,
    draft: step === "call back" || shareN && !hasCard && !personalOnly ? "" : buildDraft({ language, owner, system, step, professionalDetail, text, locations, showLocation }),
    call_when: step === "call back" ? extractCallWhen(text) : "",
    match_reasons: entity.reasons.join(" | "),
  };
}

function buildProfessionalDetail(text, system, locations) {
  const value = normalize(text);
  const systemName = system === "unknown" ? "your current system" : system;
  if (/contract renew/.test(value)) return `You said your ${systemName} contract renews at the end of the year.`;
  if (/per text/.test(value) && /reminder/.test(value)) return `You said ${systemName}'s per-text reminder charges have been frustrating.`;
  if (/reminder/.test(value) && /cost extra/.test(value)) return `You said text reminders cost extra in ${systemName}.`;
  if (/reminder/.test(value) && /(pain|problem|issue|frustrat|mad|charge)/.test(value)) return `You said reminders have been a pain in ${systemName}.`;
  if (/intake form/.test(value)) return "You mentioned sending intake forms before a client's first visit.";
  if (/deposit/.test(value) && /book/.test(value)) return "You wanted to collect deposits when clients book.";
  if (/last minute cancellation|cancellation slot/.test(value)) return "You wanted clients to grab last-minute cancellation slots online.";
  if (/happy w paper|happy with paper/.test(value)) return "You said paper is working for you for now.";
  if (/maybe next yr|maybe next year/.test(value)) return "You said this may be more relevant next year.";
  if (/evening/.test(value) && /(online|book|slot)/.test(value)) return "You wanted clients to be able to book evening appointments online.";
  if (/online book/.test(value)) return "You wanted to see how online booking would work for your clinic.";
  if (/no show|missed appointment/.test(value)) return "You wanted to reduce missed appointments.";
  if (/wait ?list/.test(value)) return "You wanted a simpler way to manage your wait-list.";
  if (/mon am rebook|monday.*rebook/.test(value)) return "You mentioned the Monday-morning rebooking work.";
  if (locations > 1) return `You mentioned coordinating bookings across ${locations} clinics.`;
  if (system === "paper book") return "You said you are still managing bookings on paper.";
  if (system === "spreadsheet") return "You said you are still managing bookings in a spreadsheet.";
  return "";
}

function buildBoothDetail(professionalDetail, system, step, locations) {
  const systemText = system === "unknown" ? "your current booking process" : system;
  const requests = {
    demo: "wanted a demo",
    pricing: "asked for pricing",
    trial: "wanted to try the product",
    "call back": "asked for a call at a specific time",
    "send info": "asked for more information",
    "thank-you note": "discussed your booking process",
  };
  const detail = professionalDetail
    ? professionalDetail.replace(/^You /, "").replace(/\.$/, "")
    : locations > 1
      ? `coordinates ${locations} clinics`
      : `uses ${systemText}`;
  return `${detail}; ${requests[step]}.`;
}

function extractCallWhen(text) {
  const value = normalize(text);
  if (value.includes("after thanksgiving") || value.includes("after action de grace")) return "after Thanksgiving";
  if (value.includes("once the new place is open") || value.includes("when new place opens")) return "when the new location opens";
  const date = String(text).match(/\b(?:on|after|back on)\s+(?:the\s+)?([A-Z]?[a-z]+\s+\d{1,2}|\d{1,2}(?:st|nd|rd|th)?)\b/i);
  return date ? date[1] : "date from booth note";
}

function buildFrenchProfessionalDetail(text, system, locations) {
  const value = normalize(text);
  const systemName = system === "unknown" ? "votre système actuel" : system;
  if (/contract renew/.test(value)) return `Vous avez dit que votre contrat ${systemName} se renouvelle à la fin de l'année.`;
  if (/per text/.test(value) && /reminder/.test(value)) return `Vous avez dit que les frais par texto pour les rappels dans ${systemName} étaient frustrants.`;
  if (/reminder/.test(value) && /cost extra/.test(value)) return `Vous avez dit que les rappels par texto coûtaient plus cher dans ${systemName}.`;
  if (/reminder/.test(value) && /(pain|problem|issue|frustrat|mad|charge)/.test(value)) return `Vous avez dit que les rappels étaient difficiles à gérer dans ${systemName}.`;
  if (/evening/.test(value) && /(online|book|slot)/.test(value)) return "Vous vouliez que vos clients puissent réserver des rendez-vous en soirée en ligne.";
  if (/online book/.test(value)) return "Vous vouliez voir comment la réservation en ligne fonctionnerait pour votre clinique.";
  if (/no show|missed appointment/.test(value)) return "Vous vouliez réduire les rendez-vous manqués.";
  if (/wait ?list/.test(value)) return "Vous vouliez simplifier la gestion de votre liste d'attente.";
  if (locations > 1) return `Vous avez parlé de la gestion des réservations dans vos ${locations} cliniques.`;
  if (system === "paper book") return "Vous avez dit que vous gériez encore les rendez-vous sur papier.";
  if (system === "spreadsheet") return "Vous avez dit que vous gériez encore les rendez-vous dans une feuille de calcul.";
  return "";
}

function buildDraft({ language, owner, system, step, professionalDetail, text, locations, showLocation }) {
  const detailLine = professionalDetail ? `\n${professionalDetail}` : "";
  const englishGreeting = showLocation ? `Great to meet you in ${showLocation}.` : "Great to meet you at the show.";
  const frenchGreeting = showLocation ? `Ravie de vous avoir rencontrée à ${showLocation}.` : "Ravie de vous avoir rencontrée au salon.";
  if (language === "French") {
    const frenchDetail = buildFrenchProfessionalDetail(text, system, locations);
    const frenchDetailLine = frenchDetail ? `\n${frenchDetail}` : "";
    const frenchAction = {
      demo: "Vous souhaitiez une démonstration avec Nadia. Voici le lien : [[LIEN DÉMO]], sinon je vous appellerai jeudi.",
      pricing: "Vous souhaitiez recevoir les tarifs : [[OWEN : AJOUTER LE PRIX]]. Je peux vous les expliquer et je vous appellerai la semaine prochaine.",
      trial: "Vous souhaitiez essayer Sandbar. Voici le lien : [[LIEN ESSAI]].",
      "send info": /security|securite|one pager/.test(normalize(text))
        ? "Voici le document de sécurité dont nous avons parlé : [[JOINDRE LE DOCUMENT]]."
        : "Voici les renseignements dont nous avons parlé : [[JOINDRE OU AJOUTER LE LIEN]].",
      "thank-you note": "Je serais heureuse de poursuivre la conversation si cela vous est utile.",
    }[step] ?? "Je vous recontacterai comme convenu.";
    return `${frenchGreeting}${frenchDetailLine}\n${frenchAction}\n${owner}`;
  }
  const action = {
    demo: "You wanted a demo with Nadia. Here is the link: [[DEMO LINK]], or I'll give you a call Thursday.",
    pricing: "You asked for pricing: [[OWEN: ADD PRICE]]. Happy to walk you through it—I'll call you next week.",
    trial: "You wanted to try Sandbar, so here is the trial link: [[TRIAL LINK]].",
    "send info": /security|one pager|it document/.test(normalize(text))
      ? "Here is the security one-pager we discussed: [[ATTACH DOCUMENT]]. I'll give you a call to walk through it."
      : "Here is the information we discussed: [[ATTACH OR ADD LINK]]. Happy to answer any questions.",
    "thank-you note": "If it would be useful, I can send a short overview.",
  }[step] ?? "I will follow up as we discussed.";
  return `${englishGreeting}${detailLine}\n${action}\n${owner}`;
}

function activityScore(event, candidate) {
  const eventEmail = normalizedEmail(event.email);
  const candidateEmail = normalizedEmail(candidate.email);
  if (eventEmail && candidateEmail && eventEmail === candidateEmail) return { score: 120, reason: "exact email" };
  const eventName = importantTokens(event.name);
  const candidateName = importantTokens(candidate.name);
  const nameScore = tokenCoverage(eventName, candidate.name);
  const clinicScore = tokenCoverage(importantTokens(event.clinic), candidate.clinic);
  let score = nameScore * 55 + clinicScore * 45;
  if (event.event === "demo booked" && candidate.promised_next_step === "demo") score += 20;
  if (event.event === "trial started" && candidate.promised_next_step === "trial") score += 20;
  if (candidateName.length && nameScore >= 0.85) score += 10;
  return { score, reason: `name ${(nameScore * 100).toFixed(0)}%, clinic ${(clinicScore * 100).toFixed(0)}%` };
}

function attachActivity(candidates, activity) {
  const linkedEvents = new Map(candidates.map((candidate) => [candidate.candidate_id, []]));
  const unlinked = [];
  for (const event of activity) {
    const ranked = candidates
      .map((candidate) => ({ candidate, ...activityScore(event, candidate) }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    const second = ranked[1];
    if (!best || best.score < 65 || (second && best.score - second.score < 8)) {
      unlinked.push({ ...event, match_reason: "no unique show-conversation match" });
      continue;
    }
    linkedEvents.get(best.candidate.candidate_id).push({ ...event, match_reason: `${best.reason} (${best.score.toFixed(1)})` });
  }

  const enriched = candidates.map((candidate) => {
    const events = linkedEvents.get(candidate.candidate_id);
    const trial = events.some((event) => event.event === "trial started");
    const demo = events.some((event) => event.event === "demo booked");
    const sent = events.some((event) => event.event === "email sent");
    const bouncedEmails = new Set(events.filter((event) => event.event === "email bounced").map((event) => normalizedEmail(event.email)));
    const successfulSent = events.some((event) => event.event === "email sent" && !bouncedEmails.has(normalizedEmail(event.email)));
    const bounced = events.some((event) => event.event === "email bounced");
    const removed = events.some((event) => /remove me|unsubscribe|do not email|take me off/.test(normalize(event.detail)));
    const day30 = trial ? "trial" : demo ? "demo" : successfulSent ? "no reply" : "never followed up";
    const finalEmailStatus = removed ? "suppressed: asked to be removed" : candidate.email_status;
    let draft = candidate.draft;
    let headsUp = "";
    if (removed) {
      draft = "";
      headsUp = "Do not contact: a removal or do-not-email request was found.";
    } else if (demo) {
      draft = "";
      headsUp = `Demo already booked. No new draft. Matched activity: ${events.filter((event) => event.event === "demo booked").map((event) => event.event_id).join(", ")}.`;
    } else if (bounced && !successfulSent) {
      draft = "";
      headsUp = `Email bounced. Hold the draft and confirm a better address or call instead. Matched activity: ${events.filter((event) => event.event === "email bounced").map((event) => event.event_id).join(", ")}.`;
    } else if (sent) {
      draft = "";
      headsUp = `Already written to. No new draft. Matched activity: ${events.filter((event) => event.event === "email sent").map((event) => event.event_id).join(", ")}.`;
    } else if (trial) {
      draft = candidate.language === "French"
        ? `Ravie de vous savoir en train d'essayer Sandbar. Je suis disponible si vous avez besoin d'aide.\n${candidate.owner}`
        : `Glad you're trying Sandbar. I'm around if you get stuck.\n${candidate.owner}`;
      headsUp = `Trial already started. Use the short support note only. Matched activity: ${events.filter((event) => event.event === "trial started").map((event) => event.event_id).join(", ")}.`;
    }
    return {
      ...candidate,
      priority: demo ? "complete" : candidate.priority,
      priority_reason: demo ? "Complete: the demo is already booked, so no sales follow-up is needed." : candidate.priority_reason,
      email_status: finalEmailStatus,
      delivery_status: bounced && !successfulSent ? "bounced: confirm better address or call" : successfulSent ? "delivered" : "no confirmed delivery",
      draft,
      heads_up: headsUp,
      day30_result: day30,
      linked_activity_ids: events.map((event) => event.event_id).join("; "),
      activity_match_reasons: events.map((event) => `${event.event_id}: ${event.match_reason}`).join(" | "),
      raw_email_sent: sent ? "yes" : "no",
      successfully_contacted: successfulSent ? "yes" : "no",
    };
  });
  return { enriched, unlinked };
}

function outputViews(candidates) {
  const withReviewReasons = candidates.map((candidate) => {
    const reasons = [];
    if (candidate.delivery_status?.startsWith("bounced")) reasons.push("Email bounced; confirm a better address or call instead");
    else if (candidate.email_status.startsWith("check")) reasons.push("Contact permission must be checked before drafting");
    if (!candidate.booth_detail) reasons.push("No safe booth-specific detail was found");
    return { ...candidate, review_reason: reasons.join("; ") };
  });
  const readyDrafts = withReviewReasons.filter((candidate) => candidate.draft && !candidate.review_reason && !candidate.email_status.startsWith("suppressed"));
  const headsUps = withReviewReasons.filter((candidate) => candidate.heads_up);
  const callSchedule = withReviewReasons
    .filter((candidate) => candidate.promised_next_step === "call back" || ["demo", "pricing"].includes(candidate.promised_next_step) && candidate.day30_result === "never followed up")
    .map((candidate) => ({
      candidate_id: candidate.candidate_id,
      name: candidate.name,
      clinic: candidate.clinic,
      owner: candidate.owner,
      call_when: candidate.call_when || (candidate.promised_next_step === "call back"
        ? "date from booth note"
        : candidate.promised_next_step === "demo"
          ? "Thursday after the draft"
          : "next week"),
      reason: candidate.booth_detail,
      why_this_result: candidate.why_this_result,
    }));
  const needsReview = withReviewReasons.filter((candidate) => candidate.review_reason);
  const suppressed = withReviewReasons.filter((candidate) => candidate.email_status.startsWith("suppressed"));
  return { readyDrafts, headsUps, callSchedule, needsReview, suppressed };
}

function renderReviewHtml(candidates, views, day30Summary, showSummary, unlinked, unresolvedSources, warnings, doNotContactUpdates) {
  const payload = JSON.stringify({
    all: candidates,
    drafts: views.readyDrafts,
    headsUps: views.headsUps,
    calls: views.callSchedule,
    review: views.needsReview,
    suppressed: views.suppressed,
    day30: day30Summary,
    showSummary,
    unlinked,
    sourceReview: unresolvedSources,
    warnings,
    doNotContact: doNotContactUpdates,
  }).replaceAll("</script", "<\\/script");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Sandbar show follow-up review</title>
  <style>
    :root { color-scheme: light; --ink:#17312f; --muted:#657673; --line:#dce5e2; --sea:#0d766e; --sand:#f5efe3; --warn:#9b5d00; --bad:#9b2c2c; }
    * { box-sizing:border-box; }
    body { margin:0; font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif; color:var(--ink); background:#f7faf9; }
    header { padding:24px clamp(18px,4vw,48px); background:linear-gradient(120deg,#e7f5f1,#f7f0e4); border-bottom:1px solid var(--line); }
    h1 { margin:0 0 6px; font-size:clamp(24px,4vw,38px); }
    header p { margin:0; color:var(--muted); }
    main { padding:22px clamp(12px,3vw,40px) 48px; }
    .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin-bottom:18px; }
    .card { background:white; border:1px solid var(--line); border-radius:12px; padding:14px; box-shadow:0 2px 8px #17312f0a; }
    .card strong { display:block; font-size:25px; }
    .card span { color:var(--muted); }
    nav { display:flex; gap:8px; flex-wrap:wrap; margin:12px 0; }
    button { border:1px solid var(--line); background:white; color:var(--ink); border-radius:9px; padding:9px 12px; cursor:pointer; }
    button.active { background:var(--sea); color:white; border-color:var(--sea); }
    input { width:min(420px,100%); padding:10px 12px; border:1px solid var(--line); border-radius:9px; margin-bottom:12px; }
    .table-wrap { overflow:auto; background:white; border:1px solid var(--line); border-radius:12px; }
    table { width:100%; border-collapse:collapse; min-width:900px; }
    th,td { padding:10px 12px; text-align:left; border-bottom:1px solid var(--line); vertical-align:top; }
    th { position:sticky; top:0; background:#edf5f2; z-index:1; }
    tr:last-child td { border-bottom:0; }
    .hot { color:var(--bad); font-weight:700; } .warm { color:var(--warn); font-weight:700; } .complete { color:var(--sea); font-weight:700; }
    .reviewed-button { white-space:nowrap; color:var(--sea); font-weight:700; }
    .draft { max-width:430px; white-space:pre-line; }
    details { max-width:460px; } summary { cursor:pointer; color:var(--sea); }
    .notice { background:#fff8e8; border:1px solid #ead6a5; padding:12px 14px; border-radius:10px; margin:12px 0; }
    .explain { background:white; border:1px solid var(--line); padding:12px 14px; border-radius:10px; margin:12px 0; }
    .explain strong { display:block; margin-bottom:4px; }
    .explain p { margin:0; color:var(--muted); }
    @media (max-width:700px){ th,td{padding:8px;font-size:13px} main{padding-inline:8px} }
  </style>
</head>
<body>
  <header><h1>Sandbar show follow-up review</h1><p>Human review required. Nothing on this page sends an email.</p></header>
  <main>
    <section class="cards" id="summary"></section>
    <div class="notice">Before approving drafts, Erin must mark known existing customers and historical unsubscribers. Those reference lists were not supplied to this tool.</div>
    <div id="warnings"></div>
    <nav id="tabs"></nav>
    <div class="explain"><strong id="viewTitle">Everyone from the show</strong><p id="viewHelp">One row for every real conversation, including people who should not receive a new note.</p></div>
    <div class="explain"><strong>What the attention labels mean</strong><p><b>Hot</b>: an important follow-up is still open. <b>Warm</b>: look next because the clinic has several locations or uses one of the named systems. <b>Standard</b>: a real conversation without an urgent request. <b>Complete</b>: the requested demo is already booked, so no sales follow-up is needed.</p></div>
    <div class="explain"><strong>Clear finished rows</strong><p>Select <b>Mark reviewed</b> to hide a finished person from this on-screen list. Running the files again rebuilds the complete record.</p></div>
    <input id="search" type="search" placeholder="Search name, clinic, action or source ID">
    <div class="table-wrap"><table><thead id="head"></thead><tbody id="body"></tbody></table></div>
  </main>
  <script>
    const data=${payload};
    const views=[['all','Everyone'],['review','Stop and check'],['headsUps','No new email draft'],['calls','Calls to make'],['drafts','Follow-up still needed'],['sourceReview',"Conversation notes we couldn't match"],['suppressed','Do not contact'],['doNotContact','Removal requests'],['unlinked',"Activity we couldn't match"],['showSummary','30-day summary']];
    const viewDescriptions={all:'One row for every real conversation. The Prepared email draft column shows the actual text whenever a safe draft is available.',review:'Do not contact these people yet. The What needs checking column states the exact problem to resolve first.',headsUps:'No ordinary new email draft is needed because something already happened or a safety rule applies.',calls:'Calls that Owen or Nadia promised or should make, with the timing and reason.',drafts:'The actual email text Owen or Nadia can read, edit and manually send. Nothing sends from this page.',sourceReview:"Conversation notes that did not contain enough information to attach to one person safely.",suppressed:'People who should not receive sales follow-up.',doNotContact:'Requests to stop contact that must be kept for future shows.',unlinked:"After-show events that could not be connected to one booth conversation safely.",showSummary:'What happened by day 30. Booked demos are early results, not revenue.'};
    let active='all';
    const reviewed=new Set();
    const reviewKey=row=>String(row.candidate_id||row.name+'|'+row.clinic);
    const preferred={all:['name','clinic','priority','priority_reason','email','owner','promised_next_step','day30_result','draft','why_this_result','source_rows','match_reasons','review_action'],drafts:['name','clinic','priority','priority_reason','owner','email','draft','why_this_result'],headsUps:['name','clinic','priority','owner','day30_result','why_this_result'],calls:['name','clinic','priority','owner','call_when','why_this_result'],review:['name','clinic','priority','why_this_result','review_reason','source_rows','match_reasons'],sourceReview:['source_text','best_guess_name','best_guess_clinic','reason','decision'],suppressed:['name','clinic','why_this_result','source_rows'],doNotContact:['name','email','clinic','date_time','reason'],unlinked:['date_time','event','name','clinic','detail','match_reason'],showSummary:['metric','value','note']};
    const columnLabels={name:'Person',clinic:'Clinic',priority:'Current attention',priority_reason:'Why this status',email:'Email',owner:'Who handles it',promised_next_step:'What they asked for',day30_result:'Result after 30 days',why_this_result:'Why the tool chose this',source_rows:'Records used',match_reasons:'Why records were joined',draft:'Suggested message',call_when:'When to call',review_reason:'What needs checking',source_text:'Unmatched conversation note',best_guess_name:'Best name guess',best_guess_clinic:'Best clinic guess',reason:'Reason',decision:'Decision',date_time:'Date',event:'What happened',detail:'Details',match_reason:'Why it was not linked',metric:'Measure',value:'Result',note:'What it means',review_action:'Finished reviewing?'};
    const valueLabels={'hot':'Hot—look first','warm':'Warm—look next','cold':'Standard','complete':'Complete—no follow-up','trial':'Trial started','demo':'Demo booked','call back':'call later','thank-you note':'short follow-up note','send info':'send requested information','no reply':'Contacted, no result','never followed up':'Not contacted','unknown: activity missing':'Unknown—activity file missing','eligible pending human check':'allowed after a person checks it','check first: after-show activity missing':'check earlier activity first'};
    const escapeHtml=value=>String(value??'').replace(/[&<>\"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[ch]));
    const friendlyValue=value=>valueLabels[String(value??'')]||value;
    function renderSummary(){
      const counts=[['People spoken with',data.all.length],['Follow-up still needed',data.drafts.length],['Calls to make',data.calls.length],['Stop and check',data.review.length],...data.day30.map(x=>[friendlyValue(x.status),x.count])];
      document.querySelector('#summary').innerHTML=counts.map(([label,count])=>'<div class="card"><strong>'+count+'</strong><span>'+escapeHtml(label)+'</span></div>').join('');
    }
    function renderTabs(){document.querySelector('#tabs').innerHTML=views.map(([key,label])=>'<button data-key="'+key+'" class="'+(key===active?'active':'')+'">'+escapeHtml(label)+' ('+data[key].length+')</button>').join(''); const current=views.find(([key])=>key===active); document.querySelector('#viewTitle').textContent=current?.[1]||''; document.querySelector('#viewHelp').textContent=viewDescriptions[active]||''; document.querySelectorAll('nav button').forEach(button=>button.onclick=()=>{active=button.dataset.key;renderTabs();renderTable();});}
    function renderTable(){
      const query=document.querySelector('#search').value.toLowerCase();
      const rows=data[active].filter(row=>JSON.stringify(row).toLowerCase().includes(query)).filter(row=>active!=='all'||!reviewed.has(reviewKey(row)));
      const columns=preferred[active]||Object.keys(rows[0]||{});
      document.querySelector('#head').innerHTML='<tr>'+columns.map(column=>'<th>'+escapeHtml(columnLabels[column]||column.replaceAll('_',' '))+'</th>').join('')+'</tr>';
      document.querySelector('#body').innerHTML=rows.map(row=>'<tr>'+columns.map(column=>{if(column==='review_action')return '<td><button class="reviewed-button" data-review="'+escapeHtml(reviewKey(row))+'">Mark reviewed</button></td>'; const value=friendlyValue(row[column]??''); if(column==='match_reasons'||column==='activity_match_reasons')return '<td><details><summary>Why were these records combined?</summary>'+escapeHtml(value)+'</details></td>'; const className=column==='draft'?'draft':column==='priority'?(row.priority==='hot'?'hot':row.priority==='warm'?'warm':row.priority==='complete'?'complete':''):''; return '<td class="'+className+'">'+escapeHtml(value)+'</td>';}).join('')+'</tr>').join('');
      document.querySelectorAll('[data-review]').forEach(button=>button.onclick=()=>{reviewed.add(button.dataset.review);renderTable();});
    }
    document.querySelector('#warnings').innerHTML=data.warnings.map(item=>'<div class="notice"><strong>Input warning:</strong> '+escapeHtml(item.warning)+'</div>').join('');
    document.querySelector('#search').addEventListener('input',renderTable); renderSummary();renderTabs();renderTable();
  </script>
</body>
</html>`;
}

function processShow(scans, notes) {
  const about = String(notes.about ?? "");
  const locationMatch = about.match(/\(([^,()]+),\s*\d{4}-\d{2}-\d{2}/);
  const showLocation = locationMatch ? locationMatch[1].trim() : "";
  const scanSources = scans.map(makeScan);
  const cardSources = notes.cards.map(makeCard);
  const voiceSources = notes.voice_notes.map((row) => makeNarrative(row, "voice", "note_id", "transcript"));
  const listSources = notes.owen_list.lines.map((row) => makeNarrative(row, "list", "line_id", "text"));

  const meaningfulScans = scanSources.filter(isMeaningfulScan);
  const blankScans = scanSources.filter((source) => !normalize(source.text) && !isExplicitNonConversation(source));
  const entities = mergeSeeds([...cardSources, ...meaningfulScans]);

  for (const source of voiceSources) {
    if (!attachNarrative(source, entities)) entities.push(newEntity(source));
  }
  for (const source of blankScans) {
    const narrativeOnly = entities.filter((entity) => !entity.sources.some((item) => item.type === "scan" || item.type === "card"));
    if (!attachBest(source, narrativeOnly, matchScore, 60, 3)) attachBest(source, entities, matchScore, 75, 5);
  }
  const unresolvedLists = [];
  for (const source of listSources) if (!attachNarrative(source, entities)) unresolvedLists.push(source);

  const seededEntities = entities.filter((entity) => entity.sources.some((source) => source.type === "scan" || source.type === "card"));
  const narrativeOnlyEntities = entities.filter((entity) => !entity.sources.some((source) => source.type === "scan" || source.type === "card"));
  const unresolvedSources = [];
  for (const entity of narrativeOnlyEntities) {
    for (const source of entity.sources) {
      if (!attachNarrativeLoose(source, seededEntities)) unresolvedSources.push(bestNarrativeSuggestion(source, seededEntities));
    }
  }
  for (const source of unresolvedLists) {
    if (!attachNarrativeLoose(source, seededEntities)) unresolvedSources.push(bestNarrativeSuggestion(source, seededEntities));
  }

  const candidates = entities
    .filter((entity) => entity.sources.some((source) => source.type === "scan" || source.type === "card"))
    .map((entity, index) => classify(entity, index, showLocation));
  return { candidates, unresolvedSources };
}

function evaluate(candidates, recount) {
  const expectedBySource = new Map();
  for (const row of recount) {
    for (const sourceId of row.source_rows.split(";").map((item) => item.trim())) {
      const linked = expectedBySource.get(sourceId) ?? [];
      linked.push(row);
      expectedBySource.set(sourceId, linked);
    }
  }

  let matchedPeople = 0;
  let exactSourceGroups = 0;
  let priorityCorrect = 0;
  let stepCorrect = 0;
  let day30Correct = 0;
  let emailStatusCorrect = 0;
  const details = [];
  const usedExpected = new Set();

  for (const candidate of candidates) {
    const sourceIds = candidate.source_rows.split(";").map((item) => item.trim()).filter(Boolean);
    const votes = new Map();
    for (const sourceId of sourceIds) {
      const expectedRows = expectedBySource.get(sourceId) ?? [];
      for (const expected of expectedRows) votes.set(expected.person_id, (votes.get(expected.person_id) ?? 0) + 1);
    }
    const winner = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!winner) continue;
    const expected = recount.find((row) => row.person_id === winner[0]);
    usedExpected.add(expected.person_id);
    matchedPeople += 1;
    const expectedIds = expected.source_rows.split(";").map((item) => item.trim()).sort();
    const predictedIds = sourceIds.sort();
    const exact = JSON.stringify(expectedIds) === JSON.stringify(predictedIds);
    if (exact) exactSourceGroups += 1;
    if (candidate.priority === expected.priority) priorityCorrect += 1;
    if (candidate.promised_next_step === expected.promised_next_step) stepCorrect += 1;
    if (candidate.day30_result && candidate.day30_result === expected.day30_result) day30Correct += 1;
    const expectedEmailStatus = expected.email_ok === "yes"
      ? "eligible"
      : expected.email_ok.startsWith("check")
        ? "check first"
        : expected.email_ok.startsWith("personal")
          ? "personal reply only"
          : "suppressed";
    const predictedEmailStatus = candidate.email_status.startsWith("eligible")
      ? "eligible"
      : candidate.email_status.startsWith("check")
        ? "check first"
        : candidate.email_status.startsWith("personal")
          ? "personal reply only"
          : "suppressed";
    if (expectedEmailStatus === predictedEmailStatus) emailStatusCorrect += 1;
    details.push({
      candidate_id: candidate.candidate_id,
      expected_person_id: expected.person_id,
      expected_name: expected.name,
      exact_source_group: exact,
      priority_correct: candidate.priority === expected.priority,
      step_correct: candidate.promised_next_step === expected.promised_next_step,
      day30_correct: candidate.day30_result ? candidate.day30_result === expected.day30_result : null,
      email_status_correct: expectedEmailStatus === predictedEmailStatus,
    });
  }

  return {
    summary: {
      predicted_candidates: candidates.length,
      expected_people: recount.length,
      expected_people_touched: usedExpected.size,
      candidates_with_expected_match: matchedPeople,
      exact_source_groups: exactSourceGroups,
      priority_correct: priorityCorrect,
      step_correct: stepCorrect,
      day30_correct: day30Correct,
      email_status_correct: emailStatusCorrect,
    },
    details,
  };
}

function main() {
  const dataDirectory = process.argv[2] || "C:\\Users\\Greyson Malabanan\\Downloads";
  const outputDirectory = process.argv[3] || path.join(__dirname, "processor-output");
  const scanPath = path.join(dataDirectory, "badge-scans.csv");
  const notesPath = path.join(dataDirectory, "booth-notes.json");
  if (!fs.existsSync(scanPath)) throw new Error("Missing badge-scans.csv. Stop: the share flags are required before any drafts can be reviewed.");
  if (!fs.existsSync(notesPath)) throw new Error("Missing booth-notes.json. Stop: cards, voice notes and Owen's list are required.");
  const scans = parseCsv(fs.readFileSync(scanPath, "utf8"));
  requireColumns(scans, ["scan_id", "first_name", "last_name", "company", "email", "phone", "share_with_exhibitors", "notes"], "badge-scans.csv");
  const notes = JSON.parse(fs.readFileSync(notesPath, "utf8"));
  requireNotesShape(notes);
  const { candidates: baseCandidates, unresolvedSources } = processShow(scans, notes);
  const activityPath = path.join(dataDirectory, "after-show-activity.csv");
  const activitySupplied = fs.existsSync(activityPath);
  const activity = activitySupplied ? parseCsv(fs.readFileSync(activityPath, "utf8")) : [];
  if (activitySupplied) requireColumns(activity, ["event_id", "date_time", "event", "channel", "name", "email", "clinic", "detail"], "after-show-activity.csv");
  const warnings = [];
  if (!activitySupplied) warnings.push({ warning: "after-show-activity.csv was not supplied. Owen may already have written to his contacts; verify sent mail and bookings before using any draft." });
  const { enriched, unlinked } = attachActivity(baseCandidates, activity);
  const doNotContactUpdates = activity
    .filter((event) => /remove me|unsubscribe|do not email|take me off/.test(normalize(event.detail)))
    .map((event) => ({
      name: event.name,
      email: event.email,
      clinic: event.clinic,
      event_id: event.event_id,
      date_time: event.date_time,
      reason: event.detail,
    }));
  const candidates = activitySupplied ? enriched : enriched.map((candidate) => candidate.owner === "Owen"
    ? { ...candidate, heads_up: "After-show activity was not supplied. Owen may already have written; verify before using this draft." }
    : candidate);
  const views = outputViews(candidates);
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "all-conversations.csv"), toCsv(candidates));
  fs.writeFileSync(path.join(outputDirectory, "ready-drafts.csv"), toCsv(views.readyDrafts));
  fs.writeFileSync(path.join(outputDirectory, "heads-up-only.csv"), toCsv(views.headsUps));
  fs.writeFileSync(path.join(outputDirectory, "call-schedule.csv"), toCsv(views.callSchedule));
  fs.writeFileSync(path.join(outputDirectory, "needs-review.csv"), toCsv(views.needsReview));
  fs.writeFileSync(path.join(outputDirectory, "suppressed.csv"), toCsv(views.suppressed));
  fs.writeFileSync(path.join(outputDirectory, "unlinked-activity.csv"), toCsv(unlinked));
  fs.writeFileSync(path.join(outputDirectory, "unresolved-source-notes.csv"), toCsv(unresolvedSources));
  fs.writeFileSync(path.join(outputDirectory, "run-warnings.csv"), toCsv(warnings));
  fs.writeFileSync(path.join(outputDirectory, "do-not-contact-updates.csv"), toCsv(doNotContactUpdates));
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
  fs.writeFileSync(path.join(outputDirectory, "audit-log.csv"), toCsv(auditRows));

  const day30Summary = ["trial", "demo", "no reply", "never followed up"].map((status) => ({
    status,
    count: candidates.filter((candidate) => candidate.day30_result === status).length,
    percent_of_real_conversations: ((candidates.filter((candidate) => candidate.day30_result === status).length / candidates.length) * 100).toFixed(1) + "%",
  }));
  fs.writeFileSync(path.join(outputDirectory, "day30-report.csv"), toCsv(day30Summary));
  const trialCount = candidates.filter((candidate) => candidate.day30_result === "trial").length;
  const demoCount = candidates.filter((candidate) => candidate.day30_result === "demo").length;
  const contactedCount = candidates.filter((candidate) => candidate.successfully_contacted === "yes").length;
  const showCost = 9000;
  const showSummary = [
    { metric: "show cost", value: showCost, note: "Client estimate" },
    { metric: "real conversations", value: candidates.length, note: "Excludes drive-bys" },
    { metric: "successfully contacted", value: contactedCount, note: `${((contactedCount / candidates.length) * 100).toFixed(1)}% coverage` },
    { metric: "trials started", value: trialCount, note: `${((trialCount / candidates.length) * 100).toFixed(1)}% of conversations` },
    { metric: "demos booked", value: demoCount, note: `${((demoCount / candidates.length) * 100).toFixed(1)}% of conversations; booked, not necessarily completed` },
    { metric: "trial or demo", value: trialCount + demoCount, note: `${(((trialCount + demoCount) / candidates.length) * 100).toFixed(1)}% of conversations` },
    { metric: "cost per booked demo", value: demoCount ? (showCost / demoCount).toFixed(2) : "n/a", note: "Does not measure attendance or revenue" },
    { metric: "cost per trial or booked demo", value: trialCount + demoCount ? (showCost / (trialCount + demoCount)).toFixed(2) : "n/a", note: "Does not measure paid conversion" },
  ];
  fs.writeFileSync(path.join(outputDirectory, "show-summary.csv"), toCsv(showSummary));
  fs.writeFileSync(path.join(outputDirectory, "review.html"), renderReviewHtml(candidates, views, day30Summary, showSummary, unlinked, unresolvedSources, warnings, doNotContactUpdates));

  const recountPath = path.join(dataDirectory, "erin-recount-toronto.csv");
  if (fs.existsSync(recountPath)) {
    const recount = parseCsv(fs.readFileSync(recountPath, "utf8"));
    const evaluation = evaluate(candidates, recount);
    fs.writeFileSync(path.join(outputDirectory, "evaluation.json"), JSON.stringify(evaluation, null, 2));
    console.log(JSON.stringify(evaluation.summary, null, 2));
  } else {
    console.log(JSON.stringify({ predicted_candidates: candidates.length }, null, 2));
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`STOP: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { parseCsv, processShow, evaluate, normalize };



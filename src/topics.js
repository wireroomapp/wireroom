// Topic tags for reports: CONFLICT, CYBER, TERRORISM.
//
// Tags come from keywords in the headline and summary (in English when a translation exists).
// They are a reading aid for filtering, not a verdict: a report tagged TERRORISM is *about*
// terrorism (an attack, a designation, a court case), not proof that an attack happened.
// The app says so wherever the tags appear.

export const TOPICS = [
  { id: "conflict", label: "CONFLICT" },
  { id: "cyber", label: "CYBER" },
  { id: "terrorism", label: "TERRORISM" },
];

// Whole-word patterns, matched case-insensitively. Kept conservative: words that are
// often used figuratively ("battle", "war on inflation", "attack" alone) are left out.
const PATTERNS = {
  conflict: [
    /\b(air ?strikes?|airstrikes?|drone strikes?|missile (strikes?|attacks?|launch(es)?)|shelling|artillery|ceasefire|cease-fire|truce|(armed|border|deadly) clashes?|armed (conflict|groups?)|insurg(ents?|ency)|militants?|rebels?|counter-?offensive|full-scale invasion|invasion of|incursions?|front ?line|troops?|military operation|war crimes?|casualties|killed in (an? )?(attack|strike|fighting)|fighting|warplanes?|naval (clash|blockade)|blockade)\b/i,
    /\b(war) (in|with|on (ukraine|gaza|israel|iran|russia))\b/i,
    /\b(ukraine war|gaza war|civil war)\b/i,
  ],
  cyber: [
    /\b(cyber ?attacks?|cyber-attacks?|cyber ?security|cybersecurity|cyber ?(espionage|operations?|threats?|incidents?|defen[cs]e)|ransomware|malware|spyware|hack(ers?|ing|ed)|data breach(es)?|ddos|phishing|zero-day|vulnerabilit(y|ies)|exploited|botnet|apt ?\d+|threat actors?|cisa|ncsc)\b/i,
  ],
  terrorism: [
    // Words about terrorism itself, plus groups on the UN Security Council's terrorism
    // sanctions lists. Groups whose status is politically contested between governments are
    // deliberately not used as keywords: Wire Room doesn't label groups, sources do.
    /\b(terror(ism|ist|ists)?|counter-?terror(ism)?|suicide (bomb(er|ing)s?|attacks?)|car bomb(s|ing)?|ieds?|improvised explosive|violent extremis(m|ts?)|isis|isil|islamic state|daesh|al-?qaeda|al-?shabaab|boko haram|ttp|tehreek-e-taliban|lashkar-e-tai?ba|jaish-e-mohammed)\b/i,
  ],
};

export function topicsFor(item) {
  if (!item) return [];
  const parts = [item.headline, item.summary];
  if (item.tr) parts.push(item.tr.headline, item.tr.summary);
  const text = parts.filter(Boolean).join(" ");
  const out = new Set(Array.isArray(item.topics) ? item.topics : []); // tags set at collection (e.g. cyber agencies)
  if (text) for (const [id, pats] of Object.entries(PATTERNS)) if (pats.some((p) => p.test(text))) out.add(id);
  return TOPICS.map((t) => t.id).filter((id) => out.has(id));
}

/**
 * Scoring is code, not model output: every answer adds a piece of evidence, and the Worker turns the
 * evidence into positions and confidence, decides which domains still need a question, and knows when to stop.
 */
import type { Evidence, Turn } from "./types";

export const SCORING_VERSION = "2";

export const CONF = 0.7; // a domain is settled at this confidence...
export const MIN_EVIDENCE = 2; // ...and never on a single answer
const SINGLE_CAP = 0.6; // the most confidence one answer can carry
export const TEXT_STRENGTH_CAP = 0.5; // a classified free-text answer stays tentative until a second answer agrees
const GROWTH = 1.1; // how fast confidence grows with accumulated strength

export type DomainScore = { position: number | null; confidence: number; count: number };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Picking one of two sides tells which way a person leans, not how far: someone at 40 and someone at 5 choose the same
 * option. So an option's position is pulled toward the middle by how coarse the widget is, which puts it near the
 * middle of the range of people who would pick it. Sliders are taken as given.
 */
const REACH: Record<"either" | "options", number> = { either: 0.7, options: 0.88 };
export function optionEvidence(domain: string, widget: "either" | "options" | "slider", position: number, strength: number): Evidence {
  const reach = widget === "slider" ? 1 : REACH[widget];
  return { domain, position: clamp(Math.round(50 + (position - 50) * reach), 0, 100), strength: clamp(strength, 0.2, 1), kind: "option" };
}

/** A slider near the middle says little; near an end it says a lot. */
export function sliderEvidence(domain: string, value: number): Evidence {
  const v = clamp(Math.round(value), 0, 100);
  return { domain, position: v, strength: 0.5 + (0.4 * Math.abs(v - 50)) / 50, kind: "slider" };
}

export function summarize(domains: readonly string[], evidence: Evidence[]): Record<string, DomainScore> {
  const out: Record<string, DomainScore> = {};
  for (const d of domains) {
    const items = evidence.filter((e) => e.domain === d);
    const weight = items.reduce((t, e) => t + e.strength, 0);
    if (!items.length || weight <= 0) {
      out[d] = { position: null, confidence: 0, count: 0 };
      continue;
    }
    const mean = items.reduce((t, e) => t + e.strength * e.position, 0) / weight;
    // answers that pull opposite ways lower the confidence instead of averaging into a false "moderate"
    const spread = items.reduce((t, e) => t + e.strength * Math.abs(e.position - mean), 0) / weight / 50;
    const agreement = 1 - clamp(spread, 0, 1);
    const grown = 1 - Math.exp(-GROWTH * weight);
    const base = items.length === 1 ? Math.min(SINGLE_CAP, grown) : grown;
    out[d] = { position: Math.round(mean), confidence: Number((base * (0.4 + 0.6 * agreement)).toFixed(3)), count: items.length };
  }
  return out;
}

export const evidenceOf = (turns: Turn[]): Evidence[] => turns.map((t) => t.evidence).filter((e): e is Evidence => e !== null);

const settled = (s: DomainScore) => s.count >= MIN_EVIDENCE && s.confidence >= CONF;

export function isDone(domains: readonly string[], turns: Turn[], maxQuestions: number): boolean {
  if (turns.length >= maxQuestions) return true;
  const scores = summarize(domains, evidenceOf(turns));
  return domains.every((d) => settled(scores[d]));
}

/** The next domains to ask about: unsettled ones, least-asked first, then least certain. `rank` breaks ties (random in production). */
export function nextDomains(domains: readonly string[], turns: Turn[], size: number, rank: (d: string) => number = () => Math.random()): string[] {
  const scores = summarize(domains, evidenceOf(turns));
  const asked = (d: string) => turns.filter((t) => t.q.domain === d).length;
  const tie = new Map(domains.map((d) => [d, rank(d)]));
  const order = (pool: readonly string[]) =>
    [...pool].sort((a, b) => asked(a) - asked(b) || scores[a].confidence - scores[b].confidence || tie.get(a)! - tie.get(b)!);
  const open = order(domains.filter((d) => !settled(scores[d])));
  const picked = open.slice(0, size);
  // fewer open domains than the batch: the batch simply gets smaller, never a repeat of one domain
  return picked.length ? picked : order(domains).slice(0, 1);
}

export function progress(domains: readonly string[], turns: Turn[], maxQuestions: number): number {
  const scores = summarize(domains, evidenceOf(turns));
  const byDomain = domains.reduce((t, d) => t + (settled(scores[d]) ? 1 : Math.min(0.85, scores[d].count * 0.45)), 0) / domains.length;
  return Number(clamp(Math.max(byDomain, turns.length / maxQuestions), 0, 1).toFixed(3));
}

export const positionsOf = (domains: readonly string[], turns: Turn[]): Record<string, number | null> => {
  const scores = summarize(domains, evidenceOf(turns));
  return Object.fromEntries(domains.map((d) => [d, scores[d].position]));
};

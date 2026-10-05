/** Drafted questions: the checks code can make before the reviewer model is asked, the curated fallback, and what the browser may see. */
import { LIBRARY } from "./library";
import { hasKids, type Draft, type PlanLine } from "./prompts";
import type { Asked, Ctx, Locale } from "./types";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
const clean = (t: unknown, max: number) => String(t ?? "").replace(/\s*[—–]\s*/g, ", ").replace(/\s+/g, " ").trim().slice(0, max);
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

const TRAILING_QUESTION = /(what'?s your take|what do you think|how do you feel|which (approach|side|option)[^.?!]*)\??\s*$/i;
const THEIR_CHILD = /\byour (kids?|child(ren)?|son|daughter|toddler|baby|teen(ager)?)\b/i;

/** Structural problems that need no judgement. An empty list means the draft may go to the reviewer. */
export function checkDraft(d: Draft, line: PlanLine, c: Ctx, locale: Locale): string[] {
  const problems: string[] = [];
  if (d.domain !== line.domain[0]) problems.push(`it is about ${d.domain}, but the plan asks for ${line.domain[0]}`);
  const prompt = clean(d.prompt, 700);
  if (!prompt) problems.push("the prompt is empty");
  if (locale === "zh" ? prompt.length > 170 : words(prompt) > 70) problems.push("the prompt is too long");
  if (TRAILING_QUESTION.test(prompt)) problems.push("it ends with a tacked-on question");
  if (c.family && !hasKids(c) && THEIR_CHILD.test(prompt)) problems.push("it gives the person a child they do not have");
  const positions = d.options.map((o) => o.position);
  const type = widgetOf(d);
  if (type === "slider") {
    if (!clean(d.left, 60) || !clean(d.right, 60)) problems.push("a slider needs a left and a right label, a choice needs 2 to 4 options");
  } else {
    if (d.options.length > 4) problems.push("at most 4 options");
    if (d.options.some((o) => !clean(o.text, 200))) problems.push("an option is empty");
    if (type === "either" ? !(Math.min(...positions) < 40 && Math.max(...positions) > 60) : !(Math.min(...positions) < 35 && Math.max(...positions) > 65)) problems.push("the options do not reach both sides of the line");
  }
  return problems;
}

/** The widget a draft really is, whatever label the model gave it: the rotation is a nicety, the option count is a fact. */
export const widgetOf = (d: Draft): Asked["type"] => (d.options.length >= 3 ? "options" : d.options.length === 2 ? "either" : "slider");

export function toAsked(d: Draft, id: number): Asked {
  const type = widgetOf(d);
  const slider = type === "slider";
  return {
    id,
    domain: d.domain,
    type,
    prompt: clean(d.prompt, 700),
    options: slider ? [] : d.options.slice(0, 4).map((o) => ({ text: clean(o.text, 200), position: Math.round(clamp(o.position, 0, 100)), strength: Number(clamp(o.strength, 0.3, 1).toFixed(2)) })),
    left: slider ? clean(d.left, 60) : "",
    right: slider ? clean(d.right, 60) : "",
    source: "ai",
  };
}

/** A curated question for this domain the interview has not used yet, preferring the planned widget. */
export function fromLibrary(line: PlanLine, used: string[], locale: Locale, id: number): { q: Asked; key: string } | null {
  const pool = LIBRARY.filter((x) => x.domain === line.domain[0] && !used.includes(x.key));
  const item = pool.find((x) => x.type === line.type) ?? pool[0];
  if (!item) return null;
  const t = item.text[locale] ?? item.text.en;
  return {
    key: item.key,
    q: {
      id,
      domain: item.domain,
      type: item.type,
      prompt: t.prompt,
      options: (t.options ?? []).map((text, i) => ({ text, position: item.o[i][0], strength: item.o[i][1] })),
      left: t.left ?? "",
      right: t.right ?? "",
      source: "library",
    },
  };
}

/** What the browser gets: the text of a question, never the scores behind its options. */
export const publicView = (q: Asked) => ({ id: q.id, domain: q.domain, type: q.type, prompt: q.prompt, options: q.options.map((o) => o.text), left: q.left, right: q.right });

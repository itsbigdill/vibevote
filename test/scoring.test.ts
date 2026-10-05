import { describe, expect, it } from "vitest";
import { CONF, MIN_EVIDENCE, evidenceOf, isDone, nextDomains, optionEvidence, positionsOf, progress, sliderEvidence, summarize } from "../src/scoring";
import type { Asked, Evidence, Turn } from "../src/types";

const DOMAINS = ["economy", "welfare", "liberty"];
const ev = (domain: string, position: number, strength = 0.8): Evidence => ({ domain, position, strength, kind: "option" });
const q = (domain: string, id = 1): Asked => ({ id, domain, type: "either", prompt: "p", options: [], left: "", right: "", source: "ai" });
const turn = (e: Evidence | null, domain = e?.domain ?? "economy"): Turn => ({ q: q(domain), reply: e ? { kind: "option", index: 0 } : { kind: "text", text: "x" }, evidence: e, classified: true });

describe("summarize", () => {
  it("reports nothing for a domain without evidence", () => {
    expect(summarize(DOMAINS, []).economy).toEqual({ position: null, confidence: 0, count: 0 });
  });

  it("never lets a single answer settle a domain, however firm", () => {
    const one = summarize(DOMAINS, [ev("economy", 90, 1)]).economy;
    expect(one.count).toBe(1);
    expect(one.confidence).toBeLessThan(CONF);
  });

  it("settles a domain on two firm answers that agree", () => {
    const two = summarize(DOMAINS, [ev("economy", 80), ev("economy", 85)]).economy;
    expect(two.confidence).toBeGreaterThanOrEqual(CONF);
    expect(two.position).toBeGreaterThanOrEqual(80);
    expect(two.position).toBeLessThanOrEqual(85);
  });

  it("stays unsure when two answers pull opposite ways, instead of calling the person moderate", () => {
    const split = summarize(DOMAINS, [ev("economy", 5), ev("economy", 95)]).economy;
    expect(split.position).toBe(50);
    expect(split.confidence).toBeLessThan(0.5);
  });

  it("needs more than two hedged answers", () => {
    expect(summarize(DOMAINS, [ev("economy", 60, 0.4), ev("economy", 62, 0.4)]).economy.confidence).toBeLessThan(CONF);
    expect(summarize(DOMAINS, [ev("economy", 60, 0.4), ev("economy", 62, 0.4), ev("economy", 64, 0.5), ev("economy", 61, 0.5)]).economy.confidence).toBeGreaterThanOrEqual(CONF);
  });

  it("weights the mean by strength", () => {
    expect(summarize(DOMAINS, [ev("economy", 20, 1), ev("economy", 80, 0.25)]).economy.position).toBeLessThan(40);
  });
});

describe("optionEvidence", () => {
  it("pulls a two-way choice toward the middle more than a four-way one, and keeps the side", () => {
    const two = optionEvidence("economy", "either", 10, 0.8).position;
    const four = optionEvidence("economy", "options", 10, 0.8).position;
    expect(two).toBeGreaterThan(four);
    expect(four).toBeGreaterThan(10);
    expect(two).toBeLessThan(50);
    expect(optionEvidence("economy", "either", 90, 0.8).position).toBeGreaterThan(50);
    expect(optionEvidence("economy", "either", 50, 0.8).position).toBe(50);
  });
});

describe("sliderEvidence", () => {
  it("treats the middle as weak and the ends as strong", () => {
    expect(sliderEvidence("economy", 50).strength).toBeCloseTo(0.5);
    expect(sliderEvidence("economy", 0).strength).toBeCloseTo(0.9);
    expect(sliderEvidence("economy", 100).strength).toBeCloseTo(0.9);
  });
  it("clamps wild values", () => {
    expect(sliderEvidence("economy", 250).position).toBe(100);
    expect(sliderEvidence("economy", -4).position).toBe(0);
  });
});

describe("the interview loop", () => {
  it("is not done until every domain has enough agreeing evidence", () => {
    const turns = DOMAINS.flatMap((d) => [turn(ev(d, 70)), turn(ev(d, 75))]);
    expect(isDone(DOMAINS, turns.slice(0, 5), 20)).toBe(false);
    expect(isDone(DOMAINS, turns, 20)).toBe(true);
  });

  it("stops at the question limit whatever the confidence", () => {
    expect(isDone(DOMAINS, Array.from({ length: 20 }, () => turn(null)), 20)).toBe(true);
  });

  it("requires the minimum evidence count even at high confidence", () => {
    expect(MIN_EVIDENCE).toBeGreaterThanOrEqual(2);
  });

  it("asks first about what it knows least, and never the same domain twice in a batch", () => {
    const turns = [turn(ev("economy", 70)), turn(ev("economy", 72)), turn(ev("welfare", 30))];
    const next = nextDomains(DOMAINS, turns, 3, (d) => DOMAINS.indexOf(d));
    expect(next[0]).toBe("liberty");
    expect(next).not.toContain("economy");
    expect(new Set(next).size).toBe(next.length);
  });

  it("counts an own-words answer as asked even before it is classified", () => {
    const next = nextDomains(DOMAINS, [turn(null, "liberty")], 1, (d) => DOMAINS.indexOf(d));
    expect(next[0]).not.toBe("liberty");
  });

  it("ignores unclassified answers when scoring", () => {
    expect(evidenceOf([turn(null), turn(ev("economy", 10))])).toHaveLength(1);
    expect(positionsOf(DOMAINS, [turn(null, "welfare")]).welfare).toBeNull();
  });

  it("reports progress between 0 and 1 and reaches 1 only when done", () => {
    expect(progress(DOMAINS, [], 20)).toBe(0);
    const some = [turn(ev("economy", 70))];
    expect(progress(DOMAINS, some, 20)).toBeGreaterThan(0);
    expect(progress(DOMAINS, some, 20)).toBeLessThan(1);
    const all = DOMAINS.flatMap((d) => [turn(ev(d, 70)), turn(ev(d, 75))]);
    expect(progress(DOMAINS, all, 20)).toBe(1);
  });
});

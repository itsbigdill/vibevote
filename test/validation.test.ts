import { describe, expect, it } from "vitest";
import { LIBRARY } from "../src/library";
import { BadInput, DOMAIN_KEYS, planLines, readCtx, readLocale, readPortrait, readReplies, type Draft } from "../src/prompts";
import { checkDraft, fromLibrary, publicView, toAsked } from "../src/questions";
import { openState, readSession, sealState, sessionCookie } from "../src/session";
import type { Asked, Ctx, InterviewState } from "../src/types";

const ctx: Ctx = { state: "Ohio", age: "", gender: "", family: "Single, no kids", job: "welder" };
const either = (over: Partial<Draft> = {}): Draft => ({ domain: "economy", type: "either", prompt: "A plant may close unless the town helps it.", options: [{ text: "Let it close", position: 15, strength: 0.8 }, { text: "Help it stay", position: 85, strength: 0.8 }], left: "", right: "", ...over });
const line = (domain = "economy", turnsBefore = 0) => planLines(Array(turnsBefore).fill(null) as never, [domain])[0];

describe("input validation", () => {
  it("rejects an unknown state and keeps only known answers", () => {
    expect(() => readCtx({ state: "Atlantis" })).toThrow(BadInput);
    expect(readCtx({ state: "Ohio", age: "12", job: "  a   b ".repeat(40) })).toMatchObject({ state: "Ohio", age: "" });
    expect(readCtx({ state: "Ohio", job: "x".repeat(300) }).job.length).toBeLessThanOrEqual(80);
  });

  it("falls back to English for an unknown locale", () => {
    expect(readLocale("ru")).toBe("ru");
    expect(readLocale("xx")).toBe("en");
    expect(readLocale(undefined)).toBe("en");
  });

  const pending: Asked[] = [toAsked(either(), 1), { ...toAsked(either(), 2), type: "slider", options: [], left: "No deals", right: "Step in" }];

  it("accepts an option index, a slider value or own words, and nothing else", () => {
    expect(readReplies([{ id: 1, option: 1 }, { id: 2, value: 70.4 }], pending).map((x) => x.reply)).toEqual([{ kind: "option", index: 1 }, { kind: "slider", value: 70 }]);
    expect(readReplies([{ id: 1, text: "  my   own words " }], pending)[0].reply).toEqual({ kind: "text", text: "my own words" });
    expect(() => readReplies([{ id: 1, option: 2 }], pending)).toThrow(BadInput);
    expect(() => readReplies([{ id: 2, value: 140 }], pending)).toThrow(BadInput);
    expect(() => readReplies([{ id: 9, option: 0 }], pending)).toThrow(BadInput);
    expect(() => readReplies([{ id: 1, option: 0 }, { id: 1, option: 1 }], pending)).toThrow(BadInput);
    expect(() => readReplies([{ id: 1, option: 0 }], [])).toThrow(BadInput);
    expect(readReplies(undefined, pending)).toEqual([]);
  });

  it("keeps a shared portrait to its known fields", () => {
    const p = readPortrait({ title: "T", manifesto: "M", positions: { economy: 140, faith: "x" }, versions: { prompt_version: "2026-09-18.1", extra: "no" }, answers: ["secret"] });
    expect(p.positions.economy).toBe(100);
    expect(p.positions.faith).toBeNull();
    expect(p.versions.prompt_version).toBe("2026-09-18.1");
    expect(JSON.stringify(p)).not.toContain("secret");
    expect(() => readPortrait({ title: "", manifesto: "M" })).toThrow(BadInput);
  });
});

describe("draft checks", () => {
  it("passes a sound either/or", () => {
    expect(checkDraft(either(), line(), ctx, "en")).toEqual([]);
  });
  it("catches options on the same side, the wrong domain and a tacked-on question", () => {
    expect(checkDraft(either({ options: [{ text: "a", position: 70, strength: 1 }, { text: "b", position: 90, strength: 1 }] }), line(), ctx, "en").join()).toMatch(/both sides/);
    expect(checkDraft(either({ type: "options" }), line(), ctx, "en")).toEqual([]); // two options are an either/or whatever the label says
    expect(toAsked(either({ type: "options" }), 1).type).toBe("either");
    expect(checkDraft(either({ options: [], left: "", right: "" }), line(), ctx, "en").join()).toMatch(/slider needs/);
    expect(checkDraft(either({ domain: "faith" }), line(), ctx, "en").join()).toMatch(/plan asks for economy/);
    expect(checkDraft(either({ prompt: "The plant may close. What do you think?" }), line(), ctx, "en").join()).toMatch(/tacked-on/);
  });
  it("catches a child invented for someone without children", () => {
    expect(checkDraft(either({ prompt: "Your daughter's school may close unless taxes rise." }), line(), ctx, "en").join()).toMatch(/child/);
    expect(checkDraft(either({ prompt: "Your daughter's school may close unless taxes rise." }), line(), { ...ctx, family: "Parent of young kids" }, "en")).toEqual([]);
  });
  it("never shows the browser a hidden score", () => {
    const shown = JSON.stringify(publicView(toAsked(either(), 3)));
    expect(shown).not.toMatch(/position|strength/);
    expect(shown).toContain("Let it close");
  });
  it("clamps what the model returns", () => {
    const q = toAsked(either({ options: [{ text: "a — b", position: 300, strength: 9 }, { text: "c", position: -5, strength: 0 }] }), 1);
    expect(q.options.map((o) => o.position)).toEqual([100, 0]);
    expect(q.options.map((o) => o.strength)).toEqual([1, 0.3]);
    expect(q.options[0].text).toBe("a, b");
  });
});

describe("the curated library", () => {
  it("has two questions for every domain, in all five languages, with matching scores", () => {
    for (const d of DOMAIN_KEYS) expect(LIBRARY.filter((x) => x.domain === d)).toHaveLength(2);
    for (const item of LIBRARY) {
      for (const locale of ["en", "es", "pt", "zh", "ru"] as const) {
        const t = item.text[locale];
        expect(t.prompt.length).toBeGreaterThan(10);
        if (item.type === "slider") expect(t.left && t.right).toBeTruthy();
        else expect(t.options).toHaveLength(item.o.length);
      }
      if (item.type !== "slider") expect(Math.min(...item.o.map((o) => o[0])) < 40 && Math.max(...item.o.map((o) => o[0])) > 60).toBe(true);
    }
  });
  it("does not repeat a question inside one interview", () => {
    const first = fromLibrary(line("faith"), [], "ru", 1)!;
    const second = fromLibrary(line("faith"), [first.key], "ru", 2)!;
    expect(second.key).not.toBe(first.key);
    expect(fromLibrary(line("faith"), [first.key, second.key], "ru", 3)).toBeNull();
    expect(first.q.source).toBe("library");
  });
});

describe("sessions and the state token", () => {
  const state: InterviewState = { v: 1, sid: "abc", started: Date.now(), ctx, locale: "en", turns: [], pending: [toAsked(either(), 1)], library: [] };

  it("round-trips a session cookie and rejects a forged or expired one", async () => {
    const cookie = (await sessionCookie("s3cret", "abc", true)).split(";")[0];
    expect(await readSession("s3cret", cookie)).toBe("abc");
    expect(await readSession("other", cookie)).toBeNull();
    expect(await readSession("s3cret", cookie.replace("abc", "abd"))).toBeNull();
    expect(await readSession("s3cret", cookie, Date.now() + 4 * 3600 * 1000)).toBeNull();
    expect(await readSession("s3cret", null)).toBeNull();
  });

  it("marks the cookie Secure only over https", async () => {
    expect(await sessionCookie("s", "abc", true)).toContain("Secure");
    expect(await sessionCookie("s", "abc", false)).not.toContain("Secure");
    expect(await sessionCookie("s", "abc", true)).toMatch(/HttpOnly; SameSite=Strict/);
  });

  it("hides the scores inside the token and opens it only for its own session", async () => {
    const token = await sealState("s3cret", state);
    expect(token).not.toContain("position");
    expect((await openState("s3cret", token, "abc"))?.pending[0].options[0].position).toBe(15);
    expect(await openState("s3cret", token, "someone-else")).toBeNull();
    expect(await openState("wrong", token, "abc")).toBeNull();
    expect(await openState("s3cret", token.slice(0, -4) + "AAAA", "abc")).toBeNull();
    expect(await openState("s3cret", token, "abc", Date.now() + 4 * 3600 * 1000)).toBeNull();
    expect(await openState("s3cret", 42, "abc")).toBeNull();
  });
});

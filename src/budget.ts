/**
 * One Durable Object guards every AI call: a daily ceiling on calls and estimated spend, and a circuit breaker
 * that stops sending traffic to a provider that is failing. KV can't do this (eventually consistent, few writes);
 * a single Durable Object is strongly consistent.
 */
import { DurableObject } from "cloudflare:workers";

type Ledger = { day: string; calls: number; usd: number; recent: boolean[]; openUntil: number };
export type Admission = { ok: true } | { ok: false; reason: "budget" | "breaker" };

const WINDOW = 20; // outcomes the breaker looks at
const MIN_SAMPLE = 10;
const FAILURE_SHARE = 0.5;
const COOL_DOWN = 5 * 60 * 1000;

/** $ per million tokens (input, output). Unknown models are billed at the dearest rate so the ceiling stays safe. */
// gemini-3.8-flash doubles to [1.5, 7.5] on 2027-01-01; thinking tokens bill as output
const PRICES: Record<string, [number, number]> = { "gemini-3.8-flash": [0.75, 3.75], "claude-sonnet-5": [2, 10], "claude-haiku-4-5": [1, 5] };
export const estimateUsd = (model: string, input: number, output: number) => {
  const [i, o] = PRICES[model] ?? [5, 25];
  return (input * i + output * o) / 1e6;
};

const today = () => new Date().toISOString().slice(0, 10);

export class Budget extends DurableObject {
  private ledger: Ledger = { day: today(), calls: 0, usd: 0, recent: [], openUntil: 0 };

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    ctx.blockConcurrencyWhile(async () => {
      this.ledger = (await ctx.storage.get<Ledger>("ledger")) ?? this.ledger;
    });
  }

  private roll() {
    if (this.ledger.day !== today()) this.ledger = { ...this.ledger, day: today(), calls: 0, usd: 0 };
  }

  /** Ask before every call. A granted call is counted at once, so a burst can't overshoot the ceiling. */
  async admit(maxCalls: number, maxUsd: number): Promise<Admission> {
    this.roll();
    const now = Date.now();
    if (this.ledger.openUntil > now) return { ok: false, reason: "breaker" };
    if (this.ledger.calls >= maxCalls || this.ledger.usd >= maxUsd) return { ok: false, reason: "budget" };
    this.ledger.calls += 1;
    await this.ctx.storage.put("ledger", this.ledger);
    return { ok: true };
  }

  /** Report how the call went. Refusals and bad input are not provider failures; only errors and timeouts count. */
  async report(ok: boolean, usd: number): Promise<void> {
    this.roll();
    this.ledger.usd += usd;
    this.ledger.recent = [...this.ledger.recent, ok].slice(-WINDOW);
    const failures = this.ledger.recent.filter((x) => !x).length;
    if (this.ledger.recent.length >= MIN_SAMPLE && failures / this.ledger.recent.length >= FAILURE_SHARE) {
      this.ledger.openUntil = Date.now() + COOL_DOWN;
      this.ledger.recent = []; // after the cool-down the breaker starts from a clean window
    }
    await this.ctx.storage.put("ledger", this.ledger);
  }

  async snapshot(): Promise<Ledger> {
    this.roll();
    return this.ledger;
  }
}

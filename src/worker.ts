import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { estimateUsd, type Admission } from "./budget";
import {
  BATCH,
  BadInput,
  ClassifySchema,
  DOMAIN_KEYS,
  INTERVIEWER,
  InterviewSchema,
  MANIFESTO_WRITER,
  MAX_Q,
  ManifestoSchema,
  PROMPT_VERSION,
  REVIEWER,
  ReviewSchema,
  STATES,
  classifyPrompt,
  interviewPrompt,
  manifestoPrompt,
  planLines,
  readCtx,
  readLocale,
  readPortrait,
  readReplies,
  reviewPrompt,
  type Draft,
  type PlanLine,
} from "./prompts";
import { checkDraft, fromLibrary, publicView, toAsked } from "./questions";
import { SCORING_VERSION, TEXT_STRENGTH_CAP, evidenceOf, isDone, nextDomains, optionEvidence, positionsOf, progress, sliderEvidence, summarize } from "./scoring";
import { newSessionId, openState, readSession, sealState, sessionCookie, sha256Hex } from "./session";
import type { Asked, Evidence, InterviewState, Reply, Versions } from "./types";

export { Budget } from "./budget";

type AppEnv = Env & { STATS_KEY?: string; GEMINI_API_KEY?: string; ANTHROPIC_API_KEY?: string; ANTHROPIC_BASE_URL?: string; SESSION_SECRET?: string; TURNSTILE_SECRET?: string; AI_GATEWAY_TOKEN?: string };
type Log = (fields: Record<string, unknown>) => void;
/** What one request carries around: bindings, a content-free logger, and a way to finish work after the response. */
type Runtime = { env: AppEnv; log: Log; wait: (p: Promise<unknown>) => void };

class Refused extends Error {}
class Busy extends Error {}

const RESULT_TTL = 60 * 60 * 24 * 90; // shared links live about three months
const MAX_BODY = 160_000; // an interview state token with 20 questions is about 40 KB
const MAX_CARD = 1_000_000; // the link preview image, a JPEG the browser draws
const SHARE_PATH = /^\/r\/([A-Za-z0-9]{10})(\/card\.jpg)?\/?$/;
const RESULT_PATH = /^\/api\/results\/([A-Za-z0-9]{10})$/;
const DISTRICT = /^[A-Z]{2}-(\d{1,2}|AL|DEL)$/;
const STATE = /^[A-Z]{2}$/;
const CANDIDATE_ID = /^[A-Z]{2}-[A-Z0-9-]{1,8}\/[a-z0-9-]{1,100}$/;
const STATEWIDE = "r.kind IN ('senate', 'senate_special', 'governor')";
const DATA_TTL = 600;
const ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MIN_TURNS_FOR_MANIFESTO = 5;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });

const isDev = (env: AppEnv) => env.ENVIRONMENT === "dev";

/** Exact origins only: the site's own origin, plus the ones the environment lists. */
function originAllowed(env: AppEnv, origin: string | null, url: URL) {
  if (!origin || origin === url.origin) return true;
  return env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean).includes(origin);
}

function sessionSecret(env: AppEnv) {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  if (isDev(env)) return "dev-only-session-secret";
  throw new Error("SESSION_SECRET secret is not set");
}

export default {
  async fetch(request, env: AppEnv, ctx) {
    const url = new URL(request.url);
    const share = url.pathname.match(SHARE_PATH);
    if (share && request.method === "GET") return share[2] ? cardImage(env, share[1]) : sharePage(request, env, share[1]);
    if (url.pathname === "/stats") return stats(env, url);
    // Search Console ownership file; served here because static .html paths redirect to their extensionless form
    if (url.pathname === "/googlec00d114988ffd02e.html") return new Response("google-site-verification: googlec00d114988ffd02e.html", { headers: { "content-type": "text/html; charset=utf-8" } });
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const requestId = crypto.randomUUID();
    const rt: Runtime = { env, wait: (p) => ctx.waitUntil(p), log: (fields) => console.log(JSON.stringify({ request_id: requestId, ...fields })) };
    const country = (request.cf as IncomingRequestCfProperties | undefined)?.country ?? "XX";
    const allowed = env.ALLOWED_COUNTRIES.split(",").map((c) => c.trim()).includes(country);
    if (url.pathname === "/api/access") return json({ allowed, turnstile: env.TURNSTILE_SITEKEY, ...(env.SPONSOR_URL ? { sponsor: env.SPONSOR_URL } : {}), ...(env.GA_ID ? { ga: env.GA_ID } : {}) }, 200, { "cache-control": "no-store" });
    if (url.pathname === "/api/health") return json(await health(env), 200, { "cache-control": "no-store" });
    if (!allowed) return json({ error: "region" }, 403);
    try {
      if (request.method === "GET") {
        if (url.pathname === "/api/seats") {
          const state = stateParam(url);
          return cached(request, ctx, () => seats(env, state));
        }
        if (url.pathname === "/api/ballot") {
          const state = stateParam(url);
          const districts = (url.searchParams.get("d") ?? "").split(",").filter((d) => DISTRICT.test(d) && d.startsWith(`${state}-`));
          return cached(request, ctx, () => ballot(env, state, districts.slice(0, 4)));
        }
        if (url.pathname === "/api/candidate") {
          const id = url.searchParams.get("id") ?? "";
          if (!CANDIDATE_ID.test(id)) throw new BadInput("id");
          return cached(request, ctx, () => candidate(env, id));
        }
      }

      const result = url.pathname.match(RESULT_PATH);
      if (result && request.method === "GET") {
        const saved = (await env.RESULTS.get(`r:${result[1]}`, "json")) as Record<string, unknown> | null;
        if (!saved) return json({ error: "not_found" }, 404);
        const { revoke: _hidden, ...shown } = saved;
        return json(shown, 200, { "cache-control": "public, max-age=300" });
      }

      if (request.method === "POST" || request.method === "DELETE") {
        if (!originAllowed(env, request.headers.get("origin"), url)) return json({ error: "forbidden" }, 403);
        const ip = request.headers.get("cf-connecting-ip") ?? "unknown";

        if (url.pathname === "/api/session" && request.method === "POST") {
          if (!(await env.SESSION_LIMIT.limit({ key: ip })).success) return json({ error: "rate_limited" }, 429);
          const body = await readBody(request);
          if (!(await passedTurnstile(env, body?.token, ip))) return json({ error: "turnstile" }, 403);
          const cookie = await sessionCookie(sessionSecret(env), newSessionId(), url.protocol === "https:");
          return json({ ok: true }, 200, { "set-cookie": cookie, "cache-control": "no-store" });
        }

        if ((url.pathname === "/api/interview" || url.pathname === "/api/manifesto") && request.method === "POST") {
          const sid = await readSession(sessionSecret(env), request.headers.get("cookie"));
          if (!sid) return json({ error: "session" }, 401);
          // per session and address, so one address can't spread its calls across many sessions
          const [byIp, bySession] = await Promise.all([env.IP_LIMIT.limit({ key: ip }), env.AI_LIMIT.limit({ key: `${sid}:${ip}` })]);
          if (!byIp.success || !bySession.success) return json({ error: "rate_limited" }, 429);
          const body = await readBody(request);
          return json(url.pathname === "/api/interview" ? await interview(rt, sid, body) : await manifesto(rt, sid, body), 200, { "cache-control": "no-store" });
        }

        if (url.pathname === "/api/event" && request.method === "POST") {
          if (!(await env.IP_LIMIT.limit({ key: ip })).success) return json({ error: "rate_limited" }, 429);
          const body = await readBody(request);
          if (body?.name !== "support") return json({ error: "bad_request" }, 400);
          rt.wait(count(env, "support", body?.state, body?.locale));
          return json({ ok: true }, 202);
        }

        if (url.pathname === "/api/results" && request.method === "POST") {
          if (!(await env.SAVE_LIMIT.limit({ key: ip })).success) return json({ error: "rate_limited" }, 429);
          const { record, card } = await readResult(request);
          const saved = await saveResult(env, record, card);
          rt.wait(count(env, "share", record?.state, record?.locale));
          return json(saved, 201);
        }

        if (result && request.method === "DELETE") {
          if (!(await env.SAVE_LIMIT.limit({ key: ip })).success) return json({ error: "rate_limited" }, 429);
          return (await deleteResult(env, result[1], request.headers.get("x-revoke-token"))) ? json({ ok: true }) : json({ error: "not_found" }, 404);
        }
      }
      return json({ error: "not_found" }, 404);
    } catch (err) {
      if (err instanceof BadInput) return json({ error: "bad_request", field: err.message }, 400);
      if (err instanceof Refused) return json({ error: "refused" }, 422);
      if (err instanceof Busy) return json({ error: "busy" }, 503, { "retry-after": "300" });
      if (err instanceof Anthropic.RateLimitError) return json({ error: "rate_limited" }, 429);
      if (err instanceof Anthropic.APIError) {
        console.error("Claude API error", err.status, err.message);
        return json({ error: "upstream_error" }, 502);
      }
      console.error(err);
      return json({ error: "server_error" }, 500);
    }
  },
} satisfies ExportedHandler<AppEnv>;

function stateParam(url: URL) {
  const state = (url.searchParams.get("state") ?? "").toUpperCase();
  if (!STATE.test(state)) throw new BadInput("state");
  return state;
}

/** Candidate data changes only when the database is reloaded, so edge-cache it briefly. */
async function cached(request: Request, ctx: ExecutionContext, make: () => Promise<unknown>) {
  const key = new Request(request.url, { method: "GET" });
  const hit = await caches.default.match(key);
  if (hit) return hit;
  const data = await make();
  if (data === null) return json({ error: "not_found" }, 404);
  const res = json(data, 200, { "cache-control": `public, max-age=${DATA_TTL}` });
  ctx.waitUntil(caches.default.put(key, res.clone()));
  return res;
}

/** House seats in a state with the sitting member's name, for the district picker. */
async function seats(env: AppEnv, state: string) {
  const { results } = await env.DB.prepare(
    `SELECT r.id,
            (SELECT c.name FROM candidates c WHERE c.race_id = r.id AND c.incumbent = 1 ORDER BY c.sort LIMIT 1) AS incumbent
       FROM races r
      WHERE r.state = ?1 AND r.kind IN ('house', 'delegate')
      ORDER BY r.sort`,
  ).bind(state).all();
  return { seats: results };
}

type BallotRow = {
  race_id: string; kind: string; title: string; status: string; photos_complete: number;
  id: string; name: string; party: string; incumbent: number; current_role: string; photo: string | null; photo_credit: string | null;
};

/** Statewide races plus the chosen House seats, with each candidate's position scores. */
async function ballot(env: AppEnv, state: string, districts: string[]) {
  const where = districts.length
    ? `r.state = ?1 AND (${STATEWIDE} OR r.id IN (${districts.map((_, i) => `?${i + 2}`).join(", ")}))`
    : `r.state = ?1 AND ${STATEWIDE}`;
  const params = [state, ...districts];
  const [rows, scores] = await env.DB.batch([
    env.DB.prepare(
      `SELECT r.id AS race_id, r.kind, r.title, r.status, r.photos_complete,
              c.id, c.name, c.party, c.incumbent, c.current_role, c.photo, c.photo_credit
         FROM races r JOIN candidates c ON c.race_id = r.id
        WHERE ${where}
        ORDER BY r.sort, c.sort`,
    ).bind(...params),
    env.DB.prepare(
      `SELECT p.candidate_id, p.domain, p.score
         FROM positions p JOIN candidates c ON c.id = p.candidate_id JOIN races r ON r.id = c.race_id
        WHERE ${where} AND p.score IS NOT NULL`,
    ).bind(...params),
  ]);
  const positions = new Map<string, Record<string, number>>();
  for (const s of scores.results as { candidate_id: string; domain: string; score: number }[]) {
    positions.set(s.candidate_id, { ...positions.get(s.candidate_id), [s.domain]: s.score });
  }
  const races = new Map<string, { id: string; kind: string; title: string; status: string; photos_complete: boolean; candidates: unknown[] }>();
  for (const row of rows.results as BallotRow[]) {
    if (!races.has(row.race_id)) {
      races.set(row.race_id, { id: row.race_id, kind: row.kind, title: row.title, status: row.status, photos_complete: row.photos_complete === 1, candidates: [] });
    }
    races.get(row.race_id)!.candidates.push({
      id: row.id, name: row.name, party: row.party, incumbent: row.incumbent === 1, current_role: row.current_role,
      photo: row.photo, credit: row.photo_credit, positions: positions.get(row.id) ?? {},
    });
  }
  return { races: [...races.values()] };
}

/** Everything the profile sheet shows for one candidate. */
async function candidate(env: AppEnv, id: string) {
  const [info, positions, platform] = await env.DB.batch([
    env.DB.prepare(
      `SELECT c.id, c.name, c.party, c.incumbent, c.current_role, c.bio, c.website, c.social, c.photo, c.photo_credit, c.updated_at,
              r.id AS race_id, r.title AS race_title, r.state, r.status, r.photos_complete
         FROM candidates c JOIN races r ON r.id = c.race_id
        WHERE c.id = ?1`,
    ).bind(id),
    env.DB.prepare(`SELECT domain, score, evidence, source FROM positions WHERE candidate_id = ?1`).bind(id),
    env.DB.prepare(`SELECT topic, point, source FROM platform WHERE candidate_id = ?1 ORDER BY ord`).bind(id),
  ]);
  const row = info.results[0] as (Record<string, unknown> & { social: string; incumbent: number; photos_complete: number }) | undefined;
  if (!row) return null;
  let social: Record<string, string> = {};
  try {
    social = JSON.parse(row.social);
  } catch {}
  return {
    ...row,
    incumbent: row.incumbent === 1,
    photos_complete: row.photos_complete === 1,
    social,
    positions: positions.results,
    platform: platform.results,
  };
}

async function readBody(request: Request): Promise<any> {
  const raw = await request.text();
  if (raw.length > MAX_BODY) throw new BadInput("body");
  try {
    return JSON.parse(raw);
  } catch {
    throw new BadInput("json");
  }
}

/** A result to share: JSON, or a form with the JSON record plus the preview card. */
async function readResult(request: Request): Promise<{ record: any; card: ArrayBuffer | null }> {
  if (!(request.headers.get("content-type") ?? "").includes("multipart/form-data")) return { record: await readBody(request), card: null };
  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_BODY + MAX_CARD) throw new BadInput("body");
  const form = await new Response(raw, { headers: { "content-type": request.headers.get("content-type")! } }).formData();
  let record: any;
  try {
    record = JSON.parse(String(form.get("record") ?? ""));
  } catch {
    throw new BadInput("json");
  }
  const file = form.get("card");
  let card: ArrayBuffer | null = null;
  if (file instanceof File && file.size <= MAX_CARD) {
    const bytes = await file.arrayBuffer();
    const head = new Uint8Array(bytes, 0, 3);
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) card = bytes;
  }
  return { record, card };
}

/** The app page for a shared result, with the title, a summary and the card as the link preview. */
async function sharePage(request: Request, env: AppEnv, id: string) {
  const origin = new URL(request.url).origin;
  const page = await env.ASSETS.fetch(new Request(`${origin}/`, { headers: { accept: "text/html" } }));
  const saved = (await env.RESULTS.get(`r:${id}`, "json")) as { portrait?: any; card?: boolean } | null;
  const p = saved?.portrait;
  if (!p?.title) return page;
  const traditions = (p.traditions ?? []).slice(0, 3).map((t: any) => `${t.pct}% ${t.name}`).join(", ");
  const summary = `${p.title}${traditions ? `: ${traditions}` : ""}. Where do you stand?`;
  const set = (value: string) => ({ element(e: Element) { e.setAttribute("content", value); } });
  const extra = [`<meta property="og:url" content="${origin}/r/${id}">`, `<meta name="twitter:card" content="${saved!.card ? "summary_large_image" : "summary"}">`];
  if (saved!.card) extra.push(`<meta property="og:image" content="${origin}/r/${id}/card.jpg">`, `<meta property="og:image:width" content="1200">`, `<meta property="og:image:height" content="630">`);
  return new HTMLRewriter()
    .on("title", { element(e) { e.setInnerContent(`${p.title} · VibeVote`); } })
    .on('meta[name="description"]', set(summary))
    .on('meta[property="og:title"]', set(String(p.title)))
    .on('meta[property="og:description"]', set(summary))
    .on("head", { element(e) { e.append(extra.join(""), { html: true }); } })
    .transform(new Response(page.body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } }));
}

async function cardImage(env: AppEnv, id: string) {
  const img = await env.RESULTS.get(`i:${id}`, "arrayBuffer");
  if (!img) return json({ error: "not_found" }, 404);
  return new Response(img, { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=86400" } });
}

/* ---- sessions ---- */

/** Turnstile tokens are checked here, server-side: a token the browser merely presents proves nothing. */
async function passedTurnstile(env: AppEnv, token: unknown, ip: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) {
    if (isDev(env)) return true;
    console.error("TURNSTILE_SECRET is not set; refusing sessions");
    return false;
  }
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  try {
    const res = await fetch(SITEVERIFY, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }) });
    return ((await res.json()) as { success?: boolean }).success === true;
  } catch (e) {
    console.error("Turnstile siteverify failed", e);
    return false;
  }
}

/* ---- funnel counters: day, event, state and language with a count; nothing that points to a person ---- */

const EVENTS = ["start", "result", "share", "support"] as const;

async function count(env: AppEnv, event: (typeof EVENTS)[number], state: unknown, locale: unknown) {
  const st = typeof state === "string" && STATES.includes(state) ? state : "";
  try {
    await env.DB.prepare("INSERT INTO events_daily (day, event, state, locale, n) VALUES (?, ?, ?, ?, 1) ON CONFLICT (day, event, state, locale) DO UPDATE SET n = n + 1")
      .bind(new Date().toISOString().slice(0, 10), event, st, readLocale(locale))
      .run();
  } catch (e) {
    console.error("count failed", e); // a lost count never breaks the interview
  }
}

const esc = (v: unknown) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The owner's view of the counters, behind the STATS_KEY secret. */
async function stats(env: AppEnv, url: URL): Promise<Response> {
  const key = url.searchParams.get("key") ?? "";
  if (!env.STATS_KEY || key.length < 16 || (await sha256Hex(key)) !== (await sha256Hex(env.STATS_KEY))) return new Response("Not found", { status: 404 });
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 30));
  const since = new Date(Date.now() - (days - 1) * 864e5).toISOString().slice(0, 10);
  const q = (sql: string) => env.DB.prepare(sql).bind(since).all<Record<string, string | number>>().then((r) => r.results);
  const pivot = "SUM(CASE WHEN event='start' THEN n END) AS start, SUM(CASE WHEN event='result' THEN n END) AS result, SUM(CASE WHEN event='share' THEN n END) AS share, SUM(CASE WHEN event='support' THEN n END) AS support";
  const [byDay, byState, byLocale] = await Promise.all([
    q(`SELECT day, ${pivot} FROM events_daily WHERE day >= ? GROUP BY day ORDER BY day DESC`),
    q(`SELECT CASE WHEN state='' THEN '(unknown)' ELSE state END AS state, ${pivot} FROM events_daily WHERE day >= ? GROUP BY state ORDER BY start DESC`),
    q(`SELECT locale, ${pivot} FROM events_daily WHERE day >= ? GROUP BY locale ORDER BY start DESC`),
  ]);
  const total = (rows: Record<string, string | number>[], k: string) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const cols = ["start", "result", "share", "support"];
  const table = (title: string, first: string, rows: Record<string, string | number>[]) =>
    `<h2>${title}</h2><table><tr><th>${first}</th>${cols.map((c) => `<th>${c}</th>`).join("")}<th>finish rate</th></tr>${rows
      .map((r) => `<tr><td>${esc(r[first])}</td>${cols.map((c) => `<td>${Number(r[c]) || 0}</td>`).join("")}<td>${Number(r.start) ? Math.round((100 * (Number(r.result) || 0)) / Number(r.start)) + "%" : ""}</td></tr>`)
      .join("")}</table>`;
  const sum = cols.map((c) => `<div><b>${total(byDay, c)}</b><span>${c}</span></div>`).join("");
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>VibeVote stats</title>
<style>body{font:15px/1.4 system-ui,sans-serif;max-width:860px;margin:32px auto;padding:0 16px;color:#111}h1{font-size:28px}h2{font-size:18px;margin-top:32px}.sum{display:flex;gap:12px;flex-wrap:wrap}.sum div{flex:1;min-width:120px;padding:14px;border-radius:14px;background:#f2f1f4}.sum b{display:block;font-size:30px}.sum span{color:#666}table{width:100%;border-collapse:collapse}th,td{text-align:right;padding:6px 8px;border-bottom:1px solid #eee}th:first-child,td:first-child{text-align:left}th{color:#666;font-weight:600}</style>
<h1>Last ${days} days</h1><div class="sum">${sum}</div>${table("By day", "day", byDay)}${table("By state", "state", byState)}${table("By language", "locale", byLocale)}`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

/* ---- Claude ---- */

function claude(env: AppEnv) {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY secret is not set");
  // dev/local.mjs answers through the local claude CLI; everywhere else the AI Gateway, when configured, sits in front of Anthropic
  if (isDev(env) && env.ANTHROPIC_BASE_URL) return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL, maxRetries: 1 });
  if (!env.AI_GATEWAY_URL) return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 });
  return new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    baseURL: env.AI_GATEWAY_URL,
    maxRetries: 1,
    // the gateway keeps tokens, cost, latency and status; it must never keep what people answered
    defaultHeaders: { "cf-aig-collect-log-payload": "false", ...(env.AI_GATEWAY_TOKEN ? { "cf-aig-authorization": `Bearer ${env.AI_GATEWAY_TOKEN}` } : {}) },
  });
}

type Ask<T extends z.ZodType> = { endpoint: string; model: string; system: string; prompt: string; schema: T; effort?: "low" | "medium"; locale: string };
type Answer = { parsed: unknown; refused: boolean; input: number; output: number };

/* ---- Gemini ---- */

const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_REFUSALS = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"]);
class GeminiError extends Error {
  constructor(readonly status: number) {
    super(`Gemini API ${status}`);
  }
}
const isGemini = (model: string) => model.startsWith("gemini-");

/** One structured Gemini call; one retry on a rate limit or a server error. Thought parts are never read. */
async function gemini<T extends z.ZodType>(env: AppEnv, o: Ask<T>): Promise<Answer> {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY secret is not set");
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: o.system }] },
    contents: [{ role: "user", parts: [{ text: o.prompt }] }],
    generationConfig: {
      maxOutputTokens: 16000,
      responseMimeType: "application/json",
      responseJsonSchema: z.toJSONSchema(o.schema, { target: "draft-2020-12", unrepresentable: "any" }),
      thinkingConfig: { thinkingLevel: o.effort ?? "low" }, // this model has no "minimal" level
    },
  });
  let res: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    res = await fetch(`${GEMINI}/${o.model}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY }, body });
    if (res.ok || (res.status !== 429 && res.status < 500)) break;
  }
  if (!res?.ok) throw new GeminiError(res?.status ?? 0);
  type Part = { text?: string; thought?: boolean };
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  };
  const u = data.usageMetadata ?? {};
  const answer = { input: u.promptTokenCount ?? 0, output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) };
  const cand = data.candidates?.[0];
  if (data.promptFeedback?.blockReason || !cand || GEMINI_REFUSALS.has(cand.finishReason ?? "")) return { ...answer, parsed: null, refused: true };
  const text = (cand.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
  let parsed: z.infer<T> | null = null;
  try {
    const checked = o.schema.safeParse(JSON.parse(text));
    if (checked.success) parsed = checked.data;
  } catch {
    // a cut-off or malformed reply counts as a refusal, so the caller falls back the same way
  }
  return { ...answer, parsed, refused: parsed === null };
}

async function anthropicCall<T extends z.ZodType>(env: AppEnv, o: Ask<T>): Promise<Answer> {
  const res = await claude(env).messages.parse({
    model: o.model,
    max_tokens: 8000,
    system: [{ type: "text", text: o.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: o.prompt }],
    output_config: { ...(o.effort ? { effort: o.effort } : {}), format: zodOutputFormat(o.schema) },
  });
  const input = res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
  return { parsed: res.parsed_output, refused: res.stop_reason === "refusal" || !res.parsed_output, input, output: res.usage.output_tokens };
}

/** One structured AI call, inside the daily budget and the circuit breaker, logged without any content. */
async function ask<T extends z.ZodType>(rt: Runtime, o: Ask<T>): Promise<z.infer<T>> {
  const budget = rt.env.BUDGET.get(rt.env.BUDGET.idFromName("global"));
  let admitted: Admission = { ok: true };
  try {
    admitted = await budget.admit(Number(rt.env.DAILY_AI_CALLS) || 3000, Number(rt.env.DAILY_AI_USD) || 25);
  } catch (e) {
    console.error("budget unavailable, letting the call through", e);
  }
  const base = { endpoint: o.endpoint, model: o.model, locale: o.locale };
  if (!admitted.ok) {
    rt.log({ ...base, status: admitted.reason });
    throw new Busy(admitted.reason);
  }
  const started = Date.now();
  try {
    const res = isGemini(o.model) ? await gemini(rt.env, o) : await anthropicCall(rt.env, o);
    rt.log({ ...base, input_tokens: res.input, output_tokens: res.output, latency_ms: Date.now() - started, status: res.refused ? "refused" : "ok" });
    rt.wait(budget.report(true, estimateUsd(o.model, res.input, res.output)).catch(() => {}));
    if (res.refused) throw new Refused();
    return res.parsed as z.infer<T>;
  } catch (err) {
    if (err instanceof Refused) throw err;
    const status = err instanceof Anthropic.APIError ? (err.status ?? "api") : err instanceof GeminiError ? err.status : "exception";
    rt.log({ ...base, latency_ms: Date.now() - started, status: "error", error: status });
    rt.wait(budget.report(false, 0).catch(() => {}));
    throw err;
  }
}

/* ---- interview: the Worker keeps the score ---- */

const evidenceFor = (q: Asked, reply: Reply): Evidence | null =>
  reply.kind === "option"
    ? optionEvidence(q.domain, q.type, q.options[reply.index].position, q.options[reply.index].strength)
    : reply.kind === "slider"
      ? sliderEvidence(q.domain, reply.value)
      : null;

type Classified = { turn: number; position: number; strength: number; quote: string }[];
const squash = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();

/** An own-words answer counts only with a quote that really is in the answer, and then only tentatively. */
function applyClassified(state: InterviewState, classified: Classified) {
  for (const c of classified) {
    const turn = state.turns[c.turn - 1];
    if (!turn || turn.reply.kind !== "text" || turn.classified || turn.evidence) continue;
    const quote = squash(c.quote ?? "");
    if (quote.length < 3 || !squash(turn.reply.text).includes(quote) || !Number.isFinite(c.position)) continue;
    turn.evidence = { domain: turn.q.domain, position: Math.round(Math.max(0, Math.min(100, c.position))), strength: Math.max(0.2, Math.min(TEXT_STRENGTH_CAP, c.strength || 0.3)), kind: "text", quote: c.quote.slice(0, 200) };
  }
  for (const turn of state.turns) turn.classified = true;
}

/** Problems per draft: the structural checks first, then the reviewer model for the drafts that passed them. */
async function judge(rt: Runtime, state: InterviewState, lines: PlanLine[], drafts: (Draft | undefined)[], round: number): Promise<string[][]> {
  const problems = drafts.map((d, i) => (d ? checkDraft(d, lines[i], state.ctx, state.locale) : ["no question was written for this line"]));
  const sound = drafts.map((d, i) => ({ d, i })).filter(({ i }) => problems[i].length === 0);
  if (sound.length) {
    try {
      const out = await ask(rt, {
        endpoint: "review", model: rt.env.REVIEW_MODEL, system: REVIEWER, schema: ReviewSchema, locale: state.locale,
        prompt: reviewPrompt(state.ctx, sound.map(({ d, i }) => ({ q: toAsked(d!, 0), line: lines[i] })), state.locale),
      });
      for (const r of out.reviews) {
        const hit = sound[r.index - 1];
        if (hit && !r.ok) problems[hit.i] = r.problems.length ? r.problems.map((x) => String(x).slice(0, 200)).slice(0, 4) : ["the reviewer rejected it"];
      }
    } catch (e) {
      if (e instanceof Busy) throw e;
      rt.log({ endpoint: "review", status: "skipped" }); // a reviewer outage must not stop the interview
    }
  }
  const rejected = problems.filter((x) => x.length).length;
  if (rejected) rt.log({ endpoint: "review", round, drafted: drafts.length, rejected, status: "rejected" });
  // the reasons quote the draft, which can carry what the person told us, so they are printed on a developer's machine only
  if (rejected && isDev(rt.env)) problems.forEach((x, i) => x.length && console.log(`[review] round ${round} · ${lines[i].domain[0]}/${lines[i].type}: ${x.join(" | ")}`));
  return problems;
}

/** Draft, review, redraft once what failed, and fall back to the curated library for what failed twice. */
async function draftQuestions(rt: Runtime, state: InterviewState, plan: PlanLine[]): Promise<{ questions: Asked[]; classified: Classified }> {
  const common = { endpoint: "interview", model: rt.env.MODEL, system: INTERVIEWER, schema: InterviewSchema, effort: "low" as const, locale: state.locale };
  const first = await ask(rt, { ...common, prompt: interviewPrompt(state.ctx, state.turns, plan, state.locale) });
  const drafts: (Draft | undefined)[] = plan.map((_, i) => first.questions[i]);
  const problems = await judge(rt, state, plan, drafts, 1);
  const failed = problems.map((x, i) => (x.length ? i : -1)).filter((i) => i >= 0);
  if (failed.length) {
    const lines = failed.map((i) => plan[i]);
    try {
      const second = await ask(rt, { ...common, endpoint: "interview_retry", prompt: interviewPrompt(state.ctx, state.turns, lines, state.locale, failed.map((i, j) => ({ line: j + 1, problems: problems[i] })), false) });
      failed.forEach((i, j) => (drafts[i] = second.questions[j]));
      const again = await judge(rt, state, lines, failed.map((i) => drafts[i]), 2);
      failed.forEach((i, j) => (problems[i] = again[j]));
    } catch (e) {
      if (e instanceof Busy) throw e; // otherwise the library covers the lines that are still failing
    }
  }
  const questions: Asked[] = [];
  plan.forEach((line, i) => {
    const id = state.turns.length + questions.length + 1;
    if (!problems[i].length && drafts[i]) return void questions.push(toAsked(drafts[i]!, id));
    const spare = fromLibrary(line, state.library, state.locale, id);
    if (spare) {
      state.library.push(spare.key);
      rt.log({ endpoint: "interview", status: "library", domain: line.domain[0] });
      questions.push(spare.q);
    } else if (drafts[i] && !checkDraft(drafts[i]!, line, state.ctx, state.locale).length) questions.push(toAsked(drafts[i]!, id));
  });
  if (!questions.length) throw new Refused();
  return { questions, classified: first.classified };
}

async function interview(rt: Runtime, sid: string, body: any) {
  const secret = sessionSecret(rt.env);
  let state: InterviewState;
  if (body?.state != null) {
    const opened = await openState(secret, body.state, sid);
    if (!opened) throw new BadInput("state");
    state = opened;
  } else {
    state = { v: 1, sid, started: Date.now(), ctx: readCtx(body?.ctx), locale: readLocale(body?.locale), turns: [], pending: [], library: [] };
    rt.wait(count(rt.env, "start", state.ctx.state, state.locale));
  }
  for (const { q, reply } of readReplies(body?.answers, state.pending)) {
    if (state.turns.length < MAX_Q) state.turns.push({ q, reply, evidence: evidenceFor(q, reply), classified: reply.kind !== "text" });
  }
  state.pending = [];
  if (isDone(DOMAIN_KEYS, state.turns, MAX_Q)) return { state: await sealState(secret, state), done: true, progress: 1, questions: [] };

  const plan = planLines(state.turns, nextDomains(DOMAIN_KEYS, state.turns, Math.min(BATCH, MAX_Q - state.turns.length)));
  const { questions, classified } = await draftQuestions(rt, state, plan);
  applyClassified(state, classified);
  state.pending = questions;
  return {
    state: await sealState(secret, state),
    done: false,
    progress: progress(DOMAIN_KEYS, state.turns, MAX_Q),
    questions: questions.map(publicView),
    // the synthetic-interview harness needs the hidden scores to play a persona; never in production
    ...(body?.debug === true && rt.env.ENVIRONMENT !== "production" ? { debug: questions.map((q) => ({ id: q.id, source: q.source, positions: q.options.map((o) => o.position) })) } : {}),
  };
}

let dataVersion: { value: string; at: number } | null = null;
async function candidateDataVersion(env: AppEnv): Promise<string> {
  if (dataVersion && Date.now() - dataVersion.at < DATA_TTL * 1000) return dataVersion.value;
  try {
    const row = await env.DB.prepare("SELECT MAX(updated_at) AS v FROM candidates").first<{ v: string | null }>();
    dataVersion = { value: (row?.v ?? "unknown").slice(0, 10), at: Date.now() };
  } catch {
    dataVersion = { value: "unknown", at: Date.now() };
  }
  return dataVersion.value;
}

async function manifesto(rt: Runtime, sid: string, body: any) {
  const state = await openState(sessionSecret(rt.env), body?.state, sid);
  if (!state || state.turns.length < MIN_TURNS_FOR_MANIFESTO) throw new BadInput("state");
  if (state.turns.some((t) => t.reply.kind === "text" && !t.classified)) {
    try {
      const out = await ask(rt, { endpoint: "classify", model: rt.env.REVIEW_MODEL, system: MANIFESTO_WRITER, schema: ClassifySchema, locale: state.locale, prompt: classifyPrompt(state.turns) });
      applyClassified(state, out.classified);
    } catch (e) {
      if (e instanceof Busy) throw e; // an unclassified answer still reaches the writer as text
    }
  }
  const scores = summarize(DOMAIN_KEYS, evidenceOf(state.turns));
  const out = await ask(rt, { endpoint: "manifesto", model: rt.env.MODEL, system: MANIFESTO_WRITER, schema: ManifestoSchema, effort: "medium", locale: state.locale, prompt: manifestoPrompt(state.ctx, state.turns, scores, state.locale) });
  const versions: Versions = { model_version: rt.env.MODEL, prompt_version: PROMPT_VERSION, scoring_version: SCORING_VERSION, candidate_data_version: await candidateDataVersion(rt.env) };
  // positions are the Worker's arithmetic, never the writer's impression
  rt.wait(count(rt.env, "result", state.ctx.state, state.locale));
  return { ...out, priorities: out.priorities.filter((k) => scores[k]?.position !== null).slice(0, 3), positions: positionsOf(DOMAIN_KEYS, state.turns), versions };
}

/* ---- shared results ---- */

async function saveResult(env: AppEnv, body: any, card: ArrayBuffer | null) {
  const state = typeof body?.state === "string" && STATES.includes(body.state) ? body.state : "";
  if (!state) throw new BadInput("state");
  const districts: string[] = Array.isArray(body?.districts)
    ? body.districts.filter((d: unknown): d is string => typeof d === "string" && DISTRICT.test(d)).slice(0, 4)
    : [];
  // whoever created the link holds this token and can delete the result; only its hash is stored
  const revoke = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
  const record = JSON.stringify({ state, districts, locale: readLocale(body?.locale), portrait: readPortrait(body?.portrait), card: !!card, revoke: await sha256Hex(revoke), created: new Date().toISOString() });
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
    if ((await env.RESULTS.get(`r:${id}`)) === null) {
      if (card) await env.RESULTS.put(`i:${id}`, card, { expirationTtl: RESULT_TTL });
      await env.RESULTS.put(`r:${id}`, record, { expirationTtl: RESULT_TTL });
      return { id, revoke };
    }
  }
  throw new Error("Could not allocate a result id");
}

async function deleteResult(env: AppEnv, id: string, token: string | null): Promise<boolean> {
  const saved = (await env.RESULTS.get(`r:${id}`, "json")) as { revoke?: string } | null;
  if (!saved?.revoke || !token || token.length > 64 || (await sha256Hex(token)) !== saved.revoke) return false;
  await Promise.all([env.RESULTS.delete(`r:${id}`), env.RESULTS.delete(`i:${id}`)]);
  return true;
}

/** For smoke tests: which pieces are configured, never their values. */
async function health(env: AppEnv) {
  return {
    ok: true,
    environment: env.ENVIRONMENT,
    versions: { model_version: env.MODEL, prompt_version: PROMPT_VERSION, scoring_version: SCORING_VERSION, candidate_data_version: await candidateDataVersion(env) },
    configured: { ai: isGemini(env.MODEL) ? !!env.GEMINI_API_KEY : !!env.ANTHROPIC_API_KEY, gemini: !!env.GEMINI_API_KEY, anthropic: !!env.ANTHROPIC_API_KEY, session: !!env.SESSION_SECRET, turnstile: !!env.TURNSTILE_SECRET && !!env.TURNSTILE_SITEKEY, ai_gateway: !!env.AI_GATEWAY_URL },
  };
}

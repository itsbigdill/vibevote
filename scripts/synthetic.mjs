#!/usr/bin/env node
// Synthetic interviews: personas with known ("latent") positions take the interview end to end, and the report says
// how often it completes, how long it takes, how often the reviewer and the curated library step in, and how close
// the measured positions land to the latent ones. Works against local dev and staging, where `debug: true` makes the
// Worker reveal each option's hidden position so a persona can answer in character. Production never does.
//
//   node scripts/synthetic.mjs --base http://localhost:8788 --n 1
//   node scripts/synthetic.mjs --base https://staging.vibevote.us --n 300 --concurrency 4 --token XXXX.DUMMY.TOKEN.XXXX
//   node scripts/synthetic.mjs --base https://staging.vibevote.us --n 20 --locale es
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = Object.fromEntries(process.argv.slice(2).join(" ").split(/\s*--/).filter(Boolean).map((a) => { const [k, ...v] = a.trim().split(/\s+/); return [k, v.join(" ") || "true"]; }));
const BASE = (args.base ?? "http://localhost:8788").replace(/\/$/, "");
const N = Number(args.n ?? 1);
const CONCURRENCY = Number(args.concurrency ?? 1);
const LOCALES = String(args.locale ?? "en").split(",");
const TOKEN = args.token ?? (BASE.includes("localhost") ? "dev" : "XXXX.DUMMY.TOKEN.XXXX");
const OWN_WORDS = Number(args["own-words"] ?? 0.1); // share of answers given as free text
const NOISE = Number(args.noise ?? 8); // how far, in points, a persona strays from its latent position when answering
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const DOMAINS = [
  ["economy", "letting the market decide", "having the state steer the economy"],
  ["welfare", "help targeted at those who need it", "universal programs for everyone"],
  ["liberty", "individual choice", "community norms"],
  ["security", "privacy first", "security first"],
  ["immigration", "open doors", "tight control of immigration"],
  ["foreign", "staying out of foreign conflicts", "leading abroad"],
  ["energy", "cheap energy now", "the energy transition now"],
  ["tech", "letting technology run", "regulating technology early"],
  ["education", "parents choosing", "the public school system"],
  ["faith", "a strictly secular state", "faith in public life"],
];
const STATES = ["Florida", "Texas", "California", "Ohio", "Pennsylvania", "Georgia", "Arizona", "Michigan", "New York", "Wyoming", "Maine", "Nevada"];
const AGES = ["18–24", "25–34", "35–44", "45–54", "55–64", "65+"];
const GENDERS = ["Woman", "Man", "Non-binary", ""];
const FAMILIES = ["Single, no kids", "Partnered, no kids", "Parent of young kids", "Parent of teens or adult kids", "Caring for a parent or relative", ""];
const JOBS = ["ICU nurse", "long-haul truck driver", "software engineer", "retired teacher", "restaurant owner", "electrician", "college student", "farmer", "police officer", "stay-at-home parent", "real estate agent", ""];

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2;

function persona() {
  // two correlated clusters plus independent noise, so personas are coherent but not uniform
  const lean = Math.random() * 100;
  const latent = Object.fromEntries(DOMAINS.map(([k]) => [k, clamp(lean * 0.5 + Math.random() * 50 + gauss() * 10)]));
  return { ctx: { state: pick(STATES), age: pick(AGES), gender: pick(GENDERS), family: pick(FAMILIES), job: pick(JOBS) }, latent };
}

const ownWords = (domain, latent) => {
  const d = DOMAINS.find((x) => x[0] === domain);
  const side = latent < 50 ? d[1] : d[2];
  return Math.abs(latent - 50) < 12 ? `Honestly I see both sides here, though I lean a little toward ${side}.` : `I come down on the side of ${side}, even when it costs something.`;
};

async function post(path, body, cookie) {
  const started = Date.now();
  const res = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", origin: BASE, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, ms: Date.now() - started, cookie: res.headers.getSetCookie?.()[0]?.split(";")[0] };
}

async function runOne(index, locale) {
  const who = persona();
  const out = { index, locale, ctx: who.ctx, questions: 0, library: 0, ownWords: 0, calls: [], error: null, latent: who.latent, measured: null, versions: null, title: null };
  const session = await post("/api/session", { token: TOKEN });
  if (session.status !== 200 || !session.cookie) return { ...out, error: `session ${session.status}` };
  let state = null;
  let answers = [];
  for (let round = 0; round < 12; round++) {
    const r = await post("/api/interview", state ? { state, answers, debug: true } : { ctx: who.ctx, locale, debug: true }, session.cookie);
    out.calls.push({ endpoint: "interview", ms: r.ms, status: r.status });
    if (r.status !== 200) return { ...out, error: `interview ${r.status} ${r.data?.error ?? ""}` };
    state = r.data.state;
    if (r.data.done) break;
    answers = r.data.questions.map((q) => {
      out.questions++;
      const dbg = (r.data.debug ?? []).find((x) => x.id === q.id);
      if (dbg?.source === "library") out.library++;
      const want = clamp(who.latent[q.domain] + gauss() * NOISE);
      if (Math.random() < OWN_WORDS) {
        out.ownWords++;
        return { id: q.id, text: ownWords(q.domain, who.latent[q.domain]) };
      }
      if (q.type === "slider") return { id: q.id, value: want };
      const positions = dbg?.positions ?? q.options.map((_, i) => (100 * i) / Math.max(1, q.options.length - 1));
      return { id: q.id, option: positions.reduce((best, p, i) => (Math.abs(p - want) < Math.abs(positions[best] - want) ? i : best), 0) };
    });
  }
  const m = await post("/api/manifesto", { state }, session.cookie);
  out.calls.push({ endpoint: "manifesto", ms: m.ms, status: m.status });
  if (m.status !== 200) return { ...out, error: `manifesto ${m.status} ${m.data?.error ?? ""}` };
  return { ...out, measured: m.data.positions, versions: m.data.versions, title: m.data.title };
}

const pct = (list, p) => (list.length ? [...list].sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor((p / 100) * list.length))] : 0);
const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);

function report(runs) {
  const ok = runs.filter((r) => !r.error);
  const errors = {};
  runs.filter((r) => r.error).forEach((r) => (errors[r.error] = (errors[r.error] ?? 0) + 1));
  const byDomain = Object.fromEntries(DOMAINS.map(([k]) => {
    const pairs = ok.filter((r) => typeof r.measured?.[k] === "number").map((r) => [r.latent[k], r.measured[k]]);
    const mx = mean(pairs.map((p) => p[0])), my = mean(pairs.map((p) => p[1]));
    const cov = mean(pairs.map(([x, y]) => (x - mx) * (y - my)));
    const sx = Math.sqrt(mean(pairs.map(([x]) => (x - mx) ** 2))), sy = Math.sqrt(mean(pairs.map(([, y]) => (y - my) ** 2)));
    return [k, { measured: pairs.length, mae: Number(mean(pairs.map(([x, y]) => Math.abs(x - y))).toFixed(1)), r: sx && sy ? Number((cov / (sx * sy)).toFixed(2)) : null }];
  }));
  const calls = runs.flatMap((r) => r.calls);
  const lat = (name) => calls.filter((c) => c.endpoint === name && c.status === 200).map((c) => c.ms);
  return {
    base: BASE, runs: runs.length, completed: ok.length, completion: Number((ok.length / Math.max(1, runs.length)).toFixed(3)), errors,
    questions: { mean: Number(mean(ok.map((r) => r.questions)).toFixed(1)), min: Math.min(...ok.map((r) => r.questions)), max: Math.max(...ok.map((r) => r.questions)) },
    library_share: Number((ok.reduce((t, r) => t + r.library, 0) / Math.max(1, ok.reduce((t, r) => t + r.questions, 0))).toFixed(3)),
    own_words_share: Number((ok.reduce((t, r) => t + r.ownWords, 0) / Math.max(1, ok.reduce((t, r) => t + r.questions, 0))).toFixed(3)),
    latency_ms: { interview_p50: pct(lat("interview"), 50), interview_p95: pct(lat("interview"), 95), manifesto_p50: pct(lat("manifesto"), 50), manifesto_p95: pct(lat("manifesto"), 95) },
    mae_overall: Number(mean(Object.values(byDomain).map((d) => d.mae)).toFixed(1)),
    by_domain: byDomain,
    versions: ok[0]?.versions ?? null,
  };
}

const jobs = Array.from({ length: N }, (_, i) => ({ i, locale: LOCALES[i % LOCALES.length] }));
const runs = [];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (let job = jobs.shift(); job; job = jobs.shift()) {
    const started = Date.now();
    const r = await runOne(job.i, job.locale).catch((e) => ({ index: job.i, locale: job.locale, calls: [], error: `exception ${e.message}` }));
    runs.push(r);
    console.log(`#${job.i + 1}/${N} ${job.locale} ${r.error ? `FAILED: ${r.error}` : `${r.questions} questions, ${r.library} from the library, "${r.title}"`} in ${Math.round((Date.now() - started) / 1000)}s`);
  }
}));

const summary = report(runs);
const file = join(ROOT, "reports", `synthetic-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify({ summary, runs }, null, 1));
console.log(JSON.stringify(summary, null, 1));
console.log(`saved ${file}`);
// a release gate: most interviews must finish, and measured positions must track the latent ones
process.exit(summary.completion >= 0.95 && summary.mae_overall <= 20 ? 0 : 1);

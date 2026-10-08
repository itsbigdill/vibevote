#!/usr/bin/env node
// End-to-end smoke test for a deployed environment (or local dev): a few cheap checks, one AI round, and a share link's
// whole life. It needs a Turnstile token the environment accepts: "dev" locally, the dummy token on staging.
//
//   node scripts/smoke.mjs http://localhost:8788
//   node scripts/smoke.mjs https://staging.vibevote.us
const BASE = (process.argv[2] ?? "http://localhost:8788").replace(/\/$/, "");
const TOKEN = process.argv[3] ?? (BASE.includes("localhost") ? "dev" : "XXXX.DUMMY.TOKEN.XXXX");
const headers = { "content-type": "application/json", origin: BASE };
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) failed++; };
const skip = (name, why) => console.log(`skip ${name} — ${why}`);
const get = (path) => fetch(BASE + path).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null), headers: r.headers }));
const post = (path, body, extra = {}) => fetch(BASE + path, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null), cookie: r.headers.getSetCookie?.()[0]?.split(";")[0] }));

const health = await get("/api/health");
check("health answers", health.status === 200 && health.data?.ok, JSON.stringify(health.data?.versions));
check("secrets are configured", health.data?.configured?.ai && (health.data.environment === "dev" || (health.data.configured.session && health.data.configured.turnstile)), JSON.stringify(health.data?.configured));
const access = await get("/api/access");
check("access names a Turnstile widget", access.status === 200 && !!access.data?.turnstile, String(access.data?.turnstile));
check("candidate data loads", (await get("/api/seats?state=FL")).data?.seats?.length > 20);
check("a foreign origin is refused", (await post("/api/session", { token: TOKEN }, { origin: "https://evil.example" })).status === 403);
check("the interview refuses callers without a session", (await post("/api/interview", { ctx: { state: "Ohio" } })).status === 401);
// Cloudflare's test secret passes any token, so this only means something against a real widget
const testKeys = !access.data?.turnstile || access.data.turnstile === "dev" || /^[123]x0{10,}/.test(access.data.turnstile);
if (testKeys) skip("a bad Turnstile token buys nothing", "this environment uses test keys");
else check("a bad Turnstile token buys nothing", (await post("/api/session", { token: "not-a-token" })).status === 403);

const session = await post("/api/session", { token: TOKEN });
check("a verified visitor gets a session", session.status === 200 && !!session.cookie);
if (!health.data?.configured?.ai) {
  skip("one interview round, hidden scores, opaque and tamper-proof state", "the AI key is not set here");
} else {
  const started = Date.now();
  const round = await post("/api/interview", { ctx: { state: "Ohio", family: "Single, no kids", job: "electrician" }, locale: "en" }, { cookie: session.cookie ?? "" });
  check("one interview round", round.status === 200 && round.data?.questions?.length > 0, `${round.data?.questions?.length ?? 0} questions in ${Math.round((Date.now() - started) / 1000)}s`);
  check("no hidden score reaches the browser", !/"position"|"strength"/.test(JSON.stringify(round.data ?? {})));
  check("the state is an opaque token", typeof round.data?.state === "string" && round.data.state.startsWith("v1."));
  const forged = await post("/api/interview", { state: `${round.data?.state ?? ""}x`, answers: [] }, { cookie: session.cookie ?? "" });
  check("a tampered state is rejected", forged.status === 400);
}

// only a result the Worker wrote (and sealed) can be shared; a made-up one is refused
const forgedShare = await post("/api/results", { state: "Ohio", districts: [], locale: "en", portrait: { title: "Smoke Test", manifesto: "I am only a test.", positions: {} } });
check("a made-up result can't be shared", forgedShare.status === 400 && forgedShare.data?.field === "seal", `${forgedShare.status} ${JSON.stringify(forgedShare.data)}`);
const portrait = process.env.SMOKE_PORTRAIT ? JSON.parse(process.env.SMOKE_PORTRAIT) : null;
if (!portrait) {
  skip("share link create, read and delete", "needs a sealed result: set SMOKE_PORTRAIT to a /api/manifesto response");
  console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
  process.exit(failed ? 1 : 0);
}
const saved = await post("/api/results", { state: "Ohio", districts: [], locale: "en", portrait });
check("a share link is created with a revoke token", saved.status === 201 && !!saved.data?.id && !!saved.data?.revoke);
const read = await get(`/api/results/${saved.data?.id}`);
check("the link reads back without the revoke hash, with its versions", read.status === 200 && !("revoke" in (read.data ?? {})) && read.data?.portrait?.versions?.prompt_version === health.data?.versions?.prompt_version);
const wrong = await fetch(`${BASE}/api/results/${saved.data?.id}`, { method: "DELETE", headers: { ...headers, "x-revoke-token": "nope" } });
check("a wrong token can't delete it", wrong.status === 404);
const gone = await fetch(`${BASE}/api/results/${saved.data?.id}`, { method: "DELETE", headers: { ...headers, "x-revoke-token": saved.data?.revoke ?? "" } });
check("its owner can", gone.status === 200 && (await get(`/api/results/${saved.data?.id}`)).status === 404);

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);

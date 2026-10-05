# Releasing VibeVote

Three configurations live in `wrangler.jsonc`:

| | Worker | Address | Countries | Turnstile | Data |
|---|---|---|---|---|---|
| dev (top level) | never deployed | `localhost:8788` | US, UA | skipped | local copies |
| `staging` | `vibevote-staging` | `staging.vibevote.us` | US, UA | Cloudflare test keys | its own KV, D1, Durable Object, rate limits |
| `production` | `vibevote` | `vibevote.us`, `www` | US | the real widget | production KV, D1, Durable Object, rate limits |

Deploys always name an environment. A bare `wrangler deploy` would publish the dev config as an unreachable Worker: don't.

## One-time setup

1. **Secrets.** Never in `wrangler.jsonc`, a committed `.env`, or the page's JavaScript. Wrangler asks for each value; nothing is echoed.
   `SESSION_SECRET` is set on both environments (2026-09-19, generated with `openssl rand -base64 48` and piped straight into
   `wrangler secret put`, a different value each) and `TURNSTILE_SECRET` on production. Still to do, by the key's owner:
   ```bash
   npx wrangler secret put ANTHROPIC_API_KEY --env staging
   npx wrangler secret put ANTHROPIC_API_KEY --env production
   ```
   `secrets.required` makes `wrangler deploy` and `wrangler versions upload` fail before publishing if one is missing.
   Production requires all three. Staging requires only `SESSION_SECRET`, so it could go up before the Anthropic key existed;
   `npm run smoke` reports the missing key. Once staging has the key, add `ANTHROPIC_API_KEY` back to its `required` list.
   `wrangler secret put` deploys a new version at once. For a controlled change on production use
   `npx wrangler versions secret put NAME --env production`, then roll the new version out as in step 8 below.
2. **Turnstile.** Done on 2026-09-18: the widget "VibeVote production" (managed mode, `vibevote.us` + `www.vibevote.us`)
   was created with `npx wrangler turnstile widget create`; its public sitekey is in `env.production.vars.TURNSTILE_SITEKEY`
   and its secret went straight into the `TURNSTILE_SECRET` secret of the production Worker. `npx wrangler turnstile widget list`
   shows it; to rotate the secret, recreate the widget and repeat. Staging uses Cloudflare's published test keys, so scripts
   can get a session with the dummy token.
3. **AI Gateway (optional but recommended).** Dashboard → AI → AI Gateway → Create gateway `vibevote`.
   In its settings turn **log payloads off** (the Worker also sends `cf-aig-collect-log-payload: false` on every call, so
   prompts and answers are never stored either way; token counts, cost, latency and status still are).
   Put `https://gateway.ai.cloudflare.com/v1/f12343f4f5f0d268f6c7df8d23a15859/vibevote/anthropic` into `AI_GATEWAY_URL`.
   If the gateway is authenticated, add the token: `npx wrangler secret put AI_GATEWAY_TOKEN --env production`.
4. **Staging data.** Done on 2026-09-19: staging has its own KV namespace (`vibevote-staging-results`) and D1 database
   (`vibevote-staging`), the migration is applied and the candidate data is loaded (about 31,000 row writes). To refresh it:
   ```bash
   python3 load_db.py --env staging --dry-run   # shows how many rows would be written (D1 free tier: 100,000 a day, account-wide)
   python3 load_db.py --env staging
   ```
5. **The Durable Object.** The release that first ships the `Budget` class carries a migration, and migrations can't go out
   gradually: that one release uses `npx wrangler deploy --env production`. Every later release follows the steps below.

## Every release

1. `npm run check` — types, then the unit tests for scoring, input validation and the session tokens.
2. `npm run synthetic -- --base https://staging.vibevote.us --n 300 --concurrency 4`
   300–500 synthetic interviews. The script exits non-zero if fewer than 95% finish or the measured positions drift more
   than 20 points from the personas' on average. Read `reports/synthetic-*.json`: `library_share` is how often the curated
   fallback was needed, `by_domain` shows which domain measures badly.
3. `npm run synthetic -- --base https://staging.vibevote.us --n 100 --locale en,es,pt,zh,ru` — 20 full runs per language,
   then read a sample of the questions in each language yourself; the script checks that they complete, not that they read well.
4. `npm run dryrun:production` — builds and validates the production bundle and config without publishing.
5. `npm run deploy:staging`
6. `npm run smoke -- https://staging.vibevote.us` — health, region gate, session, one interview round, share link create/read/delete.
7. `npm run release:upload` — uploads a new production version. No traffic moves yet. Note the version id it prints.
8. `npm run release:canary` — pick the new version and give it 10%. Non-interactive:
   `npx wrangler versions deploy <new-id>@10% <current-id>@90% --env production -y`
9. Watch for 15–30 minutes: `npx wrangler tail --env production --format json | grep '"endpoint"'`
   Every AI call logs one line: `request_id, endpoint, model, locale, input_tokens, output_tokens, latency_ms, status`.
   Nothing a person typed is ever logged. Look at the error share, `latency_ms`, `status: "library"` (fallbacks) and
   `status: "budget" | "breaker"` (the daily ceiling or the circuit breaker refusing calls). Cost is in the AI Gateway dashboard.
10. Full rollout: `npx wrangler versions deploy <new-id>@100% --env production -y`. Roll back at any point with `npm run release:rollback`.

## What protects the AI endpoints

- A Turnstile token, verified server-side, buys a 3-hour anonymous session cookie (`HttpOnly`, `SameSite=Strict`).
  `/api/interview` and `/api/manifesto` answer only to a session.
- Rate limits count per session and address (`AI_LIMIT`) and per address (`IP_LIMIT`); sessions themselves are limited per address.
- An interview is at most 20 answers; its state is an encrypted token the browser can hold but not read or edit.
- `DAILY_AI_CALLS` and `DAILY_AI_USD` cap a day's spend; the `Budget` Durable Object also opens a circuit breaker for
  five minutes when half of the last 20 calls failed. Both answer `503 busy`, which the page shows as "at capacity".
- `ALLOWED_ORIGINS` is an exact list per environment.

## Versions

Every result carries `model_version`, `prompt_version`, `scoring_version` and `candidate_data_version`; shared links keep them.
Bump `PROMPT_VERSION` (src/prompts.ts) with any change to prompts, the library or the reviewer; bump `SCORING_VERSION`
(src/scoring.ts) with any change to the arithmetic. `GET /api/health` shows what an environment is running.

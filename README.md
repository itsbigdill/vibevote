# VibeVote

**Find out where you actually stand.** A short conversation about real-life choices, not a political quiz. Live at [vibevote.us](https://vibevote.us).

You answer about twenty everyday situations. VibeVote measures where you stand on ten topics, writes a first-person manifesto of your views, and shows how close you are to every candidate on your November 3, 2026 ballot: Senate, governor and House.

VibeVote explains your values. It does not tell you how to vote.

## How the score works

The AI writes the scenes. It does not keep the score.

- Every answer option carries a hidden position (0–100) and strength. The Worker adds up the evidence in code: [`src/scoring.ts`](src/scoring.ts).
- One answer can never settle a topic. Each topic needs at least two pieces of evidence, so an interview runs 16–20 questions.
- A two-way choice shows direction, not distance, so it is pulled toward the middle before scoring.
- Answers in your own words count only when the model quotes them verbatim, and then only tentatively (capped strength).
- Every drafted question goes through structural checks ([`src/questions.ts`](src/questions.ts)) and a reviewer model. A question that fails twice is replaced by a curated one from [`src/library.ts`](src/library.ts).
- Candidate matching skips a candidate's party and endorsements. It uses only positions with a public source, and every one links to that source.

`npm run synthetic` runs simulated voters with known positions through the full interview and reports how far the measurement lands from the truth.

## Privacy

- Your ZIP code never leaves the browser. The server only learns your state.
- There are no accounts. While the interview runs, its state is an encrypted token held by your browser.
- Answers go to the AI provider (currently Google's Gemini API, paid tier, not used for training) to write the next questions and the manifesto. VibeVote keeps no copy.
- A result is stored only if you share it, and the share link can be deleted by its owner.

## Stack

- One Cloudflare Worker ([`src/worker.ts`](src/worker.ts)) serves the site and the API.
- D1 holds candidates, KV holds shared results, and a Durable Object ([`src/budget.ts`](src/budget.ts)) enforces a daily AI spend ceiling and a circuit breaker.
- Turnstile gates the AI endpoints behind a short anonymous session.
- The client is a single page ([`web/index.src.html`](web/index.src.html)) built by [`build.py`](build.py). It supports five languages: English, Spanish, Portuguese, Chinese and Russian.

## Run it locally

```bash
npm install
echo "GEMINI_API_KEY=your-key" > .dev.vars
python3 build.py
npm run dev        # http://localhost:8788
```

To load the local candidate database: `python3 load_db.py --local`.

To run the checks:

```bash
npm run check                                           # types + unit tests
npm run synthetic -- --base http://localhost:8788 --n 5
```

[`RELEASE.md`](RELEASE.md) is the release runbook for staging and production.

## Data

- **Candidates** ([`candidates/`](candidates/), [`profiles/`](profiles/)): compiled from public records, campaign sites and news coverage. Every scored position cites its source. Corrections are welcome as issues or pull requests.
- **Portraits** ([`photos/`](photos/)): Wikimedia Commons files under free licences; authors and licences are listed on [/credits](https://vibevote.us/credits).
- **ZIP codes and districts**: U.S. Census Bureau relationship files (public domain) and state redistricting files.

## License

Code: [GNU AGPL-3.0](LICENSE). If you run a modified version as a service, you share your changes under the same licence.

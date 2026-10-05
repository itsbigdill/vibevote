#!/usr/bin/env node
// Local dev: runs the site with `wrangler dev` and answers the Worker's Claude API calls with the
// installed claude CLI (your own Claude login), so the interview works without an ANTHROPIC_API_KEY.
//
//   node dev/local.mjs                  site on http://localhost:8788, Claude through the CLI
//   VIBEVOTE_AI=api node dev/local.mjs  use ANTHROPIC_API_KEY from .dev.vars instead
//
// The bridge listens on 127.0.0.1 only and speaks just enough of the Messages API for
// messages.parse(): system + messages in, one text block of JSON out.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 8788);
const BRIDGE_PORT = Number(process.env.BRIDGE_PORT ?? 8790);
const USE_CLI = process.env.VIBEVOTE_AI !== "api";
const CLAUDE = process.env.CLAUDE_BIN ?? [join(homedir(), ".local/bin/claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"].find(existsSync) ?? "claude";
const TIMEOUT_MS = 180_000;

// a bare environment, so the CLI uses your own login rather than whatever session launched this script
const CLEAN_ENV = Object.fromEntries(
  ["HOME", "USER", "LOGNAME", "PATH", "SHELL", "LANG", "TMPDIR"].filter((k) => process.env[k]).map((k) => [k, process.env[k]]),
);
// an empty working directory keeps project CLAUDE.md files and memory out of the prompt
const WORK = mkdtempSync(join(tmpdir(), "vibevote-cli-"));

const log = (...a) => console.log("[claude-cli]", ...a);
const text = (content) =>
  typeof content === "string" ? content : (content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n\n");

function run(args, input, think) {
  return new Promise((resolve, reject) => {
    // the API runs the reviewer (Haiku, no effort set) without thinking; the CLI would think by default, for minutes
    const child = spawn(CLAUDE, args, { cwd: WORK, env: think ? CLEAN_ENV : { ...CLEAN_ENV, MAX_THINKING_TOKENS: "0" } });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill("SIGTERM"), TIMEOUT_MS);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`can't start ${CLAUDE}: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error(`claude exited ${code}: ${(err || out).trim().slice(0, 400)}`));
      }
    });
    child.stdin.end(input);
  });
}

function asJson(result) {
  if (result.structured_output !== undefined) return JSON.stringify(result.structured_output);
  const raw = String(result.result ?? "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  return raw;
}

async function answer(req) {
  if (req.stream) throw new Error("streaming isn't supported by the CLI bridge");
  const turns = req.messages ?? [];
  const prompt = turns.length === 1
    ? text(turns[0].content)
    : turns.map((m) => `${m.role === "assistant" ? "Assistant" : "User"}:\n${text(m.content)}`).join("\n\n");
  const system = text(req.system);
  const format = req.output_config?.format;
  const args = ["-p", "--output-format", "json", "--no-session-persistence", "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--model", req.model];
  if (system) args.push("--system-prompt", system);
  if (req.output_config?.effort) args.push("--effort", req.output_config.effort);
  if (format?.type === "json_schema") args.push("--json-schema", JSON.stringify(format.schema));

  const result = await run(args, prompt, Boolean(req.output_config?.effort));
  if (result.is_error) throw new Error(`claude CLI: ${result.result || result.subtype || "error"}`);
  const refused = result.stop_reason === "refusal";
  return {
    message: {
      id: `msg_cli_${result.uuid ?? Date.now()}`,
      type: "message",
      role: "assistant",
      model: req.model,
      content: refused ? [] : [{ type: "text", text: format ? asJson(result) : String(result.result ?? "") }],
      stop_reason: refused ? "refusal" : "end_turn",
      stop_sequence: null,
      usage: { input_tokens: result.usage?.input_tokens ?? 0, output_tokens: result.usage?.output_tokens ?? 0 },
    },
    output: result.structured_output,
  };
}

const describe = (out) =>
  !out ? "" : Array.isArray(out.reviews) ? `review, ${out.reviews.filter((r) => !r.ok).length} of ${out.reviews.length} rejected` : Array.isArray(out.questions) ? `interview, ${out.questions.length} questions` : out.manifesto ? `manifesto "${out.title ?? ""}"` : Object.keys(out).join(", ");

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

const bridge = createServer(async (req, res) => {
  if (req.method === "GET") return send(res, 200, { ok: true, claude: CLAUDE });
  if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) {
    return send(res, 404, { type: "error", error: { type: "not_found_error", message: "not found" } });
  }
  const started = Date.now();
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try {
    const { message, output } = await answer(JSON.parse(raw));
    log(`${describe(output) || "reply"} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    send(res, 200, message);
  } catch (e) {
    log(`failed after ${((Date.now() - started) / 1000).toFixed(1)}s: ${e.message}`);
    send(res, 500, { type: "error", error: { type: "api_error", message: e.message } }, { "x-should-retry": "false" });
  }
});

const wranglerArgs = ["dev", "--local", "--port", String(PORT)];
if (USE_CLI) {
  await new Promise((resolve, reject) => bridge.once("error", reject).listen(BRIDGE_PORT, "127.0.0.1", resolve));
  log(`bridge on http://127.0.0.1:${BRIDGE_PORT} using ${CLAUDE}`);
  wranglerArgs.push("--var", `ANTHROPIC_BASE_URL:http://127.0.0.1:${BRIDGE_PORT}`, "--var", "ANTHROPIC_API_KEY:local-claude-cli");
}
const dev = spawn(join(ROOT, "node_modules/.bin/wrangler"), wranglerArgs, { cwd: ROOT, stdio: "inherit" });

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  dev.kill("SIGTERM");
  bridge.close();
  rmSync(WORK, { recursive: true, force: true });
  process.exit(code);
}
dev.on("exit", (code) => stop(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => stop(0));

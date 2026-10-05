/**
 * Anonymous sessions and the interview state token.
 * - The session cookie is `<sid>.<expiry>.<HMAC>`: issued after a Turnstile check, it carries no personal data.
 * - The interview state (questions with their hidden scores, answers, evidence) is AES-GCM encrypted with a key
 *   derived from the same secret, so the browser can hold it but neither read nor change it.
 */
import type { InterviewState } from "./types";

const COOKIE = "vv_s";
export const SESSION_TTL = 60 * 60 * 3; // seconds
const STATE_TTL = 1000 * 60 * 60 * 3;
const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes as ArrayBuffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const hmacKey = (secret: string) => crypto.subtle.importKey("raw", enc.encode(`session:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
const aesKey = async (secret: string) =>
  crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", enc.encode(`state:${secret}`)), "AES-GCM", false, ["encrypt", "decrypt"]);

export const newSessionId = () => b64(crypto.getRandomValues(new Uint8Array(16)));

export async function sessionCookie(secret: string, sid: string, secure: boolean, now = Date.now()): Promise<string> {
  const exp = Math.floor(now / 1000) + SESSION_TTL;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(`${sid}.${exp}`));
  return `${COOKIE}=${sid}.${exp}.${b64(sig)}; Path=/api; Max-Age=${SESSION_TTL}; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

/** The session id from a valid, unexpired cookie, or null. */
export async function readSession(secret: string, cookieHeader: string | null, now = Date.now()): Promise<string | null> {
  const raw = (cookieHeader ?? "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const [sid, exp, sig] = (raw ?? "").split(".");
  if (!sid || !exp || !sig || !/^\d+$/.test(exp) || Number(exp) * 1000 < now) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), unb64(sig), enc.encode(`${sid}.${exp}`));
    return ok ? sid : null;
  } catch {
    return null;
  }
}

export async function sealState(secret: string, state: InterviewState): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), enc.encode(JSON.stringify(state)));
  return `v1.${b64(iv)}.${b64(body)}`;
}

/** The state from a token this Worker issued to this session, or null if it was tampered with, is someone else's, or is too old. */
export async function openState(secret: string, token: unknown, sid: string, now = Date.now()): Promise<InterviewState | null> {
  if (typeof token !== "string" || token.length > 120_000) return null;
  const [v, iv, body] = token.split(".");
  if (v !== "v1" || !iv || !body) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(secret), unb64(body));
    const state = JSON.parse(dec.decode(plain)) as InterviewState;
    if (state.v !== 1 || state.sid !== sid || now - state.started > STATE_TTL) return null;
    return state;
  } catch {
    return null;
  }
}

export async function sha256Hex(text: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Shapes shared by the prompts, the scoring and the Worker. */

export type Ctx = { state: string; age: string; gender: string; family: string; job: string };
export type Locale = "en" | "es" | "pt" | "zh" | "ru";

export type Widget = "either" | "options" | "slider";

/** One answer choice. The person sees only `text`; `position` and `strength` never leave the Worker. */
export type Option = { text: string; position: number; strength: number };

export type Asked = {
  id: number;
  domain: string;
  type: Widget;
  prompt: string;
  options: Option[];
  left: string;
  right: string;
  source: "ai" | "library";
};

export type Reply = { kind: "option"; index: number } | { kind: "slider"; value: number } | { kind: "text"; text: string };

/** What one answer says about one domain: where on the 0-100 line, and how firmly. */
export type Evidence = { domain: string; position: number; strength: number; kind: "option" | "slider" | "text"; quote?: string };

/** `evidence` is null for a free-text answer until the model has classified it (and stays null if it reveals nothing). */
export type Turn = { q: Asked; reply: Reply; evidence: Evidence | null; classified: boolean };

/** The interview so far. It travels to the browser only as an encrypted token. */
export type InterviewState = {
  v: 1;
  sid: string;
  started: number;
  ctx: Ctx;
  locale: Locale;
  turns: Turn[];
  pending: Asked[];
  library: string[];
};

export type Versions = { model_version: string; prompt_version: string; scoring_version: string; candidate_data_version: string };

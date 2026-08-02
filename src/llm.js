// Shared plumbing for reaching a model. There are two ways out of here and
// the difference is which machine holds the prompt.
//
//   callTask()   the hosted path. Sends only the user prompt to plangolin's
//                service, which holds the system prompt, the schema and the
//                key. Needs no configuration, which is the point: the first
//                run of `npx plangolin` should draw something, not stop to
//                ask for an API key.
//
//   callModel()  the direct path. Caller supplies the system prompt and
//                schema and the user supplies the key. Nothing leaves the
//                machine except the call itself.
//
// Only generate() is still on callModel; complete and review are gone with
// the buttons that reached them. Everything the product does now — scan,
// describe, group, structure — goes through callTask.

// jsonMode: "schema" asks the API to enforce the shape (the real OpenAI and
// Gemini endpoints support this). Some OpenAI-compatible gateways — third-
// party proxies, self-hosted models — accept the request but never reply
// when strict schema enforcement is on. "object" falls back to plain "return
// JSON" mode with the schema only described in the prompt; validate() in the
// caller already treats every field as untrusted, so an unenforced shape is
// still safe, just not guaranteed on the first try.
export const PROVIDERS = {
  openai: {
    url: () => process.env.OPENAI_BASE_URL || "https://api.openai.com/v1/chat/completions",
    key: "OPENAI_API_KEY",
    model: () => process.env.OPENAI_MODEL || "gpt-5.6-terra",
    jsonMode: () => process.env.OPENAI_JSON_MODE || "schema",
  },
  anthropic: {
    url: () => process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1/messages",
    key: "ANTHROPIC_API_KEY",
    model: () => process.env.ANTHROPIC_MODEL || "claude-opus-5",
  },
  gemini: {
    url: () => process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    key: "GEMINI_API_KEY",
    model: () => process.env.GEMINI_MODEL || "gemini-2.5-flash",
    jsonMode: () => process.env.GEMINI_JSON_MODE || "schema",
  },
};

export function pickProvider() {
  const wanted = process.env.PLANGOLIN_PROVIDER;
  if (wanted) return PROVIDERS[wanted] ? wanted : null;
  return Object.keys(PROVIDERS).find((p) => process.env[PROVIDERS[p].key]) || null;
}

function request(provider, system, prompt, schemaName, schema) {
  const p = PROVIDERS[provider];
  const key = process.env[p.key];
  const model = p.model();
  const url = p.url();

  if (provider === "anthropic") {
    return [url, { "x-api-key": key, "anthropic-version": "2023-06-01" }, {
      model, max_tokens: 16000, system,
      output_config: { effort: "medium", format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: prompt }],
    }];
  }

  // Reasoning effort for OpenAI's reasoning-capable models — the Anthropic
  // branch above has had an equivalent dial (`effort`) since the start; this
  // one didn't, so every OpenAI call was left at whatever the model's own
  // default happens to be. "high" errs toward quality: these are on-demand,
  // human-triggered calls, not something firing per keystroke.
  const jsonMode = p.jsonMode ? p.jsonMode() : "schema";
  if (jsonMode === "object") {
    return [url, { authorization: "Bearer " + key }, {
      model, reasoning_effort: "high",
      messages: [
        { role: "system", content: system + `\n\nReply with a single JSON object matching this shape ` +
          `(field names and nesting matter; do not add commentary outside the JSON):\n${JSON.stringify(schema)}` },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    }];
  }
  return [url, { authorization: "Bearer " + key }, {
    model, reasoning_effort: "high",
    messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
    response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } },
  }];
}

/** Send one prompt to whichever provider has a key configured, and return the
    parsed JSON reply. Throws with `.noKey` set if nothing is configured. */
export async function callModel({ system, prompt, schemaName, schema }) {
  const provider = pickProvider();
  if (!provider) {
    const e = new Error(
      "No API key found. Add one to a .env file in this directory (" + process.cwd() + "), " +
      "or export it in your shell — OPENAI_API_KEY, ANTHROPIC_API_KEY or GEMINI_API_KEY — then restart plangolin.");
    e.noKey = true;
    throw e;
  }

  const [url, headers, body] = request(provider, system, prompt, schemaName, schema);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${provider} returned ${res.status} — ${text.slice(0, 300)}`);
  }
  const data = await res.json();

  let text;
  if (provider === "anthropic") {
    // Safety classifiers can decline — check before touching content.
    if (data.stop_reason === "refusal") throw new Error("The model declined this request.");
    if (data.stop_reason === "max_tokens") throw new Error("The reply was cut off. Try a shorter description.");
    text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  } else {
    text = data.choices?.[0]?.message?.content || "";
  }

  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new Error("The model's reply wasn't valid JSON."); }

  return { parsed, provider, model: PROVIDERS[provider].model() };
}

// Where the hosted half lives. Overridable so `PLANGOLIN_SERVICE_URL=http://
// localhost:8787 plangolin` runs the whole pipeline against a service on this
// machine — which is how you change a prompt and see the result without
// deploying.
export const SERVICE_URL =
  process.env.PLANGOLIN_SERVICE_URL || "https://plangolin-production.up.railway.app";

/** Ask plangolin's service to run a named task. The system prompt and schema
    live there; only `prompt` — built here, from this project's own files —
    goes over the wire.

    Errors carry `.userFacing` when the message is already fit to show
    someone: a daily limit is not a bug and should not be reported as one. */
export async function callTask({ task, prompt }) {
  const { installId } = await import("./install-id.js");

  let res;
  try {
    res = await fetch(`${SERVICE_URL}/v1/${task}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ installId: installId(), prompt }),
      signal: AbortSignal.timeout(180000),
    });
  } catch (err) {
    const e = new Error(
      err.name === "TimeoutError"
        ? "plangolin's service took too long to answer. Try again."
        : `Couldn't reach plangolin's service (${SERVICE_URL}). Check your connection.`);
    e.userFacing = true;
    e.offline = true;
    throw e;
  }

  let data;
  try { data = await res.json(); }
  catch { throw new Error(`plangolin's service returned ${res.status} with an unreadable body.`); }

  if (!res.ok) {
    const e = new Error(data.error || `plangolin's service returned ${res.status}.`);
    e.userFacing = true;
    if (res.status === 429) e.rateLimited = true;
    throw e;
  }

  return { parsed: data.parsed, provider: data.provider, model: data.model, quota: data.quota };
}

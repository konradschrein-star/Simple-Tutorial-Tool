import { callLLM } from "../llm-client.js";

export interface GenerateScriptParams {
  provider: string; // LLMProviderId
  prompt: string;
  apiKey: string; // "" for gemini_pool
  model?: string;
  timeoutMs?: number;
}

function requireKey(apiKey: string, provider: string): string {
  if (!apiKey) throw new Error(`Missing API key for provider "${provider}"`);
  return apiKey;
}

async function openaiChat(p: GenerateScriptParams): Promise<string> {
  const key = requireKey(p.apiKey, p.provider);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: p.model ?? "gpt-4o-mini",
      messages: [{ role: "user", content: p.prompt }],
    }),
    signal: AbortSignal.timeout(p.timeoutMs ?? 120_000),
  });
  if (!res.ok)
    throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return json.choices[0]?.message?.content ?? "";
}

async function googleGemini(p: GenerateScriptParams): Promise<string> {
  const key = requireKey(p.apiKey, p.provider);
  const model = p.model ?? "gemini-3.1-flash-lite";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: p.prompt }] }] }),
      signal: AbortSignal.timeout(p.timeoutMs ?? 120_000),
    },
  );
  if (!res.ok)
    throw new Error(`Google Gemini error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return (
    json.candidates?.[0]?.content?.parts?.map((x) => x.text ?? "").join("") ??
    ""
  );
}

// OpenAI-compatible endpoints (Minimax + Qwen/DashScope both expose /chat/completions)
async function openAICompatible(
  p: GenerateScriptParams,
  baseUrl: string,
  defaultModel: string,
): Promise<string> {
  const key = requireKey(p.apiKey, p.provider);
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: p.model ?? defaultModel,
      messages: [{ role: "user", content: p.prompt }],
    }),
    signal: AbortSignal.timeout(p.timeoutMs ?? 120_000),
  });
  if (!res.ok)
    throw new Error(`${p.provider} error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return json.choices[0]?.message?.content ?? "";
}

export async function generateScript(p: GenerateScriptParams): Promise<string> {
  switch (p.provider) {
    case "gemini_pool":
      return callLLM(p.prompt, {
        provider: "gemini_pool",
        timeoutMs: p.timeoutMs,
      });
    case "google_gemini":
      return googleGemini(p);
    case "openai":
      return openaiChat(p);
    case "minimax_llm":
      return openAICompatible(p, "https://api.minimax.io/v1", "abab6.5s-chat");
    case "qwen_hosted":
      return openAICompatible(
        p,
        "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        "qwen-plus",
      );
    case "qwen_local":
      throw new Error("qwen_local is coming soon");
    default:
      throw new Error(`Unknown LLM provider: ${p.provider}`);
  }
}

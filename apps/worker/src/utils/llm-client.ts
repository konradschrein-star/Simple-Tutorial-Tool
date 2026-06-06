/**
 * LLM Client
 *
 * Provider-agnostic text completion. Reads provider from env:
 *   LLM_PROVIDER=gemini_pool (default) | anthropic
 *
 * Gemini pool: POST /v1/chat { prompt } → { text }
 *   GEMINI_POOL_URL (default: http://127.0.0.1:8090)
 *   GEMINI_POOL_API_KEY
 *
 * Anthropic fallback: uses ANTHROPIC_API_KEY with claude-sonnet-4-6.
 */

import { createContextLogger } from "./logger.js";

const logger = createContextLogger("llm-client");

const GEMINI_POOL_URL =
  process.env["GEMINI_POOL_URL"] ?? "http://127.0.0.1:8090";
const GEMINI_POOL_API_KEY = process.env["GEMINI_POOL_API_KEY"] ?? "";

export interface LLMCallOptions {
  maxTokens?: number;
  timeoutMs?: number;
  /** Override env LLM_PROVIDER for this call. */
  provider?: "gemini_pool" | "anthropic";
}

/**
 * Call the configured LLM provider with a single prompt string.
 *
 * Returns the response text. Throws on HTTP error or timeout.
 */
export async function callLLM(
  prompt: string,
  options: LLMCallOptions = {},
): Promise<string> {
  const { timeoutMs = 120_000 } = options;
  const provider =
    options.provider ?? process.env["LLM_PROVIDER"] ?? "gemini_pool";

  if (provider === "gemini_pool") {
    return callGeminiPool(prompt, timeoutMs);
  }

  return callAnthropic(prompt, options);
}

async function callGeminiPool(
  prompt: string,
  timeoutMs: number,
): Promise<string> {
  logger.info(
    { url: `${GEMINI_POOL_URL}/v1/chat`, prompt_length: prompt.length },
    "Calling Gemini pool",
  );

  const response = await fetch(`${GEMINI_POOL_URL}/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": GEMINI_POOL_API_KEY,
    },
    body: JSON.stringify({ prompt }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Gemini pool error ${response.status}: ${body.slice(0, 300)}`,
    );
  }

  const data = (await response.json()) as { text: string; account: string };
  logger.info(
    { account: data.account, response_length: data.text.length },
    "Gemini pool response received",
  );
  return data.text;
}

async function callAnthropic(
  prompt: string,
  options: LLMCallOptions,
): Promise<string> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] });
  const maxTokens = options.maxTokens ?? 8_000;

  logger.info(
    { prompt_length: prompt.length, max_tokens: maxTokens },
    "Calling Anthropic",
  );

  let text = "";
  const stream = client.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });

  for await (const chunk of stream) {
    if (
      chunk.type === "content_block_delta" &&
      chunk.delta.type === "text_delta"
    ) {
      text += chunk.delta.text;
    }
  }

  logger.info({ response_length: text.length }, "Anthropic response received");
  return text;
}

import Anthropic from "@anthropic-ai/sdk";

export function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.startsWith("sk-ant-...") || apiKey === "sk-ant-placeholder") {
    throw new Error("ANTHROPIC_API_KEY is not configured in .env. Please set a valid Anthropic API key to use AI features.");
  }
  return new Anthropic({ apiKey });
}

export const CLAUDE_MODEL = "claude-3-5-sonnet-20241022";

/**
 * Call Claude with a system + user prompt, expecting strict JSON output.
 */
export async function callClaudeJSON<T>(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 2000
): Promise<T> {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("");

  // Strip markdown code fences if Claude wraps JSON in them
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error(`Claude returned non-JSON response: ${cleaned.slice(0, 200)}`);
  }
}

/**
 * Call Claude for plain-text output (e.g. progress insights narrative).
 */
export async function callClaudeText(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 800
): Promise<string> {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  return response.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("");
}


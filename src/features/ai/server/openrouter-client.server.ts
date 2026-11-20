/**
 * OpenRouter TypeScript Client & Streaming SDK Interface
 *
 * Implements full compatibility with @openrouter/sdk patterns:
 * - Streaming support via AsyncIterable<OpenRouterStreamChunk>
 * - Extraction of reasoning tokens (chunk.usage.completionTokensDetails.reasoningTokens)
 * - Integration with $100 credit guardrail engine (checkOpenRouterBudget)
 * - Zero external npm dependencies (native Node.js 22 fetch + AsyncGenerators)
 */

import {
  checkOpenRouterBudget,
  recordOpenRouterUsage,
  tripOpenRouterCircuit,
  isFreeOpenRouterModel,
} from "./openrouter-guardrail.server.ts";
import { scanPromptInjection } from "./ai-guard.server.ts";

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionTokensDetails {
  reasoningTokens?: number;
  reasoning_tokens?: number;
  acceptedPredictionTokens?: number;
  rejectedPredictionTokens?: number;
}

export interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  completionTokensDetails?: CompletionTokensDetails;
  completion_tokens_details?: CompletionTokensDetails;
}

export interface OpenRouterStreamChunk {
  id?: string;
  model?: string;
  choices: Array<{
    index?: number;
    delta?: {
      role?: string;
      content?: string;
      reasoning?: string;
    };
    finish_reason?: string | null;
  }>;
  usage?: OpenRouterUsage;
}

export interface OpenRouterChatResponse {
  id?: string;
  model?: string;
  choices: Array<{
    index?: number;
    message: {
      role: string;
      content: string | null;
      reasoning?: string;
    };
    finish_reason?: string;
  }>;
  usage?: OpenRouterUsage;
}

export interface OpenRouterChatRequest {
  model?: string;
  models?: string[];
  messages: OpenRouterMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  include_reasoning?: boolean;
  signal?: AbortSignal;
}

export class OpenRouter {
  apiKey: string;
  baseUrl: string;

  constructor(options?: { apiKey?: string; baseUrl?: string }) {
    this.apiKey = options?.apiKey?.trim() || process.env.OPENROUTER_API_KEY?.trim() || "";
    this.baseUrl = (options?.baseUrl || "https://openrouter.ai/api/v1").replace(/\/$/, "");
  }

  chat = {
    send: async (params: {
      chatRequest: OpenRouterChatRequest & { stream: true };
    }): Promise<AsyncIterable<OpenRouterStreamChunk>> => {
      return this._sendStream(params.chatRequest);
    },
    sendNonStreaming: async (params: {
      chatRequest: OpenRouterChatRequest & { stream?: false };
    }): Promise<OpenRouterChatResponse> => {
      return this._sendNonStreaming(params.chatRequest);
    },
  };

  private async _preflight(chatRequest: OpenRouterChatRequest): Promise<{
    model: string;
    apiKey: string;
  }> {
    const apiKey = this.apiKey || process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY missing. Cannot initiate OpenRouter request.");
    }

    const model = chatRequest.model?.trim() || process.env.OPENROUTER_MODEL || "google/gemma-4-31b-it:free";

    // Injection scan on user messages
    for (const msg of chatRequest.messages) {
      if (msg.role === "user") {
        const scan = scanPromptInjection(msg.content);
        if (scan.risk === "detected") {
          throw new Error(`Adversarial prompt injection detected: ${scan.flags.join(", ")}`);
        }
      }
    }

    // Guardrail budget check
    const guard = await checkOpenRouterBudget({ model });
    if (!guard.allowed) {
      throw new Error(`OpenRouter guardrail blocked request: ${guard.reason}`);
    }

    return { model, apiKey };
  }

  private async _sendStream(
    chatRequest: OpenRouterChatRequest,
  ): Promise<AsyncIterable<OpenRouterStreamChunk>> {
    const { model, apiKey } = await this._preflight(chatRequest);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://vetta.ai",
      "X-Title": "Vetta ATS Autonomous Agent",
    };

    const models = chatRequest.models || (
      isFreeOpenRouterModel(model) && !model.includes("nemotron")
        ? [model, "nvidia/nemotron-3.5-lightning:free"]
        : [model]
    );

    const payload: Record<string, unknown> = {
      messages: chatRequest.messages,
      stream: true,
      temperature: chatRequest.temperature ?? 0.2,
      max_tokens: chatRequest.max_tokens ?? 2048,
    };

    if (models.length > 1) {
      payload.models = models;
    } else {
      payload.model = model;
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: chatRequest.signal,
    });

    if (res.status === 402) {
      tripOpenRouterCircuit("OpenRouter payment required (402). Insufficient credit balance.");
      throw new Error("OpenRouter 402: Insufficient credit balance.");
    }

    if (res.status === 429) {
      throw new Error("OpenRouter 429: Rate limit exceeded.");
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`OpenRouter HTTP ${res.status}: ${errText || res.statusText}`);
    }

    const body = res.body;
    if (!body) {
      throw new Error("OpenRouter returned empty response body.");
    }

    return parseSSEStream(body, model);
  }

  private async _sendNonStreaming(
    chatRequest: OpenRouterChatRequest,
  ): Promise<OpenRouterChatResponse> {
    const { model, apiKey } = await this._preflight(chatRequest);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://vetta.ai",
      "X-Title": "Vetta ATS Autonomous Agent",
    };

    const models = chatRequest.models || (
      isFreeOpenRouterModel(model) && !model.includes("nemotron")
        ? [model, "nvidia/nemotron-3.5-lightning:free"]
        : [model]
    );

    const payload: Record<string, unknown> = {
      messages: chatRequest.messages,
      stream: false,
      temperature: chatRequest.temperature ?? 0.2,
      max_tokens: chatRequest.max_tokens ?? 2048,
    };

    if (models.length > 1) {
      payload.models = models;
    } else {
      payload.model = model;
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: chatRequest.signal,
    });

    if (res.status === 402) {
      tripOpenRouterCircuit("OpenRouter payment required (402). Insufficient credit balance.");
      throw new Error("OpenRouter 402: Insufficient credit balance.");
    }

    if (res.status === 429) {
      throw new Error("OpenRouter 429: Rate limit exceeded.");
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`OpenRouter HTTP ${res.status}: ${errText || res.statusText}`);
    }

    const data = (await res.json()) as OpenRouterChatResponse;
    normalizeUsage(data.usage);

    recordOpenRouterUsage({
      model,
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      reasoningTokens: data.usage?.completionTokensDetails?.reasoningTokens,
    });

    return data;
  }
}

/**
 * Normalizes usage object to ensure completionTokensDetails.reasoningTokens is always populated.
 */
function normalizeUsage(usage?: OpenRouterUsage): void {
  if (!usage) return;
  const rawDetails = usage.completion_tokens_details || usage.completionTokensDetails;
  const reasoningTokens =
    rawDetails?.reasoningTokens ??
    rawDetails?.reasoning_tokens ??
    (rawDetails as Record<string, unknown> | undefined)?.["reasoning_tokens"] as number | undefined;

  usage.completionTokensDetails = {
    ...rawDetails,
    reasoningTokens: typeof reasoningTokens === "number" ? reasoningTokens : undefined,
  };
}

/**
 * Reads a Node/Web ReadableStream of Server-Sent Events (SSE) and yields chunks.
 */
async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
  model: string,
): AsyncIterable<OpenRouterStreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  let promptTokens = 0;
  let completionTokens = 0;
  let reasoningTokens: number | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":") || trimmed === "data: [DONE]") {
          continue;
        }

        if (trimmed.startsWith("data: ")) {
          const jsonStr = trimmed.slice(6).trim();
          try {
            const chunk = JSON.parse(jsonStr) as OpenRouterStreamChunk;
            normalizeUsage(chunk.usage);

            if (chunk.usage?.prompt_tokens) promptTokens = chunk.usage.prompt_tokens;
            if (chunk.usage?.completion_tokens) completionTokens = chunk.usage.completion_tokens;
            if (chunk.usage?.completionTokensDetails?.reasoningTokens !== undefined) {
              reasoningTokens = chunk.usage.completionTokensDetails.reasoningTokens;
            }

            yield chunk;
          } catch {
            // Ignore malformed chunk
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
    recordOpenRouterUsage({
      model,
      promptTokens,
      completionTokens,
      reasoningTokens,
    });
  }
}

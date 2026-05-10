// POST /api/broker/chat
//
// Tool-aware SSE proxy to DeepSeek. Streams OpenAI-format chat.completion
// chunks to the client. Each model turn may emit tool_calls which are
// executed server-side, results appended to the message array, and the
// model re-invoked. The loop runs at most MAX_TOOL_ITERATIONS times.
//
// In addition to the standard delta streams, the route emits two
// custom SSE events the UI can render:
//   data: {"ds_tool_call":{"id","name","args"}}
//   data: {"ds_tool_result":{"id","name","result","error","latency_ms"}}
//
// Persistence (unchanged contract): user message saved before the stream;
// assistant message saved after stream completes. When the assistant turn
// includes tool_calls, the persisted payload includes them + the tool
// results so future turns retain context.

import { NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import {
  DEEPSEEK_BASE_URL,
  DEEPSEEK_MODEL_API_NAME,
  type DeepseekModelId,
  type DeepseekUsage,
} from "@/lib/deepseek-client";
import { DS_TOOL_DEFINITIONS, executeTool } from "@/lib/ds-tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ChatToolCall {
  id: string;
  type?: "function";
  function: { name: string; arguments: string };
}

interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string | null;
  reasoning_content?: string | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface ChatBody {
  actor?: string;
  model?: DeepseekModelId;
  thinking?: boolean;
  messages?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  session_slug?: string;
}

const ASSISTANT_ACTOR = "ds-chat-onboard";
const BOOT_PROMPT_SLUG = "n-boot-prompt-ds-onboard";
const BOOT_PROMPT_FALLBACK =
  "You are DS, the onboard agent for the cntxos workspace. Be tight, helpful, honest about your limits.";
const BOOT_PROMPT_TTL_MS = 60_000;
const MAX_TOOL_ITERATIONS = 10;

let bootPromptCache: { content: string; fetchedAt: number } | null = null;

async function getBootPromptTemplate(): Promise<string> {
  const now = Date.now();
  if (bootPromptCache && now - bootPromptCache.fetchedAt < BOOT_PROMPT_TTL_MS) {
    return bootPromptCache.content;
  }
  try {
    const sb = getServerSupabase();
    const { data, error } = await sb
      .schema("context_os")
      .from("nodes")
      .select("content")
      .eq("slug", BOOT_PROMPT_SLUG)
      .maybeSingle();
    if (error || !data?.content) return BOOT_PROMPT_FALLBACK;
    bootPromptCache = { content: data.content as string, fetchedAt: now };
    return bootPromptCache.content;
  } catch {
    return BOOT_PROMPT_FALLBACK;
  }
}

function brokerSlug(actor: string): string {
  return `conv-broker-${actor}`;
}

async function ensureBrokerNode(actor: string, slug: string) {
  const sb = getServerSupabase();
  const { data: existing } = await sb
    .schema("context_os")
    .from("nodes")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (existing) return;
  await sb.rpc("admin_create_broker_session", {
    p_slug: slug,
    p_content: `Broker chat conversation for ${actor}`,
    p_payload: {
      actor,
      kind: "broker-chat",
      title: "new chat",
      archived: false,
      created_at: new Date().toISOString(),
    },
  });
}

async function maybeAutoTitle(apiKey: string, slug: string, firstUserMessage: string) {
  const sb = getServerSupabase();
  const { data: node } = await sb
    .schema("context_os")
    .from("nodes")
    .select("id, payload")
    .eq("slug", slug)
    .maybeSingle();
  if (!node) return;
  const payload = (node.payload ?? {}) as Record<string, unknown>;
  const title = (payload.title as string | undefined) ?? "";
  if (title && title !== "new chat" && title !== "default") return;
  try {
    const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL_API_NAME["deepseek-v4-flash"],
        messages: [
          { role: "system", content: "Summarize the user's intent in 4-6 words. Reply with only the title, no quotes." },
          { role: "user", content: firstUserMessage.slice(0, 1000) },
        ],
        max_tokens: 24,
        stream: false,
      }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!raw) return;
    const cleaned = raw.replace(/^["'`]+|["'`]+$/g, "").slice(0, 80);
    if (!cleaned) return;
    await (sb.schema("context_os") as unknown as { rpc: typeof sb.rpc }).rpc("admin_node_set_payload", {
      p_slug: slug,
      p_payload_patch: { title: cleaned },
    });
  } catch {
    /* best-effort */
  }
}

async function postEvent(actor: string, slug: string, payload: Record<string, unknown>) {
  const sb = getServerSupabase();
  const { error } = await sb.rpc("admin_post_event", {
    p_actor: actor,
    p_slug: slug,
    p_kind: "message",
    p_payload: payload,
    p_outcome: null,
  });
  if (error) console.error("[broker/chat] persist error:", error.message);
}

// Run one streaming pass against DeepSeek. Forwards content deltas to the
// client and accumulates assistant content + tool_calls + usage.
async function streamOnePass(opts: {
  apiKey: string;
  model: DeepseekModelId;
  thinking: boolean;
  messages: ChatMessage[];
  sse: (obj: unknown) => void;
  rawForward: (chunk: Uint8Array) => void;
}): Promise<{
  content: string;
  reasoningContent: string;
  toolCalls: ChatToolCall[];
  finishReason: string | null;
  usage?: DeepseekUsage;
  error?: string;
}> {
  const { apiKey, model, thinking, messages, sse, rawForward } = opts;
  const upstream = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL_API_NAME[model],
      messages,
      tools: DS_TOOL_DEFINITIONS,
      stream: true,
      stream_options: { include_usage: true },
      extra_body: { thinking: { type: thinking ? "enabled" : "disabled" } },
    }),
  });
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return {
      content: "",
      reasoningContent: "",
      toolCalls: [],
      finishReason: null,
      error: `upstream ${upstream.status}: ${text.slice(0, 300)}`,
    };
  }

  const decoder = new TextDecoder();
  const reader = upstream.body.getReader();
  let buf = "";
  let content = "";
  let reasoningContent = "";
  let finishReason: string | null = null;
  let usage: DeepseekUsage | undefined;
  // Accumulate tool calls by index — DeepSeek streams arguments in fragments.
  const tcByIdx: Map<number, { id: string; name: string; arguments: string }> = new Map();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // Forward delta bytes to the client so existing UI keeps streaming.
      rawForward(value);
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, "");
        buf = buf.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{
              delta?: {
                content?: string;
                reasoning_content?: string;
                tool_calls?: Array<{
                  index: number;
                  id?: string;
                  type?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
              finish_reason?: string;
            }>;
            usage?: DeepseekUsage;
          };
          const choice = parsed.choices?.[0];
          const delta = choice?.delta;
          if (typeof delta?.content === "string") content += delta.content;
          if (typeof delta?.reasoning_content === "string") reasoningContent += delta.reasoning_content;
          if (Array.isArray(delta?.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const cur = tcByIdx.get(tc.index) ?? { id: "", name: "", arguments: "" };
              if (tc.id) cur.id = tc.id;
              if (tc.function?.name) cur.name = tc.function.name;
              if (tc.function?.arguments) cur.arguments += tc.function.arguments;
              tcByIdx.set(tc.index, cur);
            }
          }
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          if (parsed.usage) usage = parsed.usage;
        } catch {
          /* ignore partial JSON */
        }
      }
    }
  } catch (err) {
    return {
      content,
      reasoningContent,
      toolCalls: [],
      finishReason,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const toolCalls: ChatToolCall[] = [];
  // Iterate by ascending index for deterministic order.
  const indices = [...tcByIdx.keys()].sort((a, b) => a - b);
  for (const i of indices) {
    const t = tcByIdx.get(i)!;
    if (!t.name) continue;
    toolCalls.push({
      id: t.id || `call_${i}_${Date.now()}`,
      type: "function",
      function: { name: t.name, arguments: t.arguments || "{}" },
    });
  }

  // If model emitted tool_calls but the client only sees plain text deltas,
  // we want to surface them. Notify per-call before execution.
  for (const tc of toolCalls) {
    sse({
      ds_tool_call: {
        id: tc.id,
        name: tc.function.name,
        args: tc.function.arguments,
      },
    });
  }

  return { content, reasoningContent, toolCalls, finishReason, usage };
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "DEEPSEEK_API_KEY not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const actor = (body.actor ?? "").trim();
  const model: DeepseekModelId =
    body.model === "deepseek-v4-pro" ? "deepseek-v4-pro" : "deepseek-v4-flash";
  const thinking = !!body.thinking;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!actor) {
    return new Response(JSON.stringify({ error: "actor required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (messages.length === 0) {
    return new Response(JSON.stringify({ error: "messages required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const requestedSlug = (body.session_slug ?? "").trim();
  const prefix = brokerSlug(actor);
  const slug =
    requestedSlug && (requestedSlug === prefix || requestedSlug.startsWith(`${prefix}-`))
      ? requestedSlug
      : prefix;
  await ensureBrokerNode(actor, slug);

  let isFirstUserMessage = false;
  {
    const sb = getServerSupabase();
    const { data: node } = await sb
      .schema("context_os")
      .from("nodes")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (node) {
      const { count } = await sb
        .schema("context_os")
        .from("events")
        .select("id", { head: true, count: "exact" })
        .eq("subject_node_id", node.id as string)
        .eq("event_kind", "message");
      isFirstUserMessage = (count ?? 0) === 0;
    }
  }

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (lastUser) {
    await postEvent(actor, slug, {
      role: "user",
      content: lastUser.content,
      model,
      thinking,
    });
  }

  const bootTemplate = await getBootPromptTemplate();
  const bootSystem = bootTemplate.replace(/\{actor\}/g, actor);

  // Build the working message array as ChatMessage[] (loop-mutable).
  const working: ChatMessage[] = [
    { role: "system", content: bootSystem },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sse = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      const rawForward = (chunk: Uint8Array) => controller.enqueue(chunk);

      let finalContent = "";
      let finalUsage: DeepseekUsage | undefined;
      const persistedToolHistory: Array<{
        tool_calls?: ChatToolCall[];
        tool_results?: Array<{ tool_call_id: string; name: string; content: string }>;
      }> = [];

      try {
        for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
          const pass = await streamOnePass({
            apiKey,
            model,
            thinking,
            messages: working,
            sse,
            rawForward,
          });
          if (pass.error) {
            sse({ error: pass.error });
            break;
          }
          if (pass.usage) finalUsage = pass.usage;
          if (pass.content) finalContent += pass.content;

          if (pass.finishReason !== "tool_calls" || pass.toolCalls.length === 0) {
            // Done. Last assistant content is the final answer.
            break;
          }

          // Add the assistant message (with tool_calls) to history. DeepSeek
          // thinking-mode requires reasoning_content be passed back verbatim.
          working.push({
            role: "assistant",
            content: pass.content || null,
            reasoning_content: pass.reasoningContent || null,
            tool_calls: pass.toolCalls,
          });

          // Execute each tool sequentially; stream a result event per call.
          const turnResults: Array<{ tool_call_id: string; name: string; content: string }> = [];
          for (const tc of pass.toolCalls) {
            const ex = await executeTool(tc.function.name, tc.function.arguments, {
              actor,
            });
            const resultJson = JSON.stringify(ex.result);
            sse({
              ds_tool_result: {
                id: tc.id,
                name: ex.name,
                result: ex.result,
                error: ex.error ?? null,
                latency_ms: ex.latency_ms,
              },
            });
            working.push({
              role: "tool",
              tool_call_id: tc.id,
              name: ex.name,
              content: resultJson,
            });
            turnResults.push({ tool_call_id: tc.id, name: ex.name, content: resultJson });
          }
          persistedToolHistory.push({ tool_calls: pass.toolCalls, tool_results: turnResults });

          if (iter === MAX_TOOL_ITERATIONS - 1) {
            sse({ error: `tool iteration cap reached (${MAX_TOOL_ITERATIONS})` });
          }
        }
      } catch (err) {
        sse({ error: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();

        // Persist final assistant turn. Embed tool history so the next turn
        // can see what was done. The visible 'content' is the model's final
        // text answer. Tools are an addendum.
        if (finalContent || persistedToolHistory.length > 0) {
          postEvent(ASSISTANT_ACTOR, slug, {
            role: "assistant",
            content: finalContent,
            usage: finalUsage ?? null,
            model,
            thinking,
            tool_history: persistedToolHistory,
          }).catch(() => {});
        }
        if (isFirstUserMessage && finalContent && lastUser) {
          maybeAutoTitle(apiKey, slug, lastUser.content).catch(() => {});
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

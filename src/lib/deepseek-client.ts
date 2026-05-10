// DeepSeek client config — small helper centralizing model IDs, pricing, and
// per-role defaults. Kept minimal per Randy 2026-05-09 (build to ship).
//
// DeepSeek is OpenAI-format compatible; we use plain fetch with stream:true
// to https://api.deepseek.com/chat/completions. The `openai` npm package is
// NOT a dep of viewer — we deliberately avoid adding it.

export type DeepseekModelId = "deepseek-v4-flash" | "deepseek-v4-pro";

// Map our friendly IDs to DeepSeek API model strings. (DeepSeek's current
// public model names; if upstream renames these we update here.)
export const DEEPSEEK_MODEL_API_NAME: Record<DeepseekModelId, string> = {
  "deepseek-v4-flash": "deepseek-v4-flash",
  "deepseek-v4-pro": "deepseek-v4-pro",
};

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

// Pricing in USD per token. Sourced from prompt 2026-05-09:
//   V4 Flash: input cache miss $0.14/M, hit $0.0028/M, output $0.28/M
//   V4 Pro:   input cache miss $0.435/M, hit $0.003625/M, output $0.87/M
//             (75% promo discount through 2026-05-31; 4× after)
export interface ModelPricing {
  inputCacheMissPerToken: number;
  inputCacheHitPerToken: number;
  outputPerToken: number;
}

const PROMO_END = new Date("2026-05-31T23:59:59Z").getTime();

export function getPricing(model: DeepseekModelId, now: Date = new Date()): ModelPricing {
  if (model === "deepseek-v4-flash") {
    return {
      inputCacheMissPerToken: 0.14 / 1_000_000,
      inputCacheHitPerToken:  0.0028 / 1_000_000,
      outputPerToken:         0.28 / 1_000_000,
    };
  }
  // V4 Pro — promo through 2026-05-31, 4× after.
  const proPromo: ModelPricing = {
    inputCacheMissPerToken: 0.435 / 1_000_000,
    inputCacheHitPerToken:  0.003625 / 1_000_000,
    outputPerToken:         0.87 / 1_000_000,
  };
  if (now.getTime() <= PROMO_END) return proPromo;
  return {
    inputCacheMissPerToken: proPromo.inputCacheMissPerToken * 4,
    inputCacheHitPerToken:  proPromo.inputCacheHitPerToken  * 4,
    outputPerToken:         proPromo.outputPerToken         * 4,
  };
}

export interface DeepseekUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

// Compute USD cost for a single chat completion based on usage + model.
// Falls back to treating all prompt tokens as cache-miss when the API
// doesn't return hit/miss split.
export function computeCost(usage: DeepseekUsage, model: DeepseekModelId, now: Date = new Date()): number {
  const p = getPricing(model, now);
  const completion = usage.completion_tokens ?? 0;
  const promptTotal = usage.prompt_tokens ?? 0;
  const hit = usage.prompt_cache_hit_tokens ?? 0;
  const miss = usage.prompt_cache_miss_tokens ?? Math.max(0, promptTotal - hit);
  return hit * p.inputCacheHitPerToken
       + miss * p.inputCacheMissPerToken
       + completion * p.outputPerToken;
}

// Per-role defaults — keep small; expand when a real role config lands.
export interface RoleConfig {
  systemPrompt?: string;
  defaultModel: DeepseekModelId;
  thinkingDefault: boolean;
}

const ROLE_DEFAULTS: Record<string, RoleConfig> = {
  randy: { defaultModel: "deepseek-v4-flash", thinkingDefault: false },
  nancy: { defaultModel: "deepseek-v4-flash", thinkingDefault: false },
};

export function getRoleConfig(actor: string | null | undefined): RoleConfig {
  if (actor && ROLE_DEFAULTS[actor]) return ROLE_DEFAULTS[actor];
  return { defaultModel: "deepseek-v4-flash", thinkingDefault: false };
}

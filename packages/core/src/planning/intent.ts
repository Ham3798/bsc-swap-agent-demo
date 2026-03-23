import { GoogleGenAI } from "@google/genai"

import type {
  MissingFieldResolution,
  PlanningEvent,
  PlanningSessionState,
  StructuredIntent,
  UnknownField
} from "@bsc-swap-agent-demo/shared"

export async function extractIntent(rawInput: string): Promise<StructuredIntent> {
  return extractIntentWithFallback(rawInput)
}

export function hydratePlanningState(
  response: {
    intent: StructuredIntent
    missingFieldsResolved: MissingFieldResolution[]
    partialEvents?: PlanningEvent[]
  },
  rawInput: string,
  userAnswer: string,
  missingField?: UnknownField
): PlanningSessionState {
  if (missingField === "sell_token" || missingField === "buy_token") {
    const normalizedToken = userAnswer.trim().toUpperCase()
    if (!normalizedToken) {
      return {
        rawInput,
        intent: response.intent,
        missingFieldsResolved: response.missingFieldsResolved,
        events: response.partialEvents ?? []
      }
    }

    return {
      rawInput,
      intent: {
        ...response.intent,
        sellToken: missingField === "sell_token" ? normalizedToken : response.intent.sellToken,
        buyToken: missingField === "buy_token" ? normalizedToken : response.intent.buyToken,
        unknowns: response.intent.unknowns.filter((item) => item !== missingField)
      },
      missingFieldsResolved: [
        ...response.missingFieldsResolved,
        {
          field: missingField,
          value: normalizedToken,
          source: "user"
        }
      ],
      events: response.partialEvents ?? []
    }
  }

  const amountMatch = userAnswer.match(/(\d+(?:\.\d+)?)/)
  if (!amountMatch) {
    return {
      rawInput,
      intent: response.intent,
      missingFieldsResolved: response.missingFieldsResolved,
      events: response.partialEvents ?? []
    }
  }

  const amount = amountMatch[1]
  return {
    rawInput,
    intent: {
      ...response.intent,
      amount,
      unknowns: response.intent.unknowns.filter((item) => item !== "amount")
    },
    missingFieldsResolved: [
      ...response.missingFieldsResolved,
      {
        field: "amount",
        value: amount,
        source: "user"
      }
    ],
    events: response.partialEvents ?? []
  }
}

async function extractIntentWithFallback(rawInput: string): Promise<StructuredIntent> {
  try {
    return await extractIntentWithGemini(rawInput)
  } catch (error) {
    if (isQuotaError(error)) {
      const fallback = extractIntentDeterministically(rawInput)
      if (fallback) {
        return fallback
      }
      throw new Error("Intent parsing unavailable: Gemini quota exhausted")
    }

    if (isGeminiResponseError(error)) {
      const fallback = extractIntentDeterministically(rawInput)
      if (fallback) {
        return fallback
      }
      throw new Error("Intent parsing failed: Gemini returned an invalid response")
    }

    throw error
  }
}

async function extractIntentWithGemini(rawInput: string): Promise<StructuredIntent> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY. LLM intent extraction is required in this stage.")
  }

  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash"
  const response = await client.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              "Extract swap intent from user input. Return JSON only with fields: " +
              "action, sellToken, buyToken, amount, slippageBps, preferences {preferPrivate, preferFast, avoidStale}, unknowns."
          },
          {
            text: rawInput
          }
        ]
      }
    ]
  })
  const content = response.text
  if (!content) {
    throw new Error("Gemini did not return intent content.")
  }

  try {
    const parsed = parseGeminiIntentPayload(content)
    return normalizeIntent(parsed)
  } catch (error) {
    throw new Error(
      `Failed to parse Gemini intent JSON: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

function stripJsonFences(input: string): string {
  const trimmed = input.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced ? fenced[1].trim() : trimmed
}

function parseGeminiIntentPayload(content: string): {
  action?: string
  sellToken?: string | null
  buyToken?: string | null
  amount?: string | null
  slippageBps?: number | null
  preferences?: {
    preferPrivate?: boolean | null
    preferFast?: boolean | null
    avoidStale?: boolean | null
  }
  unknowns?: UnknownField[]
} {
  const parsed = JSON.parse(stripJsonFences(content)) as Record<string, unknown>
  const preferences = asRecord(parsed.preferences)
  const action = asString(parsed.action)
  const sellToken =
    asNullableString(parsed.sellToken) ??
    asNullableString(parsed.sell_token) ??
    asNullableString(parsed.fromToken) ??
    asNullableString(parsed.from_token)
  const buyToken =
    asNullableString(parsed.buyToken) ??
    asNullableString(parsed.buy_token) ??
    asNullableString(parsed.toToken) ??
    asNullableString(parsed.to_token)
  const amount =
    asNullableString(parsed.amount) ??
    asNullableString(parsed.amountIn) ??
    asNullableString(parsed.amount_in)
  const slippageBps =
    asNullableNumber(parsed.slippageBps) ??
    asNullableNumber(parsed.slippage_bps)
  const unknowns = normalizeUnknownFields(parsed.unknowns)

  return {
    action,
    sellToken,
    buyToken,
    amount,
    slippageBps,
    preferences: {
      preferPrivate:
        asNullableBoolean(preferences?.preferPrivate) ??
        asNullableBoolean(preferences?.prefer_private),
      preferFast:
        asNullableBoolean(preferences?.preferFast) ??
        asNullableBoolean(preferences?.prefer_fast),
      avoidStale:
        asNullableBoolean(preferences?.avoidStale) ??
        asNullableBoolean(preferences?.avoid_stale)
    },
    unknowns
  }
}

function normalizeIntent(parsed: {
  action?: string
  sellToken?: string | null
  buyToken?: string | null
  amount?: string | null
  slippageBps?: number | null
  preferences?: {
    preferPrivate?: boolean | null
    preferFast?: boolean | null
    avoidStale?: boolean | null
  }
  unknowns?: UnknownField[]
}): StructuredIntent {
  const unknowns = new Set<UnknownField>(parsed.unknowns ?? [])
  if (!parsed.sellToken) unknowns.add("sell_token")
  if (!parsed.buyToken) unknowns.add("buy_token")
  if (!parsed.amount) unknowns.add("amount")
  return {
    action: parsed.action === "swap" ? "swap" : "unknown",
    sellToken: parsed.sellToken?.toUpperCase() ?? null,
    buyToken: parsed.buyToken?.toUpperCase() ?? null,
    amount: parsed.amount ?? null,
    slippageBps: parsed.slippageBps ?? null,
    preferences: {
      preferPrivate: parsed.preferences?.preferPrivate ?? null,
      preferFast: parsed.preferences?.preferFast ?? null,
      avoidStale: parsed.preferences?.avoidStale ?? null
    },
    unknowns: Array.from(unknowns)
  }
}

export function extractIntentDeterministically(rawInput: string): StructuredIntent | null {
  const normalized = rawInput.trim()
  const lower = normalized.toLowerCase()

  const englishAll = lower.match(/change all my\s+([a-z0-9-]+)(?:\s+tokens?)?\s+to\s+([a-z0-9-]+)/i)
  if (englishAll) {
    return normalizeIntent({
      action: "swap",
      sellToken: englishAll[1],
      buyToken: englishAll[2],
      amount: "all"
    })
  }

  const englishSwap = lower.match(/swap\s+(\d+(?:\.\d+)?)\s+([a-z0-9-]+)\s+to\s+([a-z0-9-]+)/i)
  if (englishSwap) {
    return normalizeIntent({
      action: "swap",
      amount: englishSwap[1],
      sellToken: englishSwap[2],
      buyToken: englishSwap[3]
    })
  }

  const koreanAll = normalized.match(/내\s*(?:모든|전부)\s*([A-Za-z0-9-]+)\s*([A-Za-z0-9-]+)로\s*바꿔줘/i)
  if (koreanAll) {
    return normalizeIntent({
      action: "swap",
      amount: "all",
      sellToken: koreanAll[1],
      buyToken: koreanAll[2]
    })
  }

  const koreanAmount = normalized.match(/내\s*([A-Za-z0-9-]+)\s*(\d+(?:\.\d+)?)개?\s*([A-Za-z0-9-]+)로\s*바꿔줘/i)
  if (koreanAmount) {
    return normalizeIntent({
      action: "swap",
      sellToken: koreanAmount[1],
      amount: koreanAmount[2],
      buyToken: koreanAmount[3]
    })
  }

  return null
}

function isQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes("RESOURCE_EXHAUSTED") || message.includes("Quota exceeded")
}

function isGeminiResponseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes("Gemini did not return intent content") ||
    message.includes("Failed to parse Gemini intent JSON")
  )
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function asNullableString(value: unknown): string | null | undefined {
  if (value == null) return null
  if (typeof value === "string") return value.trim() || null
  if (typeof value === "number") return String(value)
  return undefined
}

function asNullableNumber(value: unknown): number | null | undefined {
  if (value == null) return null
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function asNullableBoolean(value: unknown): boolean | null | undefined {
  if (value == null) return null
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true
    if (value.toLowerCase() === "false") return false
  }
  return undefined
}

function normalizeUnknownFields(value: unknown): UnknownField[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter(
    (item): item is UnknownField =>
      item === "sell_token" || item === "buy_token" || item === "amount" || item === "slippage_bps"
  )
}

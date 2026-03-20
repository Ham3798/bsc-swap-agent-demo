import { GoogleGenAI } from "@google/genai"

import type {
  MissingFieldResolution,
  PlanningEvent,
  PlanningSessionState,
  StructuredIntent,
  UnknownField
} from "@bsc-swap-agent-demo/shared"

export async function extractIntent(rawInput: string): Promise<StructuredIntent> {
  return extractIntentWithOpenAI(rawInput)
}

export function hydratePlanningState(
  response: {
    intent: StructuredIntent
    missingFieldsResolved: MissingFieldResolution[]
    partialEvents?: PlanningEvent[]
  },
  rawInput: string,
  userAnswer: string
): PlanningSessionState {
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

async function extractIntentWithOpenAI(rawInput: string): Promise<StructuredIntent> {
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
    const parsed = JSON.parse(stripJsonFences(content)) as {
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
    }
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

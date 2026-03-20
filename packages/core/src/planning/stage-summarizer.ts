import { GoogleGenAI } from "@google/genai"

import type {
  DecisionTraceField,
  DecisionTraceStage,
  MevRiskAssessment,
  PriceImpactAssessment,
  RouteCandidate,
  StructuredIntent,
  SubmissionCandidate
} from "@bsc-swap-agent-demo/shared"

export const STAGE_SUMMARY_PROMPT_VERSION = "stage-summary-v1"

export interface StageSummaryInput {
  stage: DecisionTraceStage
  intent: StructuredIntent
  toolObservations: DecisionTraceField[]
  currentCandidates?: RouteCandidate[]
  recommendedCandidate?: RouteCandidate
  rejectedCandidates?: Array<{ id: string; reason: string }>
  mevAssessment?: MevRiskAssessment
  priceImpactAssessment?: PriceImpactAssessment
  submissionCandidates?: SubmissionCandidate[]
}

export interface StageSummaryOutput {
  summary: string
  decision: string
  observations?: DecisionTraceField[]
}

export type StageSummarizer = (input: StageSummaryInput) => Promise<StageSummaryOutput>

export async function summarizeStageWithLLM(input: StageSummaryInput): Promise<StageSummaryOutput> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY. LLM stage summaries require Gemini.")
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
              "You are summarizing one stage of a BSC swap execution planner. " +
              "Do not reveal chain-of-thought. Do not mention hidden reasoning. " +
              "Return JSON only with keys summary, decision, observations. " +
              "summary must be 1-2 sentences. decision must be 1 sentence. " +
              "observations must be an array of at most 3 {label,value} pairs. " +
              "Use only the provided structured inputs."
          },
          {
            text: JSON.stringify(input)
          }
        ]
      }
    ],
    config: {
      responseMimeType: "application/json"
    }
  })

  const content = response.text
  if (!content) {
    throw new Error("Gemini did not return a stage summary.")
  }

  const parsed = JSON.parse(stripJsonFences(content)) as {
    summary?: string
    decision?: string
    observations?: DecisionTraceField[]
  }
  if (!parsed.summary || !parsed.decision) {
    throw new Error("Gemini stage summary response was missing required fields.")
  }

  return {
    summary: parsed.summary.trim(),
    decision: parsed.decision.trim(),
    observations: Array.isArray(parsed.observations) ? parsed.observations.slice(0, 3) : []
  }
}

function stripJsonFences(input: string): string {
  const trimmed = input.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced ? fenced[1].trim() : trimmed
}

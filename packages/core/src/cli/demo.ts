import readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { config as loadEnv } from "dotenv"
import { toUserFacingErrorMessage } from "@bsc-swap-agent-demo/shared"

import { BnbCapabilityRegistry } from "../capabilities/registry"
import { executePlannedPrivateSwap } from "../execution/live-swap"
import {
  formatExecutedSwap,
  formatCliCheckpoint,
  formatCliStreamingEvent,
  formatDebugPlan,
  formatPlan,
  toDebugJson,
  toPresentationJson
} from "../format/output"
import { finalizePlan, streamPlanningContinuation, streamPlanningSession } from "../session/store"

loadEnv()

async function main() {
  const args = process.argv.slice(2)
  const debugMode = args.includes("--debug")
  const jsonMode = args.includes("--json")
  const debugJsonMode = args.includes("--debug-json")
  const dryRunMode = args.includes("--dry-run")
  const noSubmitMode = args.includes("--no-submit")
  const rawInput = args.filter((arg) => !arg.startsWith("--")).join(" ")
  const rl = readline.createInterface({ input, output })
  const registry = new BnbCapabilityRegistry()
  const emittedCheckpoints = new Set<string>()
  let liveEvents: import("@bsc-swap-agent-demo/shared").PlanningEvent[] = []

  try {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("Missing GEMINI_API_KEY. Gemini intent extraction is required.")
    }
    if (!process.env.DEMO_WALLET_ADDRESS) {
      throw new Error("Missing DEMO_WALLET_ADDRESS. Account-aware RPC simulation is required.")
    }
    if (!process.env.BSC_RPC_URL && ((process.env.DEMO_NETWORK as "bsc" | "bsc-testnet" | undefined) ?? "bsc") === "bsc") {
      throw new Error("Missing BSC_RPC_URL. Direct RPC simulation is required.")
    }

    const initialPrompt = rawInput || (await rl.question("User: "))
    const sessionId = crypto.randomUUID()
    if (!debugMode && !jsonMode && !debugJsonMode) {
      console.log("Thinking...")
    }
    let stream = streamPlanningSession({
      sessionId,
      message: initialPrompt,
      network: (process.env.DEMO_NETWORK as "bsc" | "bsc-testnet") || "bsc",
      walletAddress: process.env.DEMO_WALLET_ADDRESS || undefined,
      registry
    })

    while (true) {
      let followUpQuestion: string | null = null
      for await (const event of stream) {
        liveEvents = [...liveEvents, event]
        if (debugMode) {
          if (event.kind === "reasoning" && event.data?.reasoningSource === "llm") {
            console.log(`[${event.stage}] llm-summary: ${event.message}`)
          } else if (event.kind === "reasoning") {
            console.log(`[${event.stage}] reasoning: ${event.message}`)
          } else {
            console.log(`[${event.stage}] ${event.kind}: ${event.message}`)
          }
        } else if (!jsonMode && !debugJsonMode) {
          const checkpoint = checkpointForEvent(event)
          if (checkpoint && !emittedCheckpoints.has(checkpoint)) {
            const checkpointBlock = formatCliCheckpoint({
              events: liveEvents,
              checkpoint,
              result: event.kind === "plan-completed" ? event.data?.result : undefined
            })
            if (checkpointBlock) {
              emittedCheckpoints.add(checkpoint)
              console.log(checkpointBlock)
            }
          }
          const cliLine = formatCliStreamingEvent(event)
          if (cliLine) {
            console.log(cliLine)
          }
        }
        if (event.kind === "follow-up-required") {
          followUpQuestion = event.data?.question ?? event.message
        }
      }

      if (!followUpQuestion) {
        break
      }

      console.log(`\nAssistant:\n${followUpQuestion}\n`)
      const answer = await rl.question("User: ")
      stream = streamPlanningContinuation({
        sessionId,
        answer,
        registry
      })
    }

    const result = finalizePlan(sessionId)
    const shouldExecuteLive = !dryRunMode && !noSubmitMode
    const execution = shouldExecuteLive
      ? await executePlannedPrivateSwap({
          result,
          network: (process.env.DEMO_NETWORK as "bsc" | "bsc-testnet") || "bsc",
          walletAddress: process.env.DEMO_WALLET_ADDRESS || undefined,
          registry,
          onTrace:
            !debugMode && !jsonMode && !debugJsonMode
              ? (line) => {
                  console.log(line)
                }
              : undefined
        })
      : undefined
    const rendered = debugJsonMode
      ? JSON.stringify({ plan: toDebugJson(result), execution }, null, 2)
      : jsonMode
        ? JSON.stringify({ plan: toPresentationJson(result), execution }, null, 2)
        : debugMode
          ? [formatDebugPlan(result), execution ? JSON.stringify(execution, null, 2) : null].filter(Boolean).join("\n\n")
          : execution
            ? formatExecutedSwap(result, execution)
            : formatPlan(result)
    console.log(`\nAssistant:\n${rendered}\n`)
  } catch (error) {
    const message = error instanceof Error ? toUserFacingErrorMessage(error.message) : "Planning failed."
    console.log(`\nAssistant:\n${message}\n`)
  } finally {
    await registry.close()
    rl.close()
  }
}

void main()

function checkpointForEvent(
  event: import("@bsc-swap-agent-demo/shared").PlanningEvent
): "intent" | "tokens" | "quotes" | "payload" | "submission" | "ready" | null {
  if (event.kind === "tool-succeeded" && event.stage === "liquidity-discovery" && event.data?.toolName === "resolveToken") {
    return "tokens"
  }
  if (event.kind !== "stage-completed") {
    return null
  }
  if (event.stage === "execution-family-selection") {
    return "intent"
  }
  return null
}

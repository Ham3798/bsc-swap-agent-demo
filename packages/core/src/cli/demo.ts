import readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { config as loadEnv } from "dotenv"
import { toUserFacingErrorMessage } from "@bsc-swap-agent-demo/shared"

import { BnbCapabilityRegistry } from "../capabilities/registry"
import { executePlannedPrivateSwap } from "../execution/live-swap"
import {
  applyDashboardFailure,
  applyExecutionTraceToDashboard,
  applyPlanningEventToDashboard,
  createDashboardState,
  formatExecutedSwap,
  formatDebugPlan,
  formatPlan,
  finalizeDashboardFromExecution,
  renderDashboard,
  toDebugJson,
  toPresentationJson
} from "../format/output"
import { finalizePlan, streamPlanningContinuation, streamPlanningSession } from "../session/store"

loadEnv()
let lastDashboardRender = ""

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
  const network = ((process.env.DEMO_NETWORK as "bsc" | "bsc-testnet" | undefined) ?? "bsc")
  let liveEvents: import("@bsc-swap-agent-demo/shared").PlanningEvent[] = []
  let dashboard = createDashboardState(rawInput, network)
  const dashboardMode = !debugMode && !jsonMode && !debugJsonMode && Boolean(output.isTTY)
  lastDashboardRender = ""

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
    dashboard = createDashboardState(initialPrompt, network)
    const sessionId = crypto.randomUUID()
    if (dashboardMode) {
      drawIfChanged(renderDashboard(dashboard))
    }
    let stream = streamPlanningSession({
      sessionId,
      message: initialPrompt,
      network,
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
        } else if (dashboardMode) {
          dashboard = applyPlanningEventToDashboard(dashboard, event)
          drawIfChanged(renderDashboard(dashboard))
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
          network,
          walletAddress: process.env.DEMO_WALLET_ADDRESS || undefined,
          registry,
          onTrace:
            dashboardMode
              ? (line) => {
                  dashboard = applyExecutionTraceToDashboard(dashboard, line)
                  drawIfChanged(renderDashboard(dashboard))
                }
              : undefined
        })
      : undefined
    if (dashboardMode) {
      dashboard = finalizeDashboardFromExecution(dashboard, result, execution)
      drawIfChanged(renderDashboard(dashboard))
    }
    const rendered = debugJsonMode
      ? JSON.stringify({ plan: toDebugJson(result), execution }, null, 2)
      : jsonMode
        ? JSON.stringify({ plan: toPresentationJson(result), execution }, null, 2)
        : debugMode
          ? [formatDebugPlan(result), execution ? JSON.stringify(execution, null, 2) : null].filter(Boolean).join("\n\n")
          : execution
            ? formatExecutedSwap(result, execution)
            : formatPlan(result)
    if (dashboardMode) {
      output.write("\n")
    } else {
      console.log(`\nAssistant:\n${rendered}\n`)
    }
  } catch (error) {
    const message = error instanceof Error ? toUserFacingErrorMessage(error.message) : "Planning failed."
    if (dashboardMode) {
      const failureKind =
        dashboard.swap.txHash || dashboard.swap.nonce || dashboard.phase === "submitting" || dashboard.phase === "confirmed"
          ? "execution"
          : "planning"
      dashboard = applyDashboardFailure(dashboard, message, failureKind, "unknown")
      drawIfChanged(renderDashboard(dashboard), true)
      output.write("\n")
    } else {
      console.log(`\nAssistant:\n${message}\n`)
    }
  } finally {
    await registry.close()
    rl.close()
  }
}

void main()

function drawDashboard(content: string) {
  output.write("\u001b[2J\u001b[H")
  output.write(`${content}\n`)
}

function drawIfChanged(content: string, force = false) {
  if (!force && content === lastDashboardRender) {
    return
  }
  lastDashboardRender = content
  drawDashboard(content)
}

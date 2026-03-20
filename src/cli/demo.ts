import readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { config as loadEnv } from "dotenv"

import { formatPlanningResult } from "../format/output"
import { BnbMcpCapabilityLayer } from "../mcp/client"
import { hydratePlanningState, runSwapExecutionPlanningSkill } from "../skill/swap-execution-planning"
import type { SkillContext } from "../types"

loadEnv()

async function main() {
  const rawInput = process.argv.slice(2).join(" ")
  const rl = readline.createInterface({ input, output })
  const capabilities = new BnbMcpCapabilityLayer()

  const context: SkillContext = {
    network: (process.env.DEMO_NETWORK as SkillContext["network"]) || "bsc",
    walletAddress: process.env.DEMO_WALLET_ADDRESS || undefined,
    submitEnabled: false
  }

  try {
    const initialPrompt =
      rawInput || (await rl.question("User: "))

    let response = await runSwapExecutionPlanningSkill({
      rawInput: initialPrompt,
      context,
      capabilities
    })

    while (response.kind === "follow-up") {
      console.log(`\nAssistant:\n${response.question}\n`)
      const answer = await rl.question("User: ")
      response = await runSwapExecutionPlanningSkill({
        rawInput: `${initialPrompt}\n${answer}`,
        context,
        capabilities,
        state: hydratePlanningState(response, answer)
      })
    }

    console.log(`\nAssistant:\n${formatPlanningResult(response.result)}\n`)
  } finally {
    await capabilities.close()
    rl.close()
  }
}

void main()

import { BnbCapabilityRegistry, streamPlanningSession } from "@bsc-swap-agent-demo/core"
import { toUserFacingErrorMessage } from "@bsc-swap-agent-demo/shared"
import { loadRootEnv } from "../../_lib/load-root-env"
import { replayFixtures, type ReplayFixtureName } from "../../../fixtures/plans"

export async function POST(request: Request) {
  loadRootEnv()

  const body = (await request.json()) as {
    message?: string
    walletAddress?: string
    fixture?: ReplayFixtureName
  }

  if (!body.message) {
    return new Response(JSON.stringify({ error: "Missing message." }), {
      status: 400,
      headers: { "content-type": "application/json" }
    })
  }

  const registry = new BnbCapabilityRegistry()
  const sessionId = crypto.randomUUID()

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const writeEvent = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\n`))
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        if (body.fixture) {
          const fixture = replayFixtures[body.fixture]
          writeEvent("session", { sessionId: fixture.sessionId })
          for (const event of fixture.events) {
            writeEvent("planning-event", event)
          }
          writeEvent("complete", { sessionId: fixture.sessionId })
          return
        }

        const planningStream = streamPlanningSession({
          sessionId,
          message: body.message!,
          walletAddress: body.walletAddress || process.env.DEMO_WALLET_ADDRESS,
          network: (process.env.DEMO_NETWORK as "bsc" | "bsc-testnet") || "bsc",
          registry
        })

        writeEvent("session", { sessionId })
        for await (const event of planningStream) {
          writeEvent("planning-event", event)
        }
        writeEvent("complete", { sessionId })
      } catch (error) {
        writeEvent("error", {
          sessionId,
          error: error instanceof Error ? toUserFacingErrorMessage(error.message) : "Planning failed."
        })
      } finally {
        await registry.close()
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive"
    }
  })
}

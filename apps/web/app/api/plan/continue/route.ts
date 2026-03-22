import { BnbCapabilityRegistry, streamPlanningContinuation } from "@bsc-swap-agent-demo/core"
import { toUserFacingErrorMessage } from "@bsc-swap-agent-demo/shared"
import { loadRootEnv } from "../../_lib/load-root-env"

export async function POST(request: Request) {
  loadRootEnv()

  const body = (await request.json()) as {
    sessionId?: string
    answer?: string
  }

  if (!body.sessionId || !body.answer) {
    return new Response(JSON.stringify({ error: "Missing sessionId or answer." }), {
      status: 400,
      headers: { "content-type": "application/json" }
    })
  }

  const registry = new BnbCapabilityRegistry()
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const writeEvent = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\n`))
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        const planningStream = streamPlanningContinuation({
          sessionId: body.sessionId!,
          answer: body.answer!,
          registry
        })

        writeEvent("session", { sessionId: body.sessionId })
        for await (const event of planningStream) {
          writeEvent("planning-event", event)
        }
        writeEvent("complete", { sessionId: body.sessionId })
      } catch (error) {
        writeEvent("error", {
          sessionId: body.sessionId,
          error: error instanceof Error ? toUserFacingErrorMessage(error.message) : "Continuation failed."
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

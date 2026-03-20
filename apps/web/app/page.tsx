"use client"

import { useMemo, useState, type CSSProperties } from "react"

type TraceField = { label: string; value: string }
type PlanningEvent = {
  id: string
  kind: string
  stage: string
  status: string
  message: string
  data?: {
    toolName?: string
    observations?: TraceField[]
    decision?: string
    reasoningSource?: "deterministic" | "llm"
    model?: string
    promptVersion?: string
    question?: string
    result?: PlanResult
    outputPreview?: TraceField[]
  }
}

type TraceStep = {
  id: string
  stage: string
  title: string
  status: string
  summary: string
  observations: TraceField[]
  decision?: string
}

type PlanResult = {
  recommendedPlan: {
    summary: string
    submissionPath: string
  }
  routeCandidates: Array<{
    id: string
    platform: string
    quotedOutFormatted: string
    priceImpactPct: number
    rejectionReason?: string
  }>
  payloadCandidates: Array<{
    id: string
    type: string
    simulation: { ok: boolean; estimatedGas: string }
  }>
  submissionCandidates: Array<{
    path: string
    availability: string
    recommended: boolean
    rationale: string
  }>
  guardrails: Array<{
    name: string
    status: string
    value: string
    rationale: string
  }>
  decisionTrace: TraceStep[]
}

export default function HomePage() {
  const [message, setMessage] = useState("Swap 0.001 BNB to USDT with low MEV risk")
  const [walletAddress, setWalletAddress] = useState("")
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [followUpQuestion, setFollowUpQuestion] = useState<string | null>(null)
  const [followUpAnswer, setFollowUpAnswer] = useState("")
  const [events, setEvents] = useState<PlanningEvent[]>([])
  const [plan, setPlan] = useState<PlanResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const currentStage = useMemo(() => {
    return [...events].reverse().find((event) => event.status === "running")?.stage ?? events.at(-1)?.stage ?? null
  }, [events])

  async function connectWallet() {
    const ethereum = (window as typeof window & {
      ethereum?: { request(args: { method: string }): Promise<string[]> }
    }).ethereum
    if (!ethereum) {
      setError("MetaMask was not detected in this browser.")
      return
    }
    const accounts = await ethereum.request({ method: "eth_requestAccounts" })
    setWalletAddress(accounts[0] ?? "")
  }

  async function startPlan() {
    setLoading(true)
    setError(null)
    setPlan(null)
    setEvents([])
    setFollowUpQuestion(null)
    setSessionId(null)
    await streamFromEndpoint("/api/plan/start", {
      message,
      walletAddress: walletAddress || undefined
    })
  }

  async function continuePlan() {
    if (!sessionId) return
    setLoading(true)
    setError(null)
    setFollowUpQuestion(null)
    await streamFromEndpoint("/api/plan/continue", {
      sessionId,
      answer: followUpAnswer
    })
    setFollowUpAnswer("")
  }

  async function streamFromEndpoint(url: string, body: object) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })

    if (!response.ok || !response.body) {
      const payload = (await response.json().catch(() => ({ error: "Streaming request failed." }))) as { error?: string }
      setError(payload.error ?? "Streaming request failed.")
      setLoading(false)
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      while (buffer.includes("\n\n")) {
        const separatorIndex = buffer.indexOf("\n\n")
        const chunk = buffer.slice(0, separatorIndex)
        buffer = buffer.slice(separatorIndex + 2)
        handleSseChunk(chunk)
      }
    }

    setLoading(false)
  }

  function handleSseChunk(chunk: string) {
    const lines = chunk.split("\n")
    const event = lines.find((line) => line.startsWith("event:"))?.replace("event:", "").trim()
    const dataLine = lines.find((line) => line.startsWith("data:"))?.replace("data:", "").trim()
    if (!event || !dataLine) return

    const payload = JSON.parse(dataLine) as
      | { sessionId: string }
      | PlanningEvent
      | { sessionId: string; error: string }

    if (event === "session" && "sessionId" in payload) {
      setSessionId(payload.sessionId)
      return
    }

    if (event === "error" && "error" in payload) {
      setError(payload.error)
      setLoading(false)
      return
    }

    if (event !== "planning-event" || !("kind" in payload)) {
      return
    }

    setEvents((current) => [...current, payload])

    if (payload.kind === "follow-up-required") {
      setFollowUpQuestion(payload.data?.question ?? payload.message)
      setLoading(false)
    }

    if (payload.kind === "plan-completed" && payload.data?.result) {
      setPlan(payload.data.result)
      setLoading(false)
    }
  }

  return (
    <main style={{ maxWidth: 1280, margin: "0 auto", padding: 32 }}>
      <h1 style={{ marginTop: 0 }}>BSC Live Planner</h1>
      <p style={{ maxWidth: 760 }}>
        Read-only live planner UI. It streams stage and tool events while the execution-planning engine works, then
        renders the final plan and compact decision trace.
      </p>

      <section style={{ display: "grid", gap: 16, marginBottom: 24 }}>
        <button onClick={connectWallet} style={buttonStyle}>
          {walletAddress ? `Wallet: ${walletAddress}` : "Connect MetaMask"}
        </button>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={3}
          style={textareaStyle}
        />
        <button onClick={startPlan} style={buttonStyle} disabled={loading}>
          {loading ? "Planner running..." : "Generate live plan"}
        </button>
      </section>

      {error ? <section style={errorStyle}>{error}</section> : null}

      {followUpQuestion ? (
        <section style={panelStyle}>
          <h2>Follow-up required</h2>
          <p>{followUpQuestion}</p>
          <input
            value={followUpAnswer}
            onChange={(event) => setFollowUpAnswer(event.target.value)}
            placeholder="Enter the missing value"
            style={inputStyle}
          />
          <button onClick={continuePlan} style={buttonStyle} disabled={loading || !followUpAnswer.trim()}>
            Continue live planning
          </button>
        </section>
      ) : null}

      <section style={gridStyle}>
        <section style={panelStyle}>
          <h2>Current Stage</h2>
          <p>{currentStage ?? "Idle"}</p>
          <p>{loading ? "Planner is actively streaming events." : "No active stream."}</p>
          <p>{sessionId ? `Session: ${sessionId}` : "No active session yet."}</p>
        </section>

        <section style={panelStyle}>
          <h2>Live Activity</h2>
          {events.length ? (
            <div style={{ display: "grid", gap: 10 }}>
              {events.map((event) => (
                <article
                  key={event.id}
                  style={
                    event.kind === "reasoning" && event.data?.reasoningSource === "llm"
                      ? llmTraceCardStyle
                      : traceCardStyle
                  }
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <strong>{event.stage}</strong>
                    <span>{event.kind}</span>
                  </div>
                  <p style={{ margin: "8px 0" }}>{event.message}</p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span style={badgeStyle(event.status)}>{event.status}</span>
                    {event.data?.toolName ? <span style={secondaryBadgeStyle}>{event.data.toolName}</span> : null}
                    {event.kind === "reasoning" && event.data?.reasoningSource === "llm" ? (
                      <span style={llmBadgeStyle}>LLM Summary</span>
                    ) : null}
                  </div>
                  {event.data?.decision ? (
                    <p style={{ margin: "8px 0 0" }}>
                      <strong>Decision:</strong> {event.data.decision}
                    </p>
                  ) : null}
                  {event.data?.outputPreview?.length ? (
                    <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                      {event.data.outputPreview.slice(0, 3).map((field) => (
                        <li key={`${event.id}-${field.label}`}>
                          <strong>{field.label}:</strong> {field.value}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <p>No live activity yet.</p>
          )}
        </section>

        <section style={panelStyle}>
          <h2>Decision Trace</h2>
          {plan?.decisionTrace?.length ? (
            <div style={{ display: "grid", gap: 12 }}>
              {plan.decisionTrace.map((step) => (
                <article key={step.id} style={traceCardStyle}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <strong>{step.title}</strong>
                    <span>{step.status}</span>
                  </div>
                  <p style={{ marginBottom: 8 }}>{step.summary}</p>
                  {step.decision ? (
                    <p style={{ marginTop: 0 }}>
                      <strong>Decision:</strong> {step.decision}
                    </p>
                  ) : null}
                  {step.observations.length ? (
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {step.observations.slice(0, 4).map((field) => (
                        <li key={`${step.id}-${field.label}`}>
                          <strong>{field.label}:</strong> {field.value}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <p>Decision trace will appear after plan completion.</p>
          )}
        </section>

        <section style={panelStyle}>
          <h2>Final Plan</h2>
          {plan ? (
            <>
              <p>{plan.recommendedPlan.summary}</p>
              <p>
                <strong>Submission path:</strong> {plan.recommendedPlan.submissionPath}
              </p>
              <div style={{ display: "grid", gap: 12 }}>
                <div>
                  <strong>Route candidates</strong>
                  <ul style={{ paddingLeft: 18 }}>
                    {plan.routeCandidates.map((candidate) => (
                      <li key={candidate.id}>
                        {candidate.platform}: {candidate.quotedOutFormatted}, impact {candidate.priceImpactPct.toFixed(3)}%
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <strong>Payloads</strong>
                  <ul style={{ paddingLeft: 18 }}>
                    {plan.payloadCandidates.map((payload) => (
                      <li key={payload.id}>
                        {payload.id}: {payload.type}, gas {payload.simulation.estimatedGas}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <strong>Guardrails</strong>
                  <ul style={{ paddingLeft: 18 }}>
                    {plan.guardrails.map((guardrail) => (
                      <li key={guardrail.name}>
                        {guardrail.name}: {guardrail.value}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </>
          ) : (
            <p>Final plan will appear when the stream completes.</p>
          )}
        </section>

        <section style={{ ...panelStyle, gridColumn: "1 / -1" }}>
          <h2>Raw JSON</h2>
          <pre style={preStyle}>{JSON.stringify(plan, null, 2)}</pre>
        </section>
      </section>
    </main>
  )
}

const panelStyle: CSSProperties = {
  background: "#fffdf8",
  border: "1px solid #d9d0c1",
  borderRadius: 16,
  padding: 20
}

const traceCardStyle: CSSProperties = {
  border: "1px solid #e4d8c5",
  borderRadius: 12,
  padding: 12,
  background: "#fff"
}

const llmTraceCardStyle: CSSProperties = {
  ...traceCardStyle,
  border: "1px solid #9f6f35",
  background: "#fff7e8"
}

const gridStyle: CSSProperties = {
  display: "grid",
  gap: 16,
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))"
}

const buttonStyle: CSSProperties = {
  padding: "12px 16px",
  borderRadius: 10,
  border: "1px solid #2f2419",
  background: "#2f2419",
  color: "#fffdf8",
  cursor: "pointer"
}

const textareaStyle: CSSProperties = {
  width: "100%",
  borderRadius: 12,
  border: "1px solid #c9bea9",
  padding: 12,
  font: "inherit"
}

const inputStyle: CSSProperties = {
  width: "100%",
  borderRadius: 12,
  border: "1px solid #c9bea9",
  padding: 12,
  font: "inherit",
  marginBottom: 12
}

const preStyle: CSSProperties = {
  overflowX: "auto",
  background: "#1f1a14",
  color: "#f7f0e5",
  borderRadius: 12,
  padding: 16
}

const errorStyle: CSSProperties = {
  marginBottom: 16,
  background: "#fff0ef",
  color: "#7b1f13",
  border: "1px solid #e8b8b2",
  borderRadius: 12,
  padding: 12
}

function badgeStyle(status: string): CSSProperties {
  const palette =
    status === "running"
      ? { background: "#fff4cc", color: "#7d5b00" }
      : status === "failed"
        ? { background: "#ffe4e1", color: "#8e1f14" }
        : status === "needs-input"
          ? { background: "#eef3ff", color: "#1f4b8e" }
          : { background: "#e9f7ec", color: "#176b34" }

  return {
    ...palette,
    borderRadius: 999,
    padding: "2px 8px",
    fontSize: 12
  }
}

const secondaryBadgeStyle: CSSProperties = {
  background: "#f1ede6",
  color: "#45352a",
  borderRadius: 999,
  padding: "2px 8px",
  fontSize: 12
}

const llmBadgeStyle: CSSProperties = {
  background: "#ffe6b8",
  color: "#7a4d00",
  borderRadius: 999,
  padding: "2px 8px",
  fontSize: 12
}

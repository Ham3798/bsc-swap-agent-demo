"use client"

import { useEffect, useMemo, useState, type CSSProperties } from "react"
import {
  createPartialPresentationTrace,
  createPresentationActivityFeed,
  createPresentationResult,
  toUserFacingErrorMessage,
  type PartialPresentationTraceItem,
  type PlanningEvent,
  type PlanningResult,
  type PresentationActivityItem,
  type PresentationResult,
  type RouteExecutionReadiness,
  type SubmissionChannel
} from "@bsc-swap-agent-demo/shared"

type TraceField = { label: string; value: string }
type RouteCardStatus = "updating" | "fresh" | "stale" | "failed"

type ChatMessage = {
  id: string
  role: "user" | "assistant" | "system"
  title?: string
  body: string
}

type PlanResult = PlanningResult

type InjectedProvider = {
  isMetaMask?: boolean
  providers?: InjectedProvider[]
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
  on?(event: string, listener: (...args: unknown[]) => void): void
  removeListener?(event: string, listener: (...args: unknown[]) => void): void
}

function getMetaMaskProvider(): InjectedProvider | null {
  if (typeof window === "undefined") return null

  const ethereum = (window as typeof window & {
    ethereum?: InjectedProvider
  }).ethereum

  if (!ethereum) return null

  if (ethereum.providers?.length) {
    return ethereum.providers.find((provider) => provider.isMetaMask) ?? null
  }

  return ethereum.isMetaMask ? ethereum : null
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
  const [replayMode, setReplayMode] = useState<"" | "selfExecutedWinner" | "delegatedWinner">("")
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [selectedSubmissionChannel, setSelectedSubmissionChannel] = useState<SubmissionChannel>("public-mempool")
  const [routeCardStatus, setRouteCardStatus] = useState<Record<string, RouteCardStatus>>({})
  const [quoteFreshnessByRoute, setQuoteFreshnessByRoute] = useState<Record<string, number>>({})
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      title: "Execution planner",
      body:
        "Describe a swap goal in natural language. I will stream what I understood, what I compared, and what I recommend while the planner is working."
    }
  ])

  const currentStage = useMemo(() => {
    return [...events].reverse().find((event) => event.status === "running")?.stage ?? events.at(-1)?.stage ?? null
  }, [events])

  const presentation = useMemo<PresentationResult | null>(() => {
    return plan ? createPresentationResult(plan) : null
  }, [plan])

  const selectedRoute = useMemo(() => {
    if (!plan) return null
    return (
      plan.routeCandidates.find((candidate) => candidate.id === selectedRouteId) ??
      plan.routeCandidates.find((candidate) => candidate.id === plan.defaultSelectedRouteId) ??
      plan.routeCandidates[0] ??
      null
    )
  }, [plan, selectedRouteId])

  const selectedRouteReadiness = useMemo<RouteExecutionReadiness | null>(() => {
    if (!plan || !selectedRoute) return null
    return plan.routeExecutionReadiness.find((item) => item.routeId === selectedRoute.id) ?? null
  }, [plan, selectedRoute])

  const selectedPayload = useMemo(() => {
    if (!plan || !selectedRoute) return null
    return (
      plan.payloadCandidates.find(
        (candidate) =>
          candidate.platform === selectedRoute.platform && candidate.routeFamily === selectedRoute.routeFamily
      ) ?? null
    )
  }, [plan, selectedRoute])

  const selectedSubmissionOptions = useMemo(() => {
    if (!plan || !selectedRoute) return []
    return plan.submissionCandidates.filter((candidate) =>
      candidate.routeFamilies.includes(selectedRoute.routeFamily)
    )
  }, [plan, selectedRoute])

  const selectedPublicSubmitRequest = useMemo(() => {
    if (!selectedPayload) return null
    return {
      chainId: 56,
      from: plan?.publicSubmitRequest?.from,
      to: selectedPayload.to,
      data: selectedPayload.data,
      value: selectedPayload.value,
      gas: selectedPayload.simulation.estimatedGas,
      rationale: "Unsigned public mempool request for browser-wallet handoff."
    }
  }, [plan?.publicSubmitRequest?.from, selectedPayload])

  const liveTrace = useMemo<PartialPresentationTraceItem[]>(() => {
    return createPartialPresentationTrace({ events, result: plan })
  }, [events, plan])

  const activityFeed = useMemo<PresentationActivityItem[]>(() => {
    return createPresentationActivityFeed(events)
  }, [events])

  const runningTrace = useMemo(() => {
    return liveTrace.find((item) => item.status === "running") ?? null
  }, [liveTrace])
  const hasSidebar = Boolean(plan || activityFeed.length)
  const planOverview = useMemo(() => buildPlanOverview({ events, plan }), [events, plan])
  const visibleTraceCards = useMemo(() => {
    return liveTrace.filter((block) => block.status !== "pending" || Boolean(plan))
  }, [liveTrace, plan])

  useEffect(() => {
    if (!plan) {
      setSelectedRouteId(null)
      setSelectedSubmissionChannel("public-mempool")
      setRouteCardStatus({})
      setQuoteFreshnessByRoute({})
      return
    }

    const defaultRouteId =
      plan.defaultSelectedRouteId || plan.observedRouteIds[0] || (plan.routeCandidates[0]?.id ?? null)
    setSelectedRouteId((current) => current ?? defaultRouteId)
    setSelectedSubmissionChannel("public-mempool")

    const timestamp = Date.now()
    const freshness = Object.fromEntries(plan.observedRouteIds.map((routeId) => [routeId, timestamp]))
    const statuses = Object.fromEntries(
      plan.observedRouteIds.map((routeId) => [routeId, "fresh" as RouteCardStatus])
    ) as Record<string, RouteCardStatus>
    setQuoteFreshnessByRoute(freshness)
    setRouteCardStatus(statuses)
  }, [plan])

  useEffect(() => {
    if (!Object.keys(quoteFreshnessByRoute).length) return

    const interval = window.setInterval(() => {
      const now = Date.now()
      setRouteCardStatus((current) => {
        const next = { ...current }
        for (const [routeId, timestamp] of Object.entries(quoteFreshnessByRoute)) {
          if ((current[routeId] === "fresh" || current[routeId] === "stale") && now - timestamp > 20_000) {
            next[routeId] = "stale"
          }
        }
        return next
      })
    }, 1000)

    return () => window.clearInterval(interval)
  }, [quoteFreshnessByRoute])

  useEffect(() => {
    const provider = getMetaMaskProvider()
    if (!provider) return

    const syncAccounts = async () => {
      try {
        const accounts = (await provider.request({ method: "eth_accounts" })) as string[]
        setWalletAddress(accounts[0] ?? "")
      } catch {
        // Ignore passive sync failures and keep the current UI state.
      }
    }

    const handleAccountsChanged = (...args: unknown[]) => {
      const accounts = Array.isArray(args[0]) ? (args[0] as string[]) : []
      setWalletAddress(accounts[0] ?? "")
    }

    void syncAccounts()
    provider.on?.("accountsChanged", handleAccountsChanged)

    return () => {
      provider.removeListener?.("accountsChanged", handleAccountsChanged)
    }
  }, [])

  async function connectWallet() {
    try {
      const provider = getMetaMaskProvider()
      if (!provider) {
        setError("MetaMask was not detected in this browser.")
        return
      }

      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[]
      setWalletAddress(accounts[0] ?? "")
    } catch (error) {
      setError(error instanceof Error ? error.message : "Wallet connection failed.")
    }
  }

  async function startPlan() {
    const submittedMessage = message.trim()
    if (!submittedMessage) return

    setLoading(true)
    setError(null)
    setPlan(null)
    setEvents([])
    setSelectedRouteId(null)
    setSelectedSubmissionChannel("public-mempool")
    setRouteCardStatus({
      "skeleton-1": "updating",
      "skeleton-2": "updating",
      "skeleton-3": "updating"
    })
    setQuoteFreshnessByRoute({})
    setFollowUpQuestion(null)
    setFollowUpAnswer("")
    setSessionId(null)
    setChatMessages([
      {
        id: "welcome",
        role: "assistant",
        title: "Execution planner",
        body:
          "Describe a swap goal in natural language. I will stream what I understood, what I compared, and what I recommend while the planner is working."
      },
      {
        id: `user-${Date.now()}`,
        role: "user",
        body: submittedMessage
      }
    ])

    await streamFromEndpoint("/api/plan/start", {
      message: submittedMessage,
      walletAddress: walletAddress || undefined,
      fixture: replayMode || undefined
    })
  }

  async function continuePlan() {
    if (!sessionId || !followUpAnswer.trim()) return

    const answer = followUpAnswer.trim()
    setLoading(true)
    setError(null)
    setFollowUpQuestion(null)
    setChatMessages((current) => [...current, { id: `user-follow-up-${Date.now()}`, role: "user", body: answer }])

    await streamFromEndpoint("/api/plan/continue", {
      sessionId,
      answer
    })
    setFollowUpAnswer("")
  }

  async function streamFromEndpoint(url: string, body: object) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      })

      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => ({ error: "The planner API could not be reached from this browser session." }))) as {
          error?: string
        }
        setError(toUserFacingErrorMessage(payload.error ?? "The planner API could not be reached from this browser session."))
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
    } catch (error) {
      setError(
        toUserFacingErrorMessage(
          error instanceof Error ? error.message : "The planner API could not be reached from this browser session."
        )
      )
    } finally {
      setLoading(false)
    }
  }

  function handleSseChunk(chunk: string) {
    const lines = chunk.split("\n")
    const event = lines.find((line) => line.startsWith("event:"))?.replace("event:", "").trim()
    const dataLine = lines.find((line) => line.startsWith("data:"))?.replace("data:", "").trim()
    if (!event || !dataLine) return

    let payload:
      | { sessionId: string }
      | PlanningEvent
      | { sessionId: string; error: string }

    try {
      payload = JSON.parse(dataLine) as
        | { sessionId: string }
        | PlanningEvent
        | { sessionId: string; error: string }
    } catch {
      setError("The planner stream returned malformed event data.")
      setLoading(false)
      return
    }

    if (event === "session" && "sessionId" in payload) {
      setSessionId(payload.sessionId ?? null)
      return
    }

    if (event === "error" && "error" in payload) {
      const message = toUserFacingErrorMessage(payload.error)
      setError(message)
      setChatMessages((current) => [
        ...current,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant",
          title: "Planner error",
          body: message
        }
      ])
      setLoading(false)
      return
    }

    if (event !== "planning-event" || !("kind" in payload)) {
      return
    }

    setEvents((current) => [...current, payload])

    if (payload.kind === "follow-up-required") {
      const question = payload.data?.question ?? payload.message
      setFollowUpQuestion(question)
      setChatMessages((current) => [
        ...current,
        {
          id: `assistant-follow-up-${payload.id}`,
          role: "assistant",
          title: "I need one more input",
          body: question
        }
      ])
      setLoading(false)
    }

    if (payload.kind === "plan-completed" && payload.data?.result) {
      setPlan(payload.data.result)
      setLoading(false)
    }
  }

  async function executeSelectedRoute() {
    if (!selectedPublicSubmitRequest) {
      setError("The selected route does not have a live public execution payload.")
      return
    }

    const provider = getMetaMaskProvider()
    if (!provider) {
      setError("MetaMask was not detected in this browser.")
      return
    }

    try {
      await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: selectedPublicSubmitRequest.from,
            to: selectedPublicSubmitRequest.to,
            data: selectedPublicSubmitRequest.data,
            value: `0x${BigInt(selectedPublicSubmitRequest.value).toString(16)}`,
            gas: selectedPublicSubmitRequest.gas
              ? `0x${BigInt(selectedPublicSubmitRequest.gas).toString(16)}`
              : undefined
          }
        ]
      })
    } catch (error) {
      setError(error instanceof Error ? error.message : "The selected route could not be sent through MetaMask.")
    }
  }

  return (
    <main style={pageStyle}>
      <style>{`
        @keyframes planner-pulse {
          0% { transform: scale(0.86); opacity: 0.4; }
          50% { transform: scale(1); opacity: 1; }
          100% { transform: scale(0.86); opacity: 0.4; }
        }
        @keyframes planner-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .planner-topbar {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 16px;
          align-items: start;
        }
        .planner-shell {
          display: grid;
          grid-template-columns: minmax(0, 1.5fr) minmax(280px, 360px);
          gap: 18px;
          align-items: start;
        }
        .planner-shell--single {
          grid-template-columns: minmax(0, 1fr);
        }
        .planner-thread {
          min-width: 0;
        }
        .planner-sidebar {
          min-width: 0;
        }
        @media (max-width: 980px) {
          .planner-topbar,
          .planner-shell {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <section className="planner-topbar" style={heroStyle}>
        <div>
          <p style={eyebrowStyle}>BSC execution planner</p>
          <h1 style={heroTitleStyle}>Chat-first planner demo</h1>
          <p style={heroCopyStyle}>
            Watch the planner turn intent into payload, route evidence, and submission guidance on BSC.
          </p>
        </div>
        <div style={heroMetaStyle}>
          <div style={metaRowStyle}>
            <div style={metaPillStyle}>
              <strong>Mode</strong>
              <span>{replayMode === "" ? "Live" : `Replay: ${labelForReplayMode(replayMode)}`}</span>
            </div>
            <div style={metaPillStyle}>
              <strong>Stage</strong>
              <span>{runningTrace?.title ?? currentStage ?? "Idle"}</span>
            </div>
          </div>
          <button onClick={connectWallet} style={primaryButtonStyle}>
            {walletAddress ? `Wallet: ${truncateMiddle(walletAddress)}` : "Connect MetaMask"}
          </button>
          {!walletAddress ? (
            <span style={metaHintStyle}>
              MetaMask is optional. If a server demo wallet is configured, live planning will use it for simulation.
            </span>
          ) : null}
        </div>
      </section>

      <section style={appFrameStyle}>
      <section className={`planner-shell${hasSidebar ? "" : " planner-shell--single"}`} style={shellStyle}>
        <section className="planner-thread" style={chatColumnStyle}>
          <div style={threadStyle}>
            {chatMessages.map((entry) => (
              <article key={entry.id} style={entry.role === "user" ? userBubbleStyle : assistantBubbleStyle}>
                <div style={bubbleHeaderStyle}>
                  <span>{entry.role === "user" ? "You" : entry.title ?? "Planner"}</span>
                </div>
                <p style={bubbleBodyStyle}>{entry.body}</p>
              </article>
            ))}

            {loading || runningTrace ? (
              <article style={assistantBubbleStyle}>
                <div style={bubbleHeaderStyle}>
                  <span>Planner status</span>
                </div>
                <div style={thinkingRowStyle}>
                  <span style={spinnerStyle} />
                  <p style={{ ...bubbleBodyStyle, margin: 0 }}>
                    {runningTrace?.currentSentence ?? "Thinking..."}
                  </p>
                </div>
              </article>
            ) : null}

            {(loading || planOverview.some((item) => item.status !== "pending")) ? (
              <section style={overviewShellStyle}>
                <div style={sectionHeaderRowStyle}>
                  <div>
                    <p style={sectionEyebrowStyle}>Execution planner</p>
                    <h2 style={sectionTitleStyle}>Execution plan overview</h2>
                    <p style={sectionCopyStyle}>
                      Submission path matters on BSC, so the planner treats payload, route, and delivery as one execution problem.
                    </p>
                  </div>
                </div>
                <div style={overviewGridStyle}>
                  {planOverview.map((item) => (
                    <details key={item.label} style={overviewCardStyle}>
                      <summary style={overviewSummaryStyle}>
                        <div>
                          <strong>{item.label}</strong>
                          <div style={overviewCopyStyle}>{item.summary}</div>
                        </div>
                        <StatusPill status={item.status} />
                      </summary>
                      {item.detail ? <p style={detailCopyStyle}>{item.detail}</p> : null}
                    </details>
                  ))}
                </div>
              </section>
            ) : null}

            {visibleTraceCards.length ? (
              <section style={reasoningGridStyle}>
                {visibleTraceCards.map((block) => (
                  <article key={block.title} style={reasoningCardStyle}>
                    <div style={bubbleHeaderStyle}>
                      <span>{displayTraceTitle(block.title)}</span>
                      <StatusPill status={block.status} />
                    </div>
                    <p style={bubbleBodyStyle}>{block.currentSentence}</p>
                    <details style={traceDetailsStyle}>
                      <summary style={summaryToggleStyle}>See tools and observations</summary>
                      <div style={detailsBodyStyle}>
                        {block.details.toolsUsed.length ? (
                          <DetailList title="Tools used" items={block.details.toolsUsed} />
                        ) : null}
                        {block.details.observations.length ? (
                          <DetailFields title="Key observations" fields={block.details.observations} />
                        ) : null}
                        {block.details.decisions.length ? (
                          <DetailList title="Decision" items={block.details.decisions} />
                        ) : null}
                        <div>
                          <strong>Why it matters</strong>
                          <p style={detailCopyStyle}>{block.details.whyItMatters}</p>
                        </div>
                      </div>
                    </details>
                  </article>
                ))}
              </section>
            ) : null}

            {followUpQuestion ? (
              <article style={assistantBubbleStyle}>
                <div style={bubbleHeaderStyle}>
                  <span>I need one more input</span>
                </div>
                <p style={bubbleBodyStyle}>{followUpQuestion}</p>
                <div style={{ display: "grid", gap: 12 }}>
                  <input
                    value={followUpAnswer}
                    onChange={(event) => setFollowUpAnswer(event.target.value)}
                    placeholder="Enter the missing value"
                    style={composerInputStyle}
                  />
                  <button
                    onClick={continuePlan}
                    style={primaryButtonStyle}
                    disabled={loading || !followUpAnswer.trim()}
                  >
                    Continue planning
                  </button>
                </div>
              </article>
            ) : null}

            {loading ? (
              <section style={routePickerStyle}>
                <div style={sectionHeaderRowStyle}>
                  <div>
                    <p style={sectionEyebrowStyle}>Supporting evidence</p>
                    <h2 style={sectionTitleStyle}>Scanning observed routes</h2>
                  </div>
                </div>
                <div style={routeGridStyle}>
                  {[0, 1, 2].map((index) => (
                    <article key={`route-skeleton-${index}`} style={{ ...routeCardStyle, ...routeCardSkeletonStyle }}>
                      <div style={skeletonLineStyle(48)} />
                      <div style={skeletonLineStyle(72)} />
                      <div style={skeletonLineStyle(88)} />
                      <div style={skeletonLineStyle(62)} />
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {plan && presentation ? (
              <section style={routePickerStyle}>
                <div style={sectionHeaderRowStyle}>
                  <div>
                    <p style={sectionEyebrowStyle}>Supporting evidence</p>
                    <h2 style={sectionTitleStyle}>Observed route options</h2>
                    <p style={sectionCopyStyle}>
                      Best price is not best execution. These route cards support the planner’s payload and submission judgement.
                    </p>
                  </div>
                  <button onClick={startPlan} style={secondaryButtonStyle} disabled={loading}>
                    Refresh quotes
                  </button>
                </div>
                <div style={routeGridStyle}>
                  {presentation.routeCards.map((card) => {
                    const isSelected = card.routeId === selectedRoute?.id
                    const status = routeCardStatus[card.routeId] ?? "fresh"
                    return (
                      <article
                        key={card.routeId}
                        style={{
                          ...routeCardStyle,
                          ...(isSelected ? routeCardSelectedStyle : {})
                        }}
                      >
                        <div style={routeCardHeaderStyle}>
                          <div>
                            <strong style={routeProviderStyle}>{card.provider}</strong>
                            <div style={routeMetaStyle}>{card.routeType}</div>
                          </div>
                          <LiveBadge status={status} />
                        </div>
                        <div style={routeMetricGridStyle}>
                          <SummaryRow label="Expected out" value={card.expectedOut} />
                          <SummaryRow label="Estimated gas" value={card.estimatedGas} />
                          <SummaryRow label="Price impact" value={`${card.priceImpactPct.toFixed(3)}%`} />
                          <SummaryRow label="Coverage" value={card.coverageLabel} />
                        </div>
                        <div style={routeNoteStackStyle}>
                          <span style={infoChipStyle}>{card.readinessLabel}</span>
                          <span style={infoChipStyle}>{card.submissionLabel}</span>
                          <span style={infoChipStyle}>
                            {status === "stale" ? "Quote needs refresh" : "Observed quote"}
                          </span>
                        </div>
                        <button
                          onClick={() => setSelectedRouteId(card.routeId)}
                          style={isSelected ? primaryButtonStyle : secondaryButtonStyle}
                        >
                          {isSelected ? "Selected evidence route" : "Pick this route"}
                        </button>
                      </article>
                    )
                  })}
                </div>
              </section>
            ) : null}

            {plan && selectedRoute ? (
              <section style={selectionPanelStyle}>
                <div style={sectionHeaderRowStyle}>
                  <div>
                    <p style={sectionEyebrowStyle}>Selected evidence route</p>
                    <h2 style={sectionTitleStyle}>{selectedRoute.platform}</h2>
                    <p style={sectionCopyStyle}>{presentation?.selectedRouteSummary}</p>
                  </div>
                </div>

                <div style={selectionGridStyle}>
                  <article style={selectionCardStyle}>
                    <h3 style={subsectionTitleStyle}>Execution readiness</h3>
                    <SummaryRow
                      label="Payload"
                      value={selectedRouteReadiness?.payloadReady ? "ready" : "not prepared"}
                    />
                    <SummaryRow
                      label="Simulation"
                      value={selectedRouteReadiness?.simulationOk ? "passed" : "not available"}
                    />
                    <SummaryRow
                      label="Live execution"
                      value={selectedRouteReadiness?.liveExecutable ? "public wallet supported" : "not live"}
                    />
                    {selectedPayload ? (
                      <SummaryRow label="Min out" value={selectedPayload.minOutAmount} />
                    ) : null}
                  </article>

                  <article style={selectionCardStyle}>
                    <h3 style={subsectionTitleStyle}>Submission options for selected route</h3>
                    <div style={{ display: "grid", gap: 10 }}>
                      {selectedSubmissionOptions.map((candidate) => {
                        const isSelected = candidate.submissionChannel === selectedSubmissionChannel
                        return (
                          <button
                            key={`${candidate.submissionChannel}-${candidate.providerName}`}
                            onClick={() => setSelectedSubmissionChannel(candidate.submissionChannel)}
                            style={{
                              ...submissionOptionStyle,
                              ...(isSelected ? submissionOptionSelectedStyle : {})
                            }}
                          >
                            <div style={submissionOptionHeaderStyle}>
                              <strong>{candidate.providerName}</strong>
                              <span style={smallStatusPill(candidate.liveStatus)}>{candidate.liveStatus}</span>
                            </div>
                            <div style={submissionOptionCopyStyle}>{candidate.operationalStatus}</div>
                          </button>
                        )
                      })}
                    </div>
                  </article>
                </div>

                <article style={selectionCardStyle}>
                  <h3 style={subsectionTitleStyle}>Execute selected route</h3>
                  <p style={sectionCopyStyle}>
                    Public wallet execution is the only live handoff in this demo. Private validator RPC and builder
                    relay remain preferred advisory paths.
                  </p>
                  <div style={executeRowStyle}>
                    <button
                      onClick={executeSelectedRoute}
                      style={primaryButtonStyle}
                      disabled={
                        loading ||
                        !selectedRouteReadiness?.liveExecutable ||
                        selectedSubmissionChannel !== "public-mempool"
                      }
                    >
                      Execute via public wallet
                    </button>
                    <span style={helperTextStyle}>
                      {selectedSubmissionChannel === "public-mempool"
                        ? selectedRouteReadiness?.liveExecutable
                          ? "MetaMask will receive the selected route payload."
                          : "This selected route does not currently have a live public payload."
                        : "Selected advisory submission path is not executable from the browser yet."}
                    </span>
                  </div>
                </article>
              </section>
            ) : null}

            {(plan || visibleTraceCards.length) ? (
              <article style={assistantBubbleStyle}>
                <div style={bubbleHeaderStyle}>
                  <span>Why this execution plan?</span>
                </div>
                <p style={bubbleBodyStyle}>
                  {presentation?.recommendationSummary ??
                    "I compared route quality and submission realism before preparing execution."}
                </p>
                <details style={traceDetailsStyle}>
                  <summary style={summaryToggleStyle}>Open planner trace</summary>
                  <div style={detailsBodyStyle}>
                    {visibleTraceCards.map((block) => (
                        <div key={block.title} style={tracePanelStyle}>
                          <div style={bubbleHeaderStyle}>
                            <span>{displayTraceTitle(block.title)}</span>
                            <StatusPill status={block.status} />
                          </div>
                          <p style={detailCopyStyle}>{block.currentSentence}</p>
                          {block.details.toolsUsed.length ? (
                            <DetailList title="Tools used" items={block.details.toolsUsed} />
                          ) : null}
                          {block.details.observations.length ? (
                            <DetailFields title="Key observations" fields={block.details.observations} />
                          ) : null}
                          {block.details.decisions.length ? (
                            <DetailList title="Decision" items={block.details.decisions} />
                          ) : null}
                          <div>
                            <strong>Why it matters</strong>
                            <p style={detailCopyStyle}>{block.details.whyItMatters}</p>
                          </div>
                        </div>
                      ))}
                  </div>
                </details>
              </article>
            ) : null}
          </div>

          <section style={composerShellStyle}>
            <div style={composerTopRowStyle}>
              <select
                value={replayMode}
                onChange={(event) => setReplayMode(event.target.value as typeof replayMode)}
                style={composerInputStyle}
              >
                <option value="">Live mode</option>
                <option value="selfExecutedWinner">Replay: self-executed winner</option>
                <option value="delegatedWinner">Replay: delegated winner</option>
              </select>
              <span style={helperTextStyle}>
                Replay mode keeps the same streaming UX but uses recorded SSE events instead of live Gemini calls.
              </span>
            </div>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={3}
              style={composerTextareaStyle}
              placeholder="Ask for a swap plan in natural language"
            />
            <div style={composerFooterStyle}>
              <span style={helperTextStyle}>
                Prompt example: <code>Swap 0.001 BNB to USDT with low MEV risk</code>
              </span>
              <button onClick={startPlan} style={primaryButtonStyle} disabled={loading}>
                {loading ? "Planner running..." : "Send to planner"}
              </button>
            </div>
          </section>
        </section>

        {hasSidebar ? (
        <aside className="planner-sidebar" style={sidebarStyle}>
          {plan ? (
          <section style={summaryCardStyle}>
            <h2 style={cardTitleStyle}>Observed route confidence</h2>
            {plan ? (
              <div style={{ display: "grid", gap: 10 }}>
                <SummaryRow
                  label="Observed routes"
                  value={plan.observedRouteIds.length >= 3 ? "partial" : "narrow"}
                />
                <SummaryRow
                  label="Coverage audit"
                  value={plan.venueCoverageSnapshot.topDexesObservedByDefiLlama.length ? "available" : "unavailable"}
                />
                <SummaryRow
                  label="Selected route"
                  value={selectedRoute?.platform ?? plan.defaultSelectedRouteId}
                />
              </div>
            ) : null}
          </section>
          ) : null}

          {plan ? (
          <section style={summaryCardStyle}>
            <h2 style={cardTitleStyle}>Execution boundary</h2>
            {plan ? (
              <div style={{ display: "grid", gap: 8 }}>
                <SummaryRow label="Summary" value={presentation?.boundarySummary ?? ""} />
                <SummaryRow label="Live path" value={presentation?.submissionSummary ?? ""} />
                <SummaryRow label="Execution ops available" value={presentation?.executionCapabilitySummary ?? ""} />
                <SummaryRow label="Used in this run" value={presentation?.executionCapabilityUsageSummary ?? ""} />
              </div>
            ) : null}
          </section>
          ) : null}

          {activityFeed.length ? (
          <section style={summaryCardStyle}>
            <h2 style={cardTitleStyle}>Live activity</h2>
            {activityFeed.length ? (
              <div style={{ display: "grid", gap: 10 }}>
                {activityFeed.map((item) => (
                  <div key={item.id} style={activityItemStyle}>
                    <span>{item.label}</span>
                    <StatusPill status={item.status} />
                  </div>
                ))}
              </div>
            ) : null}
          </section>
          ) : null}

          {plan ? (
          <section style={summaryCardStyle}>
            <h2 style={cardTitleStyle}>Details</h2>
            {plan ? (
              <div style={{ display: "grid", gap: 10 }}>
                <details style={detailsStyle}>
                  <summary style={summaryToggleStyle}>See execution comparison</summary>
                  <div style={detailsBodyStyle}>
                    {plan.executionPackages.map((pkg) => (
                      <div key={pkg.id} style={detailItemStyle}>
                        <strong>{pkg.id}</strong>
                        <div>
                          {pkg.routeProvider} · {pkg.routeFamily} · {pkg.payloadType}
                        </div>
                        <div>
                          {pkg.submissionProvider} · {pkg.executionMode} · {pkg.liveStatus}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>

                <details style={detailsStyle}>
                  <summary style={summaryToggleStyle}>See all observed routes</summary>
                  <div style={detailsBodyStyle}>
                    {plan.routeCandidates.map((candidate) => (
                      <div key={candidate.id} style={detailItemStyle}>
                        <strong>{candidate.platform}</strong>
                        <div>{candidate.quotedOutFormatted}</div>
                        <div>Impact {candidate.priceImpactPct.toFixed(3)}%</div>
                        <div>{candidate.providerNative ? "provider-backed" : "modeled"} · {candidate.coverageConfidence}</div>
                      </div>
                    ))}
                  </div>
                </details>

                <details style={detailsStyle}>
                  <summary style={summaryToggleStyle}>See submission options</summary>
                  <div style={detailsBodyStyle}>
                    {plan.submissionCandidates.map((candidate) => (
                      <div key={`${candidate.path}-${candidate.providerName ?? candidate.path}`} style={detailItemStyle}>
                        <strong>{candidate.providerName ?? candidate.path}</strong>
                        <div>{candidate.liveStatus ?? candidate.availability}</div>
                        <div>{candidate.plannerControlLevel ?? "unknown control"}</div>
                        {candidate.verificationStatus ? (
                          <div>verification: {candidate.verificationStatus}</div>
                        ) : null}
                        {candidate.endpointCount ? (
                          <div>
                            endpoints: {candidate.endpointCount}
                            {candidate.endpointSample?.length
                              ? ` (${candidate.endpointSample.join(", ")})`
                              : ""}
                          </div>
                        ) : null}
                        <div>{candidate.trustAssumption ?? "no trust note"}</div>
                      </div>
                    ))}
                  </div>
                </details>

                <details style={detailsStyle}>
                  <summary style={summaryToggleStyle}>See planner boundary</summary>
                  <div style={detailsBodyStyle}>
                    <BoundaryList title="Planner controls" items={plan.executionBoundary.plannerControls} />
                    <BoundaryList title="User signs or approves" items={plan.executionBoundary.userSigns} />
                    <BoundaryList title="External executor controls" items={plan.executionBoundary.externalExecutorControls} />
                  </div>
                </details>

                <details style={detailsStyle}>
                  <summary style={summaryToggleStyle}>See raw debug JSON</summary>
                  <div style={detailsBodyStyle}>
                    <pre style={preStyle}>{JSON.stringify(plan, null, 2)}</pre>
                  </div>
                </details>
              </div>
            ) : null}
          </section>
          ) : null}
        </aside>
        ) : null}
      </section>
      </section>
    </main>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={summaryRowStyle}>
      <span style={summaryLabelStyle}>{label}</span>
      <span style={summaryValueStyle}>{value}</span>
    </div>
  )
}

function StatusPill({ status }: { status: "pending" | "running" | "completed" | "failed" }) {
  const label =
    status === "running" ? "Live" : status === "completed" ? "Done" : status === "failed" ? "Failed" : "Queued"
  return <span style={{ ...statusPillStyle, ...statusTone(status) }}>{label}</span>
}

function LiveBadge({ status }: { status: RouteCardStatus }) {
  const label =
    status === "updating" ? "Updating" : status === "stale" ? "Stale" : status === "failed" ? "Failed" : "Fresh"
  return <span style={{ ...statusPillStyle, ...liveTone(status) }}>{label}</span>
}

function DetailList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <strong>{title}</strong>
      <ul style={detailListStyle}>
        {items.map((item) => (
          <li key={`${title}-${item}`}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

function DetailFields({ title, fields }: { title: string; fields: TraceField[] }) {
  return (
    <div>
      <strong>{title}</strong>
      <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
        {fields.map((field) => (
          <div key={`${title}-${field.label}-${field.value}`} style={fieldRowStyle}>
            <span style={fieldLabelStyle}>{field.label}</span>
            <span>{field.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function BoundaryList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <strong>{title}</strong>
      <ul style={detailListStyle}>
        {items.map((item) => (
          <li key={`${title}-${item}`}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

function detailSummaryLabel(block: PartialPresentationTraceItem) {
  const toolCount = block.details.toolsUsed.length
  const observationCount = block.details.observations.length
  return `See details (${toolCount} tool${toolCount === 1 ? "" : "s"}, ${observationCount} observation${
    observationCount === 1 ? "" : "s"
  })`
}

function displayTraceTitle(title: PartialPresentationTraceItem["title"]) {
  if (title === "What I recommend") {
    return "What I would do"
  }
  return title
}

function buildPlanOverview(input: { events: PlanningEvent[]; plan: PlanResult | null }) {
  const trace = createPartialPresentationTrace({ events: input.events, result: input.plan })
  const understood = trace.find((item) => item.title === "What I understood")
  const compared = trace.find((item) => item.title === "What I compared")
  const recommended = trace.find((item) => item.title === "What I recommend")
  const hasPayload = Boolean(input.plan?.payloadCandidates.some((candidate) => candidate.type === "router-calldata"))
  const submissionChecked = Boolean(input.plan?.submissionCandidates.length || input.events.some((event) => event.stage === "submission-strategy"))
  const dryRunReady = Boolean(input.plan?.routeExecutionReadiness.some((item) => item.simulationOk))

  return [
    {
      label: "Intent parsed",
      status: understood?.status ?? "pending",
      summary: understood?.currentSentence ?? "Waiting for the request to be structured.",
      detail: "The planner first turns the natural-language request into execution constraints."
    },
    {
      label: "Payload built",
      status: hasPayload ? "completed" as const : compared?.status === "running" ? "running" as const : "pending" as const,
      summary: hasPayload ? "A live payload candidate has been built for dry-run execution." : "Payload construction has not finished yet.",
      detail: "This is where the agent stops being a chat assistant and becomes an execution planner."
    },
    {
      label: "Routes compared",
      status: compared?.status ?? "pending",
      summary: compared?.currentSentence ?? "Waiting to compare observed route options.",
      detail: "Best price is not best execution, so route quality and payload safety are checked together."
    },
    {
      label: "Submission paths checked",
      status: submissionChecked ? "completed" as const : recommended?.status === "running" ? "running" as const : "pending" as const,
      summary: submissionChecked ? "Public and advisory private submission paths have been evaluated." : "Submission path review has not finished yet.",
      detail: "On BSC, the submission path matters as much as the transaction itself."
    },
    {
      label: "Dry-run ready",
      status: dryRunReady ? "completed" as const : recommended?.status === "running" ? "running" as const : "pending" as const,
      summary: dryRunReady ? "A route is ready for public wallet handoff after simulation." : "No dry-run-ready route is available yet.",
      detail: "The planner only marks a route ready after payload construction and simulation."
    }
  ]
}

function labelForReplayMode(mode: "" | "selfExecutedWinner" | "delegatedWinner") {
  if (mode === "selfExecutedWinner") return "self-executed winner"
  if (mode === "delegatedWinner") return "delegated winner"
  return "live planning"
}

function truncateMiddle(value: string) {
  if (value.length <= 16) return value
  return `${value.slice(0, 8)}...${value.slice(-6)}`
}

function statusTone(status: "pending" | "running" | "completed" | "failed"): CSSProperties {
  if (status === "running") {
    return {
      background: "rgba(140, 94, 47, 0.14)",
      color: "#8c5e2f"
    }
  }
  if (status === "failed") {
    return {
      background: "rgba(200, 93, 74, 0.14)",
      color: "#c85d4a"
    }
  }
  if (status === "completed") {
    return {
      background: "rgba(54, 107, 58, 0.14)",
      color: "#366b3a"
    }
  }
  return {
    background: "rgba(106, 93, 73, 0.12)",
    color: "#6a5d49"
  }
}

function liveTone(status: RouteCardStatus): CSSProperties {
  if (status === "updating") {
    return {
      background: "rgba(140, 94, 47, 0.14)",
      color: "#8c5e2f"
    }
  }
  if (status === "stale") {
    return {
      background: "rgba(161, 120, 50, 0.14)",
      color: "#9b6b23"
    }
  }
  if (status === "failed") {
    return {
      background: "rgba(200, 93, 74, 0.14)",
      color: "#c85d4a"
    }
  }
  return {
    background: "rgba(54, 107, 58, 0.14)",
    color: "#366b3a"
  }
}

function smallStatusPill(status: "live" | "advisory" | "info-only"): CSSProperties {
  return {
    ...statusPillStyle,
    ...(status === "live"
      ? { background: "rgba(54, 107, 58, 0.14)", color: "#366b3a" }
      : status === "advisory"
        ? { background: "rgba(140, 94, 47, 0.14)", color: "#8c5e2f" }
        : { background: "rgba(106, 93, 73, 0.12)", color: "#6a5d49" })
  }
}

function skeletonLineStyle(width: number): CSSProperties {
  return {
    height: 12,
    width: `${width}%`,
    borderRadius: 999,
    background: "linear-gradient(90deg, rgba(220,208,191,0.65), rgba(240,233,223,0.95), rgba(220,208,191,0.65))"
  }
}

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  background:
    "radial-gradient(circle at top left, rgba(211,176,122,0.25), transparent 32%), linear-gradient(180deg, #f6efe4 0%, #efe4d4 100%)",
  color: "#2b2118",
  padding: "24px 20px 36px"
}

const heroStyle: CSSProperties = {
  maxWidth: 1320,
  margin: "0 auto 18px",
  gap: 16,
  alignItems: "center"
}

const eyebrowStyle: CSSProperties = {
  margin: 0,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "#8c5e2f",
  fontSize: 12,
  fontWeight: 700
}

const heroTitleStyle: CSSProperties = {
  margin: "8px 0 10px",
  fontSize: "clamp(1.8rem, 3.4vw, 2.8rem)",
  lineHeight: 1.05
}

const heroCopyStyle: CSSProperties = {
  margin: 0,
  maxWidth: 760,
  lineHeight: 1.6,
  color: "#584b3c"
}

const heroMetaStyle: CSSProperties = {
  display: "grid",
  gap: 10,
  justifyItems: "end"
}

const metaHintStyle: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.5,
  color: "#6a5d49",
  maxWidth: 280,
  textAlign: "right"
}

const metaRowStyle: CSSProperties = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
  justifyContent: "flex-end"
}

const metaPillStyle: CSSProperties = {
  display: "grid",
  gap: 2,
  minWidth: 128,
  background: "rgba(255, 251, 244, 0.82)",
  border: "1px solid #d8ccb8",
  borderRadius: 14,
  padding: "10px 12px",
  fontSize: 13
}

const appFrameStyle: CSSProperties = {
  maxWidth: 1320,
  margin: "0 auto",
  background: "rgba(255, 251, 244, 0.74)",
  border: "1px solid #dccfb9",
  borderRadius: 28,
  padding: 18,
  boxShadow: "0 18px 42px rgba(74, 51, 22, 0.08)"
}

const shellStyle: CSSProperties = {
  display: "grid",
  gap: 18,
  alignItems: "start"
}

const chatColumnStyle: CSSProperties = {
  display: "grid",
  gap: 16
}

const threadStyle: CSSProperties = {
  display: "grid",
  gap: 14
}

const assistantBubbleStyle: CSSProperties = {
  background: "rgba(255, 251, 244, 0.92)",
  border: "1px solid #d9ccb7",
  borderRadius: "20px 20px 20px 8px",
  padding: 18,
  boxShadow: "0 8px 24px rgba(74, 51, 22, 0.06)"
}

const userBubbleStyle: CSSProperties = {
  ...assistantBubbleStyle,
  background: "#2f2419",
  color: "#fff8ef",
  border: "1px solid #2f2419",
  borderRadius: "20px 20px 8px 20px",
  marginLeft: "auto",
  maxWidth: "78%"
}

const errorBubbleStyle: CSSProperties = {
  ...assistantBubbleStyle,
  border: "1px solid #c85d4a",
  background: "#fff2ef"
}

const bubbleHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  fontSize: 13,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "inherit",
  opacity: 0.75
}

const bubbleBodyStyle: CSSProperties = {
  margin: "10px 0 0",
  lineHeight: 1.6
}

const composerShellStyle: CSSProperties = {
  background: "rgba(255, 251, 244, 0.96)",
  border: "1px solid #d9ccb7",
  borderRadius: 24,
  padding: 18,
  display: "grid",
  gap: 14,
  boxShadow: "0 12px 32px rgba(74, 51, 22, 0.08)"
}

const composerTopRowStyle: CSSProperties = {
  display: "grid",
  gap: 10
}

const composerFooterStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "center",
  flexWrap: "wrap"
}

const composerTextareaStyle: CSSProperties = {
  width: "100%",
  minHeight: 104,
  borderRadius: 16,
  border: "1px solid #cbbca6",
  padding: 14,
  font: "inherit",
  background: "#fffdf8",
  color: "#2b2118"
}

const composerInputStyle: CSSProperties = {
  width: "100%",
  borderRadius: 12,
  border: "1px solid #cbbca6",
  padding: 12,
  font: "inherit",
  background: "#fffdf8",
  color: "#2b2118"
}

const primaryButtonStyle: CSSProperties = {
  padding: "12px 16px",
  borderRadius: 12,
  border: "1px solid #2f2419",
  background: "#2f2419",
  color: "#fffdf8",
  cursor: "pointer",
  font: "inherit"
}

const helperTextStyle: CSSProperties = {
  color: "#6a5d49",
  fontSize: 14,
  lineHeight: 1.5
}

const secondaryButtonStyle: CSSProperties = {
  ...primaryButtonStyle,
  background: "#fffaf2",
  color: "#2f2419",
  border: "1px solid #cbbca6"
}

const sidebarStyle: CSSProperties = {
  display: "grid",
  gap: 12
}

const summaryCardStyle: CSSProperties = {
  background: "rgba(255, 251, 244, 0.9)",
  border: "1px solid #d9ccb7",
  borderRadius: 18,
  padding: 16,
  boxShadow: "0 8px 20px rgba(74, 51, 22, 0.04)"
}

const cardTitleStyle: CSSProperties = {
  marginTop: 0,
  marginBottom: 14,
  fontSize: 18
}

const summaryRowStyle: CSSProperties = {
  display: "grid",
  gap: 4
}

const summaryLabelStyle: CSSProperties = {
  color: "#7a6b58",
  fontSize: 13,
  textTransform: "uppercase",
  letterSpacing: "0.08em"
}

const summaryValueStyle: CSSProperties = {
  lineHeight: 1.5
}

const emptyStateStyle: CSSProperties = {
  margin: 0,
  color: "#6a5d49",
  lineHeight: 1.6
}

const detailsStyle: CSSProperties = {
  border: "1px solid #e3d6c3",
  borderRadius: 14,
  background: "#fffdf9",
  overflow: "hidden"
}

const routePickerStyle: CSSProperties = {
  display: "grid",
  gap: 14,
  background: "rgba(255, 251, 244, 0.9)",
  border: "1px solid #d9ccb7",
  borderRadius: 22,
  padding: 18,
  boxShadow: "0 10px 28px rgba(74, 51, 22, 0.05)"
}

const overviewShellStyle: CSSProperties = {
  display: "grid",
  gap: 14,
  background: "rgba(255, 251, 244, 0.92)",
  border: "1px solid #d9ccb7",
  borderRadius: 22,
  padding: 18,
  boxShadow: "0 10px 28px rgba(74, 51, 22, 0.05)"
}

const overviewGridStyle: CSSProperties = {
  display: "grid",
  gap: 10
}

const overviewCardStyle: CSSProperties = {
  border: "1px solid #e3d6c3",
  borderRadius: 14,
  background: "#fffdf9",
  padding: 14
}

const overviewSummaryStyle: CSSProperties = {
  listStyle: "none",
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "start",
  cursor: "pointer"
}

const overviewCopyStyle: CSSProperties = {
  marginTop: 6,
  color: "#5b4c3a",
  lineHeight: 1.5,
  fontSize: 14
}

const reasoningGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12
}

const reasoningCardStyle: CSSProperties = {
  ...assistantBubbleStyle,
  padding: 16
}

const sectionHeaderRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "start",
  gap: 12,
  flexWrap: "wrap"
}

const sectionEyebrowStyle: CSSProperties = {
  margin: 0,
  color: "#8c5e2f",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  fontSize: 12,
  fontWeight: 700
}

const sectionTitleStyle: CSSProperties = {
  margin: "6px 0 8px",
  fontSize: 24
}

const sectionCopyStyle: CSSProperties = {
  margin: 0,
  color: "#5b4c3a",
  lineHeight: 1.6
}

const routeGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12
}

const routeCardStyle: CSSProperties = {
  display: "grid",
  gap: 14,
  padding: 16,
  borderRadius: 18,
  border: "1px solid #dfd2bf",
  background: "#fffdf9"
}

const routeCardSelectedStyle: CSSProperties = {
  border: "1px solid #8c5e2f",
  boxShadow: "0 12px 24px rgba(140, 94, 47, 0.12)"
}

const routeCardSkeletonStyle: CSSProperties = {
  minHeight: 188
}

const routeCardHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "start"
}

const routeProviderStyle: CSSProperties = {
  fontSize: 18
}

const routeMetaStyle: CSSProperties = {
  color: "#6a5d49",
  fontSize: 13,
  marginTop: 4
}

const routeMetricGridStyle: CSSProperties = {
  display: "grid",
  gap: 10
}

const routeNoteStackStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap"
}

const infoChipStyle: CSSProperties = {
  borderRadius: 999,
  padding: "6px 10px",
  background: "rgba(106, 93, 73, 0.08)",
  color: "#5f5547",
  fontSize: 12
}

const selectionPanelStyle: CSSProperties = {
  display: "grid",
  gap: 14,
  background: "rgba(255, 251, 244, 0.9)",
  border: "1px solid #d9ccb7",
  borderRadius: 22,
  padding: 18
}

const selectionGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: 12
}

const selectionCardStyle: CSSProperties = {
  display: "grid",
  gap: 10,
  padding: 16,
  borderRadius: 18,
  border: "1px solid #dfd2bf",
  background: "#fffdf9"
}

const subsectionTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 18
}

const submissionOptionStyle: CSSProperties = {
  textAlign: "left",
  display: "grid",
  gap: 8,
  width: "100%",
  padding: 12,
  borderRadius: 14,
  border: "1px solid #dfd2bf",
  background: "#fffdf9",
  cursor: "pointer"
}

const submissionOptionSelectedStyle: CSSProperties = {
  border: "1px solid #8c5e2f",
  boxShadow: "0 10px 20px rgba(140, 94, 47, 0.12)"
}

const submissionOptionHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  alignItems: "center"
}

const submissionOptionCopyStyle: CSSProperties = {
  color: "#5b4c3a",
  lineHeight: 1.5,
  fontSize: 14
}

const executeRowStyle: CSSProperties = {
  display: "grid",
  gap: 12,
  alignItems: "start"
}

const tracePanelStyle: CSSProperties = {
  display: "grid",
  gap: 10,
  padding: 14,
  borderRadius: 14,
  border: "1px solid #e3d6c3",
  background: "#fffdf9"
}

const traceDetailsStyle: CSSProperties = {
  ...detailsStyle,
  marginTop: 12
}

const summaryToggleStyle: CSSProperties = {
  cursor: "pointer",
  padding: "12px 14px",
  fontWeight: 600
}

const detailsBodyStyle: CSSProperties = {
  padding: "0 14px 14px",
  display: "grid",
  gap: 10
}

const detailItemStyle: CSSProperties = {
  borderTop: "1px solid #f0e5d4",
  paddingTop: 10,
  lineHeight: 1.5
}

const detailListStyle: CSSProperties = {
  paddingLeft: 18,
  marginTop: 8,
  marginBottom: 0,
  display: "grid",
  gap: 6
}

const fieldRowStyle: CSSProperties = {
  display: "grid",
  gap: 3
}

const fieldLabelStyle: CSSProperties = {
  color: "#7a6b58",
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.08em"
}

const detailCopyStyle: CSSProperties = {
  margin: "8px 0 0",
  lineHeight: 1.6
}

const preStyle: CSSProperties = {
  margin: 0,
  padding: 12,
  background: "#2b2118",
  color: "#fff8ef",
  borderRadius: 14,
  overflowX: "auto",
  fontSize: 12,
  lineHeight: 1.5
}

const statusPillStyle: CSSProperties = {
  borderRadius: 999,
  padding: "4px 10px",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase"
}

const thinkingRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  marginTop: 10
}

const spinnerStyle: CSSProperties = {
  width: 16,
  height: 16,
  borderRadius: "50%",
  border: "2px solid rgba(140, 94, 47, 0.22)",
  borderTopColor: "#8c5e2f",
  animation: "planner-spin 0.9s linear infinite"
}

const activityItemStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "center",
  borderBottom: "1px solid #efe1cc",
  paddingBottom: 10
}

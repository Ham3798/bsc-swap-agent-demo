import type { PlanningResult } from "@bsc-swap-agent-demo/shared"

export function formatPlan(result: PlanningResult): string {
  const recommendedRoute = result.routeCandidates.find(
    (candidate) => candidate.id === result.recommendedPlan.routeId
  )
  const recommendedPayload = result.payloadCandidates.find(
    (candidate) => candidate.id === result.recommendedPlan.payloadId
  )

  return [
    "## Swap Execution Plan",
    "",
    `Recommended route: ${recommendedRoute?.platform ?? result.recommendedPlan.routeId}`,
    `Recommended submission path: ${result.recommendedPlan.submissionPath}`,
    `Payload type: ${recommendedPayload?.type ?? "router-calldata"}`,
    "",
    "### Why this plan",
    result.recommendedPlan.summary,
    "",
    "### Risk note",
    result.recommendedPlan.riskNote,
    "",
    "### Policy note",
    result.recommendedPlan.policyNote,
    "",
    "### Decision Trace",
    ...result.decisionTrace.flatMap((step) => [
      `#### ${step.title}`,
      step.summary,
      ...(step.decision ? [`Decision: ${step.decision}`] : []),
      ...step.observations.slice(0, 4).map((item) => `- ${item.label}: ${item.value}`),
      ""
    ]),
    "",
    "### Alternatives rejected",
    ...result.alternativesRejected.map((item) => `- ${item.routeId}: ${item.reason}`),
    "",
    "### JSON",
    "```json",
    JSON.stringify(
      {
        intent: result.intent,
        missing_fields_resolved: result.missingFieldsResolved,
        decision_trace: result.decisionTrace,
        liquidity_snapshot: result.liquiditySnapshot,
        route_candidates: result.routeCandidates,
        price_impact_assessment: result.priceImpactAssessment,
        mev_risk_assessment: result.mevRiskAssessment,
        payload_candidates: result.payloadCandidates.map((payload) => ({
          ...payload,
          data: `${payload.data.slice(0, 18)}...`,
          data_length: payload.data.length
        })),
        submission_candidates: result.submissionCandidates,
        guardrails: result.guardrails,
        recommended_plan: result.recommendedPlan,
        alternatives_rejected: result.alternativesRejected,
        public_submit_request: result.publicSubmitRequest,
        private_submit_request: result.privateSubmitRequest,
        intent_submit_request: result.intentSubmitRequest
      },
      null,
      2
    ),
    "```"
  ].join("\n")
}

import type { PlanningResult } from "../types"

export function formatPlanningResult(result: PlanningResult): string {
  const recommendedRoute = result.routeCandidates.find(
    (candidate) => candidate.id === result.recommendedPlan.routeId
  )
  const recommendedPayload = result.payloadCandidates.find(
    (candidate) => candidate.id === result.recommendedPlan.payloadId
  )

  const markdown = [
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
    "### Alternatives rejected",
    ...result.alternativesRejected.map(
      (item) => `- ${item.routeId}: ${item.reason}`
    ),
    "",
    "### JSON",
    "```json",
    JSON.stringify(
      {
        intent: result.intent,
        missing_fields_resolved: result.missingFieldsResolved,
        liquidity_snapshot: result.liquiditySnapshot,
        route_candidates: result.routeCandidates,
        price_impact_assessment: result.priceImpactAssessment,
        mev_risk_assessment: result.mevRiskAssessment,
        payload_candidates: result.payloadCandidates.map((payload) => ({
          ...payload,
          data: `${payload.data.slice(0, 18)}...`,
          data_length: payload.data.length,
          simulation: {
            ...payload.simulation,
            note:
              payload.simulation.note.length > 220
                ? `${payload.simulation.note.slice(0, 220)}...`
                : payload.simulation.note
          }
        })),
        submission_candidates: result.submissionCandidates,
        guardrails: result.guardrails,
        recommended_plan: result.recommendedPlan,
        alternatives_rejected: result.alternativesRejected
      },
      null,
      2
    ),
    "```"
  ]

  return markdown.join("\n")
}

export const replayFixtures = {
  selfExecutedWinner: {
    sessionId: "fixture-self-executed",
    events: [
      {
        id: "fixture-1",
        kind: "stage-started",
        stage: "execution-package-comparison",
        status: "running",
        message: "Comparing execution packages across self-executed and delegated paths."
      },
      {
        id: "fixture-2",
        kind: "reasoning",
        stage: "execution-package-comparison",
        status: "completed",
        message:
          "PancakeSwap private RPC keeps the swap self-executed while improving path quality over public broadcast.",
        data: {
          reasoningSource: "deterministic",
          decision:
            "Use the self-executed PancakeSwap private RPC package because it preserves direct execution with a cleaner submission path."
        }
      },
      {
        id: "fixture-3",
        kind: "plan-completed",
        stage: "final-recommendation",
        status: "completed",
        message: "Planning completed successfully.",
        data: {
          result: {
            recommendedPlan: {
              summary:
                "Recommended PancakeSwap via private RPC because it keeps the trade self-executed while improving path quality over public broadcast.",
              submissionPath: "private-rpc",
              executionMode: "self-executed",
              submissionChannel: "private-rpc",
              submissionProvider: "PancakeSwap Private RPC",
              bestPricePackageId: "openocean-public",
              bestExecutionPackageId: "pancake-private",
              executionPackageId: "pancake-private"
            },
            executionPackages: [
              {
                id: "openocean-public",
                routeProvider: "OpenOcean",
                routeFamily: "aggregator",
                payloadType: "router-calldata",
                submissionProvider: "Public wallet broadcast",
                submissionChannel: "public-mempool",
                executionMode: "self-executed",
                liveStatus: "live",
                score: 0.74
              },
              {
                id: "pancake-private",
                routeProvider: "PancakeSwap",
                routeFamily: "direct-dex",
                payloadType: "router-calldata",
                submissionProvider: "PancakeSwap Private RPC",
                submissionChannel: "private-rpc",
                executionMode: "self-executed",
                liveStatus: "advisory",
                score: 0.82
              },
              {
                id: "cow-style-intent",
                routeProvider: "CoW-style intent path",
                routeFamily: "solver-intent",
                payloadType: "approval-plus-intent",
                submissionProvider: "CoW-style intent server",
                submissionChannel: "centralized-intent-server",
                executionMode: "delegated-to-solver",
                liveStatus: "info-only",
                score: 0.76
              }
            ],
            executionBoundary: {
              plannerControls: [
                "intent parsing",
                "route ranking",
                "payload construction",
                "guardrail recommendation"
              ],
              userSigns: ["transaction signature"],
              externalExecutorControls: [
                "private RPC delivery semantics",
                "final block inclusion outcome"
              ]
            },
            routeCandidates: [],
            payloadCandidates: [],
            submissionCandidates: [
              {
                path: "private-rpc",
                availability: "stub",
                recommended: true,
                providerName: "PancakeSwap Private RPC",
                liveStatus: "advisory",
                plannerControlLevel: "handoff",
                trustAssumption: "Assumes trust in the selected private RPC operator."
              },
              {
                path: "public-mempool",
                availability: "live",
                recommended: false,
                providerName: "Public wallet broadcast",
                liveStatus: "live",
                plannerControlLevel: "direct",
                trustAssumption: "Minimizes trusted intermediaries but stays fully public."
              }
            ],
            guardrails: [],
            decisionTrace: [
              {
                id: "trace-1",
                stage: "execution-package-comparison",
                title: "Execution package comparison",
                status: "completed",
                summary:
                  "Best price came from an aggregator path, but best execution came from a self-executed private RPC package.",
                observations: [],
                decision:
                  "Choose the PancakeSwap private RPC package because submission quality changes realized execution quality."
              }
            ]
          }
        }
      }
    ]
  },
  delegatedWinner: {
    sessionId: "fixture-delegated",
    events: [
      {
        id: "fixture-4",
        kind: "stage-started",
        stage: "path-quality-assessment",
        status: "running",
        message: "Assessing path quality, delegation boundaries, and approval overhead."
      },
      {
        id: "fixture-5",
        kind: "reasoning",
        stage: "path-quality-assessment",
        status: "completed",
        message:
          "A solver-intent package reduces public-path dependence, but it shifts execution control to an external solver.",
        data: {
          reasoningSource: "deterministic",
          decision:
            "Use the delegated CoW-style package when delegated settlement is acceptable and approval overhead is justified."
        }
      },
      {
        id: "fixture-6",
        kind: "plan-completed",
        stage: "final-recommendation",
        status: "completed",
        message: "Planning completed successfully.",
        data: {
          result: {
            recommendedPlan: {
              summary:
                "Recommended the CoW-style intent package because delegated settlement can be cleaner than direct public or private routing for this trade shape.",
              submissionPath: "intent-api",
              executionMode: "delegated-to-solver",
              submissionChannel: "centralized-intent-server",
              submissionProvider: "CoW-style intent server",
              bestPricePackageId: "openocean-public",
              bestExecutionPackageId: "cow-style-intent",
              executionPackageId: "cow-style-intent"
            },
            executionPackages: [
              {
                id: "openocean-public",
                routeProvider: "OpenOcean",
                routeFamily: "aggregator",
                payloadType: "router-calldata",
                submissionProvider: "Public wallet broadcast",
                submissionChannel: "public-mempool",
                executionMode: "self-executed",
                liveStatus: "live",
                score: 0.71
              },
              {
                id: "pancake-private",
                routeProvider: "PancakeSwap",
                routeFamily: "direct-dex",
                payloadType: "router-calldata",
                submissionProvider: "PancakeSwap Private RPC",
                submissionChannel: "private-rpc",
                executionMode: "self-executed",
                liveStatus: "advisory",
                score: 0.77
              },
              {
                id: "cow-style-intent",
                routeProvider: "CoW-style intent path",
                routeFamily: "solver-intent",
                payloadType: "approval-plus-intent",
                submissionProvider: "CoW-style intent server",
                submissionChannel: "centralized-intent-server",
                executionMode: "delegated-to-solver",
                liveStatus: "info-only",
                score: 0.83
              }
            ],
            executionBoundary: {
              plannerControls: [
                "intent parsing",
                "execution package recommendation",
                "approval policy recommendation"
              ],
              userSigns: ["token approval", "intent submission or handoff authorization"],
              externalExecutorControls: [
                "solver settlement logic",
                "server-side execution outcome",
                "final block inclusion outcome"
              ]
            },
            routeCandidates: [],
            payloadCandidates: [],
            submissionCandidates: [
              {
                path: "intent-api",
                availability: "stub",
                recommended: true,
                providerName: "CoW-style intent server",
                liveStatus: "info-only",
                plannerControlLevel: "informational",
                trustAssumption: "Assumes a centralized intent server and solver set will settle honestly."
              }
            ],
            guardrails: [],
            decisionTrace: [
              {
                id: "trace-2",
                stage: "path-quality-assessment",
                title: "Path quality assessment",
                status: "completed",
                summary:
                  "The delegated package wins on path quality, but it introduces approval overhead and solver trust assumptions.",
                observations: [],
                decision:
                  "Use the delegated package only when the user accepts that the planner is no longer the final executor."
              }
            ]
          }
        }
      }
    ]
  }
} as const

export type ReplayFixtureName = keyof typeof replayFixtures

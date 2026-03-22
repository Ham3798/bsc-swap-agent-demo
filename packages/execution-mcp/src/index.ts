import { config as loadEnv } from "dotenv"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

import {
  BnbCapabilityRegistry,
  auditExecution,
  broadcastPrivateRawTransaction,
  encodeJitRouterExecute,
  getJitRouterAddress,
  loadPrivateSubmissionRegistry,
  probeRegistryEndpointById
} from "@bsc-swap-agent-demo/core"

loadEnv()

if (process.argv.includes("--help")) {
  console.error("bsc-execution-mcp")
  console.error("")
  console.error("Runs a stdio MCP server for BSC execution operations.")
  console.error("This process is expected to stay open and wait for an MCP client.")
  console.error("")
  console.error("Use:")
  console.error("  bun run mcp:execution")
  console.error("")
  console.error("Available tools:")
  console.error("  - get_private_endpoint_registry")
  console.error("  - probe_private_endpoint")
  console.error("  - private_rpc_submit_raw")
  console.error("  - multi_builder_broadcast_raw")
  console.error("  - audit_swap_execution")
  console.error("  - simulate_candidate_routes")
  console.error("  - encode_jit_router_call")
  process.exit(0)
}

const NetworkSchema = z.enum(["bsc", "bsc-testnet"])

const server = new McpServer(
  {
    name: "bsc-execution-mcp",
    version: "0.1.0"
  },
  {
    capabilities: {
      tools: {}
    },
    instructions:
      "Execution operations server for BSC PBS workflows. Use these tools for private submission, execution audit, private endpoint inspection, and candidate route simulation."
  }
)

server.registerTool(
  "get_private_endpoint_registry",
  {
    description: "Return the BSC private validator RPC and builder relay registry with verification metadata.",
    inputSchema: {
      network: NetworkSchema.default("bsc")
    }
  },
  async ({ network }) => {
    const registry = await loadPrivateSubmissionRegistry()
    const structuredContent = {
      network,
      summary: registry.summary,
      endpoints: registry.endpoints.map((endpoint) => ({
        id: endpoint.id,
        displayName: endpoint.displayName,
        type: endpoint.type,
        rpcUrl: endpoint.rpcUrl,
        verificationStatus: endpoint.verificationStatus,
        notes: endpoint.notes
      }))
    }
    return toolResult(structuredContent)
  }
)

server.registerTool(
  "probe_private_endpoint",
  {
    description: "Probe a private validator RPC or builder relay endpoint to determine reachability and likely raw-send semantics.",
    inputSchema: {
      endpointId: z.string().min(1)
    }
  },
  async ({ endpointId }) => {
    const endpoint = await probeRegistryEndpointById({ endpointId })
    const structuredContent = {
      endpoint: {
        id: endpoint.id,
        displayName: endpoint.displayName,
        type: endpoint.type,
        rpcUrl: endpoint.rpcUrl,
        verificationStatus: endpoint.verificationStatus
      },
      probe: endpoint.probe,
      notes: endpoint.notes
    }
    return toolResult(structuredContent)
  }
)

server.registerTool(
  "private_rpc_submit_raw",
  {
    description: "Submit a signed raw transaction to one validator-backed private RPC endpoint.",
    inputSchema: {
      network: NetworkSchema.default("bsc"),
      rawTransaction: z.string().min(2),
      endpointId: z.string().min(1).optional()
    }
  },
  async ({ network, rawTransaction, endpointId }) => {
    const structuredContent = await broadcastPrivateRawTransaction({
      network,
      rawTransaction,
      channel: "validator",
      maxEndpoints: endpointId ? 1 : 1,
      endpointIds: endpointId ? [endpointId] : undefined
    })
    return toolResult({
      network,
      mode: "private-rpc",
      results: structuredContent,
      firstAcceptedTxHash: structuredContent.find((item) => item.accepted)?.txHash
    })
  }
)

server.registerTool(
  "multi_builder_broadcast_raw",
  {
    description: "Broadcast a signed raw transaction to multiple builder relay endpoints.",
    inputSchema: {
      network: NetworkSchema.default("bsc"),
      rawTransaction: z.string().min(2),
      endpointIds: z.array(z.string().min(1)).optional(),
      maxEndpoints: z.number().int().min(1).max(10).optional()
    }
  },
  async ({ network, rawTransaction, endpointIds, maxEndpoints }) => {
    const results = await broadcastPrivateRawTransaction({
      network,
      rawTransaction,
      channel: "builder",
      endpointIds,
      maxEndpoints: maxEndpoints ?? 3
    })
    return toolResult({
      network,
      mode: "builder-aware-broadcast",
      results,
      firstAcceptedTxHash: results.find((item) => item.accepted)?.txHash
    })
  }
)

server.registerTool(
  "audit_swap_execution",
  {
    description: "Audit a swap execution by tx hash, including receipt status, gas, latency, and realized output when token/recipient are provided.",
    inputSchema: {
      network: NetworkSchema.default("bsc"),
      txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
      buyTokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
      recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
      expectedOut: z.string().optional(),
      submittedAt: z.union([z.string(), z.number()]).optional(),
      executionPath: z.enum(["public-mempool", "private-rpc", "builder-aware-broadcast", "unknown"]).optional()
    }
  },
  async ({ network, txHash, buyTokenAddress, recipient, expectedOut, submittedAt, executionPath }) => {
    const audit = await auditExecution({
      network,
      txHash: txHash as `0x${string}`,
      buyTokenAddress: buyTokenAddress as `0x${string}` | undefined,
      recipient: recipient as `0x${string}` | undefined,
      expectedOut,
      submittedAt,
      executionPath
    })
    return toolResult({
      ...audit,
      blockNumber: audit.blockNumber?.toString(),
      gasUsed: audit.gasUsed?.toString(),
      effectiveGasPrice: audit.effectiveGasPrice?.toString()
    })
  }
)

server.registerTool(
  "encode_jit_router_call",
  {
    description: "Encode a call to the deployed secure JIT v2.1 swap router for signed-order best-of-3 execution.",
    inputSchema: {
      network: NetworkSchema.default("bsc"),
      routerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
      order: z.object({
        user: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        tokenIn: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        tokenOut: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        amountIn: z.string().min(1),
        minOut: z.string().min(1),
        maxBlockNumber: z.union([z.bigint().min(1n), z.number().int().min(1), z.string().min(1)]),
        nonce: z.union([z.bigint().min(0n), z.number().int().min(0), z.string().min(1)]),
        candidateSetHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/)
      }),
      candidates: z.array(z.object({
        adapterId: z.number().int().min(0).max(2),
        router: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        value: z.string().min(1),
        data: z.string().regex(/^0x[a-fA-F0-9]*$/)
      })).length(3),
      signature: z.string().regex(/^0x[a-fA-F0-9]+$/)
    }
  },
  async ({ network, routerAddress, order, candidates, signature }) => {
    const payload = encodeJitRouterExecute({
      network,
      routerAddress: routerAddress as `0x${string}` | undefined,
      order: {
        user: order.user as `0x${string}`,
        recipient: order.recipient as `0x${string}`,
        tokenIn: order.tokenIn as `0x${string}`,
        tokenOut: order.tokenOut as `0x${string}`,
        amountIn: order.amountIn,
        minOut: order.minOut,
        maxBlockNumber: typeof order.maxBlockNumber === "bigint" ? order.maxBlockNumber : BigInt(order.maxBlockNumber),
        nonce: typeof order.nonce === "bigint" ? order.nonce : BigInt(order.nonce),
        candidateSetHash: order.candidateSetHash as `0x${string}`
      },
      candidates: candidates as Array<{
        adapterId: number
        router: `0x${string}`
        value: string
        data: `0x${string}`
      }>,
      signature: signature as `0x${string}`
    })

    return toolResult({
      network,
      routerAddress: payload.routerAddress,
      configuredRouterAddress: getJitRouterAddress(network),
      payloadType: payload.payloadType,
      to: payload.to,
      value: payload.value,
      data: payload.data,
      candidateCount: candidates.length
    })
  }
)

server.registerTool(
  "simulate_candidate_routes",
  {
    description: "Resolve tokens, observe candidate routes, then build and simulate selected route candidates with current RPC state.",
    inputSchema: {
      network: NetworkSchema.default("bsc"),
      sellToken: z.string().min(1),
      buyToken: z.string().min(1),
      amount: z.string().min(1),
      account: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      slippageBps: z.number().int().min(1).max(5000).default(50),
      routeIds: z.array(z.string().min(1)).optional()
    }
  },
  async ({ network, sellToken, buyToken, amount, account, slippageBps, routeIds }) => {
    const registry = new BnbCapabilityRegistry()
    try {
      const sell = await registry.chain.resolveToken(sellToken, network)
      const buy = await registry.chain.resolveToken(buyToken, network)
      if (!sell || !buy) {
        throw new Error(`Could not resolve tokens: sell=${sellToken}, buy=${buyToken}`)
      }

      const quoteResult = registry.quote.getQuoteCandidatesWithAudit
        ? await registry.quote.getQuoteCandidatesWithAudit({
            network,
            sellToken: sell,
            buyToken: buy,
            amount,
            amountRaw: parseAmountToRaw(amount, sell.decimals),
            slippageBps
          })
        : {
            candidates: await registry.quote.getQuoteCandidates({
              network,
              sellToken: sell,
              buyToken: buy,
              amount,
              amountRaw: parseAmountToRaw(amount, sell.decimals),
              slippageBps
            }),
            audit: [],
            observedAt: new Date().toISOString()
          }

      const selectedRoutes = (routeIds?.length
        ? quoteResult.candidates.filter((candidate) => routeIds.includes(candidate.id))
        : quoteResult.candidates.slice(0, 3)
      ).slice(0, 5)

      const simulations = await Promise.all(
        selectedRoutes.map(async (route) => {
          const payload = await registry.quote.encodeRouterCalldata({
            network,
            platform: route.platform,
            sellToken: sell,
            buyToken: buy,
            amount,
            amountRaw: parseAmountToRaw(amount, sell.decimals),
            slippageBps,
            account
          })
          const simulation = await registry.quote.simulateTransaction({
            network,
            account,
            to: payload.to,
            data: payload.data,
            value: payload.value
          })
          return {
            routeId: route.id,
            platform: route.platform,
            quotedOut: route.quotedOutFormatted,
            priceImpactPct: route.priceImpactPct,
            payloadType: "router-calldata",
            to: payload.to,
            minOutAmount: payload.minOutAmount,
            estimatedGas: payload.estimatedGas,
            simulation
          }
        })
      )

      return toolResult({
        network,
        pair: `${sell.symbol}/${buy.symbol}`,
        observedAt: quoteResult.observedAt,
        quoteAudit: quoteResult.audit,
        routes: simulations
      })
    } finally {
      await registry.close()
    }
  }
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error("bsc-execution-mcp: stdio server ready, waiting for MCP client")
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

function toolResult<T extends Record<string, unknown>>(structuredContent: T) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(structuredContent, null, 2)
      }
    ],
    structuredContent
  }
}

function parseAmountToRaw(amount: string, decimals: number): string {
  const normalizedAmount = String(amount ?? "").trim()
  const [wholePart, fractionalPart = ""] = normalizedAmount.split(".")
  const normalizedWhole = wholePart === "" ? "0" : wholePart
  const normalizedFraction = fractionalPart.replace(/[^0-9]/g, "").slice(0, decimals).padEnd(decimals, "0")
  return `${normalizedWhole}${normalizedFraction}`.replace(/^0+(?=\d)/, "") || "0"
}

import { createPublicClient, decodeEventLog, erc20Abi, getAddress, http } from "viem"
import { bsc, bscTestnet } from "viem/chains"

import type {
  ExecutionAudit,
  Network,
  PrivateSubmissionEndpoint,
  PrivateSubmissionResult
} from "@bsc-swap-agent-demo/shared"

import {
  loadPrivateSubmissionRegistry,
  selectRegistryEndpoints,
  type PrivateSubmissionRegistry
} from "./private-registry"

type SubmissionChannel = "validator" | "builder" | "both"

export async function broadcastPrivateRawTransaction(input: {
  rawTransaction: string
  network: Network
  channel?: SubmissionChannel
  maxEndpoints?: number
  endpointIds?: string[]
  registry?: PrivateSubmissionRegistry
}): Promise<PrivateSubmissionResult[]> {
  const registry = input.registry ?? (await loadPrivateSubmissionRegistry())
  const endpoints = input.endpointIds?.length
    ? registry.endpoints.filter((endpoint) => input.endpointIds?.includes(endpoint.id))
    : pickSubmissionEndpoints({
        registry,
        channel: input.channel ?? "both",
        maxEndpoints: input.maxEndpoints ?? 3
      })

  const results = await Promise.all(
    endpoints.map((endpoint) => submitToEndpoint(endpoint, input.rawTransaction))
  )

  return results
}

export async function auditExecution(input: {
  network: Network
  txHash: `0x${string}`
  buyTokenAddress?: `0x${string}`
  recipient?: `0x${string}`
  expectedOut?: string
  submittedAt?: string | number | Date
  executionPath?: ExecutionAudit["executionPath"]
}): Promise<ExecutionAudit> {
  const client = createRpcClient(input.network)
  const chainId = await client.getChainId()
  const receipt = await client.getTransactionReceipt({ hash: input.txHash }).catch((error) => {
    if (String(error).toLowerCase().includes("not found")) {
      return null
    }
    throw error
  })

  if (!receipt) {
    return {
      txHash: input.txHash,
      chainId,
      status: "not-found",
      executionPath: input.executionPath ?? "unknown"
    }
  }

  const block = await client.getBlock({ blockNumber: receipt.blockNumber }).catch(() => null)
  const submittedAtMs = toTimestamp(input.submittedAt)
  const inclusionLatencyMs =
    submittedAtMs && block?.timestamp ? Number(block.timestamp) * 1000 - submittedAtMs : undefined

  const realizedOut =
    input.buyTokenAddress && input.recipient
      ? await deriveRealizedOut({
          client,
          receipt,
          tokenAddress: input.buyTokenAddress,
          recipient: input.recipient
        })
      : undefined

  return {
    txHash: input.txHash,
    chainId,
    blockNumber: receipt.blockNumber,
    status: receipt.status === "success" ? "success" : "reverted",
    gasUsed: receipt.gasUsed,
    effectiveGasPrice: receipt.effectiveGasPrice,
    inclusionLatencyMs,
    buyTokenAddress: input.buyTokenAddress,
    recipient: input.recipient,
    expectedOut: input.expectedOut,
    realizedOut,
    realizedDelta:
      realizedOut && input.expectedOut ? (BigInt(realizedOut) - BigInt(input.expectedOut)).toString() : undefined,
    executionPath: input.executionPath ?? "unknown"
  }
}

function pickSubmissionEndpoints(input: {
  registry: PrivateSubmissionRegistry
  channel: SubmissionChannel
  maxEndpoints: number
}): PrivateSubmissionEndpoint[] {
  if (input.channel === "validator") {
    return selectRegistryEndpoints(input.registry, "validator-mev-rpc", input.maxEndpoints)
  }
  if (input.channel === "builder") {
    return selectRegistryEndpoints(input.registry, "builder-relay", input.maxEndpoints)
  }

  const validatorLimit = Math.max(1, Math.ceil(input.maxEndpoints / 2))
  const builderLimit = Math.max(1, input.maxEndpoints - validatorLimit)
  return [
    ...selectRegistryEndpoints(input.registry, "validator-mev-rpc", validatorLimit),
    ...selectRegistryEndpoints(input.registry, "builder-relay", builderLimit)
  ]
}

async function submitToEndpoint(
  endpoint: PrivateSubmissionEndpoint,
  rawTransaction: string
): Promise<PrivateSubmissionResult> {
  const startedAt = Date.now()
  try {
    const response = await fetch(endpoint.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_sendRawTransaction",
        params: [rawTransaction]
      }),
      signal: AbortSignal.timeout(8000)
    })
    const payload = await response.json().catch(() => null)
    const latencyMs = Date.now() - startedAt

    if (!response.ok) {
      return {
        endpointId: endpoint.id,
        displayName: endpoint.displayName,
        rpcUrl: endpoint.rpcUrl,
        type: endpoint.type,
        accepted: false,
        latencyMs,
        error: normalizeSubmissionError(payload?.error?.message || response.statusText || "http-error")
      }
    }

    if (payload?.result && typeof payload.result === "string" && payload.result.startsWith("0x")) {
      return {
        endpointId: endpoint.id,
        displayName: endpoint.displayName,
        rpcUrl: endpoint.rpcUrl,
        type: endpoint.type,
        accepted: true,
        latencyMs,
        txHash: payload.result
      }
    }

    return {
      endpointId: endpoint.id,
      displayName: endpoint.displayName,
      rpcUrl: endpoint.rpcUrl,
      type: endpoint.type,
      accepted: false,
      latencyMs,
      error: normalizeSubmissionError(payload?.error?.message || "unexpected-response")
    }
  } catch (error) {
    return {
      endpointId: endpoint.id,
      displayName: endpoint.displayName,
      rpcUrl: endpoint.rpcUrl,
      type: endpoint.type,
      accepted: false,
      latencyMs: Date.now() - startedAt,
      error: normalizeSubmissionError(error instanceof Error ? error.message : String(error))
    }
  }
}

function normalizeSubmissionError(value: string): string {
  const normalized = value.toLowerCase()
  if (normalized.includes("already known")) return "already-known"
  if (normalized.includes("nonce too low")) return "nonce-too-low"
  if (normalized.includes("insufficient funds")) return "insufficient-funds"
  if (normalized.includes("timeout") || normalized.includes("timed out")) return "timeout"
  if (normalized.includes("forbidden") || normalized.includes("unauthorized") || normalized.includes("api key")) {
    return "auth-required"
  }
  if (normalized.includes("method not found")) return "method-unsupported"
  if (normalized.includes("invalid sender")) return "invalid-sender"
  if (normalized.includes("replacement transaction underpriced")) return "replacement-underpriced"
  return "submit-failed"
}

function createRpcClient(network: Network) {
  const rpcUrl = network === "bsc" ? process.env.BSC_RPC_URL : process.env.BSC_TESTNET_RPC_URL
  if (!rpcUrl) {
    throw new Error(network === "bsc" ? "Missing BSC_RPC_URL." : "Missing BSC_TESTNET_RPC_URL.")
  }

  return createPublicClient({
    chain: network === "bsc" ? bsc : bscTestnet,
    transport: http(rpcUrl)
  })
}

async function deriveRealizedOut(input: {
  client: ReturnType<typeof createRpcClient>
  receipt: Awaited<ReturnType<ReturnType<typeof createRpcClient>["getTransactionReceipt"]>>
  tokenAddress: `0x${string}`
  recipient: `0x${string}`
}): Promise<string | undefined> {
  const recipient = getAddress(input.recipient)
  const token = getAddress(input.tokenAddress)
  const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
  let total = 0n

  for (const log of input.receipt.logs) {
    if ((log.address?.toLowerCase?.() ?? "") !== token.toLowerCase()) continue
    if (!log.topics?.length || log.topics[0]?.toLowerCase() !== transferTopic) continue
    if ((log.topics[2] ?? "").slice(-40).toLowerCase() !== recipient.slice(2).toLowerCase()) continue

    try {
      const decoded = decodeEventLog({
        abi: erc20Abi,
        data: log.data,
        topics: log.topics
      })
      if ("args" in decoded && decoded.args && typeof decoded.args === "object" && "value" in decoded.args) {
        total += decoded.args.value as bigint
      }
    } catch {
      continue
    }
  }

  return total > 0n ? total.toString() : undefined
}

function toTimestamp(value?: string | number | Date): number | undefined {
  if (value == null) return undefined
  if (typeof value === "number") return value
  if (value instanceof Date) return value.getTime()
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? undefined : timestamp
}

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { config as loadEnv } from "dotenv"

import type {
  CapabilityLayer,
  MevRiskAssessment,
  Network,
  RouteCandidate,
  SubmissionCandidate,
  TokenRef
} from "../types"

loadEnv()

const BNB_NATIVE_SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
const PLATFORM_CANDIDATES = ["openoceanv2", "matcha", "paraswap", "1inch"] as const

interface OpenOceanTokenListResponse {
  code: number
  data: Array<{
    address: string
    decimals: number
    symbol: string
    name: string
  }>
}

interface OpenOceanQuoteResponse {
  code: number
  data?: {
    outAmount: string
    estimatedGas: string
    price_impact?: string
    dexes?: Array<{ dexCode: string; swapAmount: string }>
  }
}

interface OpenOceanSwapQuoteResponse {
  code: number
  data?: {
    to: string
    data: string
    value: string
    minOutAmount: string
    estimatedGas: string
  }
}

export class BnbMcpCapabilityLayer implements CapabilityLayer {
  private readonly mcp = new Client({ name: "bsc-swap-planning-demo", version: "0.1.0" })
  private tokenCache = new Map<Network, TokenRef[]>()
  private connected = false

  async connect(): Promise<void> {
    if (this.connected) {
      return
    }

    const overrideCommand = process.env.BNB_MCP_COMMAND
    const overrideArgs = process.env.BNB_MCP_ARGS
    const mcpDir = process.env.BNB_MCP_DIR || "/Users/ham-yunsig/Documents/bnb/bnbchain-mcp"

    const command = overrideCommand || "/bin/zsh"
    const args =
      overrideArgs?.split(" ").filter(Boolean) || [
        "-lc",
        `cd ${shellEscape(mcpDir)} && bun run src/index.ts 2>/dev/null`
      ]

    const transport = new StdioClientTransport({
      command,
      args,
      env: {
        ...process.env,
        LOGLEVEL: process.env.LOGLEVEL || "error"
      }
    })

    await this.mcp.connect(transport)
    this.connected = true
  }

  async listTools(): Promise<string[]> {
    await this.connect()
    const tools = await this.mcp.listTools()
    return tools.tools.map((tool) => tool.name)
  }

  async getChainInfo(network: Network): Promise<unknown> {
    return this.callMcp("get_chain_info", { network })
  }

  async getNativeBalance(address: string, network: Network) {
    return this.callMcp("get_native_balance", { address, network })
  }

  async getErc20Balance(tokenAddress: string, address: string, network: Network) {
    return this.callMcp("get_erc20_balance", { tokenAddress, address, network })
  }

  async getErc20TokenInfo(tokenAddress: string, network: Network) {
    return this.callMcp("get_erc20_token_info", { tokenAddress, network })
  }

  async resolveToken(query: string, network: Network): Promise<TokenRef | null> {
    const normalized = query.trim().toUpperCase()
    if (normalized === "BNB") {
      return {
        symbol: "BNB",
        address: BNB_NATIVE_SENTINEL,
        decimals: 18,
        isNative: true
      }
    }

    const list = await this.getTokenList(network)
    const direct = list.find(
      (token) =>
        token.symbol.toUpperCase() === normalized ||
        token.address.toLowerCase() === query.toLowerCase()
    )
    return direct ?? null
  }

  async getQuoteCandidates(input: {
    network: Network
    sellToken: TokenRef
    buyToken: TokenRef
    amount: string
    slippageBps: number
  }): Promise<RouteCandidate[]> {
    const quotes = await Promise.all(
      PLATFORM_CANDIDATES.map(async (platform) => {
        const params = new URLSearchParams({
          platform,
          inTokenAddress: input.sellToken.address,
          outTokenAddress: input.buyToken.address,
          amount: input.amount,
          gasPrice: "3",
          slippage: String(input.slippageBps / 100)
        })
        const response = (await fetchJson(
          `https://open-api.openocean.finance/v3/${input.network}/quote?${params.toString()}`
        )) as OpenOceanQuoteResponse
        return { platform, response }
      })
    )

    return quotes
      .filter((item) => item.response.code === 200 && item.response.data?.outAmount)
      .map((item) => {
        const outAmountRaw = item.response.data!.outAmount
        const outAmount = formatUnits(outAmountRaw, input.buyToken.decimals)
        const dexes = normalizeDexShares(item.response.data?.dexes ?? [])
        const priceImpactPct = parsePercentString(item.response.data?.price_impact)
        const stability = priceImpactPct < 0.3 ? "high" : priceImpactPct < 1 ? "medium" : "low"
        return {
          id: item.platform,
          platform: item.platform,
          quotedOut: outAmountRaw,
          quotedOutFormatted: `${trimFloat(outAmount)} ${input.buyToken.symbol}`,
          priceImpactPct,
          estimatedGas: item.response.data?.estimatedGas ?? "0",
          expectedExecutionStability: stability,
          protocolFit: "aggregator",
          mevExposure: priceImpactPct > 1 ? "high" : priceImpactPct > 0.3 ? "medium" : "low",
          routeSummary: dexes.length
            ? `Route spans ${dexes.length} venues with ${dexes[0].dexCode} dominant`
            : "Route venue composition unavailable",
          dexes,
          score: 0
        } satisfies RouteCandidate
      })
  }

  async encodeRouterCalldata(input: {
    network: Network
    platform: string
    sellToken: TokenRef
    buyToken: TokenRef
    amount: string
    slippageBps: number
    account: string
  }) {
    const params = new URLSearchParams({
      platform: input.platform,
      account: input.account,
      inTokenAddress: input.sellToken.address,
      outTokenAddress: input.buyToken.address,
      amount: input.amount,
      gasPrice: "3",
      slippage: String(input.slippageBps / 100)
    })
    const response = (await fetchJson(
      `https://open-api.openocean.finance/v3/${input.network}/swap_quote?${params.toString()}`
    )) as OpenOceanSwapQuoteResponse

    if (response.code !== 200 || !response.data) {
      throw new Error(`Failed to build payload for ${input.platform}`)
    }

    return {
      platform: input.platform,
      to: response.data.to,
      data: response.data.data,
      value: response.data.value,
      minOutAmount: response.data.minOutAmount,
      estimatedGas: response.data.estimatedGas
    }
  }

  async simulateTransaction(input: {
    network: Network
    to: string
    data: string
    value: string
  }): Promise<{ ok: boolean; estimatedGas: string; note: string }> {
    try {
      const valueEth = input.value === "0" ? undefined : formatUnits(input.value, 18)
      const res = (await this.callMcp("estimate_gas", {
        network: input.network,
        to: input.to,
        data: input.data,
        value: valueEth
      })) as { estimatedGas?: string }
      return {
        ok: true,
        estimatedGas: res.estimatedGas ?? "0",
        note: "Gas estimated through bnbchain-mcp estimate_gas."
      }
    } catch (error) {
      return {
        ok: false,
        estimatedGas: "0",
        note: `Gas estimation unavailable: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  async getSubmissionPaths(input: {
    network: Network
    mevRiskLevel: MevRiskAssessment["level"]
    preferPrivate: boolean | null
  }): Promise<SubmissionCandidate[]> {
    const privatePreferred = input.preferPrivate || input.mevRiskLevel !== "low"
    return [
      {
        path: "private-rpc",
        availability: "stub",
        recommended: privatePreferred,
        rationale:
          "Private RPC is advisory in MVP, but it is the preferred path when MEV sensitivity is meaningful."
      },
      {
        path: "multi-builder-broadcast",
        availability: "stub",
        recommended: privatePreferred && input.mevRiskLevel === "high",
        rationale:
          "Builder-aware broadcast is advisory in MVP and represents the preferred BSC PBS-aware path under higher extraction risk."
      },
      {
        path: "public-mempool",
        availability: "live",
        recommended: !privatePreferred,
        rationale: "Public submission remains the most available path but exposes the swap to extraction risk.",
        riskNote:
          "Use only when private or builder-aware paths are unavailable or unsupported by the chosen route."
      }
    ]
  }

  async close(): Promise<void> {
    if (this.connected) {
      await this.mcp.close()
      this.connected = false
    }
  }

  private async callMcp(name: string, args: Record<string, unknown>): Promise<any> {
    await this.connect()
    const response = await this.mcp.callTool({
      name,
      arguments: args
    })
    const first = Array.isArray(response.content) ? response.content[0] : undefined
    const text = first && "type" in first && first.type === "text" && "text" in first ? first.text : ""
    if (!text) {
      throw new Error(`Empty MCP response for ${name}`)
    }
    if (text.startsWith("Error ")) {
      throw new Error(text)
    }
    return JSON.parse(text)
  }

  private async getTokenList(network: Network): Promise<TokenRef[]> {
    const cached = this.tokenCache.get(network)
    if (cached) {
      return cached
    }

    const response = (await fetchJson(
      `https://open-api.openocean.finance/v3/${network}/tokenList`
    )) as OpenOceanTokenListResponse
    if (response.code !== 200) {
      throw new Error(`Failed to load token list for ${network}`)
    }

    const list = response.data.map((token) => ({
      symbol: token.symbol,
      address: token.address,
      decimals: token.decimals
    }))
    this.tokenCache.set(network, list)
    return list
  }
}

function normalizeDexShares(
  dexes: Array<{ dexCode: string; swapAmount: string }>
): Array<{ dexCode: string; shareBps: number }> {
  const total = dexes.reduce((sum, dex) => sum + BigInt(dex.swapAmount), 0n)
  if (total === 0n) {
    return []
  }
  return dexes
    .map((dex) => ({
      dexCode: dex.dexCode,
      shareBps: Number((BigInt(dex.swapAmount) * 10000n) / total)
    }))
    .sort((a, b) => b.shareBps - a.shareBps)
    .slice(0, 5)
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json"
    }
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`)
  }
  return response.json()
}

function trimFloat(value: string): string {
  const num = Number(value)
  if (!Number.isFinite(num)) {
    return value
  }
  return num.toFixed(num >= 100 ? 4 : 6).replace(/\.?0+$/, "")
}

export function formatUnits(raw: string, decimals: number): string {
  const normalized = raw.replace(/^(-?)(\d+)$/, "$1$2")
  const sign = normalized.startsWith("-") ? "-" : ""
  const digits = sign ? normalized.slice(1) : normalized
  const padded = digits.padStart(decimals + 1, "0")
  const head = padded.slice(0, -decimals) || "0"
  const tail = padded.slice(-decimals).replace(/0+$/, "")
  return tail ? `${sign}${head}.${tail}` : `${sign}${head}`
}

function parsePercentString(value: string | undefined): number {
  if (!value) {
    return 0
  }
  const normalized = value.replace("%", "")
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0
}

function shellEscape(input: string): string {
  return `'${input.replace(/'/g, `'\"'\"'`)}'`
}

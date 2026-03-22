import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { config as loadEnv } from "dotenv"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { encodeFunctionData, type Address } from "viem"
import { createPublicClient, http } from "viem"
import { bsc, bscTestnet } from "viem/chains"

import type {
  CuratedVenue,
  ExecutionCapabilityUsage,
  ExecutionCapabilitySummary,
  PrivatePathRegistrySummary,
  PrivateSubmissionEndpoint,
  ProviderFeasibility,
  MevRiskAssessment,
  Network,
  ProviderUniverseSnapshot,
  RouteCandidate,
  SubmissionCandidate,
  TokenRef,
  VenueCoverageSnapshot
} from "@bsc-swap-agent-demo/shared"

import type {
  CapabilityRegistry,
  ChainCapabilityAdapter,
  MarketIntelligenceAdapter,
  QuoteCapabilityAdapter,
  SubmissionCapabilityAdapter
} from "./types"
import {
  loadPrivateSubmissionRegistry,
  selectRegistryEndpoints,
  type PrivateSubmissionRegistry
} from "../submission/private-registry"

loadEnv()

const BNB_NATIVE_SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
const PANCAKESWAP_BSC_SMART_ROUTER = "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4"
const PANCAKESWAP_BSC_MIXED_ROUTE_QUOTER_V1 = "0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86"
const PANCAKESWAP_BSC_INFINITY_UNIVERSAL_ROUTER = "0xd9C500DfF816a1Da21A48A732d3498Bf09dc9AEB"
const PANCAKESWAP_BSC_V2_ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E"
const THENA_BSC_ROUTER_V2 = "0xd4Ae6eCA985340Dd434D38F470aCCce4DC78D109"
const BSC_WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"
const WOOFI_BSC_ROUTER_V2 = "0x4c4af8dbc524681930a27b2f1af5bcc8062e6fb7"
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")

const FEASIBILITY_IMPLEMENTED_AGGREGATOR: ProviderFeasibility = {
  quoteEndpointAvailable: true,
  swapBuildAvailable: true,
  bscSupported: true,
  authRequired: false,
  rateLimitNotes: "Subject to provider rate limits.",
  allowanceModel: "mixed",
  responseShapeConfidence: "high",
  docsQuality: "medium",
  recommendedAction: "implement-now"
}

const FEASIBILITY_IMPLEMENT_NOW_AGGREGATOR: ProviderFeasibility = {
  quoteEndpointAvailable: true,
  swapBuildAvailable: true,
  bscSupported: true,
  authRequired: true,
  rateLimitNotes: "Provider-specific auth and rate limits apply.",
  allowanceModel: "mixed",
  responseShapeConfidence: "medium",
  docsQuality: "medium",
  recommendedAction: "implement-now"
}

const FEASIBILITY_IMPLEMENT_LATER_DEX: ProviderFeasibility = {
  quoteEndpointAvailable: true,
  swapBuildAvailable: true,
  bscSupported: true,
  authRequired: false,
  rateLimitNotes: "Direct venue integration details vary by router/quoter design.",
  allowanceModel: "erc20-approval",
  responseShapeConfidence: "medium",
  docsQuality: "medium",
  recommendedAction: "implement-later"
}

const FEASIBILITY_EXCLUDE_OR_DEPRIORITIZE: ProviderFeasibility = {
  quoteEndpointAvailable: false,
  swapBuildAvailable: false,
  bscSupported: true,
  authRequired: false,
  rateLimitNotes: "Not currently prioritized for production integration.",
  allowanceModel: "unknown",
  responseShapeConfidence: "low",
  docsQuality: "low",
  recommendedAction: "exclude"
}

const CURATED_BSC_VENUE_UNIVERSE: {
  aggregators: CuratedVenue[]
  dexs: CuratedVenue[]
  deprioritized: CuratedVenue[]
  excluded: CuratedVenue[]
} = {
  aggregators: [
    {
      id: "openoceanv2",
      displayName: "OpenOcean",
      category: "aggregator",
      defiLlamaSlug: "openocean",
      bscRelevant: true,
      nativeQuoteStatus: "implemented",
      feasibility: FEASIBILITY_IMPLEMENTED_AGGREGATOR,
      included: true,
      notes: ["Directly connected today through the OpenOcean API."]
    },
    {
      id: "matcha",
      displayName: "Matcha / 0x",
      category: "aggregator",
      defiLlamaSlug: "0x-api",
      bscRelevant: true,
      nativeQuoteStatus: "implemented",
      feasibility: FEASIBILITY_IMPLEMENT_NOW_AGGREGATOR,
      included: true,
      notes: ["Native 0x price/quote routing is enabled when ZEROX_API_KEY is configured."]
    },
    {
      id: "paraswap",
      displayName: "ParaSwap",
      category: "aggregator",
      defiLlamaSlug: "paraswap",
      bscRelevant: true,
      nativeQuoteStatus: "implemented",
      feasibility: FEASIBILITY_IMPLEMENT_NOW_AGGREGATOR,
      included: true,
      notes: ["Native ParaSwap market routing is enabled through the Velora API."]
    },
    {
      id: "1inch",
      displayName: "1inch",
      category: "aggregator",
      defiLlamaSlug: "1inch",
      bscRelevant: true,
      nativeQuoteStatus: "implemented",
      feasibility: FEASIBILITY_IMPLEMENT_NOW_AGGREGATOR,
      included: true,
      notes: ["Native 1inch routing is enabled when ONEINCH_API_KEY is configured."]
    }
  ],
  dexs: [
    {
      id: "pancakeswap",
      displayName: "PancakeSwap",
      category: "dex",
      defiLlamaSlug: "pancakeswap-amm",
      bscRelevant: true,
      nativeQuoteStatus: "planned",
      feasibility: FEASIBILITY_IMPLEMENT_LATER_DEX,
      included: true,
      notes: [
        "Top-priority direct BSC venue candidate.",
        `BSC Smart Router: ${PANCAKESWAP_BSC_SMART_ROUTER}.`,
        `BSC MixedRouteQuoterV1: ${PANCAKESWAP_BSC_MIXED_ROUTE_QUOTER_V1}.`,
        `BSC Infinity Universal Router: ${PANCAKESWAP_BSC_INFINITY_UNIVERSAL_ROUTER}.`
      ]
    },
    {
      id: "thena",
      displayName: "Thena",
      category: "dex",
      defiLlamaSlug: "thena",
      bscRelevant: true,
      nativeQuoteStatus: "implemented",
      feasibility: FEASIBILITY_IMPLEMENT_LATER_DEX,
      included: true,
      notes: [
        "Important BSC venue candidate for direct quote coverage.",
        `BSC RouterV2: ${THENA_BSC_ROUTER_V2}.`
      ]
    },
    {
      id: "woofi",
      displayName: "WOOFi",
      category: "dex",
      defiLlamaSlug: "woofi",
      bscRelevant: true,
      nativeQuoteStatus: "implemented",
      feasibility: FEASIBILITY_IMPLEMENT_LATER_DEX,
      included: true,
      notes: [
        "Important BSC venue candidate for direct quote coverage.",
        `BSC WooRouterV2: ${WOOFI_BSC_ROUTER_V2}.`
      ]
    },
    {
      id: "uniswap",
      displayName: "Uniswap-family on BSC",
      category: "dex",
      defiLlamaSlug: "uniswap-v3",
      bscRelevant: true,
      nativeQuoteStatus: "planned",
      feasibility: FEASIBILITY_IMPLEMENT_LATER_DEX,
      included: true,
      notes: ["Represents Uniswap-family liquidity surfaced on BSC."]
    },
    {
      id: "biswap",
      displayName: "Biswap",
      category: "dex",
      defiLlamaSlug: "biswap",
      bscRelevant: true,
      nativeQuoteStatus: "none",
      feasibility: FEASIBILITY_EXCLUDE_OR_DEPRIORITIZE,
      included: true,
      notes: ["Observed candidate but not yet prioritized for native integration."]
    }
  ],
  deprioritized: [
    {
      id: "apeswap",
      displayName: "ApeSwap",
      category: "dex",
      defiLlamaSlug: "apeswap-amm",
      bscRelevant: true,
      nativeQuoteStatus: "none",
      feasibility: FEASIBILITY_EXCLUDE_OR_DEPRIORITIZE,
      included: false,
      notes: ["Known BSC venue but currently outside the top implementation target set."]
    }
  ],
  excluded: []
}

const PLATFORM_CANDIDATES = CURATED_BSC_VENUE_UNIVERSE.aggregators
  .filter((venue) => venue.included)
  .map((venue) => venue.id)

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

interface ZeroXRouteFill {
  source?: string
  proportionBps?: string
}

interface ZeroXPriceResponse {
  buyAmount?: string
  grossBuyAmount?: string
  minBuyAmount?: string
  gas?: string
  route?: {
    fills?: ZeroXRouteFill[]
  }
  issues?: {
    allowance?: { spender?: string | null }
  }
}

interface ZeroXQuoteResponse extends ZeroXPriceResponse {
  transaction?: {
    to?: string
    data?: string
    value?: string
    gas?: string
  }
}

interface ParaSwapBestRouteSwap {
  swapExchanges?: Array<{
    exchange?: string
    percent?: number
  }>
}

interface ParaSwapPriceRoute {
  destAmount?: string
  srcAmount?: string
  gasCost?: string
  bestRoute?: ParaSwapBestRouteSwap[]
}

interface ParaSwapPriceResponse {
  priceRoute?: ParaSwapPriceRoute
}

interface ParaSwapSwapResponse {
  priceRoute?: ParaSwapPriceRoute
  txParams?: {
    to?: string
    data?: string
    value?: string
    gas?: string
  }
}

interface OneInchRoutePart {
  name?: string
  part?: number
}

interface OneInchProtocolEntry {
  name?: string
  part?: number
}

interface OneInchQuoteResponse {
  dstAmount?: string
  toAmount?: string
  estimatedGas?: number | string
  protocols?: Array<Array<OneInchProtocolEntry>>
  route?: {
    parts?: OneInchRoutePart[]
  }
  tx?: {
    to?: string
    data?: string
    value?: string
    gas?: number | string
  }
}

interface WooFiQuoteResponse {
  type?: string
  stateMutability?: string
}

interface DefiLlamaDexOverviewResponse {
  protocols?: Array<{
    name?: string
    displayName?: string
    volume24h?: number
    chains?: string[]
  }>
}

interface DefiLlamaDexSummaryResponse {
  name?: string
  displayName?: string
  volume24h?: number
  chains?: string[]
}

class BnbMcpChainAdapter implements ChainCapabilityAdapter {
  private readonly mcp = new Client({ name: "bsc-swap-agent-demo", version: "0.2.0" })
  private readonly tokenCache = new Map<Network, TokenRef[]>()
  private connected = false

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
    return (
      list.find(
        (token) =>
          token.symbol.toUpperCase() === normalized ||
          token.address.toLowerCase() === query.toLowerCase()
      ) ?? null
    )
  }

  async estimateGas(input: {
    network: Network
    to: string
    data?: string
    value?: string
  }): Promise<{ estimatedGas?: string }> {
    return this.callMcp("estimate_gas", input)
  }

  async close(): Promise<void> {
    if (this.connected) {
      await this.mcp.close()
      this.connected = false
    }
  }

  private async connect(): Promise<void> {
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

class BscExecutionMcpClient {
  private readonly mcp = new Client({ name: "bsc-swap-agent-demo-execution", version: "0.1.0" })
  private connected = false

  async getCapabilitySummary(network: Network): Promise<ExecutionCapabilitySummary> {
    try {
      await this.connect()
      const tools = await this.mcp.listTools()
      const toolNames = tools.tools.map((tool) => tool.name)
      const registryPayload = toolNames.includes("get_private_endpoint_registry")
        ? await this.callMcp("get_private_endpoint_registry", { network })
        : null

      return {
        available: true,
        toolCount: toolNames.length,
        tools: toolNames,
        privateRegistryAvailable: Boolean(registryPayload?.summary),
        privateSubmitAvailable: toolNames.includes("private_rpc_submit_raw"),
        builderBroadcastAvailable: toolNames.includes("multi_builder_broadcast_raw"),
        auditAvailable: toolNames.includes("audit_swap_execution"),
        routeSimulationAvailable: toolNames.includes("simulate_candidate_routes"),
        registrySummary: registryPayload?.summary,
        notes: registryPayload?.summary?.notes ?? ["Execution MCP connected."]
      }
    } catch (error) {
      return {
        available: false,
        toolCount: 0,
        tools: [],
        privateRegistryAvailable: false,
        privateSubmitAvailable: false,
        builderBroadcastAvailable: false,
        auditAvailable: false,
        routeSimulationAvailable: false,
        notes: [error instanceof Error ? error.message : String(error)]
      }
    }
  }

  async simulateCandidateRoutes(input: {
    network: Network
    sellToken: TokenRef
    buyToken: TokenRef
    amount: string
    slippageBps: number
    account: string
    routeIds?: string[]
  }): Promise<{
    routeIds: string[]
    confirmed: boolean
    note: string
    usage: ExecutionCapabilityUsage
  }> {
    try {
      const payload = await this.callMcp("simulate_candidate_routes", {
        network: input.network,
        sellToken: input.sellToken.symbol,
        buyToken: input.buyToken.symbol,
        amount: input.amount,
        account: input.account,
        slippageBps: input.slippageBps,
        routeIds: input.routeIds
      })
      const routeIds = Array.isArray(payload?.routes)
        ? payload.routes.map((route: { routeId?: string }) => route.routeId).filter(Boolean)
        : []
      return {
        routeIds,
        confirmed: routeIds.length > 0,
        note: routeIds.length ? "route-sim confirmed top candidates" : "route-sim returned no confirmations",
        usage: {
          available: ["route-sim"],
          used: routeIds.length ? ["route-sim"] : [],
          notes: routeIds.length ? ["Execution MCP route simulation confirmed kept candidates."] : ["Execution MCP route simulation returned no confirmations."]
        }
      }
    } catch (error) {
      return {
        routeIds: [],
        confirmed: false,
        note: "route-sim unavailable, local simulation only",
        usage: {
          available: ["route-sim"],
          used: [],
          notes: [error instanceof Error ? error.message : String(error)]
        }
      }
    }
  }

  async close(): Promise<void> {
    if (this.connected) {
      await this.mcp.close()
      this.connected = false
    }
  }

  private async connect(): Promise<void> {
    if (this.connected) return

    const overrideCommand = process.env.BSC_EXECUTION_MCP_COMMAND
    const overrideArgs = process.env.BSC_EXECUTION_MCP_ARGS
    const command = overrideCommand || "/bin/zsh"
    const args =
      overrideArgs?.split(" ").filter(Boolean) || [
        "-lc",
        `cd ${shellEscape(REPO_ROOT)} && bun run mcp:execution 2>/dev/null`
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

  private async callMcp(name: string, args: Record<string, unknown>): Promise<any> {
    await this.connect()
    const response = await this.mcp.callTool({ name, arguments: args })
    const first = Array.isArray(response.content) ? response.content[0] : undefined
    const text = first && "type" in first && first.type === "text" && "text" in first ? first.text : ""
    if (!text) {
      throw new Error(`Empty execution MCP response for ${name}`)
    }
    return JSON.parse(text)
  }
}

class OpenOceanQuoteAdapter implements QuoteCapabilityAdapter {
  constructor(
    private readonly chain: ChainCapabilityAdapter,
    private readonly options: {
      platforms?: string[]
      quoteSource?: string
      quoteMethod?: RouteCandidate["quoteMethod"]
      routeSourceType?: RouteCandidate["routeSourceType"]
    } = {}
  ) {}

  async getQuoteCandidates(input: {
    network: Network
    sellToken: TokenRef
    buyToken: TokenRef
    amount: string
    amountRaw: string
    slippageBps: number
  }): Promise<RouteCandidate[]> {
    const platforms = this.options.platforms ?? PLATFORM_CANDIDATES
    const quotes = await Promise.all(
      platforms.map(async (platform) => {
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
        const curatedVenue = getCuratedAggregatorVenue(item.platform)
        const outAmountRaw = item.response.data!.outAmount
        const outAmount = formatUnits(outAmountRaw, input.buyToken.decimals)
        const dexes = normalizeDexShares(item.response.data?.dexes ?? [])
        const priceImpactPct = parsePercentString(item.response.data?.price_impact)
        const stability = priceImpactPct < 0.3 ? "high" : priceImpactPct < 1 ? "medium" : "low"
        const routeSourceType =
          this.options.routeSourceType ??
          (curatedVenue?.nativeQuoteStatus === "implemented" ? "native" : "modeled")
        return {
          id: item.platform,
          platform: item.platform,
          routeFamily: "aggregator",
          quoteSource: this.options.quoteSource ?? "openocean",
          routeSourceType,
          quoteMethod: this.options.quoteMethod ?? "aggregator-http",
          providerNative: routeSourceType === "native",
          providerUniverseCategory: curatedVenue?.category ?? "aggregator",
          feasibilityStatus: curatedVenue?.feasibility.recommendedAction ?? "implement-later",
          quotedOut: outAmountRaw,
          quotedOutFormatted: `${trimFloat(outAmount)} ${input.buyToken.symbol}`,
          priceImpactPct,
          estimatedGas: item.response.data?.estimatedGas ?? "0",
          expectedExecutionStability: stability,
          protocolFit: "aggregator",
          mevExposure: priceImpactPct > 1 ? "high" : priceImpactPct > 0.3 ? "medium" : "low",
          coverageConfidence: "medium",
          coverageNotes:
            routeSourceType === "native"
              ? ["Observed directly through the OpenOcean aggregator API."]
              : [
                  `Observed through OpenOcean platform routing, not a native ${item.platform} quote path.`,
                  ...(curatedVenue?.notes ?? [])
                ],
          quoteRequestNotes: [
            routeSourceType === "native"
              ? "Queried through the currently connected native provider path."
              : "Using the OpenOcean-modeled fallback until a native provider adapter is enabled."
          ],
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
    amountRaw: string
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
    account: string
    to: string
    data: string
    value: string
  }): Promise<{ ok: boolean; estimatedGas: string; note: string }> {
    try {
      const client = getRpcClient(input.network)
      const gas = await client.estimateGas({
        account: input.account as Address,
        to: input.to as Address,
        data: input.data as `0x${string}`,
        value: input.value === "0" ? undefined : BigInt(input.value)
      })
      return {
        ok: true,
        estimatedGas: gas.toString(),
        note: `Gas estimated through direct ${input.network} RPC simulation with account context.`
      }
    } catch (error) {
      return {
        ok: false,
        estimatedGas: "0",
        note: `Gas estimation unavailable: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }
}

abstract class PlaceholderNativeQuoteAdapter implements QuoteCapabilityAdapter {
  constructor(readonly providerId: string) {}

  async getQuoteCandidates(_input: {
    network: Network
    sellToken: TokenRef
    buyToken: TokenRef
    amount: string
    amountRaw: string
    slippageBps: number
  }): Promise<RouteCandidate[]> {
    return []
  }

  async encodeRouterCalldata(_input: {
    network: Network
    platform: string
    sellToken: TokenRef
    buyToken: TokenRef
    amount: string
    amountRaw: string
    slippageBps: number
    account: string
  }): Promise<{
    platform: string
    to: string
    data: string
    value: string
    minOutAmount: string
    estimatedGas: string
  }> {
    throw new Error(`Native quote adapter for ${this.providerId} is not yet enabled for payload building.`)
  }

  async simulateTransaction(input: {
    network: Network
    account: string
    to: string
    data: string
    value: string
  }): Promise<{ ok: boolean; estimatedGas: string; note: string }> {
    const client = getRpcClient(input.network)
    try {
      const gas = await client.estimateGas({
        account: input.account as Address,
        to: input.to as Address,
        data: input.data as `0x${string}`,
        value: input.value === "0" ? undefined : BigInt(input.value)
      })
      return {
        ok: true,
        estimatedGas: gas.toString(),
        note: `Gas estimated through direct ${input.network} RPC simulation with account context.`
      }
    } catch (error) {
      return {
        ok: false,
        estimatedGas: "0",
        note: `Gas estimation unavailable: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }
}

class ZeroXQuoteAdapter implements QuoteCapabilityAdapter {
  constructor(private readonly chain: ChainCapabilityAdapter) {}

  async getQuoteCandidates(input: {
    network: Network
    sellToken: TokenRef
    buyToken: TokenRef
    amount: string
    amountRaw: string
    slippageBps: number
  }): Promise<RouteCandidate[]> {
    if (!isZeroXEnabled() || input.network !== "bsc" || input.sellToken.isNative || input.buyToken.isNative) {
      return []
    }

    const params = new URLSearchParams({
      chainId: String(getChainId(input.network)),
      sellToken: input.sellToken.address,
      buyToken: input.buyToken.address,
      sellAmount: input.amountRaw
    })

    const response = (await fetchJson(`https://api.0x.org/swap/allowance-holder/price?${params.toString()}`, {
      headers: getZeroXHeaders()
    })) as ZeroXPriceResponse

    if (!response.buyAmount) {
      return []
    }

    const curatedVenue = getCuratedAggregatorVenue("matcha")
    const dexes = normalizeZeroXFills(response.route?.fills ?? [])
    const outAmount = formatUnits(response.buyAmount, input.buyToken.decimals)

    return [
      {
        id: "matcha",
        platform: "matcha",
        routeFamily: "aggregator",
        quoteSource: "0x",
        routeSourceType: "native",
        quoteMethod: "native-http",
        providerNative: true,
        providerUniverseCategory: curatedVenue?.category ?? "aggregator",
        feasibilityStatus: curatedVenue?.feasibility.recommendedAction ?? "implement-now",
        quotedOut: response.buyAmount,
        quotedOutFormatted: `${trimFloat(outAmount)} ${input.buyToken.symbol}`,
        priceImpactPct: 0,
        estimatedGas: response.gas ?? "0",
        expectedExecutionStability: dexes.length > 1 ? "high" : "medium",
        protocolFit: "aggregator",
        mevExposure: "medium",
        coverageConfidence: "medium",
        coverageNotes: [
          "Observed directly through the 0x native price endpoint.",
          ...(curatedVenue?.notes ?? [])
        ],
        quoteRequestNotes: [
          "Discovery uses the 0x allowance-holder price endpoint.",
          response.issues?.allowance?.spender
            ? `Allowance holder spender surfaced by 0x: ${response.issues.allowance.spender}.`
            : "Allowance holder details will be finalized at quote/build time."
        ],
        routeSummary: dexes.length
          ? `0x route spans ${dexes.length} venues with ${dexes[0].dexCode} dominant`
          : "0x route composition unavailable",
        dexes,
        score: 0
      }
    ]
  }

  async encodeRouterCalldata(input: {
    network: Network
    platform: string
    sellToken: TokenRef
    buyToken: TokenRef
    amount: string
    amountRaw: string
    slippageBps: number
    account: string
  }) {
    if (!isZeroXEnabled()) {
      throw new Error("ZEROX_API_KEY is not configured for the 0x native adapter.")
    }
    if (input.network !== "bsc") {
      throw new Error("0x native adapter is currently enabled only for BSC.")
    }
    if (input.sellToken.isNative || input.buyToken.isNative) {
      throw new Error("0x native adapter currently handles ERC20-to-ERC20 swaps only.")
    }

    const params = new URLSearchParams({
      chainId: String(getChainId(input.network)),
      sellToken: input.sellToken.address,
      buyToken: input.buyToken.address,
      sellAmount: input.amountRaw,
      taker: input.account,
      slippageBps: String(input.slippageBps)
    })
    const response = (await fetchJson(`https://api.0x.org/swap/allowance-holder/quote?${params.toString()}`, {
      headers: getZeroXHeaders()
    })) as ZeroXQuoteResponse

    if (!response.transaction?.to || !response.transaction.data || !response.buyAmount) {
      throw new Error("Failed to build a native 0x swap quote.")
    }

    return {
      platform: input.platform,
      to: response.transaction.to,
      data: response.transaction.data,
      value: response.transaction.value ?? "0",
      minOutAmount: response.minBuyAmount ?? response.buyAmount,
      estimatedGas: response.transaction.gas ?? response.gas ?? "0"
    }
  }

  async simulateTransaction(input: {
    network: Network
    account: string
    to: string
    data: string
    value: string
  }): Promise<{ ok: boolean; estimatedGas: string; note: string }> {
    const client = getRpcClient(input.network)
    try {
      const gas = await client.estimateGas({
        account: input.account as Address,
        to: input.to as Address,
        data: input.data as `0x${string}`,
        value: input.value === "0" ? undefined : BigInt(input.value)
      })
      return {
        ok: true,
        estimatedGas: gas.toString(),
        note: `Gas estimated through direct ${input.network} RPC simulation with account context.`
      }
    } catch (error) {
      return {
        ok: false,
        estimatedGas: "0",
        note: `Gas estimation unavailable: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }
}

class ParaSwapQuoteAdapter extends PlaceholderNativeQuoteAdapter {
  constructor() {
    super("paraswap")
  }

  async getQuoteCandidates(input: {
    network: Network
    sellToken: TokenRef
    buyToken: TokenRef
    amount: string
    amountRaw: string
    slippageBps: number
  }): Promise<RouteCandidate[]> {
    if (input.network !== "bsc") {
      return []
    }

    const params = new URLSearchParams({
      srcToken: normalizeParaSwapToken(input.sellToken),
      destToken: normalizeParaSwapToken(input.buyToken),
      srcDecimals: String(input.sellToken.decimals),
      destDecimals: String(input.buyToken.decimals),
      amount: input.amountRaw,
      side: "SELL",
      network: String(getChainId(input.network)),
      version: "6.2"
    })
    const response = (await fetchJson(
      `https://apiv5.paraswap.io/prices?${params.toString()}`
    )) as ParaSwapPriceResponse

    if (!response.priceRoute?.destAmount) {
      return []
    }

    const curatedVenue = getCuratedAggregatorVenue("paraswap")
    const dexes = normalizeParaSwapBestRoute(response.priceRoute.bestRoute ?? [])
    const outAmount = formatUnits(response.priceRoute.destAmount, input.buyToken.decimals)

    return [
      {
        id: "paraswap",
        platform: "paraswap",
        routeFamily: "aggregator",
        quoteSource: "paraswap",
        routeSourceType: "native",
        quoteMethod: "native-http",
        providerNative: true,
        providerUniverseCategory: curatedVenue?.category ?? "aggregator",
        feasibilityStatus: curatedVenue?.feasibility.recommendedAction ?? "implement-now",
        quotedOut: response.priceRoute.destAmount,
        quotedOutFormatted: `${trimFloat(outAmount)} ${input.buyToken.symbol}`,
        priceImpactPct: 0,
        estimatedGas: response.priceRoute.gasCost ?? "0",
        expectedExecutionStability: dexes.length > 1 ? "high" : "medium",
        protocolFit: "aggregator",
        mevExposure: "medium",
        coverageConfidence: "medium",
        coverageNotes: [
          "Observed directly through the ParaSwap native price endpoint.",
          ...(curatedVenue?.notes ?? [])
        ],
        quoteRequestNotes: [
          "Discovery uses the ParaSwap prices endpoint.",
          "Payload build uses the ParaSwap swap endpoint with the same priceRoute context."
        ],
        routeSummary: dexes.length
          ? `ParaSwap route spans ${dexes.length} venues with ${dexes[0].dexCode} dominant`
          : "ParaSwap route composition unavailable",
        dexes,
        score: 0
      }
    ]
  }

  async encodeRouterCalldata(input: {
    network: Network
    platform: string
    sellToken: TokenRef
    buyToken: TokenRef
    amount: string
    amountRaw: string
    slippageBps: number
    account: string
  }) {
    if (input.network !== "bsc") {
      throw new Error("ParaSwap native adapter is currently enabled only for BSC.")
    }

    const priceParams = new URLSearchParams({
      srcToken: normalizeParaSwapToken(input.sellToken),
      destToken: normalizeParaSwapToken(input.buyToken),
      srcDecimals: String(input.sellToken.decimals),
      destDecimals: String(input.buyToken.decimals),
      amount: input.amountRaw,
      side: "SELL",
      network: String(getChainId(input.network)),
      version: "6.2"
    })
    const priceResponse = (await fetchJson(
      `https://apiv5.paraswap.io/prices?${priceParams.toString()}`
    )) as ParaSwapPriceResponse

    if (!priceResponse.priceRoute?.destAmount) {
      throw new Error("Failed to fetch a ParaSwap price route.")
    }

    const swapParams = new URLSearchParams({
      srcToken: normalizeParaSwapToken(input.sellToken),
      destToken: normalizeParaSwapToken(input.buyToken),
      srcDecimals: String(input.sellToken.decimals),
      destDecimals: String(input.buyToken.decimals),
      amount: input.amountRaw,
      side: "SELL",
      network: String(getChainId(input.network)),
      userAddress: input.account,
      slippage: String(input.slippageBps / 100),
      version: "6.2"
    })
    const swapResponse = (await fetchJson(
      `https://apiv5.paraswap.io/swap?${swapParams.toString()}`
    )) as ParaSwapSwapResponse

    if (!swapResponse.txParams?.to || !swapResponse.txParams.data) {
      throw new Error("Failed to build a native ParaSwap swap transaction.")
    }

    return {
      platform: input.platform,
      to: swapResponse.txParams.to,
      data: swapResponse.txParams.data,
      value: swapResponse.txParams.value ?? "0",
      minOutAmount: swapResponse.priceRoute?.destAmount ?? priceResponse.priceRoute.destAmount,
      estimatedGas: swapResponse.txParams.gas ?? swapResponse.priceRoute?.gasCost ?? priceResponse.priceRoute.gasCost ?? "0"
    }
  }
}

class OneInchQuoteAdapter extends PlaceholderNativeQuoteAdapter {
  constructor() {
    super("1inch")
  }

  async getQuoteCandidates(input: {
    network: Network
    sellToken: TokenRef
    buyToken: TokenRef
    amount: string
    amountRaw: string
    slippageBps: number
  }): Promise<RouteCandidate[]> {
    if (!isOneInchEnabled() || input.network !== "bsc") {
      return []
    }

    const params = new URLSearchParams({
      src: normalizeOneInchToken(input.sellToken),
      dst: normalizeOneInchToken(input.buyToken),
      amount: input.amountRaw
    })
    const response = (await fetchJson(
      `${getOneInchBaseUrl(input.network)}/quote?${params.toString()}`,
      { headers: getOneInchHeaders() }
    )) as OneInchQuoteResponse

    const dstAmount = response.dstAmount ?? response.toAmount
    if (!dstAmount) {
      return []
    }

    const curatedVenue = getCuratedAggregatorVenue("1inch")
    const dexes = normalizeOneInchProtocols(response.protocols ?? [], response.route?.parts ?? [])
    const outAmount = formatUnits(dstAmount, input.buyToken.decimals)

    return [
      {
        id: "1inch",
        platform: "1inch",
        routeFamily: "aggregator",
        quoteSource: "1inch",
        routeSourceType: "native",
        quoteMethod: "native-http",
        providerNative: true,
        providerUniverseCategory: curatedVenue?.category ?? "aggregator",
        feasibilityStatus: curatedVenue?.feasibility.recommendedAction ?? "implement-now",
        quotedOut: dstAmount,
        quotedOutFormatted: `${trimFloat(outAmount)} ${input.buyToken.symbol}`,
        priceImpactPct: 0,
        estimatedGas: String(response.estimatedGas ?? "0"),
        expectedExecutionStability: dexes.length > 1 ? "high" : "medium",
        protocolFit: "aggregator",
        mevExposure: "medium",
        coverageConfidence: "medium",
        coverageNotes: [
          "Observed directly through the 1inch native quote endpoint.",
          ...(curatedVenue?.notes ?? [])
        ],
        quoteRequestNotes: [
          "Discovery uses the 1inch quote endpoint.",
          "Payload build uses the 1inch swap endpoint."
        ],
        routeSummary: dexes.length
          ? `1inch route spans ${dexes.length} venues with ${dexes[0].dexCode} dominant`
          : "1inch route composition unavailable",
        dexes,
        score: 0
      }
    ]
  }

  async encodeRouterCalldata(input: {
    network: Network
    platform: string
    sellToken: TokenRef
    buyToken: TokenRef
    amount: string
    amountRaw: string
    slippageBps: number
    account: string
  }) {
    if (!isOneInchEnabled()) {
      throw new Error("ONEINCH_API_KEY is not configured for the 1inch native adapter.")
    }
    if (input.network !== "bsc") {
      throw new Error("1inch native adapter is currently enabled only for BSC.")
    }

    const params = new URLSearchParams({
      src: normalizeOneInchToken(input.sellToken),
      dst: normalizeOneInchToken(input.buyToken),
      amount: input.amountRaw,
      from: input.account,
      slippage: String(input.slippageBps / 100)
    })
    const response = (await fetchJson(
      `${getOneInchBaseUrl(input.network)}/swap?${params.toString()}`,
      { headers: getOneInchHeaders() }
    )) as OneInchQuoteResponse

    const dstAmount = response.dstAmount ?? response.toAmount
    if (!response.tx?.to || !response.tx.data || !dstAmount) {
      throw new Error("Failed to build a native 1inch swap transaction.")
    }

    return {
      platform: input.platform,
      to: response.tx.to,
      data: response.tx.data,
      value: response.tx.value ?? "0",
      minOutAmount: dstAmount,
      estimatedGas: String(response.tx.gas ?? response.estimatedGas ?? "0")
    }
  }
}

class PancakeQuoteAdapter extends PlaceholderNativeQuoteAdapter {
  constructor() {
    super("pancakeswap")
  }

  async getQuoteCandidates(input: {
    network: Network
    sellToken: TokenRef
    buyToken: TokenRef
    amount: string
    amountRaw: string
    slippageBps: number
  }): Promise<RouteCandidate[]> {
    if (input.network !== "bsc" || !supportsPancakeDirectPair(input.sellToken, input.buyToken)) {
      return []
    }

    const client = getRpcClient(input.network)
    const path = buildPancakePath(input.sellToken, input.buyToken)
    const amounts = (await client.readContract({
      address: PANCAKESWAP_BSC_V2_ROUTER as Address,
      abi: PANCAKE_V2_ROUTER_ABI,
      functionName: "getAmountsOut",
      args: [BigInt(input.amountRaw), path]
    })) as bigint[]
    const quotedOut = amounts[amounts.length - 1]
    if (!quotedOut || quotedOut <= 0n) {
      return []
    }

    const curatedVenue = CURATED_BSC_VENUE_UNIVERSE.dexs.find((venue) => venue.id === "pancakeswap")
    const dexes = [{ dexCode: "PancakeSwap", shareBps: 10000 }]
    return [
      {
        id: "pancakeswap",
        platform: "pancakeswap",
        routeFamily: "direct-dex",
        quoteSource: "pancakeswap",
        routeSourceType: "native",
        quoteMethod: "onchain-quoter",
        providerNative: true,
        providerUniverseCategory: "dex",
        feasibilityStatus: curatedVenue?.feasibility.recommendedAction ?? "implement-later",
        quotedOut: quotedOut.toString(),
        quotedOutFormatted: `${trimFloat(formatUnits(quotedOut.toString(), input.buyToken.decimals))} ${input.buyToken.symbol}`,
        priceImpactPct: 0,
        estimatedGas: estimatePancakeGas(path).toString(),
        expectedExecutionStability: "medium",
        protocolFit: "single-venue",
        mevExposure: input.sellToken.isNative || input.buyToken.isNative ? "medium" : "low",
        coverageConfidence: "medium",
        coverageNotes: [
          "Observed directly through the PancakeSwap BSC router path.",
          ...(curatedVenue?.notes ?? [])
        ],
        quoteRequestNotes: [
          "Direct venue quote uses PancakeSwap router getAmountsOut with a fixed BSC path.",
          "v1 direct venue scope is limited to major BNB and stable routes."
        ],
        routeSummary: `Direct PancakeSwap path via ${path.length - 1} hop(s).`,
        dexes,
        score: 0
      }
    ]
  }

  async encodeRouterCalldata(input: {
    network: Network
    platform: string
    sellToken: TokenRef
    buyToken: TokenRef
    amount: string
    amountRaw: string
    slippageBps: number
    account: string
  }) {
    if (input.network !== "bsc" || !supportsPancakeDirectPair(input.sellToken, input.buyToken)) {
      throw new Error("Pancake direct adapter currently supports only major BSC exact-in routes.")
    }

    const path = buildPancakePath(input.sellToken, input.buyToken)
    const client = getRpcClient(input.network)
    const amounts = (await client.readContract({
      address: PANCAKESWAP_BSC_V2_ROUTER as Address,
      abi: PANCAKE_V2_ROUTER_ABI,
      functionName: "getAmountsOut",
      args: [BigInt(input.amountRaw), path]
    })) as bigint[]
    const quotedOut = amounts[amounts.length - 1]
    const minOutAmount = applySlippageToAmount(quotedOut, input.slippageBps)
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 120)

    let data: string
    let value = "0"

    if (input.sellToken.isNative) {
      data = encodeFunctionData({
        abi: PANCAKE_V2_ROUTER_ABI,
        functionName: "swapExactETHForTokens",
        args: [minOutAmount, path, input.account as Address, deadline]
      })
      value = input.amount
    } else if (input.buyToken.isNative) {
      data = encodeFunctionData({
        abi: PANCAKE_V2_ROUTER_ABI,
        functionName: "swapExactTokensForETH",
        args: [BigInt(input.amountRaw), minOutAmount, path, input.account as Address, deadline]
      })
    } else {
      data = encodeFunctionData({
        abi: PANCAKE_V2_ROUTER_ABI,
        functionName: "swapExactTokensForTokens",
        args: [BigInt(input.amountRaw), minOutAmount, path, input.account as Address, deadline]
      })
    }

    return {
      platform: input.platform,
      to: PANCAKESWAP_BSC_V2_ROUTER,
      data,
      value,
      minOutAmount: minOutAmount.toString(),
      estimatedGas: estimatePancakeGas(path).toString()
    }
  }
}

class ThenaQuoteAdapter extends PlaceholderNativeQuoteAdapter {
  constructor() {
    super("thena")
  }

  async getQuoteCandidates(input: {
    network: Network
    sellToken: TokenRef
    buyToken: TokenRef
    amount: string
    amountRaw: string
    slippageBps: number
  }): Promise<RouteCandidate[]> {
    if (input.network !== "bsc" || !supportsThenaDirectPair(input.sellToken, input.buyToken)) {
      return []
    }

    const client = getRpcClient(input.network)
    const routes = await buildThenaRoutes(client, input.sellToken, input.buyToken, BigInt(input.amountRaw))
    if (!routes.length) {
      return []
    }

    const amounts = (await client.readContract({
      address: THENA_BSC_ROUTER_V2 as Address,
      abi: THENA_ROUTER_V2_ABI,
      functionName: "getAmountsOut",
      args: [BigInt(input.amountRaw), routes]
    })) as bigint[]
    const quotedOut = amounts[amounts.length - 1]
    if (!quotedOut || quotedOut <= 0n) {
      return []
    }

    const curatedVenue = CURATED_BSC_VENUE_UNIVERSE.dexs.find((venue) => venue.id === "thena")
    return [
      {
        id: "thena",
        platform: "thena",
        routeFamily: "direct-dex",
        quoteSource: "thena",
        routeSourceType: "native",
        quoteMethod: "onchain-quoter",
        providerNative: true,
        providerUniverseCategory: "dex",
        feasibilityStatus: curatedVenue?.feasibility.recommendedAction ?? "implement-later",
        quotedOut: quotedOut.toString(),
        quotedOutFormatted: `${trimFloat(formatUnits(quotedOut.toString(), input.buyToken.decimals))} ${input.buyToken.symbol}`,
        priceImpactPct: 0,
        estimatedGas: estimateThenaGas(routes).toString(),
        expectedExecutionStability: routes.length > 1 ? "medium" : "high",
        protocolFit: "single-venue",
        mevExposure: input.sellToken.isNative || input.buyToken.isNative ? "medium" : "low",
        coverageConfidence: "medium",
        coverageNotes: [
          "Observed directly through the THENA RouterV2 path.",
          ...(curatedVenue?.notes ?? [])
        ],
        quoteRequestNotes: [
          "Direct venue quote uses THENA RouterV2 getAmountOut/getAmountsOut.",
          "v1 direct venue scope is limited to major BNB and stable routes."
        ],
        routeSummary: `Direct THENA path via ${routes.length} hop(s).`,
        dexes: [{ dexCode: "Thena", shareBps: 10000 }],
        score: 0
      }
    ]
  }

  async encodeRouterCalldata(input: {
    network: Network
    platform: string
    sellToken: TokenRef
    buyToken: TokenRef
    amount: string
    amountRaw: string
    slippageBps: number
    account: string
  }) {
    if (input.network !== "bsc" || !supportsThenaDirectPair(input.sellToken, input.buyToken)) {
      throw new Error("THENA direct adapter currently supports only major BSC exact-in routes.")
    }

    const client = getRpcClient(input.network)
    const routes = await buildThenaRoutes(client, input.sellToken, input.buyToken, BigInt(input.amountRaw))
    if (!routes.length) {
      throw new Error("THENA direct adapter could not derive a valid route.")
    }
    const amounts = (await client.readContract({
      address: THENA_BSC_ROUTER_V2 as Address,
      abi: THENA_ROUTER_V2_ABI,
      functionName: "getAmountsOut",
      args: [BigInt(input.amountRaw), routes]
    })) as bigint[]
    const quotedOut = amounts[amounts.length - 1]
    const minOutAmount = applySlippageToAmount(quotedOut, input.slippageBps)
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 120)

    let data: string
    let value = "0"

    if (input.sellToken.isNative) {
      data = encodeFunctionData({
        abi: THENA_ROUTER_V2_ABI,
        functionName: "swapExactETHForTokens",
        args: [minOutAmount, routes, input.account as Address, deadline]
      })
      value = input.amount
    } else if (input.buyToken.isNative) {
      data = encodeFunctionData({
        abi: THENA_ROUTER_V2_ABI,
        functionName: "swapExactTokensForETH",
        args: [BigInt(input.amountRaw), minOutAmount, routes, input.account as Address, deadline]
      })
    } else {
      data = encodeFunctionData({
        abi: THENA_ROUTER_V2_ABI,
        functionName: "swapExactTokensForTokens",
        args: [BigInt(input.amountRaw), minOutAmount, routes, input.account as Address, deadline]
      })
    }

    return {
      platform: input.platform,
      to: THENA_BSC_ROUTER_V2,
      data,
      value,
      minOutAmount: minOutAmount.toString(),
      estimatedGas: estimateThenaGas(routes).toString()
    }
  }
}

class WooFiQuoteAdapter extends PlaceholderNativeQuoteAdapter {
  constructor() {
    super("woofi")
  }

  async getQuoteCandidates(input: {
    network: Network
    sellToken: TokenRef
    buyToken: TokenRef
    amount: string
    amountRaw: string
    slippageBps: number
  }): Promise<RouteCandidate[]> {
    if (input.network !== "bsc" || !supportsWooFiDirectPair(input.sellToken, input.buyToken)) {
      return []
    }

    const client = getRpcClient(input.network)
    const quotedOut = (await client.readContract({
      address: WOOFI_BSC_ROUTER_V2 as Address,
      abi: WOOFI_ROUTER_V2_ABI,
      functionName: "querySwap",
      args: [toWooFiAddress(input.sellToken), toWooFiAddress(input.buyToken), BigInt(input.amountRaw)]
    })) as bigint
    if (!quotedOut || quotedOut <= 0n) {
      return []
    }

    const curatedVenue = CURATED_BSC_VENUE_UNIVERSE.dexs.find((venue) => venue.id === "woofi")
    return [
      {
        id: "woofi",
        platform: "woofi",
        routeFamily: "direct-dex",
        quoteSource: "woofi",
        routeSourceType: "native",
        quoteMethod: "onchain-quoter",
        providerNative: true,
        providerUniverseCategory: "dex",
        feasibilityStatus: curatedVenue?.feasibility.recommendedAction ?? "implement-later",
        quotedOut: quotedOut.toString(),
        quotedOutFormatted: `${trimFloat(formatUnits(quotedOut.toString(), input.buyToken.decimals))} ${input.buyToken.symbol}`,
        priceImpactPct: 0,
        estimatedGas: estimateWooFiGas(input.sellToken, input.buyToken).toString(),
        expectedExecutionStability: "medium",
        protocolFit: "single-venue",
        mevExposure: input.sellToken.isNative || input.buyToken.isNative ? "medium" : "low",
        coverageConfidence: "medium",
        coverageNotes: [
          "Observed directly through the WOOFi BSC router path.",
          ...(curatedVenue?.notes ?? [])
        ],
        quoteRequestNotes: [
          "Direct venue quote uses WooRouterV2 querySwap.",
          "v1 direct venue scope is limited to major BNB and stable routes."
        ],
        routeSummary: "Direct WOOFi path via WooRouterV2.",
        dexes: [{ dexCode: "WOOFi", shareBps: 10000 }],
        score: 0
      }
    ]
  }

  async encodeRouterCalldata(input: {
    network: Network
    platform: string
    sellToken: TokenRef
    buyToken: TokenRef
    amount: string
    amountRaw: string
    slippageBps: number
    account: string
  }) {
    if (input.network !== "bsc" || !supportsWooFiDirectPair(input.sellToken, input.buyToken)) {
      throw new Error("WOOFi direct adapter currently supports only major BSC exact-in routes.")
    }

    const client = getRpcClient(input.network)
    const quotedOut = (await client.readContract({
      address: WOOFI_BSC_ROUTER_V2 as Address,
      abi: WOOFI_ROUTER_V2_ABI,
      functionName: "querySwap",
      args: [toWooFiAddress(input.sellToken), toWooFiAddress(input.buyToken), BigInt(input.amountRaw)]
    })) as bigint
    const minOutAmount = applySlippageToAmount(quotedOut, input.slippageBps)
    const data = encodeFunctionData({
      abi: WOOFI_ROUTER_V2_ABI,
      functionName: "swap",
      args: [
        toWooFiAddress(input.sellToken),
        toWooFiAddress(input.buyToken),
        BigInt(input.amountRaw),
        minOutAmount,
        input.account as Address,
        "0x0000000000000000000000000000000000000000" as Address
      ]
    })

    return {
      platform: input.platform,
      to: WOOFI_BSC_ROUTER_V2,
      data,
      value: input.sellToken.isNative ? input.amount : "0",
      minOutAmount: minOutAmount.toString(),
      estimatedGas: estimateWooFiGas(input.sellToken, input.buyToken).toString()
    }
  }
}

class MultiProviderQuoteAdapter implements QuoteCapabilityAdapter {
  private readonly nativeAdapters: Record<string, QuoteCapabilityAdapter>
  private readonly directDexAdapters: Record<string, QuoteCapabilityAdapter>
  private readonly modeledFallbackAdapter: QuoteCapabilityAdapter
  private readonly directOpenOceanAdapter: QuoteCapabilityAdapter

  constructor(private readonly chain: ChainCapabilityAdapter) {
    this.nativeAdapters = {
      openoceanv2: new OpenOceanQuoteAdapter(chain, {
        platforms: ["openoceanv2"],
        quoteSource: "openocean",
        quoteMethod: "aggregator-http",
        routeSourceType: "native"
      }),
      matcha: new ZeroXQuoteAdapter(chain),
      paraswap: new ParaSwapQuoteAdapter(),
      "1inch": new OneInchQuoteAdapter()
    }
    this.directDexAdapters = {
      pancakeswap: new PancakeQuoteAdapter(),
      thena: new ThenaQuoteAdapter(),
      woofi: new WooFiQuoteAdapter()
    }
    this.modeledFallbackAdapter = new OpenOceanQuoteAdapter(chain, {
      platforms: CURATED_BSC_VENUE_UNIVERSE.aggregators
        .filter((venue) => venue.included && !isNativeAdapterReady(venue.id))
        .map((venue) => venue.id),
      quoteSource: "openocean",
      quoteMethod: "aggregator-http",
      routeSourceType: "modeled"
    })
    this.directOpenOceanAdapter = this.nativeAdapters.openoceanv2
  }

  async getQuoteCandidates(input: {
    network: Network
    sellToken: TokenRef
    buyToken: TokenRef
    amount: string
    amountRaw: string
    slippageBps: number
  }): Promise<RouteCandidate[]> {
    const { candidates } = await this.getQuoteCandidatesWithAudit(input)
    return candidates
  }

  async getQuoteCandidatesWithAudit(input: {
    network: Network
    sellToken: TokenRef
    buyToken: TokenRef
    amount: string
    amountRaw: string
    slippageBps: number
  }): Promise<{
    candidates: RouteCandidate[]
    audit: import("@bsc-swap-agent-demo/shared").QuoteProviderAuditEntry[]
    observedAt: string
  }> {
    const observedAt = new Date().toISOString()
    const nativeResults = await Promise.all(
      CURATED_BSC_VENUE_UNIVERSE.aggregators
        .filter(
          (venue) =>
            venue.included &&
            venue.feasibility.recommendedAction === "implement-now" &&
            isNativeAdapterReady(venue.id)
        )
        .map(async (venue) => {
          const adapter = this.nativeAdapters[venue.id]
          if (!adapter) {
            return {
              candidates: [],
              audit: buildQuoteAuditEntry({
                providerId: venue.id,
                category: "aggregator",
                mode: "native",
                status: "failed",
                reason: "adapter-missing",
                rawReason: "adapter-missing",
                quoteCount: 0
              })
            }
          }
          const preflightReason = getNativeQuoteUnsupportedReason(venue.id, input)
          if (preflightReason) {
            return {
              candidates: [],
              audit: buildQuoteAuditEntry({
                providerId: venue.id,
                category: "aggregator",
                mode: "native",
                status: "unsupported",
                reason: preflightReason,
                rawReason: preflightReason,
                quoteCount: 0
              })
            }
          }
          try {
            const candidates = await adapter.getQuoteCandidates(input)
            return {
              candidates,
              audit: buildQuoteAuditEntry({
                providerId: venue.id,
                category: "aggregator",
                mode: "native",
                status: candidates.length ? "observed" : "empty",
                reason: candidates.length ? undefined : "no-quote-returned",
                rawReason: candidates.length ? undefined : "no-quote-returned",
                quoteCount: candidates.length
              })
            }
          } catch (error) {
            return {
              candidates: [],
              audit: buildQuoteAuditEntry({
                providerId: venue.id,
                category: "aggregator",
                mode: "native",
                status: "failed",
                reason: summarizeQuoteError(error),
                rawReason: rawQuoteError(error),
                quoteCount: 0
              })
            }
          }
        })
    )

    const directDexResults = await Promise.all(
      CURATED_BSC_VENUE_UNIVERSE.dexs
        .filter((venue) => venue.included && isDirectDexAdapterReady(venue.id))
        .map(async (venue) => {
          const adapter = this.directDexAdapters[venue.id]
          if (!adapter) {
            return {
              candidates: [],
              audit: buildQuoteAuditEntry({
                providerId: venue.id,
                category: "dex",
                mode: "direct",
                status: "failed",
                reason: "adapter-missing",
                rawReason: "adapter-missing",
                quoteCount: 0
              })
            }
          }
          const preflightReason = getDirectQuoteUnsupportedReason(venue.id, input)
          if (preflightReason) {
            return {
              candidates: [],
              audit: buildQuoteAuditEntry({
                providerId: venue.id,
                category: "dex",
                mode: "direct",
                status: "unsupported",
                reason: preflightReason,
                rawReason: preflightReason,
                quoteCount: 0
              })
            }
          }
          try {
            const candidates = await adapter.getQuoteCandidates(input)
            return {
              candidates,
              audit: buildQuoteAuditEntry({
                providerId: venue.id,
                category: "dex",
                mode: "direct",
                status: candidates.length ? "observed" : "empty",
                reason: candidates.length ? undefined : "no-route-returned",
                rawReason: candidates.length ? undefined : "no-route-returned",
                quoteCount: candidates.length
              })
            }
          } catch (error) {
            return {
              candidates: [],
              audit: buildQuoteAuditEntry({
                providerId: venue.id,
                category: "dex",
                mode: "direct",
                status: "failed",
                reason: summarizeQuoteError(error),
                rawReason: rawQuoteError(error),
                quoteCount: 0
              })
            }
          }
        })
    )

    const modeledVenueIds = CURATED_BSC_VENUE_UNIVERSE.aggregators
      .filter((venue) => venue.included && !isNativeAdapterReady(venue.id))
      .map((venue) => venue.id)
    let modeledCandidates: RouteCandidate[] = []
    let modeledAudit: import("@bsc-swap-agent-demo/shared").QuoteProviderAuditEntry[] = []
    try {
      modeledCandidates = await this.modeledFallbackAdapter.getQuoteCandidates(input)
      modeledAudit = modeledVenueIds.map((providerId) =>
        buildQuoteAuditEntry({
          providerId,
          category: "modeled",
          mode: "modeled",
          status: modeledCandidates.some((candidate) => candidate.id === providerId) ? "observed" : "empty",
          reason: modeledCandidates.some((candidate) => candidate.id === providerId) ? undefined : "no-modeled-quote",
          rawReason: modeledCandidates.some((candidate) => candidate.id === providerId) ? undefined : "no-modeled-quote",
          quoteCount: modeledCandidates.filter((candidate) => candidate.id === providerId).length
        })
      )
    } catch (error) {
      modeledAudit = modeledVenueIds.map((providerId) =>
        buildQuoteAuditEntry({
          providerId,
          category: "modeled",
          mode: "modeled",
          status: "failed",
          reason: summarizeQuoteError(error),
          rawReason: rawQuoteError(error),
          quoteCount: 0
        })
      )
    }
    const merged = new Map<string, RouteCandidate>()

    for (const candidate of nativeResults.flatMap((item) => item.candidates)) {
      merged.set(candidate.id, candidate)
    }

    for (const candidate of directDexResults.flatMap((item) => item.candidates)) {
      if (!merged.has(candidate.id)) {
        merged.set(candidate.id, candidate)
      }
    }

    for (const candidate of modeledCandidates) {
      if (!merged.has(candidate.id)) {
        merged.set(candidate.id, candidate)
      }
    }

    return {
      candidates: [...merged.values()],
      audit: [...nativeResults.map((item) => item.audit), ...directDexResults.map((item) => item.audit), ...modeledAudit],
      observedAt
    }
  }

  async encodeRouterCalldata(input: {
    network: Network
    platform: string
    sellToken: TokenRef
    buyToken: TokenRef
    amount: string
    amountRaw: string
    slippageBps: number
    account: string
  }) {
    const curatedVenue = getCuratedAggregatorVenue(input.platform)
    const useNative =
      curatedVenue && isNativeAdapterReady(curatedVenue.id) && this.nativeAdapters[input.platform]

    return (useNative ? this.nativeAdapters[input.platform] : this.directOpenOceanAdapter).encodeRouterCalldata(input)
  }

  async simulateTransaction(input: {
    network: Network
    account: string
    to: string
    data: string
    value: string
  }): Promise<{ ok: boolean; estimatedGas: string; note: string }> {
    return this.directOpenOceanAdapter.simulateTransaction(input)
  }
}

class DefiLlamaMarketIntelligenceAdapter implements MarketIntelligenceAdapter {
  async discoverBscDexUniverse(input: {
    network: Network
  }): Promise<Array<{ id: string; displayName: string; volume24h?: number | null; category: "aggregator" | "dex" }>> {
    const overview = await this.getChainDexOverview(input)

    return overview.slice(0, 8).map((protocol) => ({
      id: slugifyVenueId(protocol.displayName),
      displayName: protocol.displayName,
      volume24h: protocol.volume24h ?? null,
      category: inferVenueCategory(protocol.displayName)
    }))
  }

  async getChainDexOverview(input: {
    network: Network
  }): Promise<Array<{ name: string; displayName: string; volume24h?: number | null }>> {
    const chain = input.network === "bsc" ? "BSC" : "BSC"
    const response = (await fetchJson(
      `${getDefiLlamaBaseUrl()}/api/overview/dexs/${chain}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`
    )) as DefiLlamaDexOverviewResponse

    return (response.protocols ?? [])
      .map((protocol) => ({
        name: protocol.name ?? protocol.displayName ?? "unknown",
        displayName: protocol.displayName ?? protocol.name ?? "unknown",
        volume24h: protocol.volume24h ?? null
      }))
      .filter((protocol) => protocol.name !== "unknown")
      .sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0))
  }

  async getDexSummary(input: {
    protocol: string
  }): Promise<{ name: string; displayName: string; volume24h?: number | null; chains?: string[] } | null> {
    try {
      const response = (await fetchJson(
        `${getDefiLlamaBaseUrl()}/api/summary/dexs/${encodeURIComponent(input.protocol)}`
      )) as DefiLlamaDexSummaryResponse

      if (!response.name && !response.displayName) {
        return null
      }

      return {
        name: response.name ?? response.displayName ?? input.protocol,
        displayName: response.displayName ?? response.name ?? input.protocol,
        volume24h: response.volume24h ?? null,
        chains: response.chains ?? []
      }
    } catch {
      return null
    }
  }

  async buildCuratedUniverseSnapshot(input: {
    network: Network
  }): Promise<ProviderUniverseSnapshot> {
    const discovered = await this.discoverBscDexUniverse(input).catch(() => [])
    const curatedCandidates = [
      ...CURATED_BSC_VENUE_UNIVERSE.aggregators,
      ...CURATED_BSC_VENUE_UNIVERSE.dexs,
      ...CURATED_BSC_VENUE_UNIVERSE.deprioritized,
      ...CURATED_BSC_VENUE_UNIVERSE.excluded
    ]

    return {
      discoveredCandidates: discovered.map((candidate) => candidate.displayName),
      curatedCandidates,
      implementedNativeAdapters: curatedCandidates
        .filter((venue) => venue.category === "aggregator" && isNativeAdapterReady(venue.id))
        .map((venue) => venue.displayName),
      implementedDirectDexCandidates: curatedCandidates
        .filter((venue) => venue.category === "dex" && isDirectDexAdapterReady(venue.id))
        .map((venue) => venue.displayName),
      modeledAdapters: curatedCandidates
        .filter((venue) => venue.category === "aggregator" && venue.included && !isNativeAdapterReady(venue.id))
        .map((venue) => venue.displayName),
      implementNowCandidates: curatedCandidates
        .filter((venue) => venue.feasibility.recommendedAction === "implement-now")
        .map((venue) => venue.displayName),
      implementLaterCandidates: curatedCandidates
        .filter((venue) => venue.feasibility.recommendedAction === "implement-later")
        .map((venue) => venue.displayName),
      excludedCandidates: curatedCandidates
        .filter((venue) => venue.feasibility.recommendedAction === "exclude")
        .map((venue) => venue.displayName),
      missingHighImpactCandidates: discovered
        .filter(
          (candidate) =>
            !curatedCandidates.some(
              (venue) => normalizeDexName(venue.displayName) === normalizeDexName(candidate.displayName)
            )
        )
        .map((candidate) => candidate.displayName)
    }
  }

  async getVenueCoverageSnapshot(input: {
    network: Network
    observedDexes: string[]
    pair?: { sellToken: string; buyToken: string }
  }): Promise<VenueCoverageSnapshot> {
    try {
      const topProtocols = await this.getChainDexOverview({ network: input.network })
      const topDexesObservedByDefiLlama = topProtocols
        .slice(0, 8)
        .map((protocol) => protocol.displayName)

      const observedNormalized = new Map(
        input.observedDexes.map((dex) => [normalizeDexName(dex), dex] as const)
      )
      const matched = topDexesObservedByDefiLlama.filter((dex) => observedNormalized.has(normalizeDexName(dex)))
      const missing = topDexesObservedByDefiLlama.filter((dex) => !observedNormalized.has(normalizeDexName(dex)))
      const coverageRatio =
        topDexesObservedByDefiLlama.length > 0 ? matched.length / topDexesObservedByDefiLlama.length : 0

      const notes = [
        "DefiLlama is used as chain-level market intelligence, not as a quote source.",
        input.pair
          ? `Coverage audit was generated for ${input.pair.sellToken}/${input.pair.buyToken} against current BSC DEX activity.`
          : "Coverage audit was generated against current BSC DEX activity."
      ]

      return {
        topDexesObservedByDefiLlama,
        topDexesObservedInQuotes: matched.map((dex) => observedNormalized.get(normalizeDexName(dex)) ?? dex),
        missingHighShareVenues: missing,
        coverageRatio,
        notes
      }
    } catch (error) {
      return {
        topDexesObservedByDefiLlama: [],
        topDexesObservedInQuotes: input.observedDexes.slice(0, 8),
        missingHighShareVenues: [],
        coverageRatio: 0,
        notes: [
          "DefiLlama market intelligence was unavailable, so venue coverage could not be audited.",
          error instanceof Error ? error.message : String(error)
        ]
      }
    }
  }
}

class AdvisorySubmissionAdapter implements SubmissionCapabilityAdapter {
  private registryPromise: Promise<PrivateSubmissionRegistry> | null = null
  private readonly executionMcp = new BscExecutionMcpClient()

  async getSubmissionPaths(input: {
    network: Network
    mevRiskLevel: MevRiskAssessment["level"]
    preferPrivate: boolean | null
  }): Promise<SubmissionCandidate[]> {
    const privatePreferred = input.preferPrivate || input.mevRiskLevel !== "low"
    const registry = await this.getRegistry()
    const validatorEndpoints = selectRegistryEndpoints(registry, "validator-mev-rpc", 3)
    const builderEndpoints = selectRegistryEndpoints(registry, "builder-relay", 3)
    const validatorStatus = summarizeVerificationStatus(validatorEndpoints)
    const builderStatus = summarizeVerificationStatus(builderEndpoints)

    return [
      {
        path: "private-rpc",
        submissionChannel: "private-rpc",
        providerName: "Private validator RPC",
        sourceType: "registry-backed",
        verificationStatus: validatorStatus,
        endpointCount: registry.summary.validatorEndpointCount,
        endpointSample: validatorEndpoints.map((endpoint) => endpoint.displayName),
        availability: validatorEndpoints.length > 0 ? "live" : "stub",
        liveStatus: "advisory",
        recommended: privatePreferred,
        routeFamilies: ["direct-dex", "aggregator"],
        plannerControlLevel: "handoff",
        expectedPrivacy: "high",
        expectedInclusionQuality: "high",
        expectedLatency: "fast",
        attackSurface: "low",
        trustAssumption: "Assumes a selected BSC validator MEV RPC will accept and forward the transaction under its own relay policy.",
        operationalStatus: buildOperationalStatus({
          label: "Validator-backed private routing is available for signed raw-transaction handoff, but planner-side direct signing remains advisory in the current stage.",
          endpoints: validatorEndpoints,
          verificationStatus: validatorStatus
        }),
        score: privatePreferred ? 0.84 : 0.62,
        rationale:
          "Advisory private path backed by known BSC validator endpoints."
      },
      {
        path: "private-rpc",
        submissionChannel: "builder-aware-broadcast",
        providerName: "Builder relay",
        sourceType: "registry-backed",
        verificationStatus: builderStatus,
        endpointCount: registry.summary.builderEndpointCount,
        endpointSample: builderEndpoints.map((endpoint) => endpoint.displayName),
        availability: builderEndpoints.length > 0 ? "live" : "stub",
        liveStatus: "advisory",
        recommended: privatePreferred && input.mevRiskLevel === "high",
        routeFamilies: ["direct-dex", "aggregator"],
        plannerControlLevel: "handoff",
        expectedPrivacy: "high",
        expectedInclusionQuality: "high",
        expectedLatency: "medium",
        attackSurface: "low",
        trustAssumption: "Assumes a selected BSC builder relay will accept and deliver the transaction under its own builder policy.",
        operationalStatus: buildOperationalStatus({
          label: "Builder relay routing is available for signed raw-transaction broadcast, but planner-side direct signing remains advisory in the current stage.",
          endpoints: builderEndpoints,
          verificationStatus: builderStatus
        }),
        score: privatePreferred && input.mevRiskLevel === "high" ? 0.8 : 0.58,
        rationale:
          "Advisory builder-aware path backed by known BSC builder relay endpoints."
      },
      {
        path: "intent-api",
        submissionChannel: "centralized-intent-server",
        providerName: "CoW-style intent server",
        sourceType: "intent-server",
        availability: "stub",
        liveStatus: "info-only",
        recommended: false,
        routeFamilies: ["meta-aggregator", "solver-intent"],
        plannerControlLevel: "informational",
        expectedPrivacy: "high",
        expectedInclusionQuality: "medium",
        expectedLatency: "medium",
        attackSurface: "low",
        trustAssumption: "Assumes a centralized intent server and solver set will settle honestly.",
        operationalStatus: "Intent handoff is modeled as advisory or info-only in the current stage.",
        score: 0.72,
        rationale:
          "Solver-intent handoff can reduce public exposure, but execution is delegated to an external solver."
      },
      {
        path: "public-mempool",
        submissionChannel: "public-mempool",
        providerName: "Public wallet broadcast",
        sourceType: "direct-public-rpc",
        verificationStatus: "verified",
        availability: "live",
        liveStatus: "live",
        recommended: !privatePreferred,
        routeFamilies: ["direct-dex", "aggregator"],
        plannerControlLevel: "direct",
        expectedPrivacy: "low",
        expectedInclusionQuality: "medium",
        expectedLatency: "fast",
        attackSurface: "medium",
        trustAssumption: "Minimizes trusted intermediaries but leaves the path fully public.",
        operationalStatus: "Live and directly executable by a browser wallet.",
        score: !privatePreferred ? 0.74 : 0.48,
        rationale: "Public submission remains the most available path but exposes the swap to extraction risk.",
        riskNote:
          "Use only when private or builder-aware paths are unavailable or unsupported by the chosen route."
      }
    ]
  }

  async getPrivatePathRegistrySummary(_input: {
    network: Network
  }): Promise<PrivatePathRegistrySummary | undefined> {
    const registry = await this.getRegistry()
    return registry.summary
  }

  async getExecutionCapabilitySummary(input: {
    network: Network
  }): Promise<ExecutionCapabilitySummary | undefined> {
    return this.executionMcp.getCapabilitySummary(input.network)
  }

  async simulateCandidateRoutes(input: {
    network: Network
    sellToken: TokenRef
    buyToken: TokenRef
    amount: string
    slippageBps: number
    account: string
    routeIds?: string[]
  }): Promise<{
    routeIds: string[]
    confirmed: boolean
    note: string
    usage: ExecutionCapabilityUsage
  }> {
    return this.executionMcp.simulateCandidateRoutes(input)
  }

  async close(): Promise<void> {
    await this.executionMcp.close()
  }

  private async getRegistry(): Promise<PrivateSubmissionRegistry> {
    this.registryPromise ??= loadPrivateSubmissionRegistry().catch((error) => ({
      endpoints: [],
      summary: {
        validatorEndpointCount: 0,
        builderEndpointCount: 0,
        notes: [
          "Private submission registry could not be loaded.",
          error instanceof Error ? error.message : String(error)
        ]
      }
    }))
    return this.registryPromise
  }
}

function summarizeVerificationStatus(
  endpoints: PrivateSubmissionEndpoint[]
): "unverified" | "reachable" | "protocol-unknown" | "verified" {
  if (endpoints.some((endpoint) => endpoint.verificationStatus === "verified")) {
    return "verified"
  }
  if (endpoints.some((endpoint) => endpoint.verificationStatus === "protocol-unknown")) {
    return "protocol-unknown"
  }
  if (endpoints.some((endpoint) => endpoint.verificationStatus === "reachable")) {
    return "reachable"
  }
  return "unverified"
}

function buildOperationalStatus(input: {
  label: string
  endpoints: PrivateSubmissionEndpoint[]
  verificationStatus: "unverified" | "reachable" | "protocol-unknown" | "verified"
}): string {
  const sample =
    input.endpoints.length > 0
      ? ` Representative endpoints: ${input.endpoints.map((endpoint) => endpoint.displayName).join(", ")}.`
      : ""
  const verification =
    input.verificationStatus === "verified"
      ? " Dry-run probing suggests raw-send semantics are likely available on at least one endpoint."
      : input.verificationStatus === "protocol-unknown"
        ? " Dry-run probing reached at least one endpoint, but the exact submission contract remains limited or non-standard."
        : input.verificationStatus === "reachable"
          ? " Endpoint reachability has been observed, but JSON-RPC submission semantics are still unclear."
          : " Endpoint verification has not completed yet."
  return `${input.label}${sample}${verification}`
}

export class BnbCapabilityRegistry implements CapabilityRegistry {
  readonly chain: ChainCapabilityAdapter
  readonly quote: QuoteCapabilityAdapter
  readonly submission: SubmissionCapabilityAdapter
  readonly market: MarketIntelligenceAdapter

  constructor() {
    const chain = new BnbMcpChainAdapter()
    this.chain = chain
    this.quote = new MultiProviderQuoteAdapter(chain)
    this.submission = new AdvisorySubmissionAdapter()
    this.market = new DefiLlamaMarketIntelligenceAdapter()
  }

  async close(): Promise<void> {
    if ("close" in this.chain && typeof this.chain.close === "function") {
      await (this.chain as BnbMcpChainAdapter).close()
    }
    if ("close" in this.submission && typeof this.submission.close === "function") {
      await (this.submission as AdvisorySubmissionAdapter).close()
    }
  }
}

function getRpcClient(network: Network) {
  const rpcUrl =
    network === "bsc" ? process.env.BSC_RPC_URL : process.env.BSC_TESTNET_RPC_URL
  if (!rpcUrl) {
    throw new Error(
      network === "bsc"
        ? "Missing BSC_RPC_URL for direct RPC simulation."
        : "Missing BSC_TESTNET_RPC_URL for direct RPC simulation."
    )
  }

  return createPublicClient({
    chain: network === "bsc" ? bsc : bscTestnet,
    transport: http(rpcUrl)
  })
}

function getDefiLlamaBaseUrl(): string {
  const apiKey = process.env.DEFILLAMA_API_KEY
  if (apiKey) {
    return `https://pro-api.llama.fi/${apiKey}`
  }
  return "https://api.llama.fi"
}

function getCuratedAggregatorVenue(platform: string): CuratedVenue | undefined {
  return CURATED_BSC_VENUE_UNIVERSE.aggregators.find((venue) => venue.id === platform)
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.headers ?? {})
    }
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`)
  }
  return response.json()
}

function normalizeDexName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/^pancakeswap/, "pancake")
    .replace(/^pancake/, "pancake")
    .replace(/^thenafusion/, "thena")
    .replace(/^woofiv\d+/i, "woofi")
    .replace(/^woofi/, "woofi")
    .replace(/^uniswapv\d+/i, "uniswap")
    .replace(/^uniswap/, "uniswap")
    .replace(/^solidlyv3/, "solidly")
}

function normalizeZeroXFills(fills: ZeroXRouteFill[]): Array<{ dexCode: string; shareBps: number }> {
  return fills
    .map((fill) => ({
      dexCode: fill.source ?? "unknown",
      shareBps: Number(fill.proportionBps ?? "0")
    }))
    .filter((fill) => fill.dexCode !== "unknown" && Number.isFinite(fill.shareBps) && fill.shareBps > 0)
    .sort((a, b) => b.shareBps - a.shareBps)
    .slice(0, 5)
}

function normalizeParaSwapBestRoute(
  routes: ParaSwapBestRouteSwap[]
): Array<{ dexCode: string; shareBps: number }> {
  const aggregated = new Map<string, number>()
  for (const route of routes) {
    for (const swap of route.swapExchanges ?? []) {
      const key = swap.exchange ?? "unknown"
      aggregated.set(key, (aggregated.get(key) ?? 0) + (swap.percent ?? 0))
    }
  }
  return [...aggregated.entries()]
    .map(([dexCode, shareBps]) => ({ dexCode, shareBps: Math.round(shareBps * 100) }))
    .filter((fill) => fill.dexCode !== "unknown" && fill.shareBps > 0)
    .sort((a, b) => b.shareBps - a.shareBps)
    .slice(0, 5)
}

function normalizeParaSwapToken(token: TokenRef): string {
  return token.isNative ? BNB_NATIVE_SENTINEL : token.address
}

function normalizeOneInchToken(token: TokenRef): string {
  return token.isNative ? BNB_NATIVE_SENTINEL : token.address
}

function normalizeOneInchProtocols(
  protocols: Array<Array<OneInchProtocolEntry>>,
  routeParts: OneInchRoutePart[]
): Array<{ dexCode: string; shareBps: number }> {
  const aggregated = new Map<string, number>()

  for (const level of protocols) {
    for (const entry of level) {
      const key = entry.name ?? "unknown"
      aggregated.set(key, (aggregated.get(key) ?? 0) + (entry.part ?? 0))
    }
  }

  for (const part of routeParts) {
    const key = part.name ?? "unknown"
    aggregated.set(key, (aggregated.get(key) ?? 0) + (part.part ?? 0))
  }

  return [...aggregated.entries()]
    .map(([dexCode, share]) => ({ dexCode, shareBps: Math.round(share * 100) }))
    .filter((fill) => fill.dexCode !== "unknown" && fill.shareBps > 0)
    .sort((a, b) => b.shareBps - a.shareBps)
    .slice(0, 5)
}

function slugifyVenueId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function inferVenueCategory(value: string): "aggregator" | "dex" {
  const normalized = value.toLowerCase()
  if (
    normalized.includes("1inch") ||
    normalized.includes("matcha") ||
    normalized.includes("paraswap") ||
    normalized.includes("openocean") ||
    normalized.includes("0x")
  ) {
    return "aggregator"
  }
  return "dex"
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

const PANCAKE_V2_ROUTER_ABI = [
  {
    type: "function",
    name: "getAmountsOut",
    stateMutability: "view",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "path", type: "address[]" }
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }]
  },
  {
    type: "function",
    name: "swapExactETHForTokens",
    stateMutability: "payable",
    inputs: [
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" }
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }]
  },
  {
    type: "function",
    name: "swapExactTokensForETH",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" }
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }]
  },
  {
    type: "function",
    name: "swapExactTokensForTokens",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" }
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }]
  }
] as const

const WOOFI_ROUTER_V2_ABI = [
  {
    type: "function",
    name: "querySwap",
    stateMutability: "view",
    inputs: [
      { name: "fromToken", type: "address" },
      { name: "toToken", type: "address" },
      { name: "fromAmount", type: "uint256" }
    ],
    outputs: [{ name: "toAmount", type: "uint256" }]
  },
  {
    type: "function",
    name: "swap",
    stateMutability: "payable",
    inputs: [
      { name: "fromToken", type: "address" },
      { name: "toToken", type: "address" },
      { name: "fromAmount", type: "uint256" },
      { name: "minToAmount", type: "uint256" },
      { name: "to", type: "address" },
      { name: "rebateTo", type: "address" }
    ],
    outputs: [{ name: "realToAmount", type: "uint256" }]
  }
] as const

const THENA_ROUTER_V2_ABI = [
  {
    type: "function",
    name: "getAmountOut",
    stateMutability: "view",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" }
    ],
    outputs: [
      { name: "amount", type: "uint256" },
      { name: "stable", type: "bool" }
    ]
  },
  {
    type: "function",
    name: "getAmountsOut",
    stateMutability: "view",
    inputs: [
      { name: "amountIn", type: "uint256" },
      {
        name: "routes",
        type: "tuple[]",
        components: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "stable", type: "bool" }
        ]
      }
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }]
  },
  {
    type: "function",
    name: "swapExactTokensForTokens",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      {
        name: "routes",
        type: "tuple[]",
        components: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "stable", type: "bool" }
        ]
      },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" }
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }]
  },
  {
    type: "function",
    name: "swapExactETHForTokens",
    stateMutability: "payable",
    inputs: [
      { name: "amountOutMin", type: "uint256" },
      {
        name: "routes",
        type: "tuple[]",
        components: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "stable", type: "bool" }
        ]
      },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" }
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }]
  },
  {
    type: "function",
    name: "swapExactTokensForETH",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      {
        name: "routes",
        type: "tuple[]",
        components: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "stable", type: "bool" }
        ]
      },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" }
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }]
  }
] as const

const PANCAKE_DIRECT_MAJOR_SYMBOLS = new Set(["BNB", "WBNB", "USDT", "USDC", "BUSD", "ETH", "BTCB", "CAKE"])
const WOOFI_DIRECT_MAJOR_SYMBOLS = new Set(["BNB", "WBNB", "USDT", "USDC", "BUSD", "ETH", "BTCB"])
const THENA_DIRECT_MAJOR_SYMBOLS = new Set(["BNB", "WBNB", "USDT", "USDC", "BUSD", "ETH", "BTCB", "THE"])

function supportsPancakeDirectPair(sellToken: TokenRef, buyToken: TokenRef): boolean {
  return (
    PANCAKE_DIRECT_MAJOR_SYMBOLS.has(sellToken.symbol.toUpperCase()) &&
    PANCAKE_DIRECT_MAJOR_SYMBOLS.has(buyToken.symbol.toUpperCase())
  )
}

function toPancakeAddress(token: TokenRef): Address {
  return (token.isNative ? BSC_WBNB : token.address) as Address
}

function buildPancakePath(sellToken: TokenRef, buyToken: TokenRef): Address[] {
  const sell = toPancakeAddress(sellToken)
  const buy = toPancakeAddress(buyToken)
  if (sell.toLowerCase() === BSC_WBNB.toLowerCase() || buy.toLowerCase() === BSC_WBNB.toLowerCase()) {
    return [sell, buy]
  }
  return [sell, BSC_WBNB as Address, buy]
}

function applySlippageToAmount(amount: bigint, slippageBps: number): bigint {
  return (amount * BigInt(Math.max(0, 10000 - slippageBps))) / 10000n
}

function buildQuoteAuditEntry(input: {
  providerId: string
  category: import("@bsc-swap-agent-demo/shared").QuoteProviderAuditEntry["category"]
  mode: import("@bsc-swap-agent-demo/shared").QuoteProviderAuditEntry["mode"]
  status: import("@bsc-swap-agent-demo/shared").QuoteProviderAuditEntry["status"]
  reason?: string
  rawReason?: string
  quoteCount: number
}) {
  return input
}

function summarizeQuoteError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "quote-failed"
  }
  const message = error.message.trim()
  if (!message) {
    return "quote-failed"
  }
  const normalized = message.toLowerCase()
  if (normalized.includes("http 4") || normalized.includes("http 5")) {
    return "quote-api-error"
  }
  if (normalized.includes("bigint") || normalized.includes("readcontract") || normalized.includes("estimate")) {
    return "onchain-read-failed"
  }
  if (normalized.includes("no route")) {
    return "no-route"
  }
  if (normalized.includes("quote")) {
    return "quote-api-error"
  }
  return "quote-failed"
}

function rawQuoteError(error: unknown): string | undefined {
  if (!(error instanceof Error)) {
    return typeof error === "string" ? error : undefined
  }
  return error.message.trim() || undefined
}

function getNativeQuoteUnsupportedReason(
  providerId: string,
  input: {
    network: Network
    sellToken: TokenRef
    buyToken: TokenRef
  }
): string | null {
  if (providerId === "matcha") {
    if (!isZeroXEnabled()) return "api-key-missing"
    if (input.network !== "bsc") return "network-unsupported"
    if (input.sellToken.isNative || input.buyToken.isNative) return "erc20-only"
  }
  if (providerId === "paraswap" && input.network !== "bsc") {
    return "network-unsupported"
  }
  if (providerId === "1inch") {
    if (!isOneInchEnabled()) return "api-key-missing"
    if (input.network !== "bsc") return "network-unsupported"
  }
  return null
}

function getDirectQuoteUnsupportedReason(
  providerId: string,
  input: {
    network: Network
    sellToken: TokenRef
    buyToken: TokenRef
  }
): string | null {
  if (input.network !== "bsc") {
    return "network-unsupported"
  }
  if (providerId === "pancakeswap" && !supportsPancakeDirectPair(input.sellToken, input.buyToken)) {
    return "unsupported-pair"
  }
  if (providerId === "thena" && !supportsThenaDirectPair(input.sellToken, input.buyToken)) {
    return "unsupported-pair"
  }
  if (providerId === "woofi" && !supportsWooFiDirectPair(input.sellToken, input.buyToken)) {
    return "unsupported-pair"
  }
  return null
}

function estimatePancakeGas(path: Address[]): bigint {
  return path.length > 2 ? 260000n : 220000n
}

function supportsWooFiDirectPair(sellToken: TokenRef, buyToken: TokenRef): boolean {
  return (
    WOOFI_DIRECT_MAJOR_SYMBOLS.has(sellToken.symbol.toUpperCase()) &&
    WOOFI_DIRECT_MAJOR_SYMBOLS.has(buyToken.symbol.toUpperCase())
  )
}

function toWooFiAddress(token: TokenRef): Address {
  return (token.isNative ? BNB_NATIVE_SENTINEL : token.address) as Address
}

function estimateWooFiGas(sellToken: TokenRef, buyToken: TokenRef): bigint {
  return sellToken.isNative || buyToken.isNative ? 240000n : 210000n
}

function supportsThenaDirectPair(sellToken: TokenRef, buyToken: TokenRef): boolean {
  return (
    THENA_DIRECT_MAJOR_SYMBOLS.has(sellToken.symbol.toUpperCase()) &&
    THENA_DIRECT_MAJOR_SYMBOLS.has(buyToken.symbol.toUpperCase())
  )
}

type ThenaRoute = { from: Address; to: Address; stable: boolean }

async function buildThenaRoutes(
  client: ReturnType<typeof getRpcClient>,
  sellToken: TokenRef,
  buyToken: TokenRef,
  amountIn: bigint
): Promise<ThenaRoute[]> {
  const sell = toPancakeAddress(sellToken)
  const buy = toPancakeAddress(buyToken)

  if (sell.toLowerCase() === BSC_WBNB.toLowerCase() || buy.toLowerCase() === BSC_WBNB.toLowerCase()) {
    const single = await readThenaSingleHop(client, sell, buy, amountIn)
    return single ? [single] : []
  }

  const first = await readThenaSingleHop(client, sell, BSC_WBNB as Address, amountIn)
  if (!first) {
    return []
  }
  const second = await readThenaSingleHop(client, BSC_WBNB as Address, buy, BigInt(first.quote))
  if (!second) {
    return []
  }
  return [
    { from: first.from, to: first.to, stable: first.stable },
    { from: second.from, to: second.to, stable: second.stable }
  ]
}

async function readThenaSingleHop(
  client: ReturnType<typeof getRpcClient>,
  from: Address,
  to: Address,
  amountIn: bigint
): Promise<{ from: Address; to: Address; stable: boolean; quote: string } | null> {
  try {
    const [quote, stable] = (await client.readContract({
      address: THENA_BSC_ROUTER_V2 as Address,
      abi: THENA_ROUTER_V2_ABI,
      functionName: "getAmountOut",
      args: [amountIn, from, to]
    })) as [bigint, boolean]
    if (!quote || quote <= 0n) {
      return null
    }
    return { from, to, stable, quote: quote.toString() }
  } catch {
    return null
  }
}

function estimateThenaGas(routes: ThenaRoute[]): bigint {
  return routes.length > 1 ? 280000n : 230000n
}

function trimFloat(value: string): string {
  const num = Number(value)
  if (!Number.isFinite(num)) {
    return value
  }
  return num.toFixed(num >= 100 ? 4 : 6).replace(/\.?0+$/, "")
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

function getChainId(network: Network): number {
  return network === "bsc" ? 56 : 97
}

function getZeroXHeaders(): Record<string, string> {
  const apiKey = process.env.ZEROX_API_KEY
  if (!apiKey) {
    throw new Error("ZEROX_API_KEY is required for the 0x native quote adapter.")
  }
  return {
    "0x-api-key": apiKey,
    "0x-version": "v2"
  }
}

function isZeroXEnabled(): boolean {
  return Boolean(process.env.ZEROX_API_KEY)
}

function getOneInchHeaders(): Record<string, string> {
  const apiKey = process.env.ONEINCH_API_KEY
  if (!apiKey) {
    throw new Error("ONEINCH_API_KEY is required for the 1inch native quote adapter.")
  }
  return {
    Authorization: `Bearer ${apiKey}`
  }
}

function getOneInchBaseUrl(network: Network): string {
  return `https://api.1inch.dev/swap/v6.1/${getChainId(network)}`
}

function isOneInchEnabled(): boolean {
  return Boolean(process.env.ONEINCH_API_KEY)
}

function isNativeAdapterReady(providerId: string): boolean {
  if (providerId === "openoceanv2") {
    return true
  }
  if (providerId === "matcha") {
    return isZeroXEnabled()
  }
  if (providerId === "paraswap") {
    return true
  }
  if (providerId === "1inch") {
    return isOneInchEnabled()
  }
  return false
}

function isDirectDexAdapterReady(providerId: string): boolean {
  return providerId === "pancakeswap" || providerId === "woofi" || providerId === "thena"
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

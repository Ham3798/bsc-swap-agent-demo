import {
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient
} from "viem"

import type { Network } from "@bsc-swap-agent-demo/shared"

const JIT_ROUTER_V21_ABI = parseAbi([
  "function execute((address user,address recipient,address tokenIn,address tokenOut,uint256 amountIn,uint256 minOut,uint256 maxBlockNumber,uint256 nonce,bytes32 candidateSetHash) order,(uint8 adapterId,address router,bytes data,uint256 value)[] candidates,bytes signature) payable returns (uint256 selectedIndex,uint256 receivedAmount)",
  "function nonces(address user) view returns (uint256)"
])

const JIT_CANDIDATE_TYPEHASH = keccak256(
  new TextEncoder().encode("CandidateCall(uint8 adapterId,address router,bytes data,uint256 value)")
)
const DEPRECATED_JIT_ROUTER_ADDRESSES = new Set([
  "0x84361f416ae89435fe857ce6220545317244ceca",
  "0x373f33cb87196f58be01d10e2a998019ac00c23b"
])

export const JIT_ADAPTER_IDS = {
  openoceanv2: 0,
  "1inch": 1,
  pancakeswap: 2
} as const

export type JitAdapterPlatform = keyof typeof JIT_ADAPTER_IDS

export interface JitCandidateCall {
  adapterId: number
  router: `0x${string}`
  value: string
  data: `0x${string}`
}

export interface JitSignedOrder {
  user: `0x${string}`
  recipient: `0x${string}`
  tokenIn: `0x${string}`
  tokenOut: `0x${string}`
  amountIn: string
  minOut: string
  maxBlockNumber: bigint | number | string
  nonce: bigint | number | string
  candidateSetHash: `0x${string}`
}

export function getJitRouterAddress(network: Network): `0x${string}` | undefined {
  const envAddress =
    network === "bsc"
      ? process.env.JIT_ROUTER_BSC_ADDRESS
      : process.env.JIT_ROUTER_BSC_TESTNET_ADDRESS

  if (!envAddress) {
    return undefined
  }
  return DEPRECATED_JIT_ROUTER_ADDRESSES.has(envAddress.toLowerCase()) ? undefined : (envAddress as `0x${string}`)
}

export async function getJitRouterNonce(input: {
  client: PublicClient
  routerAddress: `0x${string}`
  user: `0x${string}`
}): Promise<bigint> {
  return input.client.readContract({
    address: input.routerAddress as Address,
    abi: JIT_ROUTER_V21_ABI,
    functionName: "nonces",
    args: [input.user as Address]
  })
}

export function computeJitCandidateSetHash(candidates: JitCandidateCall[]): `0x${string}` {
  const hashes = candidates.map((candidate) =>
    keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "uint8" },
          { type: "address" },
          { type: "bytes32" },
          { type: "uint256" }
        ],
        [
          JIT_CANDIDATE_TYPEHASH,
          candidate.adapterId,
          candidate.router,
          keccak256(candidate.data),
          BigInt(candidate.value)
        ]
      )
    )
  )
  return keccak256(concatHex(hashes))
}

export function buildJitOrderTypedData(input: {
  network: Network
  routerAddress: `0x${string}`
  order: JitSignedOrder
}) {
  return {
    domain: {
      name: "JitSwapRouterV21",
      version: "1",
      chainId: input.network === "bsc" ? 56 : 97,
      verifyingContract: input.routerAddress
    },
    types: {
      Order: [
        { name: "user", type: "address" },
        { name: "recipient", type: "address" },
        { name: "tokenIn", type: "address" },
        { name: "tokenOut", type: "address" },
        { name: "amountIn", type: "uint256" },
        { name: "minOut", type: "uint256" },
        { name: "maxBlockNumber", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "candidateSetHash", type: "bytes32" }
      ]
    } as const,
    primaryType: "Order" as const,
    message: {
      user: input.order.user,
      recipient: input.order.recipient,
      tokenIn: input.order.tokenIn,
      tokenOut: input.order.tokenOut,
      amountIn: BigInt(input.order.amountIn),
      minOut: BigInt(input.order.minOut),
      maxBlockNumber: BigInt(input.order.maxBlockNumber),
      nonce: BigInt(input.order.nonce),
      candidateSetHash: input.order.candidateSetHash
    }
  }
}

export function encodeJitRouterExecute(input: {
  network: Network
  order: JitSignedOrder
  candidates: JitCandidateCall[]
  signature: `0x${string}`
  routerAddress?: `0x${string}`
}): {
  routerAddress: `0x${string}`
  to: `0x${string}`
  data: `0x${string}`
  value: string
  payloadType: "jit-router-calldata"
} {
  const routerAddress = input.routerAddress ?? getJitRouterAddress(input.network)
  if (!routerAddress) {
    throw new Error(`Missing JIT router address for network: ${input.network}`)
  }

  const value = input.order.tokenIn === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" ? input.order.amountIn : "0"
  const data = encodeFunctionData({
    abi: JIT_ROUTER_V21_ABI,
    functionName: "execute",
    args: [
      {
        user: input.order.user,
        recipient: input.order.recipient,
        tokenIn: input.order.tokenIn,
        tokenOut: input.order.tokenOut,
        amountIn: BigInt(input.order.amountIn),
        minOut: BigInt(input.order.minOut),
        maxBlockNumber: BigInt(input.order.maxBlockNumber),
        nonce: BigInt(input.order.nonce),
        candidateSetHash: input.order.candidateSetHash
      },
      input.candidates.map((candidate) => ({
        adapterId: candidate.adapterId,
        router: candidate.router,
        data: candidate.data,
        value: BigInt(candidate.value)
      })),
      input.signature
    ]
  })

  return {
    routerAddress,
    to: routerAddress,
    data,
    value,
    payloadType: "jit-router-calldata"
  }
}

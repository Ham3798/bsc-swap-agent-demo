import { describe, expect, it } from "bun:test"

import { computeJitCandidateSetHash, encodeJitRouterExecute, getJitRouterAddress } from "./jit-router"

describe("jit router encoding", () => {
  it("reads the router address from env configuration only", () => {
    const previous = process.env.JIT_ROUTER_BSC_ADDRESS
    delete process.env.JIT_ROUTER_BSC_ADDRESS
    expect(getJitRouterAddress("bsc")).toBeUndefined()
    restoreEnv("JIT_ROUTER_BSC_ADDRESS", previous)
  })

  it("reads the configured secure JIT router address from env", () => {
    const previous = process.env.JIT_ROUTER_BSC_ADDRESS
    process.env.JIT_ROUTER_BSC_ADDRESS = "0x5555555555555555555555555555555555555555"
    expect(getJitRouterAddress("bsc")).toBe("0x5555555555555555555555555555555555555555")
    restoreEnv("JIT_ROUTER_BSC_ADDRESS", previous)
  })

  it("hashes the candidate set deterministically", () => {
    const hash = computeJitCandidateSetHash([
      {
        adapterId: 0,
        router: "0x1111111111111111111111111111111111111111",
        value: "0",
        data: "0x1234"
      },
      {
        adapterId: 1,
        router: "0x2222222222222222222222222222222222222222",
        value: "0",
        data: "0xabcd"
      },
      {
        adapterId: 2,
        router: "0x3333333333333333333333333333333333333333",
        value: "0",
        data: "0xbeef"
      }
    ])

    expect(hash).toMatch(/^0x[a-f0-9]{64}$/)
  })

  it("encodes secure JIT calldata for signed-order execution", () => {
    const payload = encodeJitRouterExecute({
      network: "bsc",
      routerAddress: "0x9999999999999999999999999999999999999999",
      order: {
        user: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        recipient: "0x4444444444444444444444444444444444444444",
        tokenIn: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        tokenOut: "0x3333333333333333333333333333333333333333",
        amountIn: "500",
        minOut: "450",
        maxBlockNumber: 1234567890,
        nonce: 7,
        candidateSetHash: "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      candidates: [
        {
          adapterId: 0,
          router: "0x1111111111111111111111111111111111111111",
          value: "0",
          data: "0x1234"
        },
        {
          adapterId: 1,
          router: "0x2222222222222222222222222222222222222222",
          value: "0",
          data: "0xabcd"
        },
        {
          adapterId: 2,
          router: "0x3333333333333333333333333333333333333333",
          value: "0",
          data: "0xbeef"
        }
      ],
      signature: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1b"
    })

    expect(payload.payloadType).toBe("jit-router-calldata")
    expect(payload.to).toBe("0x9999999999999999999999999999999999999999")
    expect(payload.value).toBe("0")
    expect(payload.data.startsWith("0x")).toBe(true)
    expect(payload.data.length).toBeGreaterThan(10)
  })
})

function restoreEnv(name: string, value: string | undefined) {
  if (value == null) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}

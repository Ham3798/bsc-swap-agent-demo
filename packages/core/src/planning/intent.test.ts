import { describe, expect, it } from "bun:test"

import { extractIntentDeterministically } from "./intent"

describe("intent fallback extraction", () => {
  it("extracts english all-in swaps", () => {
    const intent = extractIntentDeterministically("Change all my USDC tokens to BNB")
    expect(intent).not.toBeNull()
    expect(intent).toMatchObject({
      action: "swap",
      sellToken: "USDC",
      buyToken: "BNB",
      amount: "all"
    })
  })

  it("extracts korean all-in swaps", () => {
    const intent = extractIntentDeterministically("내 모든 USDC BNB로 바꿔줘")
    expect(intent).not.toBeNull()
    expect(intent).toMatchObject({
      action: "swap",
      sellToken: "USDC",
      buyToken: "BNB",
      amount: "all"
    })
  })

  it("extracts english amount swaps", () => {
    const intent = extractIntentDeterministically("swap 0.001 BNB to USDC")
    expect(intent).not.toBeNull()
    expect(intent).toMatchObject({
      action: "swap",
      sellToken: "BNB",
      buyToken: "USDC",
      amount: "0.001"
    })
  })
})

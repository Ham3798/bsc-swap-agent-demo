import { describe, expect, it } from "bun:test"

import { loadPrivateSubmissionRegistry, selectRegistryEndpoints } from "./private-registry"

describe("private submission registry", () => {
  it("loads BSC validator and builder endpoints from bsc-mev-info", async () => {
    const registry = await loadPrivateSubmissionRegistry()

    expect(registry.summary.validatorEndpointCount).toBeGreaterThan(0)
    expect(registry.summary.builderEndpointCount).toBeGreaterThan(0)
    expect(registry.endpoints.some((endpoint) => endpoint.rpcUrl.includes("bnbmev.ankr.com"))).toBe(true)
    expect(registry.endpoints.some((endpoint) => endpoint.rpcUrl.includes("builder-relay.48.club"))).toBe(true)
  })

  it("returns deterministic endpoint samples by type", async () => {
    const registry = await loadPrivateSubmissionRegistry()

    const validators = selectRegistryEndpoints(registry, "validator-mev-rpc", 3)
    const builders = selectRegistryEndpoints(registry, "builder-relay", 3)

    expect(validators.length).toBeGreaterThan(0)
    expect(builders.length).toBeGreaterThan(0)
    expect(validators.every((endpoint) => endpoint.type === "validator-mev-rpc")).toBe(true)
    expect(builders.every((endpoint) => endpoint.type === "builder-relay")).toBe(true)
  })
})

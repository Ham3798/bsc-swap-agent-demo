import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import type {
  EndpointProbeResult,
  PrivatePathRegistrySummary,
  PrivateSubmissionEndpoint,
  SubmissionVerificationStatus
} from "@bsc-swap-agent-demo/shared"

type ParsedSection = {
  name: string
  fields: Record<string, string>
}

export interface PrivateSubmissionRegistry {
  endpoints: PrivateSubmissionEndpoint[]
  summary: PrivatePathRegistrySummary
}

const DEFAULT_BSC_MEV_INFO_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../bsc-mev-info"
)

const PROBE_METHODS = ["eth_chainId", "web3_clientVersion", "rpc_modules"] as const
let cachedRegistryPromise: Promise<PrivateSubmissionRegistry> | null = null

export async function loadPrivateSubmissionRegistry(): Promise<PrivateSubmissionRegistry> {
  cachedRegistryPromise ??= buildPrivateSubmissionRegistry()
  return cachedRegistryPromise
}

async function buildPrivateSubmissionRegistry(): Promise<PrivateSubmissionRegistry> {
  const baseDir = process.env.BSC_MEV_INFO_DIR || DEFAULT_BSC_MEV_INFO_DIR
  const [validatorSections, builderSections] = await Promise.all([
    readRegistryToml(path.join(baseDir, "mainnet", "validator-list.toml")),
    readRegistryToml(path.join(baseDir, "mainnet", "builder-list.toml"))
  ])

  const endpoints = [
    ...validatorSections
      .map((section) =>
        toEndpoint(section, "validator-mev-rpc", "mainnet/validator-list.toml")
      )
      .filter((endpoint): endpoint is PrivateSubmissionEndpoint => Boolean(endpoint)),
    ...builderSections
      .map((section) => toEndpoint(section, "builder-relay", "mainnet/builder-list.toml"))
      .filter((endpoint): endpoint is PrivateSubmissionEndpoint => Boolean(endpoint))
  ]

  const probeTarget = pickPrototypeEndpoint(endpoints)
  if (probeTarget) {
    const probe = await probePrivateEndpoint(probeTarget)
    const target = endpoints.find((endpoint) => endpoint.id === probeTarget.id)
    if (target) {
      target.probe = probe
      target.verificationStatus = deriveVerificationStatus(probe)
      target.notes = unique([
        ...target.notes,
        ...probe.remarks
      ])
    }
  }

  return {
    endpoints,
    summary: {
      validatorEndpointCount: endpoints.filter((endpoint) => endpoint.type === "validator-mev-rpc").length,
      builderEndpointCount: endpoints.filter((endpoint) => endpoint.type === "builder-relay").length,
      probedEndpointId: probeTarget?.id,
      probedVerificationStatus: probeTarget?.verificationStatus,
      notes: [
        "Registry is sourced from bsc-mev-info mainnet validator and builder lists.",
        probeTarget
          ? `Dry-run protocol probe was executed against ${probeTarget.displayName}.`
          : "No private endpoint was available for dry-run protocol probing."
      ]
    }
  }
}

export function selectRegistryEndpoints(
  registry: PrivateSubmissionRegistry,
  type: PrivateSubmissionEndpoint["type"],
  limit = 3
): PrivateSubmissionEndpoint[] {
  return registry.endpoints
    .filter((endpoint) => endpoint.type === type)
    .sort(compareEndpoints)
    .slice(0, limit)
}

export async function probeRegistryEndpointById(input: {
  endpointId: string
  registry?: PrivateSubmissionRegistry
}): Promise<PrivateSubmissionEndpoint> {
  const registry = input.registry ?? (await loadPrivateSubmissionRegistry())
  const endpoint = registry.endpoints.find((candidate) => candidate.id === input.endpointId)
  if (!endpoint) {
    throw new Error(`Unknown private endpoint: ${input.endpointId}`)
  }

  const probe = await probePrivateEndpoint(endpoint)
  return {
    ...endpoint,
    probe,
    verificationStatus: deriveVerificationStatus(probe),
    notes: unique([...endpoint.notes, ...probe.remarks])
  }
}

async function readRegistryToml(filePath: string): Promise<ParsedSection[]> {
  const content = await readFile(filePath, "utf8")
  return parseTomlSections(content)
}

function parseTomlSections(content: string): ParsedSection[] {
  const sections: ParsedSection[] = []
  let current: ParsedSection | null = null
  let skippingArray = false

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue

    if (skippingArray) {
      if (line.includes("]")) {
        skippingArray = false
      }
      continue
    }

    const sectionMatch = line.match(/^\[(.+)\]$/)
    if (sectionMatch) {
      current = { name: sectionMatch[1], fields: {} }
      sections.push(current)
      continue
    }

    if (!current) continue

    const keyValueMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/)
    if (!keyValueMatch) continue

    const [, key, rawValue] = keyValueMatch
    if (rawValue.startsWith("[")) {
      if (!rawValue.includes("]")) {
        skippingArray = true
      }
      continue
    }

    current.fields[key] = stripTomlString(rawValue)
  }

  return sections
}

function stripTomlString(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function toEndpoint(
  section: ParsedSection,
  type: PrivateSubmissionEndpoint["type"],
  sourceFile: string
): PrivateSubmissionEndpoint | null {
  const rpcUrl = section.fields.RPC || section.fields.URL
  if (!rpcUrl) {
    return null
  }

  const description = section.fields.Description?.trim()

  return {
    id: `${type}:${section.name}`,
    displayName: prettifyName(section.name),
    type,
    rpcUrl,
    website: section.fields.Website,
    contact: section.fields.Contact,
    sourceFile,
    verificationStatus: "unverified",
    notes: unique([
      sourceFile,
      description || ""
    ].filter(Boolean))
  }
}

function prettifyName(name: string): string {
  return name
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function pickPrototypeEndpoint(endpoints: PrivateSubmissionEndpoint[]): PrivateSubmissionEndpoint | undefined {
  return (
    endpoints.find((endpoint) => endpoint.rpcUrl.includes("bnbmev.ankr.com")) ||
    endpoints.find((endpoint) => endpoint.rpcUrl.includes("builder-relay.48.club")) ||
    endpoints.find((endpoint) => endpoint.rpcUrl.includes("bsc-relay.blxrbdn.com")) ||
    endpoints[0]
  )
}

async function probePrivateEndpoint(endpoint: PrivateSubmissionEndpoint): Promise<EndpointProbeResult> {
  const standardMethodsAvailable: string[] = []
  const remarks: string[] = []
  let reachable = false
  let acceptsJsonRpc = false
  let authRequiredLikely = false

  for (const method of PROBE_METHODS) {
    const probe = await postRpc(endpoint.rpcUrl, method, [])
    if (probe.reachable) reachable = true
    if (probe.acceptsJsonRpc) acceptsJsonRpc = true
    if (probe.authRequiredLikely) authRequiredLikely = true
    if (probe.ok) {
      standardMethodsAvailable.push(method)
    } else if (probe.remark) {
      remarks.push(`${method}: ${probe.remark}`)
    }
  }

  const sendProbe = await postRpc(endpoint.rpcUrl, "eth_sendRawTransaction", ["0x00"])
  if (sendProbe.reachable) reachable = true
  if (sendProbe.acceptsJsonRpc) acceptsJsonRpc = true
  if (sendProbe.authRequiredLikely) authRequiredLikely = true
  if (sendProbe.remark) {
    remarks.push(`eth_sendRawTransaction: ${sendProbe.remark}`)
  }

  const sendMethodObserved =
    sendProbe.acceptsJsonRpc &&
    sendProbe.errorCode !== -32601 &&
    !authRequiredLikely

  return {
    endpointId: endpoint.id,
    reachable,
    acceptsJsonRpc,
    standardMethodsAvailable: unique(standardMethodsAvailable),
    sendMethodObserved,
    authRequiredLikely,
    rawSendFeasible: sendMethodObserved,
    remarks: unique(remarks)
  }
}

async function postRpc(url: string, method: string, params: unknown[]): Promise<{
  reachable: boolean
  acceptsJsonRpc: boolean
  ok: boolean
  errorCode?: number
  authRequiredLikely: boolean
  remark?: string
}> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(4000)
    })

    const text = await response.text()
    const authRequiredLikely =
      response.status === 401 ||
      response.status === 403 ||
      /auth|token|api[- ]?key|forbidden|unauthorized/i.test(text)

    if (!text.trim()) {
      return {
        reachable: true,
        acceptsJsonRpc: false,
        ok: false,
        authRequiredLikely,
        remark: "empty HTTP response"
      }
    }

    try {
      const parsed = JSON.parse(text) as {
        jsonrpc?: string
        result?: unknown
        error?: { code?: number; message?: string }
      }
      const acceptsJsonRpc = parsed.jsonrpc === "2.0" || Boolean(parsed.error) || "result" in parsed
      const ok = parsed.result !== undefined
      return {
        reachable: true,
        acceptsJsonRpc,
        ok,
        errorCode: parsed.error?.code,
        authRequiredLikely,
        remark: ok ? "method returned a JSON-RPC result" : parsed.error?.message || `http ${response.status}`
      }
    } catch {
      return {
        reachable: true,
        acceptsJsonRpc: false,
        ok: false,
        authRequiredLikely,
        remark: "non-JSON response body"
      }
    }
  } catch (error) {
    return {
      reachable: false,
      acceptsJsonRpc: false,
      ok: false,
      authRequiredLikely: false,
      remark: error instanceof Error ? error.message : String(error)
    }
  }
}

function deriveVerificationStatus(probe: EndpointProbeResult): SubmissionVerificationStatus {
  if (probe.sendMethodObserved && probe.rawSendFeasible) {
    return "verified"
  }
  if (probe.acceptsJsonRpc) {
    return "protocol-unknown"
  }
  if (probe.reachable) {
    return "reachable"
  }
  return "unverified"
}

function compareEndpoints(a: PrivateSubmissionEndpoint, b: PrivateSubmissionEndpoint): number {
  return verificationRank(b.verificationStatus) - verificationRank(a.verificationStatus) || a.displayName.localeCompare(b.displayName)
}

function verificationRank(value: SubmissionVerificationStatus): number {
  if (value === "verified") return 3
  if (value === "protocol-unknown") return 2
  if (value === "reachable") return 1
  return 0
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

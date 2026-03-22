import { loadPrivateSubmissionRegistry, selectRegistryEndpoints } from "../submission/private-registry"

async function main() {
  const registry = await loadPrivateSubmissionRegistry()
  const validatorSample = selectRegistryEndpoints(registry, "validator-mev-rpc", 3)
  const builderSample = selectRegistryEndpoints(registry, "builder-relay", 3)

  console.log(
    JSON.stringify(
      {
        summary: registry.summary,
        validator_sample: validatorSample,
        builder_sample: builderSample
      },
      null,
      2
    )
  )
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

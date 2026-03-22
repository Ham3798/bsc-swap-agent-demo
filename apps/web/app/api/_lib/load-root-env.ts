import { config as loadEnv } from "dotenv"
import path from "node:path"

let loaded = false

export function loadRootEnv() {
  if (loaded) {
    return
  }

  const projectRoot = path.resolve(process.cwd(), "..", "..")
  loadEnv({ path: path.join(projectRoot, ".env") })
  loadEnv({ path: path.join(projectRoot, ".env.local"), override: true })
  loaded = true
}

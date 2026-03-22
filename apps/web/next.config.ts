import type { NextConfig } from "next"

const defaultAllowedDevOrigins = ["localhost:3000", "127.0.0.1:3000"]
const envAllowedDevOrigins = (process.env.NEXT_ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)

const nextConfig: NextConfig = {
  allowedDevOrigins: [...new Set([...defaultAllowedDevOrigins, ...envAllowedDevOrigins])]
}

export default nextConfig

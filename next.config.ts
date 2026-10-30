import type { NextConfig } from "next"

const config: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: ["undici"],
  async headers() {
    return [{
      source: "/ffmpeg/:path*",
      headers: [{ key: "Cache-Control", value: "public, max-age=3600, must-revalidate" }],
    }]
  },
}

export default config

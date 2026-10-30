import { assertChannelAllowed } from "@/server/stream-catalog"
import { verifyResource } from "@/server/proxy-policy"
import { proxyFailure, proxyStream } from "@/server/stream-response"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: Request) {
  try {
    const grant = verifyResource(new URL(request.url).searchParams.get("token") ?? "")
    await assertChannelAllowed(grant.channel)
    return await proxyStream(request, grant.url, grant.channel, grant.playlist)
  } catch (error) { return proxyFailure(error) }
}

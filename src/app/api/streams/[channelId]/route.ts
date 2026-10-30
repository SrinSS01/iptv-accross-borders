import { resolveSource } from "@/server/stream-catalog"
import { ProxyError } from "@/server/proxy-policy"
import { proxyFailure, proxyStream } from "@/server/stream-response"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: Request, { params }: { params: Promise<{ channelId: string }> }) {
  try {
    const { channelId } = await params
    const value = new URL(request.url).searchParams.get("source") ?? "0"
    if (!/^\d+$/.test(value)) throw new ProxyError("INVALID_SOURCE", "Select a valid stream source.")
    const source = await resolveSource(channelId, Number(value))
    return await proxyStream(request, source, channelId, true)
  } catch (error) { return proxyFailure(error) }
}

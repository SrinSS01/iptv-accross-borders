import { lookup } from "node:dns/promises"
import { Agent, request } from "undici"
import { isPublicAddress, ProxyError, validateUpstreamUrl } from "./proxy-policy"

export const MAX_RESOURCE_BYTES = 32 * 1024 * 1024
export const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024
const TIMEOUT_MS = 25_000

/** Resolve once, reject all non-public answers, then pin the socket lookup. */
export async function openUpstream(input: string, range?: string, signal?: AbortSignal, acceptEncoding: "identity" | "gzip" = "identity") {
  let url = validateUpstreamUrl(input)
  const controller = new AbortController()
  const aborted = () => controller.abort()
  signal?.addEventListener("abort", aborted, { once: true })
  if (signal?.aborted) controller.abort()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let agent: Agent | undefined
  const cleanup = () => {
    clearTimeout(timer)
    signal?.removeEventListener("abort", aborted)
    if (agent) void agent.destroy().catch(() => {})
  }
  try {
    for (let redirects = 0; redirects <= 4; redirects++) {
      const hostname = url.hostname.replace(/^\[|\]$/g, "")
      // Bound DNS as part of the same request timeout, even if the OS resolver stalls.
      const addresses = await Promise.race([
        lookup(hostname, { all: true, verbatim: true }),
        new Promise<never>((_, reject) => {
          if (controller.signal.aborted) reject(new Error("aborted"))
          else controller.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
        }),
      ])
      if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address)))
        throw new ProxyError("BLOCKED_DESTINATION", "This stream destination is not allowed.", 403)
      const chosen = addresses.find(({ family }) => family === 4) ?? addresses[0]
      agent = new Agent({ connect: {
        autoSelectFamily: false,
        lookup: (_hostname, _options, callback) => callback(null, chosen.address, chosen.family),
      } })
      const response = await request(url, {
        dispatcher: agent,
        method: "GET",
        signal: controller.signal,
        headersTimeout: 10_000,
        bodyTimeout: 10_000,
        headers: { accept: "*/*", "accept-encoding": acceptEncoding, ...(range ? { range } : {}) },
      })
      // Undici emits an asynchronous error when an unread body is destroyed
      // (redirects, rejected statuses, or client cancellation). Always observe
      // it, even before an async iterator is attached. Iterators still reject.
      response.body.on("error", () => {})
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.body.destroy()
        await agent.destroy()
        agent = undefined
        const location = response.headers.location
        if (!location || Array.isArray(location) || redirects === 4)
          throw new ProxyError("UPSTREAM_REDIRECT", "The broadcaster returned too many or invalid redirects.", 502)
        url = validateUpstreamUrl(new URL(location, url).href)
        continue
      }
      return { ...response, finalUrl: url.href, cleanup, signal: controller.signal }
    }
    throw new ProxyError("UPSTREAM_REDIRECT", "The broadcaster returned too many redirects.", 502)
  } catch (error) {
    cleanup()
    if (error instanceof ProxyError) throw error
    if (controller.signal.aborted) throw new ProxyError("UPSTREAM_TIMEOUT", "The stream request timed out or was canceled.", 504)
    throw new ProxyError("UPSTREAM_UNAVAILABLE", "The broadcaster could not be reached.", 502)
  }
}

export async function readBounded(body: AsyncIterable<Uint8Array>, limit: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let length = 0
  for await (const chunk of body) {
    length += chunk.byteLength
    if (length > limit) throw new ProxyError("RESOURCE_TOO_LARGE", "The stream resource exceeds the proxy size limit.", 413)
    chunks.push(chunk)
  }
  const output = new Uint8Array(length)
  let position = 0
  for (const chunk of chunks) { output.set(chunk, position); position += chunk.byteLength }
  return output
}

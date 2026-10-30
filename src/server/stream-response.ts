import { ProxyError, rewritePlaylist, validateRange } from "./proxy-policy"
import { MAX_PLAYLIST_BYTES, MAX_RESOURCE_BYTES, openUpstream, readBounded } from "./upstream"

export function proxyFailure(error: unknown): Response {
  const failure = error instanceof ProxyError ? error : new ProxyError("UPSTREAM_UNAVAILABLE", "The broadcaster could not provide this stream resource.", 502)
  return Response.json({ error: failure.code, message: failure.message }, {
    status: failure.status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  })
}
export async function proxyStream(request: Request, url: string, channel: string, playlist = false): Promise<Response> {
  const range = validateRange(request.headers.get("range"))
  const upstream = await openUpstream(url, range, request.signal)
  let closed = false
  const close = () => { if (closed) return; closed = true; upstream.body.destroy(); upstream.cleanup() }
  try {
    if (upstream.statusCode !== 200 && upstream.statusCode !== 206) {
      if (upstream.statusCode === 416) throw new ProxyError("INVALID_RANGE", "The broadcaster cannot serve this byte range.", 416)
      if (upstream.statusCode === 401 || upstream.statusCode === 403)
        throw new ProxyError("UPSTREAM_REJECTED", "The broadcaster refused this stream request.", 502)
      throw new ProxyError("UPSTREAM_UNAVAILABLE", "This stream resource is unavailable at the broadcaster.", 502)
    }
    const contentType = String(upstream.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase()
    const isPlaylist = playlist || /mpegurl/.test(contentType) || /\.m3u8$/i.test(new URL(upstream.finalUrl).pathname)
    const limit = isPlaylist ? MAX_PLAYLIST_BYTES : MAX_RESOURCE_BYTES
    const contentLength = Number(upstream.headers["content-length"])
    if (Number.isFinite(contentLength) && contentLength > limit)
      throw new ProxyError("RESOURCE_TOO_LARGE", "The stream resource exceeds the proxy size limit.", 413)
    const encoding = upstream.headers["content-encoding"]
    if (encoding && encoding !== "identity")
      throw new ProxyError("UNSUPPORTED_ENCODING", "The broadcaster returned an unsupported content encoding.", 502)
    const headers = new Headers({
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
    })
    if (isPlaylist) {
      if (range) throw new ProxyError("INVALID_RANGE", "Byte ranges are not supported for playlists.", 416)
      const bytes = await readBounded(upstream.body, limit)
      const text = rewritePlaylist(new TextDecoder().decode(bytes), upstream.finalUrl, channel)
      close()
      headers.set("content-type", "application/vnd.apple.mpegurl; charset=utf-8")
      return new Response(text, { headers })
    }
    // Never expose executable broadcaster HTML/JS under the application's origin.
    headers.set("content-type", /^(?:video|audio)\/[a-z0-9.+-]+$/.test(contentType) || contentType === "application/mp4" ? contentType : "application/octet-stream")
    headers.set("accept-ranges", "bytes")
    if (Number.isSafeInteger(contentLength) && contentLength >= 0 && upstream.headers["content-length"] !== undefined)
      headers.set("content-length", String(contentLength))
    const contentRange = upstream.headers["content-range"]
    if (upstream.statusCode === 206 && typeof contentRange === "string" && /^bytes \d+-\d+\/(?:\d+|\*)$/.test(contentRange))
      headers.set("content-range", contentRange)
    const iterator = upstream.body[Symbol.asyncIterator]()
    let received = 0
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const result = await iterator.next()
          if (closed) return
          if (result.done) { close(); controller.close(); return }
          received += result.value.byteLength
          if (received > limit) throw new ProxyError("RESOURCE_TOO_LARGE", "The resource exceeds the proxy size limit.", 413)
          controller.enqueue(new Uint8Array(result.value))
        } catch (error) { if (closed) return; close(); controller.error(error) }
      },
      cancel() { close() },
    })
    return new Response(body, { status: upstream.statusCode, headers })
  } catch (error) { close(); throw error }
}

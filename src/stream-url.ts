/** Keep the original URL on catalog rows; route HLS requests through our server. */
export function getStreamUrl(channelId: string, sourceIndex: number, originalUrl: string): string {
  if (!/\.m3u8(?:[?#]|$)/i.test(originalUrl)) return originalUrl
  return `/api/streams/${encodeURIComponent(channelId)}?source=${sourceIndex}&format=.m3u8`
}

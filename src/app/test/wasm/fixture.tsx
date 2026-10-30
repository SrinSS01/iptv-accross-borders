"use client"

import { RecordingProvider, RecordButton, RecordingLibrary } from "../../../recording"

// Development-only fixture. Playwright supplies generated HLS media at the proxy boundary.
export default function Fixture() {
  return (
    <RecordingProvider>
      <main style={{ padding: 24 }}>
        <h1>HLS recording verification</h1>
        <RecordButton channel={{ id: "test-hls", name: "HLS test broadcast", streams: [{ url: "https://example.invalid/test.m3u8" }] }} />
        <RecordingLibrary />
      </main>
    </RecordingProvider>
  )
}

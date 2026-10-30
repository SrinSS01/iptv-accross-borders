"use client"

import dynamic from "next/dynamic"

// Playback, local preferences and browser-owned recording are initialized only
// after mount. The server shell deliberately avoids browser-dependent markup.
const BrowserApp = dynamic(() => import("./browser-app"), {
  ssr: false,
  loading: () => (
    <main className="min-h-screen bg-[var(--background)] p-6 text-white" aria-busy="true" aria-label="Loading channels">
      <div className="mx-auto max-w-[1580px]">
        <div className="mb-8 h-11 max-w-md bg-white/5" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => <div key={index} className="aspect-video bg-white/5" />)}
        </div>
      </div>
    </main>
  ),
})

export default function ClientApp() {
  return <BrowserApp />
}

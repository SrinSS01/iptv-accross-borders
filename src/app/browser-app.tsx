"use client"

import App from "../App"
import { RecordingProvider } from "../recording"

export default function BrowserApp() {
  return <RecordingProvider><App /></RecordingProvider>
}

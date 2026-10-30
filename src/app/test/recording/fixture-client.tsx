"use client"

import dynamic from "next/dynamic"

const Fixture = dynamic(() => import("../../../../tests/recording-browser"), { ssr: false })

export default function RecordingFixtureClient() {
  return <Fixture />
}

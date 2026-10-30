import { notFound } from "next/navigation"
import RecordingFixtureClient from "./fixture-client"

export default function RecordingTestPage() {
  if (process.env.NODE_ENV === "production") notFound()
  return <RecordingFixtureClient />
}

import { notFound } from "next/navigation"
import Fixture from "./fixture"

export default function RecordingTestPage() {
  if (process.env.NODE_ENV === "production") notFound()
  return <Fixture />
}

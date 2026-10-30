import type { Metadata, Viewport } from "next"
import type { ReactNode } from "react"
import "../index.css"

export const metadata: Metadata = {
  title: "IPTV Accross Borders — Live TV & Recordings",
  description: "Browse international live TV, explore programme schedules, and record broadcasts in your browser.",
  icons: { icon: "/favicon.svg" },
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#101112",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>
}

export function BrandMark({ className = "size-10" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M22 8H8v48h14M42 8h14v48H42"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        d="M2 32h18l8-16 8 32 8-16h18"
        stroke="var(--accent, #ff4655)"
        strokeWidth="5"
        strokeLinejoin="miter"
      />
    </svg>
  )
}

export default function Brand() {
  return (
    <span
      className="inline-flex min-w-0 items-center gap-3 text-left text-[#f1f0eb]"
      aria-label="IPTV Accross Borders"
    >
      <BrandMark className="size-10 shrink-0" />
      <span className="flex min-w-0 flex-col leading-none" aria-hidden="true">
        <span className="text-lg font-bold tracking-[0.12em]">IPTV</span>
        <span className="mt-1.5 whitespace-nowrap text-[9px] font-medium tracking-[0.12em]">
          ACCROSS BORDERS
        </span>
      </span>
    </span>
  )
}

export function validateSchedule(start: string, end: string, now: number) {
  const from = start ? new Date(start).getTime() : now
  const to = end ? new Date(end).getTime() : undefined
  if (!Number.isFinite(from) || (start && from < now)) {
    return {
      error: "Choose a future start time, or leave it blank to start now.",
      field: "record-start",
    } as const
  }
  if (to !== undefined && (!Number.isFinite(to) || to <= from)) {
    return {
      error: "End time must be after the start time.",
      field: "record-end",
    } as const
  }
  return { from, to }
}

export function scheduleAction(
  start: number,
  end: number | undefined,
  now: number,
  started: boolean,
) {
  if (end !== undefined && now >= end) return started ? "stop" : "missed-window"
  if (started || now < start) return "wait"
  return now - start > 60000 ? "missed-start" : "start"
}

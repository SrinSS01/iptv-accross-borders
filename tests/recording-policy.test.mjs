import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import ts from "typescript"
const source = fs.readFileSync(
  new URL("../src/recording-policy.ts", import.meta.url),
  "utf8",
)
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
})
const { validateSchedule, scheduleAction } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
)
const now = Date.parse("2026-10-26T12:00:00Z")
test("blank times default to immediate capture with manual stop", () =>
  assert.deepEqual(validateSchedule("", "", now), { from: now, to: undefined }))
test("rejects past and invalid starts", () => {
  assert.equal(
    validateSchedule("2026-10-26T11:59:00Z", "", now).field,
    "record-start",
  )
  assert.equal(validateSchedule("invalid", "", now).field, "record-start")
})
test("rejects equal, earlier and invalid ends", () => {
  for (const end of ["2026-10-26T12:00:00Z", "2026-10-26T11:00:00Z", "invalid"])
    assert.equal(validateSchedule("", end, now).field, "record-end")
})
test("accepts future schedules spanning midnight", () => {
  assert.deepEqual(
    validateSchedule("2026-10-26T23:59:00Z", "2026-10-27T00:30:00Z", now),
    {
      from: Date.parse("2026-10-26T23:59:00Z"),
      to: Date.parse("2026-10-27T00:30:00Z"),
    },
  )
})
test("starts once at the due time", () => {
  assert.equal(scheduleAction(now, undefined, now - 1, false), "wait")
  assert.equal(scheduleAction(now, undefined, now, false), "start")
  assert.equal(scheduleAction(now, undefined, now + 1000, true), "wait")
})
test("ends at the exact deadline, including after timer throttling", () => {
  assert.equal(scheduleAction(now, now + 1000, now + 1000, true), "stop")
  assert.equal(scheduleAction(now, now + 1000, now + 120000, true), "stop")
})
test("missed schedules are not recorded silently", () => {
  assert.equal(
    scheduleAction(now, undefined, now + 60001, false),
    "missed-start",
  )
  assert.equal(
    scheduleAction(now, now + 1000, now + 2000, false),
    "missed-window",
  )
})

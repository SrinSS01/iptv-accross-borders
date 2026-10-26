# Streamly interaction contract

Source: user request for current/future recording with optional end time; existing React/Vite client-only architecture in package.json and src/App.tsx. No backend or account/storage API exists.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Select/Listbox | ChannelFilters.tsx dialog picker | DESIGN.md | searchable dialog with native buttons | search, selection, dismissal, mobile review |
| Date | recording.tsx datetime-local | DESIGN.md | native | schedule validation |
| Form | RecordingProvider | User recording request | immediate, scheduled | typecheck, recording checks |
| Scrollbar | index.css | DESIGN.md | global | CSS review |
| Toast | RecordingProvider message | UX-CONTRACT.md | status, error | library status checks |
| Dialog | RecordingProvider dialog | DESIGN.md | modal | focus and Escape review |


Recording uses one independent media pipeline per session, surviving app navigation and player dismissal. One recording at a time; states: scheduled, connecting, recording, saving, finished or failure. Scheduled starts require the tab open and device awake. Missed starts beyond one minute fail explicitly. Timers use wall-clock comparisons. Stream connection times out per source; capture interruptions finalize partial data. A 512 MB per-recording limit bounds chunks. Output is WebM or MP4 depending on browser support; it is captured/re-encoded media, not a byte-identical copy of original segments. Files are held in this tab until the user saves them; no server upload. Reload/close warns about session recordings. No scheduled job is persisted across reload.

Catalog filters remain transient in-memory state, preserving this app's existing behavior. Favorites persist in localStorage. New recording forms do not change catalog selection. Search is local and immediate; no remote search debounce needed. Recordings page is available on mobile and desktop. Date popup geometry/locale remains platform-owned. Catalog filter pickers use non-modal dialog semantics with ordinary buttons (not a custom ARIA combobox/listbox). Search filters the options locally; Enter picks the first match, Tab reaches options, Escape dismisses and returns focus; outside pointer dismisses without stealing focus. The popup follows scrolling and sits below the header. Country and category lists are alphabetical and include all catalog values. Counts describe the full catalog. Reset filters preserves the separate channel search.

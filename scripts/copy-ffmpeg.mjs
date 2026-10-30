import { copyFile, mkdir, readdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const coreDirectory = dirname(fileURLToPath(import.meta.resolve("@ffmpeg/core")))
const destination = new URL("../public/ffmpeg/", import.meta.url)
await mkdir(destination, { recursive: true })
for (const name of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
  await copyFile(join(coreDirectory, name), new URL(name, destination))
}
// Keep the module worker unbundled: its runtime core import must be resolved by
// the browser, not converted to a webpack dynamic import context.
const workerDirectory = dirname(fileURLToPath(import.meta.resolve("@ffmpeg/ffmpeg/worker")))
const workerDestination = new URL("worker/", destination)
await mkdir(workerDestination, { recursive: true })
for (const name of await readdir(workerDirectory)) {
  if (name.endsWith(".js")) await copyFile(join(workerDirectory, name), new URL(name, workerDestination))
}
console.log("Prepared same-origin FFmpeg core and module worker assets.")

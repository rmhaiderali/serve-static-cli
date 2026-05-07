import { dirname } from "node:path"

const response = await fetch(dirname(import.meta.url) + "/package-lock.json")
const packageLock = await response.text()
const packages = JSON.parse(packageLock).packages || {}

export default function npm(name) {
  const version = packages["node_modules/" + name]?.version || "latest"
  return import("npm:" + name + "@" + version)
}

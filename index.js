#!/usr/bin/env deno

import http from "node:http"
import fs from "node:fs/promises"
import { join, dirname, resolve } from "node:path"
import ms from "npm:ms"
import { z } from "npm:zod"
import pc from "npm:picocolors"
import serveStatic from "npm:serve-static"
import finalhandler from "npm:finalhandler"
import format from "./utils/format.js"
import { serveStaticOptionsSchema } from "./schemas.js"

const response = await fetch(dirname(import.meta.url) + "/template.html")
const template = await response.text()

function render(template, variables) {
  return Object.entries(variables).reduce(
    (prev, [key, value]) => prev.replaceAll("{" + key + "}", value),
    template
  )
}

const root = process.argv[2] || "."
const port = +process.argv[3] || 3000
const listing = process.argv[4] || "yes"
const options = { dotfiles: "allow" }
let userOptions = null
let rootStats = null

try {
  rootStats = await fs.stat(root)
} catch (e) {
  console.error("Failed to stat root: \"" + root + "\"")
  process.exit(1)
}

if (!rootStats.isDirectory()) {
  console.error("Provided root is not a directory")
  process.exit(2)
}

const absRoot = resolve(root)

try {
  userOptions = eval("(" + (process.argv[5] || "{}") + ")")
} catch (e) {
  console.error("Failed to evaluate options object")
  process.exit(3)
}

const result = serveStaticOptionsSchema.safeParse(userOptions)

if (!result.success) {
  console.error(result.error.errors[0]?.message)
  process.exit(4)
}

Object.assign(options, userOptions)

if (!z.enum(["yes", "no"]).safeParse(listing).success) {
  console.error("Listing accepts either yes or no")
  process.exit(5)
}

if (!z.number().int().gte(1).lte(65535).safeParse(port).success) {
  console.error("Port must be an integer between 1 and 65535 (inclusive)")
  process.exit(6)
}

const serve = serveStatic(root, options)

const hideDotDirs = ["deny", "ignore"].includes(options.dotfiles)

const server = http.createServer(async function onRequest(req, res) {
  const startTime = Date.now()

  console.log(
    pc.gray(new Date().toLocaleString()) +
      pc.cyan(" " + req.method + " " + req.url)
  )

  res.on("finish", () => {
    let color = (t) => t
    if (res.statusCode >= 400) color = pc.red
    else if (res.statusCode >= 300) color = pc.yellow
    else if (res.statusCode >= 200) color = pc.green
    console.log(
      pc.gray(new Date().toLocaleString()) +
        color(
          " Returned " + res.statusCode + " in " + ms(Date.now() - startTime)
        )
    )
  })

  serve(req, res, async function (err) {
    const path = decodeURI(req.url).split("?")[0].replace(/\/+/g, "/")

    if (listing === "yes" && !(hideDotDirs && path.indexOf("/.") !== -1)) {
      const fullPath = join(absRoot, path)
      let stat = null

      try {
        stat = await fs.stat(fullPath)
      } catch (e) {}

      if (stat?.isDirectory()) {
        if (options.setHeaders) await options.setHeaders(res, fullPath, stat)

        const files = await fs.readdir(fullPath)
        const slash = path.endsWith("/") ? "" : "/"

        const list = [".."]
          .concat(hideDotDirs ? files.filter((f) => !f.startsWith(".")) : files)
          .map(
            (file) => `<li><a href="${path}${slash}${file}">${file}</a></li>`
          )
          .join("")

        res.writeHead(200, { "content-type": "text/html" })
        res.end(render(template, { path, list }))
        return
      }
    }

    finalhandler(req, res)()
  })
})

let runtime = null
if (typeof global !== "undefined") runtime = "node"
if (typeof Deno !== "undefined") runtime = "deno"
if (typeof Bun !== "undefined") runtime = "bun"

let version = null
if (runtime === "node") version = process.versions.node
else if (runtime === "deno") version = Deno.version.deno
else if (runtime === "bun") version = Bun.version

let color = (t) => t
if (runtime === "node") color = pc.green
else if (runtime === "deno") color = pc.gray
else if (runtime === "bun") color = pc.magenta

server.listen(port, () => {
  if (runtime && version) console.log(color("using " + runtime + " " + version))
  console.log("started server at http://localhost:" + port)
  console.log(format("\"")({ root, port, listing, options }, { colors: true }))
})

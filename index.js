#!/usr/bin/env deno

import http from "node:http"
import fs from "node:fs/promises"
import { join, dirname } from "node:path/posix"
import { z } from "npm:zod"
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

const hideDotDirectories = ["deny", "ignore"].includes(options.dotfiles)

const server = http.createServer(async function onRequest(req, res) {
  serve(req, res, async function (err) {
    console.log(req.method, req.url)
    const path = decodeURI(req.url).slice("?").slice("#")
    if (
      !err &&
      listing === "yes" &&
      !(hideDotDirectories && path.indexOf("/.") !== -1)
    ) {
      try {
        const fullPath = join(root, path)
        const stats = await fs.stat(fullPath)

        if (stats.isDirectory()) {
          const files = await fs.readdir(fullPath)

          const list = [".."]
            .concat(
              hideDotDirectories
                ? files.filter((f) => !f.startsWith("."))
                : files
            )
            .map((file) => "<li><a href=\"" + file + "\">" + file + "</a></li>")
            .join("")

          const html = render(template, { path, list })
          res.writeHead(200, { "Content-Type": "text/html" })
          res.end(html)
          return
        }
      } catch (e) {}
    }
    finalhandler(req, res)(err)
  })
})

server.listen(port, () => {
  console.log("Started server at http://localhost:" + port)
  console.log(format("\"")({ root, port, listing, options }, { colors: true }))
})

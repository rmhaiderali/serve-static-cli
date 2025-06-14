#!/usr/bin/env node

import http from "node:http"
import fs from "node:fs/promises"
import { join, resolve } from "node:path"
import { Buffer } from "node:buffer"
import ms from "ms"
import { z } from "zod"
import chalk from "chalk"
import fresh from "fresh"
import etagify from "etag"
import mustache from "mustache"
import serveStatic from "serve-static"
import finalhandler from "finalhandler"
import format from "./utils/format.js"
import { serveStaticOptionsSchema } from "./schemas.js"

const template = await fs.readFile(
  import.meta.dirname + "/template.mustache",
  "utf8"
)

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

const MAX_MAXAGE = 60 * 60 * 24 * 365 * 1000 // 1 year

let maxage = options.maxAge || options.maxage
maxage = typeof maxage === "string" ? ms(maxage) : Number(maxage)
maxage = !isNaN(maxage) ? Math.min(Math.max(maxage), MAX_MAXAGE) : 0

const serve = serveStatic(root, options)

const hideDotDirs = ["deny", "ignore"].includes(options.dotfiles)

const server = http.createServer(async function onRequest(req, res) {
  const startTime = Date.now()

  console.log(
    chalk.gray(new Date().toLocaleString()) +
      chalk.cyan(" " + req.method + " " + req.url)
  )

  res.on("finish", () => {
    let color = (t) => t
    if (res.statusCode >= 400) color = chalk.red
    else if (res.statusCode >= 300) color = chalk.yellow
    else if (res.statusCode >= 200) color = chalk.green
    console.log(
      chalk.gray(new Date().toLocaleString()) +
        color(
          " Returned " + res.statusCode + " in " + ms(Date.now() - startTime)
        )
    )
  })

  serve(req, res, async function (err) {
    const path = decodeURI(req.url).split("?")[0].replace(/\/+/g, "/")

    serve_listing: if (
      listing === "yes" &&
      !(hideDotDirs && path.indexOf("/.") !== -1)
    ) {
      const fullPath = join(absRoot, path)

      let stat = null
      try {
        stat = await fs.stat(fullPath)
      } catch (e) {
        break serve_listing
      }

      if (stat.isDirectory()) {
        if (options.setHeaders) await options.setHeaders(res, fullPath, stat)

        const etag = etagify(stat)
        const lastModified = stat.mtime.toUTCString()

        const check = {}

        if (options.etag !== false) check.etag = etag
        if (options.lastModified !== false)
          check["last-modified"] = lastModified

        if (fresh(req.headers, check)) {
          res.statusCode = 304
          res.end()
          break serve_listing
        }

        let files = null
        try {
          files = await fs.readdir(fullPath)
        } catch (e) {
          break serve_listing
        }

        const slash = path.endsWith("/") ? "" : "/"

        files = [".."]
          .concat(hideDotDirs ? files.filter((f) => !f.startsWith(".")) : files)
          .map((name) => ({ name, url: encodeURI(path + slash + name) }))

        const doc = mustache.render(template, { path, files })

        if (options.etag !== false) res.setHeader("etag", etag)

        if (options.lastModified !== false)
          res.setHeader("last-modified", lastModified)

        let cacheControl = "public, max-age=" + Math.floor(maxage / 1000)
        if (options.immutable) cacheControl += ", immutable"
        res.setHeader("cache-control", cacheControl)

        res.setHeader("content-type", "text/html; charset=utf-8")
        res.setHeader("content-length", Buffer.byteLength(doc))
        res.end(doc)
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
if (runtime === "node") color = chalk.hex("#66cc33")
else if (runtime === "deno") color = chalk.hex("#70ffaf")
else if (runtime === "bun") color = chalk.hex("#f472b6")

server.listen(port, () => {
  if (runtime && version) console.log("using " + color(runtime + " " + version))
  console.log("started server at http://localhost:" + port)
  console.log(format("\"")({ root, port, listing, options }, { colors: true }))
})

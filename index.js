#!/usr/bin/env node

import http from "node:http"
import fs from "node:fs/promises"
import { inspect } from "node:util"
import { join, resolve } from "node:path"
import { Buffer } from "node:buffer"
import prettyMs from "pretty-ms"
import { z } from "zod"
import chalk from "chalk"
import fresh from "fresh"
import etagify from "etag"
import mustache from "mustache"
import serveStatic from "serve-static"
import finalhandler from "finalhandler"
import replaceQuotes, { double, single, backtick } from "replace-quotes"
import { serveStaticOptionsSchema } from "./schemas.js"

const toDoubleQuotes = replaceQuotes(
  // from
  double,
  single,
  backtick,
  // to
  double
)

const template = await fs.readFile(
  import.meta.dirname + "/template.mustache",
  "utf8"
)

const root = process.argv[2] || "."
const options = { dotfiles: "allow" }
let userOptions = null
let rootStats = null

try {
  rootStats = await fs.stat(root)
} catch (e) {
  console.error('Failed to stat root: "' + root + '"')
  process.exit(1)
}

if (!rootStats.isDirectory()) {
  console.error("Provided root is not a directory")
  process.exit(2)
}

const absRoot = resolve(root)

try {
  userOptions = eval("(" + (process.argv[3] || "{}") + ")")
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

let listing = process.env.LISTING
let port = process.env.PORT
let host = process.env.HOST

if (listing && !z.enum(["true", "false"]).safeParse(listing).success) {
  console.error("LISTING must be true or false")
  process.exit(5)
}

if (port && !z.number().int().min(0).max(65535).safeParse(+port).success) {
  console.error("PORT must be >= 0 and < 65536")
  process.exit(6)
}

if (host && !z.string().ip().safeParse(host).success) {
  console.error("HOST must be a valid IP address")
  process.exit(7)
}

listing = listing !== "false"
port = port ? +port : 3000
host = host || "localhost"

function getPrettyMs(delta) {
  return prettyMs(delta, { compact: true, formatSubMilliseconds: true })
}

const MAX_MAXAGE = 60 * 60 * 24 * 365 * 1000 // 1 year

let maxage = options.maxAge || options.maxage
maxage = typeof maxage === "string" ? getPrettyMs(maxage) : Number(maxage)
maxage = !isNaN(maxage) ? Math.min(Math.max(maxage), MAX_MAXAGE) : 0

const serve = serveStatic(root, options)

const hideDotDirs = ["deny", "ignore"].includes(options.dotfiles)

let requestId = 0n

const server = http.createServer(async function onRequest(req, res) {
  const id = ++requestId
  const startTime = process.hrtime.bigint()

  console.log(
    chalk.magenta("#" + id) +
      " " +
      chalk.gray(new Date().toLocaleString()) +
      " " +
      chalk.cyan(req.method + " " + req.url)
  )

  res.on("finish", () => {
    let color = (t) => t
    if (res.statusCode >= 400) color = chalk.red
    else if (res.statusCode >= 300) color = chalk.yellow
    else if (res.statusCode >= 200) color = chalk.green
    const deltaTime = Number(process.hrtime.bigint() - startTime)
    console.log(
      chalk.magenta("#" + id) +
        " " +
        chalk.gray(new Date().toLocaleString()) +
        " " +
        color(
          "Returned " + res.statusCode + " in " + getPrettyMs(deltaTime / 1e6)
        )
    )
  })

  serve(req, res, async function (err) {
    const path = decodeURI(req.url).split("?")[0].replace(/\/+/g, "/")

    serve_listing: if (listing && !(hideDotDirs && path.indexOf("/.") !== -1)) {
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

        let contents = null
        try {
          contents = await fs.readdir(fullPath, { withFileTypes: true })
        } catch (e) {
          break serve_listing
        }

        const slash = path.endsWith("/") ? "" : "/"

        contents.unshift({ name: "..", isDirectory: () => true })

        if (hideDotDirs)
          contents = contents.filter((c) => !c.name.startsWith("."))

        contents = contents
          .map((c) => {
            const type =
              c.isDirectory() || c.isSymbolicLink() ? "dir/symlink" : "file"
            return { name: c.name, type, url: encodeURI(path + slash + c.name) }
          })
          .sort((a, b) => {
            if (a.type === b.type) return 0
            return a.type === "dir/symlink" ? -1 : 1
          })

        const doc = mustache.render(template, { path, contents })

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

const opts = {}
if (host) opts.host = host
if (port) opts.port = port

server.listen(opts, () => {
  console.log("started server at http://" + host + ":" + port)
  if (runtime && version) console.log("using " + color(runtime + " " + version))
  const optsString = inspect({ root, listing, options }, { colors: true })
  console.log(toDoubleQuotes(optsString))
})

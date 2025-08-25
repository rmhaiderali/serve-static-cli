#!/usr/bin/env node

import os from "node:os"
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

let port = process.env.PORT
let host = process.env.HOST
let dir_listing = process.env.DIR_LISTING
let show_only_ipv4 = process.env.SHOW_ONLY_IPV4

if (port && !z.number().int().min(0).max(65535).safeParse(+port).success) {
  console.error("PORT must be >= 0 and < 65536")
  process.exit(5)
}

if (
  host?.toLocaleLowerCase() !== "localhost" &&
  host &&
  !z.string().ip().safeParse(host).success
) {
  console.error("HOST must be a valid network interface address")
  process.exit(6)
}

if (dir_listing && !z.enum(["true", "false"]).safeParse(dir_listing).success) {
  console.error("DIR_LISTING must be true or false")
  process.exit(7)
}

if (
  show_only_ipv4 &&
  !z.enum(["true", "false"]).safeParse(show_only_ipv4).success
) {
  console.error("SHOW_ONLY_IPV4 must be true or false")
  process.exit(8)
}

port = port ? +port : 3000
dir_listing = dir_listing !== "false"
show_only_ipv4 = show_only_ipv4 !== "false"

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

const fileTypes = ["dir", "file"]

let runtime = null
if (typeof global !== "undefined") runtime = "node"
if (typeof Deno !== "undefined") runtime = "deno"
if (typeof Bun !== "undefined") runtime = "bun"

let version = null
if (runtime === "node") version = process.versions.node
else if (runtime === "deno") version = Deno.version.deno
else if (runtime === "bun") version = Bun.version

let runtimeColor = (t) => t
if (runtime === "node") runtimeColor = chalk.hex("#66cc33")
else if (runtime === "deno") runtimeColor = chalk.hex("#70ffaf")
else if (runtime === "bun") runtimeColor = chalk.hex("#f472b6")

const server = http.createServer(async function onRequest(req, res) {
  const id = ++requestId
  const startTime = process.hrtime.bigint()

  console.log(
    runtimeColor("#" + id) +
      " " +
      chalk.gray(new Date().toLocaleString()) +
      " " +
      chalk.cyan(req.method + " " + req.url)
  )

  res.on("finish", () => {
    let resLogColor = (t) => t
    if (res.statusCode >= 400) resLogColor = chalk.red
    else if (res.statusCode >= 300) resLogColor = chalk.yellow
    else if (res.statusCode >= 200) resLogColor = chalk.green
    const deltaTime = Number(process.hrtime.bigint() - startTime)

    console.log(
      runtimeColor("#" + id) +
        " " +
        chalk.gray(new Date().toLocaleString()) +
        " " +
        resLogColor(
          "Returned " + res.statusCode + " in " + getPrettyMs(deltaTime / 1e6)
        )
    )
  })

  serve(req, res, async function (err) {
    const path = decodeURI(req.url).split("?")[0].replace(/\/+/g, "/")

    serve_listing: if (
      dir_listing &&
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

        let contents = null
        try {
          contents = await fs.readdir(fullPath, { withFileTypes: true })
        } catch (e) {
          break serve_listing
        }

        const slash = path.endsWith("/") ? "" : "/"

        if (hideDotDirs)
          contents = contents.filter((dirent) => !dirent.name.startsWith("."))

        contents = await Promise.all(
          contents.map(async (dirent) => {
            let type = "file"
            if (dirent.isDirectory()) type = "dir"
            else if (dirent.isSymbolicLink()) {
              try {
                const stat = await fs.stat(fullPath + slash + dirent.name)
                if (stat.isDirectory()) type = "dir"
              } catch {}
            }

            return {
              type,
              name: dirent.name,
              url: encodeURI(path + slash + dirent.name),
            }
          })
        )

        contents = contents
          .sort((a, b) => (a.name > b.name ? 1 : a.name < b.name ? -1 : 0))
          .sort((a, b) => fileTypes.indexOf(a.type) - fileTypes.indexOf(b.type))

        contents.unshift({
          type: "dir",
          name: "..",
          url: encodeURI(path + slash + ".."),
        })

        const doc = mustache.render(template, { path, contents })

        const etag = etagify(doc)
        const check = {}
        if (options.etag !== false) check.etag = etag

        if (fresh(req.headers, check)) {
          res.statusCode = 304
          res.end()
          return
        }

        if (options.etag !== false) res.setHeader("etag", etag)

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

const opts = {}
if (host) opts.host = host
if (port) opts.port = port

server.listen(opts, () => {
  const { address, family, port } = server.address()

  if (runtime && version)
    console.log("using " + runtimeColor(runtime + " " + version))
  const argsAndEnvs = { root, dir_listing, show_only_ipv4, options }
  console.log(toDoubleQuotes(inspect(argsAndEnvs, { colors: true })))

  const addresses = []

  function netToURL({ address, family, port }) {
    if (family === "IPv6") return "http://[" + address + "]:" + port
    return "http://" + address + ":" + port
  }

  if (address === "0.0.0.0" || address === "::")
    for (const netList of Object.values(os.networkInterfaces())) {
      for (const net of netList) {
        if ((address === "0.0.0.0" || show_only_ipv4) && net.family !== "IPv4")
          continue
        addresses.push({ address: net.address, family: net.family, port })
      }
    }
  else addresses.push({ address, family, port })

  if (addresses.some((net) => ["127.0.0.1", "::1"].includes(net.address)))
    addresses.unshift({ address: "localhost", family: "IPv4", port })

  console.log("server is listening on:")
  addresses
    .sort((a, b) => a.family.localeCompare(b.family))
    .forEach((net) => console.log("  " + runtimeColor(netToURL(net))))
})

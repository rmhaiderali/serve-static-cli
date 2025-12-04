#!/usr/bin/env node

import os from "node:os"
import net from "node:net"
import http from "node:http"
import fs from "node:fs/promises"
import { inspect } from "node:util"
import { join, resolve } from "node:path"
import { Buffer } from "node:buffer"
import ms from "ms"
import { z } from "zod"
import chalk from "chalk"
import fresh from "fresh"
import etagify from "etag"
import ipaddr from "ipaddr.js"
import mustache from "mustache"
import prettyMs from "pretty-ms"
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

const ROOT = process.argv[2] || "."
const OPTIONS = { dotfiles: "allow" }
let userOptions = null
let rootStats = null

try {
  rootStats = await fs.stat(ROOT)
} catch (e) {
  console.error('Failed to stat ROOT: "' + ROOT + '"')
  process.exit(1)
}

if (!rootStats.isDirectory()) {
  console.error("Provided ROOT is not a directory")
  process.exit(2)
}

const absRoot = resolve(ROOT)

try {
  userOptions = eval("(" + (process.argv[3] || "{}") + ")")
} catch (e) {
  console.error("Provided OPTIONS object is not valid")
  console.error("Failed to evaluate")
  process.exit(3)
}

const result = serveStaticOptionsSchema.safeParse(userOptions)

if (!result.success) {
  console.error("Provided OPTIONS object is not valid")
  console.error("See: https://github.com/expressjs/serve-static#api")
  console.error()
  console.error(z.prettifyError(result.error))
  process.exit(4)
}

Object.assign(OPTIONS, userOptions)

let PORT = process.env.PORT
let HOST = process.env.HOST
let DIR_LISTING = process.env.DIR_LISTING
let SHOW_ONLY_IPV4 = process.env.SHOW_ONLY_IPV4

if (PORT && !z.number().int().min(0).max(65535).safeParse(+PORT).success) {
  console.error("PORT must be >= 0 and < 65536")
  process.exit(5)
}

if (
  HOST &&
  HOST.toLocaleLowerCase() !== "localhost" &&
  !z.string().ip().safeParse(HOST).success
) {
  console.error("HOST must be a valid network interface address")
  process.exit(6)
}

if (DIR_LISTING && !z.enum(["true", "false"]).safeParse(DIR_LISTING).success) {
  console.error("DIR_LISTING must be true or false")
  process.exit(7)
}

if (
  SHOW_ONLY_IPV4 &&
  !z.enum(["true", "false"]).safeParse(SHOW_ONLY_IPV4).success
) {
  console.error("SHOW_ONLY_IPV4 must be true or false")
  process.exit(8)
}

PORT = PORT ? +PORT : 3000
if (HOST && HOST !== "localhost") HOST = ipaddr.parse(HOST).toString()
DIR_LISTING = DIR_LISTING !== "false"
SHOW_ONLY_IPV4 = SHOW_ONLY_IPV4 !== "false"

function getPrettyMs(delta) {
  return prettyMs(delta, { compact: true, formatSubMilliseconds: true })
}

const MAX_MAXAGE = ms("1y")

let maxage = OPTIONS.maxAge || OPTIONS.maxage
maxage = typeof maxage === "string" ? getPrettyMs(maxage) : Number(maxage)
maxage = !isNaN(maxage) ? Math.min(Math.max(maxage), MAX_MAXAGE) : 0

const serve = serveStatic(ROOT, OPTIONS)

const hideDotDirs = ["deny", "ignore"].includes(OPTIONS.dotfiles)

let requestId = 0n

const fileTypesOrder = ["dir", "file"]

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
      DIR_LISTING &&
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
        if (OPTIONS.setHeaders) await OPTIONS.setHeaders(res, fullPath, stat)

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
          .sort(
            (a, b) =>
              fileTypesOrder.indexOf(a.type) - fileTypesOrder.indexOf(b.type)
          )

        contents.unshift({
          type: "dir",
          name: "..",
          url: encodeURI(path + slash + ".."),
        })

        const doc = mustache.render(template, { path, contents })

        const etag = etagify(doc)
        const check = {}
        if (OPTIONS.etag !== false) check.etag = etag

        if (fresh(req.headers, check)) {
          res.statusCode = 304
          res.end()
          return
        }

        if (OPTIONS.etag !== false) res.setHeader("etag", etag)

        let cacheControl = "public, max-age=" + Math.floor(maxage / 1000)
        if (OPTIONS.immutable) cacheControl += ", immutable"
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
if (PORT) opts.port = PORT
if (HOST) opts.host = HOST

server.listen(opts, () => {
  let { address, family, port } = server.address()

  if (!family) family = net.isIPv6(address) ? "IPv6" : "IPv4"

  if (runtime && version)
    console.log("using " + runtimeColor(runtime + " " + version))

  const argsAndEnvs = { ROOT, DIR_LISTING, SHOW_ONLY_IPV4, OPTIONS }
  console.log(toDoubleQuotes(inspect(argsAndEnvs, { colors: true })))

  const addresses = []

  function netToURL({ address, family, port }) {
    if (family === "IPv6") return "http://[" + address + "]:" + port
    return "http://" + address + ":" + port
  }

  const isAddressWildcard = address === "0.0.0.0" || address === "::"

  if (isAddressWildcard)
    for (const netList of Object.values(os.networkInterfaces())) {
      for (const net of netList) {
        addresses.push({ address: net.address, family: net.family, port })
      }
    }
  else addresses.push({ address, family, port })

  if (addresses.some((net) => ["127.0.0.1", "::1"].includes(net.address)))
    addresses.unshift({ address: "localhost", family: "IPv4", port })

  const addressesToShow =
    SHOW_ONLY_IPV4 && isAddressWildcard
      ? addresses.filter((net) => net.family === "IPv4")
      : addresses

  console.log("server is listening on:")
  addressesToShow
    .sort((a, b) => a.family.localeCompare(b.family))
    .forEach((net) => console.log("  " + runtimeColor(netToURL(net))))
})

#!/usr/bin/env node

import os from "node:os"
import net from "node:net"
import http from "node:http"
import path from "node:path"
import fs from "node:fs/promises"
import { inspect } from "node:util"
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
import Table from "@rmhaiderali/cli-table"
import replaceQuotes, { double, single, backtick } from "replace-quotes"
import { serveStaticOptionsSchema } from "./schemas.js"

const toDoubleQuotes = replaceQuotes(
  // from
  double,
  single,
  backtick,
  // to
  double,
)

const template = await fs.readFile(
  import.meta.dirname + "/template.mustache",
  "utf8",
)

const ROOT = process.argv[2] || "."
const OPTIONS = { dotfiles: "allow" }
let userOptions = null
let rootStats = null

try {
  rootStats = await fs.stat(ROOT)
} catch (e) {
  console.error("Failed to read ROOT directory: " + ROOT)
  process.exit(1)
}

if (!rootStats.isDirectory()) {
  console.error("Provided ROOT is not a directory")
  process.exit(2)
}

const absRoot = path.resolve(ROOT).replaceAll(path.sep, "/")

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

const PORT = process.env.PORT || "0"
const HOST = process.env.HOST || "localhost"
let DIR_LISTING = process.env.DIR_LISTING

if (!z.number().int().min(0).max(65535).safeParse(Number(PORT)).success) {
  console.error("PORT must be an integer in range 0-65535")
  process.exit(5)
}

if (
  HOST.toLocaleLowerCase() !== "localhost" &&
  !z.union([z.ipv4(), z.ipv6()]).safeParse(HOST).success
) {
  console.error("HOST must be a valid network interface address")
  process.exit(6)
}

if (DIR_LISTING && !z.enum(["true", "false"]).safeParse(DIR_LISTING).success) {
  console.error("DIR_LISTING must be true or false")
  process.exit(7)
}

DIR_LISTING = DIR_LISTING !== "false"

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
      chalk.cyan(req.method + " " + req.url),
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
          "Returned " + res.statusCode + " in " + getPrettyMs(deltaTime / 1e6),
        ),
    )
  })

  serve(req, res, async function (err) {
    const reqPath = decodeURI(req.url).split("?")[0].replace(/\/+/g, "/")

    serve_listing: if (
      DIR_LISTING &&
      !(hideDotDirs && reqPath.indexOf("/.") !== -1)
    ) {
      const fullPath = path.posix.join(absRoot, reqPath)

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

        const slash = reqPath.endsWith("/") ? "" : "/"

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
              url: encodeURI(reqPath + slash + dirent.name),
            }
          }),
        )

        contents = contents
          .sort((a, b) => (a.name > b.name ? 1 : a.name < b.name ? -1 : 0))
          .sort(
            (a, b) =>
              fileTypesOrder.indexOf(a.type) - fileTypesOrder.indexOf(b.type),
          )

        contents.unshift({
          type: "dir",
          name: "..",
          url: encodeURI(reqPath + slash + ".."),
        })

        const doc = mustache.render(template, { path: reqPath, contents })

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

const opts = {
  port: Number(PORT),
  host: HOST === "localhost" ? HOST : ipaddr.parse(HOST).toString(),
}

server.listen(opts, () => {
  let { address, family, port } = server.address()

  if (!family) family = net.isIPv6(address) ? "IPv6" : "IPv4"

  let addresses = []

  function netToURL({ address, family, port }) {
    if (family === "IPv6") return "http://[" + address + "]:" + port
    return "http://" + address + ":" + port
  }

  const ipv4Wildcard = "0.0.0.0"
  const ipv6Wildcard = "::"

  const isAddressWildcard = address === ipv4Wildcard || address === ipv6Wildcard

  if (isAddressWildcard)
    for (const netList of Object.values(os.networkInterfaces())) {
      for (const net of netList)
        if (address === ipv6Wildcard || net.family === "IPv4")
          addresses.push({ address: net.address, family: net.family, port })
    }
  else addresses.push({ address, family, port })

  const boundToLoopback = addresses.some((net) =>
    ["127.0.0.1", "::1"].includes(net.address),
  )

  addresses = addresses.map((net) => netToURL(net)).sort()

  if (boundToLoopback)
    addresses.unshift(netToURL({ address: "localhost", family: "IPv4", port }))

  const table = new Table({})

  if (runtime && version)
    table.push(["Runtime", runtimeColor(runtime + " " + version)])

  table.push(["[ENV] HOST", chalk.yellow(HOST)])

  table.push(["[ENV] PORT", chalk.yellow(port)])

  table.push(["[ENV] DIR_LISTING", chalk.yellow(DIR_LISTING)])

  table.push(["[ARG1] Serve Static Root", chalk.cyan(absRoot)])

  const optionsString = toDoubleQuotes(inspect(OPTIONS, { colors: true }))

  table.push(["[ARG2] Serve Static Options", optionsString])

  console.log(table.toString())

  const table2 = new Table({})

  table2.push(["Listening On Following Addresses"])

  addresses.forEach((addr) => table2.push([runtimeColor(addr)]))

  console.log(table2.toString())
})

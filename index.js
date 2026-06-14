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
import parseurl from "parseurl"
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

const fileIndexTemplate = await fs.readFile(
  import.meta.dirname + "/templates/file-index.mustache",
  "utf8",
)

const wrongBaseTemplate = await fs.readFile(
  import.meta.dirname + "/templates/wrong-base.mustache",
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
const BASE = process.env.BASE?.replace(/[/\\]+/g, "/") || "/"
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

if (!BASE.startsWith("/")) {
  console.error("BASE must start with a slash")
  process.exit(7)
}

if (BASE.length > 1 && BASE.endsWith("/")) {
  console.error("BASE must not end with a slash")
  process.exit(8)
}

const restrictedChar = BASE.match(/[?#]/)

if (restrictedChar) {
  console.error("BASE must not include " + restrictedChar[0] + " character")
  process.exit(9)
}

if (DIR_LISTING && !z.enum(["true", "false"]).safeParse(DIR_LISTING).success) {
  console.error("DIR_LISTING must be true or false")
  process.exit(10)
}

DIR_LISTING = DIR_LISTING !== "false"

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

function safeDecodeURI(uri) {
  try {
    return decodeURI(uri)
  } catch (e) {
    return null
  }
}

function getPrettyMs(delta) {
  return prettyMs(delta, { compact: true, formatSubMilliseconds: true })
}

const MAX_MAXAGE = ms("1y")

let maxage = OPTIONS.maxAge || OPTIONS.maxage
maxage = typeof maxage === "string" ? getPrettyMs(maxage) : Number(maxage)
maxage = !isNaN(maxage) ? Math.min(Math.max(maxage), MAX_MAXAGE) : 0

const redirect = OPTIONS.redirect !== false

let requestId = 0n

const fileTypesOrder = ["dir", "file"]

const hideDotDirs = ["deny", "ignore"].includes(OPTIONS.dotfiles)

const encodedBase = encodeURI(BASE)
const isBaseSkippable = BASE === "/"

const serve = serveStatic(ROOT, OPTIONS)

function sendDoc(req, res, doc) {
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
}

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

  req.originalUrl = req.url
  const reqOriginalPath = safeDecodeURI(parseurl.original(req).pathname)

  if (reqOriginalPath === null) {
    finalhandler(req, res)()
    return
  }

  if (!isBaseSkippable && reqOriginalPath === "/") {
    res.writeHead(302, { Location: encodedBase + (redirect ? "/" : "") })
    return res.end()
  }

  if (!reqOriginalPath.startsWith(BASE)) {
    res.statusCode = 404

    const doc = mustache.render(wrongBaseTemplate, {
      base: BASE,
      path: BASE + reqOriginalPath,
      encodedPath: encodedBase + req.originalUrl,
    })

    sendDoc(req, res, doc)
    return
  }

  const reqPath = path.posix.join("/", reqOriginalPath.slice(BASE.length))
  req.url = encodeURI(reqPath)

  if (!isBaseSkippable) {
    const isBaseExactMatch = reqOriginalPath.length === BASE.length
    const isBaseWithSlashMatch = reqOriginalPath[BASE.length] === "/"

    if (isBaseExactMatch && redirect) {
      res.writeHead(302, { Location: encodedBase + "/" })
      return res.end()
    }

    if (!isBaseExactMatch && !isBaseWithSlashMatch) {
      res.statusCode = 404

      const doc = mustache.render(wrongBaseTemplate, {
        base: BASE,
        path: BASE + reqOriginalPath,
        encodedPath: encodedBase + req.originalUrl,
      })

      sendDoc(req, res, doc)
      return
    }
  }

  serve(req, res, async function (err) {
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

        if (hideDotDirs)
          contents = contents.filter((dirent) => !dirent.name.startsWith("."))

        contents = await Promise.all(
          contents.map(async (dirent) => {
            let type = "file"
            if (dirent.isDirectory()) type = "dir"
            else if (dirent.isSymbolicLink()) {
              try {
                const stat = await fs.stat(path.join(fullPath, dirent.name))
                if (stat.isDirectory()) type = "dir"
              } catch {}
            }

            return {
              type,
              name: dirent.name,
              url: encodeURI(
                path.posix.join(
                  reqOriginalPath,
                  dirent.name,
                  redirect && type === "dir" ? "/" : "",
                ),
              ),
            }
          }),
        )

        contents = contents
          .sort((a, b) => (a.name > b.name ? 1 : a.name < b.name ? -1 : 0))
          .sort(
            (a, b) =>
              fileTypesOrder.indexOf(a.type) - fileTypesOrder.indexOf(b.type),
          )

        const parentPath = path.posix.join(
          "/",
          reqOriginalPath
            .split("/")
            .slice(0, reqOriginalPath.endsWith("/") ? -2 : -1)
            .join("/"),
          redirect ? "/" : "",
        )

        if (reqPath !== "/")
          contents.unshift({
            type: "dir",
            name: "..",
            url: encodeURI(parentPath),
          })

        const doc = mustache.render(fileIndexTemplate, {
          contents,
          path: reqOriginalPath,
        })

        sendDoc(req, res, doc)
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

  function niToURL({ address, family, port, base }) {
    if (family === "IPv6") return "http://[" + address + "]:" + port + base
    return "http://" + address + ":" + port + base
  }

  const ipv4Wildcard = "0.0.0.0"
  const ipv6Wildcard = "::"

  const isAddressWildcard = address === ipv4Wildcard || address === ipv6Wildcard

  const base = BASE === "/" ? "" : encodedBase + (redirect ? "/" : "")

  if (isAddressWildcard)
    for (const ni of Object.values(os.networkInterfaces()).flat()) {
      if (address === ipv6Wildcard || ni.family === "IPv4")
        addresses.push({ address: ni.address, family: ni.family, port, base })
    }
  else addresses.push({ address, family, port, base })

  const boundToLoopback = addresses.some((ni) =>
    ["127.0.0.1", "::1"].includes(ni.address),
  )

  addresses = addresses.map((ni) => niToURL(ni)).sort()

  if (boundToLoopback)
    addresses.unshift(
      niToURL({ address: "localhost", family: "IPv4", port, base }),
    )

  const table = new Table({})

  if (runtime && version)
    table.push(["Runtime", runtimeColor(runtime + " " + version)])

  table.push(["[ENV] HOST", chalk.yellow(HOST)])

  table.push(["[ENV] PORT", chalk.yellow(port)])

  table.push(["[ENV] BASE", chalk.yellow(BASE)])

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

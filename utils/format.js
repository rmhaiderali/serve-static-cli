import util from "node:util"

const single = "'"
const double = "\""
const escape = "\\"
const backtick = String.fromCharCode(96)

const all = [single, double, backtick]

function format(chosen, debug) {
  if (!all.includes(chosen))
    throw new Error(
      "Invalid quote character. Use single quote, double quote, or backtick."
    )

  const others = all.filter((char) => char !== chosen)

  const getLiteralsRegex = new RegExp(
    all
      .map((char) => char + "(?:[^" + char + "\\\\]|\\\\.)*" + char) // to match string literal
      .concat(
        "\\/(?:[^\\/\\\n\\\\]|\\\\.)*\\/", // to match regex literal
        "\\[Function: .*?\\]",
        "\\[class .*?\\]",
        "Symbol\\(.*?\\)"
      )
      .join("|"),
    "gm"
  )

  const getUnescapedChosenRegex = new RegExp("(?<!\\\\)" + chosen, "gm")

  const getEscapedOthersRegexes = {}

  for (const other of others)
    getEscapedOthersRegexes[other] = new RegExp(escape + escape + other, "gm")

  if (debug)
    console.log({
      chosen,
      others,
      getLiteralsRegex,
      getUnescapedChosenRegex,
    })

  return (...args) =>
    util.inspect(...args).replaceAll(getLiteralsRegex, (match) => {
      if (!others.includes(match[0])) return match

      let string =
        chosen +
        match
          .replaceAll(getUnescapedChosenRegex, escape + chosen)
          .slice(1, -1) +
        chosen

      for (const other in getEscapedOthersRegexes)
        string = string.replaceAll(getEscapedOthersRegexes[other], other)

      return string
    })
}

export default format

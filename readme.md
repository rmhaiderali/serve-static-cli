# Usage

Node

```bash
npx github:rmhaiderali/serve-static-cli <root> <port> <listing> <options>
```

Bun

```bash
bunx github:rmhaiderali/serve-static-cli#bun <root> <port> <listing> <options>
```

Deno

```bash
deno -A https://raw.githubusercontent.com/rmhaiderali/serve-static-cli/refs/heads/deno/index.js <root> <port> <listing> <options>
```

Default values

```bash
npx github:rmhaiderali/serve-static-cli . 3000 yes "{}"
```

Disable index

```bash
npx github:rmhaiderali/serve-static-cli . 3000 yes "{index: false}"
```

Set headers

```bash
npx github:rmhaiderali/serve-static-cli . 3000 yes '{setHeaders: (res) => res.setHeader("powered-by", "serve-static-cli")}'
```

| Options | Discription                 | Type                        | Default               |
| ------- | --------------------------- | --------------------------- | --------------------- |
| root    | root directory path         | string                      | "."                   |
| port    | port number to listen on    | number                      | 3000                  |
| listing | display directory content   | enum "yes" "no"             | "yes"                 |
| options | serve-static options object | [`serve-static options`][1] | '{dotfiles: "allow"}' |

[1]: https://expressjs.com/en/5x/api.html#express.static

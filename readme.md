## Usage

Node

```bash
npx github:rmhaiderali/serve-static-cli <root> <options>
```

Bun

```bash
bunx github:rmhaiderali/serve-static-cli#bun <root> <options>
```

Deno

```bash
deno -A https://raw.githubusercontent.com/rmhaiderali/serve-static-cli/refs/heads/deno/index.js <root> <options>
```

Default values

```bash
npx github:rmhaiderali/serve-static-cli . "{}"
```

Disable index

```bash
npx github:rmhaiderali/serve-static-cli . "{index: false}"
```

Set headers

```bash
npx github:rmhaiderali/serve-static-cli . '{setHeaders: (res) => res.setHeader("powered-by", "serve-static-cli")}'
```

## Environment Variables:

| Variable | Purpose                                  |
| -------- | ---------------------------------------- |
| HOST     | Network interface to listen on           |
| PORT     | Port number to listen on                 |
| LISTING  | Display directory content, true or false |

## Arguments:

| Options | Discription                 | Type                        | Default               |
| ------- | --------------------------- | --------------------------- | --------------------- |
| root    | root directory path         | string                      | "."                   |
| options | serve-static options object | [`serve-static options`][1] | '{dotfiles: "allow"}' |

[1]: https://expressjs.com/en/5x/api.html#express.static

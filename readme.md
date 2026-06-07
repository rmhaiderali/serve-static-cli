## Usage

Node

```bash
npx github:rmhaiderali/serve-static-cli <root> <options>
```

Bun

```bash
bunx --bun github:rmhaiderali/serve-static-cli <root> <options>
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

| Variable    | Purpose                                  |
| ----------- | ---------------------------------------- |
| HOST        | Network interface to listen on           |
| PORT        | Port number to listen on                 |
| BASE        | Base path for the served files           |
| DIR_LISTING | Display directory content, true or false |

## Arguments:

| Options | Discription                 | Type                        | Default               |
| ------- | --------------------------- | --------------------------- | --------------------- |
| root    | directory to serve          | string                      | "."                   |
| options | serve-static options object | [`serve-static options`][1] | '{dotfiles: "allow"}' |

[1]: https://expressjs.com/en/resources/middleware/serve-static/#servestaticroot-options

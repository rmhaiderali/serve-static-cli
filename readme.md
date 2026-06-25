## Usage

### Node

```bash
npm x serve-static-files <root> <options>
```

Can also be used with `npx` in place of `npm x`

### Bun

```bash
bun x --bun serve-static-files <root> <options>
```

Can also be used with `bunx` in place of `bun x`

### Deno

```bash
deno x -NESR serve-static-files <root> <options>
```

Can also be used with `dx` in place of `deno x`

### Deno HTTP

```bash
deno x -NESR https://raw.githubusercontent.com/rmhaiderali/serve-static-files/refs/heads/deno/index.js <root> <options>
```

### Default values

```bash
npm x serve-static-files . "{}"
```

### Disable index

```bash
npm x serve-static-files . "{index: false}"
```

### Set headers

```bash
npm x serve-static-files . '{setHeaders: (res) => res.setHeader("powered-by", "serve-static-files")}'
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

## Refresh cached package

### Node (Entire npm cache)

```bash
npm cache clean --force
```

### Bun (Entire bun cache)

```bash
bun pm cache clean
```

### Deno

```bash
deno x -r -NESR serve-static-files
```

### Deno HTTP

```bash
deno x -r -NESR https://raw.githubusercontent.com/rmhaiderali/serve-static-files/refs/heads/deno/index.js <root> <options>
```

## Deno Permissions

When using deno `-NERS` grants minimum required permissions. You can also use `-A` to grant all permissions, but using the least required permissions is recommended to improve security. For more information on Deno permissions, please refer to the [Deno manual](https://docs.deno.com/runtime/reference/permissions/).

## License

MIT

# Usage

```bash
npx github:rmhaiderali/serve-static-cli <root> <port> <listing> <options>
```

Default values

```bash
npx github:rmhaiderali/serve-static-cli . 3000 yes "{}"
```

Disable index

```bash
npx github:rmhaiderali/serve-static-cli . 3000 yes "{index: false}"
```

| Options | Discription                 | Type                        | Default               |
| ------- | --------------------------- | --------------------------- | --------------------- |
| root    | root directory path         | string                      | "."                   |
| port    | port number to listen on    | number                      | 3000                  |
| listing | display directory content   | enum "yes" "no"             | "yes"                 |
| options | serve-static options object | [`serve-static options`][1] | '{dotfiles: "allow"}' |

[1]: https://expressjs.com/en/5x/api.html#express.static

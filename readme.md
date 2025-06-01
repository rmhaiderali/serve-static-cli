# Usage

```bash
npx github:rmhaiderali/serve-static-cli <root> <port> <listing> <options>
npx github:rmhaiderali/serve-static-cli . 3000 yes '{}'
```

| Options | Discription                 | Type                 | Default               |
|---------|-----------------------------|----------------------|-----------------------|
| root    | root directory path         | string               | "."                   |
| port    | port number to listen on    | number               | 3000                  |
| listing | display directory content   | enum "yes" "no"      | "yes"                 |
| options | serve-static options object | serve-static options | '{dotfiles: "allow"}' |

import { z } from "zod"

export const serveStaticOptionsSchema = z
  .object({
    acceptRanges: z.boolean().optional(),
    cacheControl: z.boolean().optional(),
    dotfiles: z.enum(["allow", "deny", "ignore"]).optional(),
    etag: z.boolean().optional(),
    extensions: z
      .union([z.literal(false), z.array(z.string())], {
        error: "Invalid option: expected one of false|string[]",
      })
      .optional(),
    fallthrough: z.boolean().optional(),
    immutable: z.boolean().optional(),
    index: z
      .union([z.literal(false), z.string(), z.array(z.string())], {
        error: "Invalid option: expected one of false|string|string[]",
      })
      .optional(),
    lastModified: z.boolean().optional(),
    maxAge: z
      .union([z.number(), z.string()], {
        error: "Invalid option: expected one of number|string",
      })
      .optional(),
    redirect: z.boolean().optional(),
    setHeaders: z.function().optional(),
  })
  .strict()

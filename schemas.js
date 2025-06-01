import { z } from "npm:zod"

export const serveStaticOptionsSchema = z.object({
  acceptRanges: z.boolean().optional(),
  cacheControl: z.boolean().optional(),
  dotfiles: z.enum(["allow", "deny", "ignore"]).optional(),
  etag: z.boolean().optional(),
  extensions: z.union([z.array(z.string()), z.literal(false)]).optional(),
  fallthrough: z.boolean().optional(),
  immutable: z.boolean().optional(),
  index: z.union([z.boolean(), z.string(), z.array(z.string())]).optional(),
  lastModified: z.boolean().optional(),
  maxAge: z.union([z.number(), z.string()]).optional(),
  redirect: z.boolean().optional(),
  setHeaders: z
    .function()
    .args(z.any(), z.string(), z.any())
    .returns(z.any())
    .optional(),
})

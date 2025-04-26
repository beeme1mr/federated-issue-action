import { z } from "zod";

export const configSchema = z.object({
  allowed: z.object({
    users: z.array(z.string()).default([]),
    teams: z.array(z.string()).default([]),
  }).default({}),
});

export type Config = z.infer<typeof configSchema>;
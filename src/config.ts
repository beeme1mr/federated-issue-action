import { z } from "zod";

const targetRepositorySelectors = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("name-pattern"),
    identifier: z.string(),
    patternType: z.enum(['starts-with', 'contains', 'ends-with']).default('contains'),
  }),
  z.object({
    method: z.literal("explicit"),
    repositories: z.array(z.string()),
  }),
])

export const configSchema = z.object({
  allowed: z.object({
    users: z.array(z.string()).default([]),
    teams: z.array(z.string()).default([]),
  }).default({}).describe('List of users and teams allowed to create parent issues'),

  targetRepositorySelectors: z.array(targetRepositorySelectors).default([]).describe('List of selectors for target repositories where the child issue will be created'),
});

export type Config = z.infer<typeof configSchema>;
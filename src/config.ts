import { z } from "zod";

const targetRepositorySelectors = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("name-pattern").describe('Match repositories by name pattern'),
    identifier: z.string().describe('Identifier fragment of the repository name to match, e.g. "sdk"'),
    patternType: z.enum(['starts-with', 'contains', 'ends-with']).default('contains').describe('Type of pattern matching to use'),
  }),
  z.object({
    method: z.literal("explicit").describe('Explicitly list repositories'),
    repositories: z.array(z.string()).describe('List of repositories to match, e.g. "dotnet-sdk"'),
  }),
])

export const configSchema = z.object({
  allowed: z.object({
    users: z.array(z.string()).default([]),
    teams: z.array(z.string()).default([]),
  }).default({}).describe('List of users and teams allowed to create parent issues'),

  targetRepositorySelectors: z.array(targetRepositorySelectors).default([]).describe('List of selectors for target repositories where the child issue will be created'),

  issueTemplate: z.object({
    // title: z.string().describe('Title of the child issue'),
    // body: z.string().describe('Body content of the child issue'),
    labels: z.array(z.string()).default([]).describe('Labels to apply to the child issue'),
  }).describe('Template for creating child issues'),
});

export type Config = z.infer<typeof configSchema>;
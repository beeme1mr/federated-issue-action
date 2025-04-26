import type { getOctokit } from '@actions/github';

export type Octokit = ReturnType<typeof getOctokit>;

/**
 * GitHub repository reference
 */
export interface Repository {
  /** Owner/organization name */
  owner: string;
  /** Repository name */
  name: string;
  /** Node ID of the repository */
  nodeId?: string;
}
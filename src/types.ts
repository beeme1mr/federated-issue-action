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

/**
 * GitHub issue reference
 */
export interface IssueReference {
  /** Repository owner */
  owner: string;
  /** Repository name */
  repo: string;
  /** Issue number */
  number: number;
  /** Issue title */
  title?: string;
  /** Issue body content */
  body?: string;
  /** Issue labels */
  labels?: string[];
  /** Node ID of the issue */
  nodeId?: string;
}

/**
 * GitHub issue details
 */
export interface IssueDetails {
  /** Issue title */
  title: string;
  /** Issue body content */
  body: string;
  /** Issue labels */
  labels: string[];
}

/**
 * GraphQL query response for issue node ID
 */
export interface IssueIdResponse {
  repository: {
    issue: {
      id: string;
      [key: string]: any;
    };
  };
}

/**
 * GraphQL query response for sub-items
 */
export interface SubItemsResponse {
  repository: {
    issue: {
      trackedInIssues: {
        nodes: Array<{
          repository: {
            name: string;
          };
          number: number;
          [key: string]: any;
        }>;
      };
    };
  };
}
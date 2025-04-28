import { Config } from './config';
import { Octokit, Repository } from './types';

/**
 * Discovers repositories where child issues will be created based on configured selectors
 */
export async function discoverRepositories(
  client: Octokit,
  config: Config,
  owner: string
): Promise<Repository[]> {
  const repoMap = new Map<string, Repository>();
  
  // Process each repository selector
  for (const selector of config.targetRepositorySelectors) {
    const repos = await getRepositoriesForSelector(client, selector, owner);
    
    // Add to map using repo name as key to avoid duplicates
    for (const repo of repos) {
      repoMap.set(repo.name, repo);
    }
  }
  
  return Array.from(repoMap.values());
}

/**
 * Gets repositories for a single selector
 */
async function getRepositoriesForSelector(
  client: Octokit,
  selector: Config["targetRepositorySelectors"][number],
  owner: string
): Promise<Repository[]> {
  switch (selector.method) {
    case 'name-pattern':
      return await discoverByNamePattern(
        client,
        owner,
        selector.operator,
        selector.pattern
      );
    case 'explicit':
      return getExplicitRepositories(owner, selector.repositories || []);
    default:
      throw new Error(`Unsupported selector type: ${(selector as any).type}`);
  }
}

/**
 * Discovers repositories by name pattern matching with different pattern types
 */
async function discoverByNamePattern(
  client: Octokit,
  owner: string,
  operator: "starts-with" | "contains" | "ends-with",
  pattern: string
): Promise<Repository[]> {
  const repos: Repository[] = [];

  // Get all repositories in the organization
  const repositories = await client.paginate(client.rest.repos.listForOrg, {
    org: owner,
    per_page: 100,
  });

  for (const repo of repositories) {
    let isMatch = false;

    switch (operator) {
      case "starts-with":
        isMatch = repo.name.startsWith(pattern);
        break;
      case "contains":
        isMatch = repo.name.includes(pattern);
        break;
      case "ends-with":
        isMatch = repo.name.endsWith(pattern);
        break;
      default:
        isMatch = repo.name.includes(pattern); // Default to 'contains'
    }

    if (isMatch) {
      repos.push({
        owner,
        name: repo.name,
        nodeId: repo.node_id,
      });
    }
  }

  return repos;
}

/**
 * Creates repository objects from an explicit list of repository names
 * 
 * @param owner Organization owner name
 * @param repoNames Array of repository names
 * @returns Array of repository objects
 */
function getExplicitRepositories(owner: string, repoNames: string[]): Repository[] {
  return repoNames.map(name => ({
    owner,
    name
  }));
}
import { IssueDetails, IssueReference, Octokit, Repository } from "./types";

/**
 * Gets the node ID of an issue (for GraphQL operations)
 */
export async function getIssueNodeId(
  client: Octokit,
  owner: string,
  repo: string,
  issueNumber: number
): Promise<string> {
  const query = `
    query GetIssueId($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) {
          id
        }
      }
    }
  `;
  
  const response: any = await client.graphql(query, {
    owner,
    repo,
    number: issueNumber
  });
  
  return response.repository.issue.id;
}

/**
 * Creates a child issue in a target repository
 */
export async function createChildIssue(
  client: Octokit,
  parentIssue: IssueDetails,
  targetRepo: Repository,
): Promise<IssueReference> {
  // Create the child issue
  const childIssueResponse = await client.rest.issues.create({
    owner: targetRepo.owner,
    repo: targetRepo.name,
    title: "This is a child issue",
    body: parentIssue.implementationDetails || 'See parent issue for details',
    // labels: ['cross-sdk', determineIssueType(parentIssue.title)]
  });
  
  return {
    owner: targetRepo.owner,
    repo: targetRepo.name,
    number: childIssueResponse.data.number,
    nodeId: childIssueResponse.data.node_id
  };
}

/**
 * Links a child issue to a parent issue using the GitHub GraphQL API
 */
export async function linkIssueAsSubItem(
  client: Octokit,
  parentNodeId: string,
  childNodeId: string
): Promise<unknown> {
  // Validate parameters to prevent GraphQL errors
  if (!parentNodeId || typeof parentNodeId !== 'string') {
    throw new Error(`Invalid parent issue ID: ${parentNodeId}`);
  }
  
  if (!childNodeId || typeof childNodeId !== 'string') {
    throw new Error(`Invalid child issue ID: ${childNodeId}`);
  }
  
  const mutation = `
    mutation AddSubIssue($parentId: ID!, $childId: ID!) {
      addSubIssue(input: {
        issueId: $parentId,
        subIssueId: $childId
      }) {
        clientMutationId
      }
    }
  `;
  
  console.log(`Linking issues with parent ID: ${parentNodeId} and child ID: ${childNodeId}`);
  
  return await client.graphql(mutation, {
    parentId: parentNodeId,
    childId: childNodeId,
    headers: {
      "GraphQL-Features": "sub_issues"
    }
  });
}

/**
 * Gets all child issues linked to a parent issue
 */
export async function getChildIssues(
  client: Octokit,
  parentNodeId: string,
): Promise<IssueReference[]> {
  // Validate the parameter
  if (!parentNodeId || typeof parentNodeId !== 'string') {
    throw new Error(`Invalid parent issue ID: ${parentNodeId}`);
  }

  const query = `
    query SubIssues($parentId: ID!) {
      node(id: $parentId) {
        ... on Issue {
          subIssues(first: 50) {
            nodes {
              repository {
                name
                owner {
                  login
                }
              }
              number
              id
            }
          }
        }
      }
    }
  `;
  
  const response: any = await client.graphql(query, {
    parentId: parentNodeId,
    headers: {
      "GraphQL-Features": "sub_issues"
    }
  });
  
  const childIssues: IssueReference[] = [];
  
  for (const node of response.repository.issue.trackedInIssues.nodes) {
    childIssues.push({
      owner: node.repository.owner.login,
      repo: node.repository.name,
      number: node.number,
      nodeId: node.id
    });
  }
  
  return childIssues;
}

/**
 * Updates a child issue with new content from the parent issue
 */
export async function updateChildIssue(
  client: Octokit,
  childIssue: IssueReference,
  parentIssue: IssueDetails,
): Promise<unknown> {
  return await client.rest.issues.update({
    owner: childIssue.owner,
    repo: childIssue.repo,
    issue_number: childIssue.number,
    title: "This is a child issue",
    body: parentIssue.implementationDetails || 'See parent issue for details',
  });
}

/**
 * Updates the status (open/closed) of a child issue
 */
export async function updateChildIssueStatus(
  client: Octokit,
  childIssue: IssueReference,
  isOpen: boolean
): Promise<unknown> {
  return await client.rest.issues.update({
    owner: childIssue.owner,
    repo: childIssue.repo,
    issue_number: childIssue.number,
    state: isOpen ? 'open' : 'closed'
  });
}

import * as core from '@actions/core';
import { getOctokit, context } from '@actions/github';
import { Config, configSchema } from './config';
import { discoverRepositories } from './repo-discovery';

type Octokit = ReturnType<typeof getOctokit>;

/**
 * Main entry point for the SDK issue synchronization action
 */
async function run(): Promise<void> {
  try {
    // Get inputs
    const token = core.getInput('github-token', { required: true });
    const configPath = core.getInput('config-path') || '.github/federated-issue-action-config.json';
    const requiredLabel = core.getInput('required-label') || 'federated';

    // Initialize GitHub client
    const octokit = getOctokit(token);
    
    // Get current repo and context
    const repo = context.repo.repo;
    const owner = context.repo.owner;
    const action = context.payload.action as 'opened' | 'edited' | 'closed' | 'reopened';
    const issueNumber = context.payload.issue?.number;
    
    // Skip non-issue events or issues without the required label
    if (!context.payload.issue || !issueNumber) {
      core.info('Not an issue event, skipping');
      return;
    }
    
    const issue = context.payload.issue;
    const hasParentLabel = issue.labels.some((label: { name: string }) => label.name === requiredLabel);
    
    if (!hasParentLabel) {
      core.info(`Issue does not have ${requiredLabel} label, skipping`);
      return;
    }
    
    const config = await getConfig(octokit, owner, repo, configPath);
    
    console.log('Loaded configuration:', config)

    const hasPermission = await validatePermission(
      octokit,
      config,
      owner,
      issue.user.login
    );

    if (!hasPermission) {
      core.warning(`User ${issue.user.login} does not have permission to create SDK parent issues`);
      await addNoPermissionComment(octokit, owner, repo, issueNumber);
      return;
    }

    const repos = await discoverRepositories(octokit, config, owner);

    console.log('Discovered repositories:', repos);
    if (repos.length === 0) {
      core.warning('No target repositories found for creating child issues');
      return;
    }

  // const { client, repo, action, issueNumber } = context;
  // const { name: repoName } = repo;
  
  // Extract issue details
  const issueDetails = {
    title: issue.title,
    body: issue.body || '',
    labels: issue.labels?.map((label: any) => label.name) || [],
    isOpen: issue.state === 'open',

  }
  
  switch (action) {
    case 'opened':
      console.log('Issue opened:', issueDetails);
      break;
      
    case 'edited':
      console.log('Issue edited:', issueDetails);
      break;
      
    case 'closed':
    case 'reopened':
      console.log('Issue closed/reopened:', issueDetails);
      break;
      
    default:
      core.info(`Action ${action} not handled`);
  }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    core.setFailed(`Action failed: ${errorMessage}`);
  }
}

/**
 * Gets the action configuration from the repository
 */
async function getConfig(
  octokit: Octokit,
  owner: string,
  repo: string,
  configPath: string
) {
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: configPath,
      ref: context.ref
    });
    
    if("content" in response.data) {
      const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
      return configSchema.parse(JSON.parse(content));
   }
   throw new Error('Configuration file not found or invalid');
  } catch (error) {
    throw new Error(`Failed to load configuration from ${configPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Validates if a user has permission to create parent issues
 */
async function validatePermission(
  client: Octokit,
  config: Config,
  owner: string,
  username: string
): Promise<boolean> {
  // Check if user owns the repo
  if (owner === username) {
    return true;
  }

  // Check if user is in the allowed users list
  if (config.allowed.users.includes(username)) {
    return true;
  }

  // Check team memberships
  for (const team of config.allowed.teams) {
    try {
      // Extract team name from team slug (which might include org name)
      const teamSlug = team.includes('/') ? team.split('/')[1] : team;
      const teamOrg = team.includes('/') ? team.split('/')[0] : context.repo.owner;
      
      const response = await client.rest.teams.getMembershipForUserInOrg({
        org: teamOrg,
        team_slug: teamSlug,
        username
      });
      
      // If the API doesn't throw and returns active state, user is a member
      if (response.status === 200 && response.data.state === 'active') {
        return true;
      }
    } catch (error) {
      // Ignore errors, just continue checking other teams
      continue;
    }
  }
  
  return false;
}

/**
 * Adds a comment to an issue indicating lack of permission
 */
async function addNoPermissionComment(
  client: Octokit,
  owner: string,
  repo: string,
  issueNumber: number
) {
  return await client.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: "⚠️ No permissions ⚠️\nYou don't have permission to create parent issues.",
  });
}

run();
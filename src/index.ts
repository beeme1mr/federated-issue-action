import * as core from '@actions/core';
import { getOctokit, context } from '@actions/github';
import { Config, configSchema } from './config';
import { discoverRepositories } from './repo-discovery';
import { IssueDetails, Repository } from './types';
import { createChildIssue, getChildIssues, getIssueNodeId, linkIssueAsSubItem, updateChildIssue, updateChildIssueStatus } from './issue-operations';

type Octokit = ReturnType<typeof getOctokit>;

async function run(): Promise<void> {
  try {
    const token = core.getInput('github-token', { required: true });
    const configPath = core.getInput('config-path') || '.github/federated-issue-action-config.json';
    const requiredLabel = core.getInput('required-label') || 'federated';
    const notifyMissingPermissions = core.getBooleanInput('notify-missing-permissions')
    const closeIssuesOnParentClose = core.getBooleanInput('close-issues-on-parent-close');

    const octokit = getOctokit(token);

    // Get current repo and context
    const repo = context.repo.repo;
    const owner = context.repo.owner;
    const action = context.payload.action as 'edited' | 'closed' | 'labeled' | 'unlabeled';
    const issueNumber = context.payload.issue?.number;

    // Skip non-issue events or issues without the required label
    if (!context.payload.issue || !issueNumber) {
      core.debug('Not an issue event, skipping');
      return;
    }

    const issue = context.payload.issue;
    const hasParentLabel = issue.labels.some((label: { name: string }) => label.name === requiredLabel);

    if (!hasParentLabel) {
      core.info(`Issue does not have ${requiredLabel} label, skipping`);
      return;
    }

    const config = await getConfig(octokit, owner, repo, configPath);

    const hasPermission = await validatePermission(
      octokit,
      config,
      owner,
      issue.user.login
    );

    if (!hasPermission) {
      core.warning(`User ${issue.user.login} does not have permission to create SDK parent issues`);
      if (notifyMissingPermissions) {
        core.debug('Notifying user about missing permissions');
        await addNoPermissionComment(octokit, owner, repo, issueNumber);
      } else {
        core.debug('Skipping notification about missing permissions');
      }
      return;
    }

    const repos = await discoverRepositories(octokit, config, owner);

    console.log('Discovered repositories:', repos);
    if (repos.length === 0) {
      core.warning('No target repositories found for creating child issues');
      return;
    }

    // Extract issue details
    const issueDetails = {
      title: issue.title,
      body: issue.body || '',
      labels: issue.labels?.map((label: any) => label.name) || [],
      isOpen: issue.state === 'open',
    }

    const parentIssueNodeId = await getIssueNodeId(octokit, owner, repo, issueNumber);
    core.debug(`Parent issue node ID: ${parentIssueNodeId}`);

    switch (action) {
      case 'labeled':
        handleIssueOpened(octokit, parentIssueNodeId, issueDetails, repos);
        break;

      case 'edited':
        handleIssueEdited(octokit, parentIssueNodeId, issueDetails);
        break;

      case 'closed':
        if (closeIssuesOnParentClose) {
          core.debug('Closing child issues on parent issue close');
          handleIssueStatusChanged(octokit, parentIssueNodeId);
        } else {
          core.debug('Not closing child issues on parent issue close');
        }
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

    if ("content" in response.data) {
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
      const teamOrg = team.includes('/') ? team.split('/')[0] : owner;

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

async function handleIssueOpened(
  client: Octokit,
  parentIssueNodeId: string,
  issueDetails: IssueDetails,
  childRepos: Repository[]
): Promise<void> {
  core.debug(`Parent issue node ID: ${parentIssueNodeId}`);

  for (const repo of childRepos) {
    try {
      core.debug(`Creating child issue in ${repo.name}`);

      const childIssue = await createChildIssue(
        client,
        issueDetails,
        repo,
      );

      // Get the child issue node ID for linking
      const childNodeId = childIssue.nodeId ||
        await getIssueNodeId(client, childIssue.owner, childIssue.repo, childIssue.number);

      // Link child issue as sub-item of parent
      await linkIssueAsSubItem(client, parentIssueNodeId, childNodeId);

      core.info(`Created and linked child issue ${repo.name}#${childIssue.number}`);
    } catch (error) {
      core.error(`Failed to create child issue in ${repo.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

/**
 * Handles the 'edited' event by updating child issues
 */
async function handleIssueEdited(
  client: Octokit,
  parentIssueNodeId: string,
  issueDetails: IssueDetails,
): Promise<void> {
  const childIssues = await getChildIssues(client, parentIssueNodeId);
  core.debug(`Found ${childIssues.length} child issues`);

  for (const childIssue of childIssues) {
    try {
      core.debug(`Updating child issue ${childIssue.repo}#${childIssue.number}`);

      await updateChildIssue(
        client,
        childIssue,
        issueDetails,
      );

      core.info(`Updated child issue ${childIssue.repo}#${childIssue.number}`);
    } catch (error) {
      core.warning(`Failed to update child issue ${childIssue.repo}#${childIssue.number}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

/**
 * Handles the 'closed' or 'reopened' events by updating child issue statuses
 */
async function handleIssueStatusChanged(
  client: Octokit,
  parentIssueNodeId: string,
): Promise<void> {
  const childIssues = await getChildIssues(client, parentIssueNodeId);
  core.debug(`Found ${childIssues.length} child issues`);

  for (const childIssue of childIssues) {
    try {
      core.debug(`Updating status of child issue ${childIssue.repo}#${childIssue.number} to closed`);

      await updateChildIssueStatus(client, childIssue, false);

      core.info(`Updated status of child issue ${childIssue.repo}#${childIssue.number}`);
    } catch (error) {
      core.warning(`Failed to update status of child issue ${childIssue.repo}#${childIssue.number}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

run();
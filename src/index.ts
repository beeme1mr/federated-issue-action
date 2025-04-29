import * as core from '@actions/core';
import { context, getOctokit } from '@actions/github';
import { Config, configSchema } from './config';
import { createChildIssue, getChildIssues, getIssueNodeId, linkIssueAsSubItem, updateChildIssue, updateChildIssueStatus } from './issue-operations';
import { discoverRepositories } from './repo-discovery';
import { IssueDetails, Repository, Settings } from "./types";
import { validatePermission } from "./permissions";

type Octokit = ReturnType<typeof getOctokit>;

export async function runActionLogic(
  octokit: Octokit,
  actionContext: typeof context,
  settings: Settings
): Promise<void> {
  const repo = actionContext.repo.repo;
  const owner = actionContext.repo.owner;
  const action = actionContext.payload.action as
    | "edited"
    | "closed"
    | "labeled"
    | "unlabeled";
  const issueNumber = actionContext.payload.issue?.number;

  // Skip non-issue events or issues without the required label
  if (!actionContext.payload.issue || !issueNumber) {
    core.debug("Not an issue event, skipping");
    return;
  }

  const issue = actionContext.payload.issue;
  const hasParentLabel = issue.labels.some(
    (label: { name: string }) => label.name === settings.requiredLabel
  );

  if (!hasParentLabel) {
    core.info(`Issue does not have ${settings.requiredLabel} label, skipping`);
    return;
  }

  const config = await getConfig(
    octokit,
    owner,
    repo,
    settings.configPath,
    actionContext.ref
  );

  const hasPermission = await validatePermission(
    octokit,
    config,
    owner,
    issue.user.login
  );

  if (!hasPermission) {
    core.warning(
      `User ${issue.user.login} does not have permission to create SDK parent issues`
    );
    if (settings.notifyMissingPermissions) {
      core.debug("Notifying user about missing permissions");
      await addNoPermissionComment(octokit, owner, repo, issueNumber);
    } else {
      core.debug("Skipping notification about missing permissions");
    }
    return;
  }

  const repos = await discoverRepositories(octokit, config, owner);

  if (repos.length === 0) {
    core.warning("No target repositories found for creating child issues");
    return;
  }

  const parentIssueNodeId = await getIssueNodeId(
    octokit,
    owner,
    repo,
    issueNumber
  );
  core.debug(`Parent issue node ID: ${parentIssueNodeId}`);

  // Interpolate title and body templates (basic example, might need more robust templating)
  const childIssueDetails = {
    title: settings.childIssueTitleTemplate.replace(
      "${{ github.event.issue.title }}",
      issue.title
    ),
    body: settings.childIssueBodyTemplate.replace(
      "${{ github.event.issue.body }}",
      issue.body || ""
    ),
    // TODO support custom labels - core.getInput('child-issue-labels')
    labels: [],
  } satisfies IssueDetails;

  switch (action) {
    case "labeled":
      await handleIssueOpened(
        octokit,
        parentIssueNodeId,
        childIssueDetails,
        repos
      );
      break;

    case "edited":
      await handleIssueEdited(octokit, parentIssueNodeId, childIssueDetails, repos);
      break;

    case "closed":
      if (settings.closeIssuesOnParentClose) {
        core.debug("Closing child issues on parent issue close");
        await handleIssueStatusChanged(octokit, parentIssueNodeId, repos);
      } else {
        core.debug("Not closing child issues on parent issue close");
      }
      break;

    default:
      core.info(`Action ${action} not handled`);
  }
}

/**
 * Gets the action configuration from the repository
 */
export async function getConfig(
  octokit: Octokit,
  owner: string,
  repo: string,
  configPath: string,
  ref: string
): Promise<Config> {
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: configPath,
      ref,
    });

    if ("content" in response.data) {
      const content = Buffer.from(response.data.content, "base64").toString(
        "utf-8"
      );
      return configSchema.parse(JSON.parse(content));
    }
    throw new Error("Configuration file not found or invalid");
  } catch (error) {
    throw new Error(
      `Failed to load configuration from ${configPath}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Adds a comment to an issue indicating lack of permission
 */
async function addNoPermissionComment(
  client: Octokit,
  owner: string,
  repo: string,
  issueNumber: number
): Promise<void> {
  // Return void for consistency
  await client.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: "⚠️ No permissions ⚠️\nYou don't have permission to create parent issues.",
  });
}

async function handleIssueOpened(
  client: Octokit,
  parentIssueNodeId: string,
  childIssueDetails: IssueDetails,
  childRepos: Repository[]
): Promise<void> {
  for (const repo of childRepos) {
    try {
      core.debug(`Creating child issue in ${repo.name}`);

      const childIssue = await createChildIssue(
        client,
        childIssueDetails,
        repo
      );

      // Get the child issue node ID for linking
      const childNodeId =
        childIssue.nodeId ||
        (await getIssueNodeId(
          client,
          childIssue.owner,
          childIssue.repo,
          childIssue.number
        ));

      // Link child issue as sub-item of parent
      await linkIssueAsSubItem(client, parentIssueNodeId, childNodeId);

      core.info(
        `Created and linked child issue ${repo.name}#${childIssue.number}`
      );
    } catch (error) {
      core.error(
        `Failed to create child issue in ${repo.name}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }
}

/**
 * Handles the 'edited' event by updating child issues
 */
async function handleIssueEdited(
  client: Octokit,
  parentIssueNodeId: string,
  childIssueDetails: IssueDetails,
  targetRepos: Repository[]
): Promise<void> {
  const allChildIssues = await getChildIssues(client, parentIssueNodeId);
  core.debug(`Found ${allChildIssues.length} linked child issues`);

  // Filter child issues to only include those in target repositories
  const targetRepoNames = new Set(targetRepos.map(repo => repo.name));
  const childIssuesToUpdate = allChildIssues.filter(child => targetRepoNames.has(child.repo));
  core.debug(`Found ${childIssuesToUpdate.length} child issues in target repositories`);

  for (const childIssue of childIssuesToUpdate) {
    try {
      core.debug(
        `Updating child issue ${childIssue.repo}#${childIssue.number}`
      );

      await updateChildIssue(client, childIssue, childIssueDetails);

      core.info(`Updated child issue ${childIssue.repo}#${childIssue.number}`);
    } catch (error) {
      core.warning(
        `Failed to update child issue ${childIssue.repo}#${
          childIssue.number
        }: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
}

/**
 * Handles the 'closed' or 'reopened' events by updating child issue statuses
 */
async function handleIssueStatusChanged(
  client: Octokit,
  parentIssueNodeId: string,
  targetRepos: Repository[]
): Promise<void> {
  const allChildIssues = await getChildIssues(client, parentIssueNodeId);
  core.debug(`Found ${allChildIssues.length} linked child issues`);

  // Filter child issues to only include those in target repositories
  const targetRepoNames = new Set(targetRepos.map(repo => repo.name));
  const childIssuesToUpdate = allChildIssues.filter(child => targetRepoNames.has(child.repo));
  core.debug(`Found ${childIssuesToUpdate.length} child issues in target repositories`);

  for (const childIssue of childIssuesToUpdate) {
    try {
      core.debug(
        `Updating status of child issue ${childIssue.repo}#${childIssue.number} to closed`
      );

      await updateChildIssueStatus(client, childIssue, false);

      core.info(
        `Updated status of child issue ${childIssue.repo}#${childIssue.number}`
      );
    } catch (error) {
      core.warning(
        `Failed to update status of child issue ${childIssue.repo}#${
          childIssue.number
        }: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
}

// Main execution wrapper
async function run(): Promise<void> {
  try {
    const token = core.getInput("github-token", { required: true });
    const settings = {
      configPath:
        core.getInput("config-path") ||
        ".github/federated-issue-action-config.json",
      requiredLabel: core.getInput("required-label") || "federated",
      notifyMissingPermissions: core.getBooleanInput(
        "notify-missing-permissions"
      ),
      closeIssuesOnParentClose: core.getBooleanInput(
        "close-issues-on-parent-close"
      ),
      childIssueTitleTemplate:
        core.getInput("child-issue-title") || "${{ github.event.issue.title }}",
      childIssueBodyTemplate:
        core.getInput("child-issue-body") || "${{ github.event.issue.body }}",
    } satisfies Settings;

    const octokit = getOctokit(token);

    await runActionLogic(octokit, context, settings);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    core.setFailed(`Action failed: ${errorMessage}`);
  }
}

// Only run if not in test environment
if (process.env.JEST_WORKER_ID === undefined) {
  run();
}
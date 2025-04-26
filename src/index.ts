import * as core from '@actions/core';
import * as github from '@actions/github';
import { configSchema } from './config';

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
    const octokit = github.getOctokit(token);
    
    // Get current repo and context
    const repo = github.context.repo.repo;
    const action = github.context.payload.action as 'opened' | 'edited' | 'closed' | 'reopened';
    const issueNumber = github.context.payload.issue?.number;
    
    // Skip non-issue events or issues without the required label
    if (!github.context.payload.issue || !issueNumber) {
      core.info('Not an issue event, skipping');
      return;
    }
    
    const issue = github.context.payload.issue;
    const hasParentLabel = issue.labels.some((label: { name: string }) => label.name === requiredLabel);
    
    if (!hasParentLabel) {
      core.info(`Issue does not have ${requiredLabel} label, skipping`);
      return;
    }
    
    const config = await getConfig(octokit, repo, configPath);
    
    console.log('Loaded configuration:', config)

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    core.setFailed(`Action failed: ${errorMessage}`);
  }
}

/**
 * Gets the action configuration from the repository
 * 
 * @param octokit GitHub API client
 * @param repo Repository name
 * @param configPath Path to the configuration file
 * @returns The loaded configuration object
 */
async function getConfig(
  octokit: any,
  repo: string,
  configPath: string
) {
  try {
    const response = await octokit.rest.repos.getContent({
      owner: github.context.repo.owner,
      repo,
      path: configPath,
      ref: github.context.ref
    });
    
    if("content" in response.data) {
      console.log('Configuration file found:', response.data);
      const content = Buffer.from(response.data.content, 'base64').toString('utf-8');

      return configSchema.parse(JSON.parse(content));
   }
   throw new Error('Configuration file not found or invalid');
  } catch (error) {
    throw new Error(`Failed to load configuration from ${configPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

run();
import { getOctokit } from '@actions/github';
import { Config } from './config';

type Octokit = ReturnType<typeof getOctokit>;

/**
 * Validates if the user triggering the action has permission based on the config
 */
export async function validatePermission(
  client: Octokit,
  config: Config,
  owner: string,
  username: string
): Promise<boolean> {
  // If no allowed users or teams are specified, everyone has permission
  if (!config.allowed || (!config.allowed.users?.length && !config.allowed.teams?.length)) {
    return true;
  }

  // Check if the user is explicitly allowed
  if (config.allowed.users?.includes(username)) {
    return true;
  }

  // Check if the user is a member of any allowed teams
  if (config.allowed.teams?.length) {
    for (const teamSlug of config.allowed.teams) {
      try {
        // Handle potential org/team-slug format
        const [org, team_slug] = teamSlug.includes('/') ? teamSlug.split('/') : [owner, teamSlug];

        const response = await client.rest.teams.getMembershipForUserInOrg({
          org,
          team_slug,
          username,
        });

        // If the user is an active member, they have permission
        if (response.data.state === 'active') {
          return true;
        }
      } catch (error: any) {
        // Handle 404 Not Found specifically - user is not in the team
        if (error.status !== 404) {
          console.warn(`Error checking team membership for ${username} in ${teamSlug}: ${error.message}`);
        }
        // Continue checking other teams
      }
    }
  }

  // If no checks passed, the user does not have permission
  return false;
}

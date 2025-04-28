import { validatePermission } from '../permissions';
import { Config } from '../config';

// Mock Octokit client
const mockOctokit = {
  rest: {
    teams: {
      getMembershipForUserInOrg: jest.fn(),
    },
  },
} as any;

describe('validatePermission', () => {
  const owner = 'test-owner';
  const username = 'test-user';

  beforeEach(() => {
    // Reset mocks before each test
    mockOctokit.rest.teams.getMembershipForUserInOrg.mockReset();
  });

  it('should return true if no allowed users or teams are specified', async () => {
    const config: Config = { allowed: { users: [], teams: [] }, targetRepositorySelectors: [] };
    const result = await validatePermission(mockOctokit, config, owner, username);
    expect(result).toBe(true);
  });

  it('should return true if the user is in the allowed users list', async () => {
    const config: Config = {
      allowed: { users: ['test-user', 'another-user'], teams: [] },
      targetRepositorySelectors: [],
    };
    const result = await validatePermission(mockOctokit, config, owner, username);
    expect(result).toBe(true);
  });

  it('should return true if the user is in an allowed team', async () => {
    const config: Config = {
      allowed: { users: [], teams: ['test-team'] },
      targetRepositorySelectors: [],
    };
    mockOctokit.rest.teams.getMembershipForUserInOrg.mockResolvedValue({ data: { state: 'active' } });
    const result = await validatePermission(mockOctokit, config, owner, username);
    expect(result).toBe(true);
    expect(mockOctokit.rest.teams.getMembershipForUserInOrg).toHaveBeenCalledWith({
      org: owner,
      team_slug: 'test-team',
      username,
    });
  });

  it('should return true if the user is in an allowed team with org prefix', async () => {
    const config: Config = {
      allowed: { users: [], teams: ['other-org/test-team'] },
      targetRepositorySelectors: [],
    };
    mockOctokit.rest.teams.getMembershipForUserInOrg.mockResolvedValue({ data: { state: 'active' } });
    const result = await validatePermission(mockOctokit, config, owner, username);
    expect(result).toBe(true);
    expect(mockOctokit.rest.teams.getMembershipForUserInOrg).toHaveBeenCalledWith({
      org: 'other-org',
      team_slug: 'test-team',
      username,
    });
  });

  it('should return false if the user is not allowed', async () => {
    const config: Config = {
      allowed: { users: ['another-user'], teams: ['test-team'] },
      targetRepositorySelectors: [],
    };
    // Mock the API call to return a 404 error (user not found in team)
    mockOctokit.rest.teams.getMembershipForUserInOrg.mockRejectedValue({ status: 404 });
    const result = await validatePermission(mockOctokit, config, owner, username);
    expect(result).toBe(false);
  });

  it('should return false if the user is pending in an allowed team', async () => {
    const config: Config = {
      allowed: { users: [], teams: ['test-team'] },
      targetRepositorySelectors: [],
    };
    mockOctokit.rest.teams.getMembershipForUserInOrg.mockResolvedValue({ data: { state: 'pending' } });
    const result = await validatePermission(mockOctokit, config, owner, username);
    expect(result).toBe(false);
  });

  it('should handle API errors gracefully and return false', async () => {
    const config: Config = {
      allowed: { users: [], teams: ['test-team'] },
      targetRepositorySelectors: [],
    };
    mockOctokit.rest.teams.getMembershipForUserInOrg.mockRejectedValue(new Error('API Error'));
    const result = await validatePermission(mockOctokit, config, owner, username);
    expect(result).toBe(false);
  });
});

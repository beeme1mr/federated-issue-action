import { discoverRepositories } from "../repo-discovery";
import { Config } from "../config";
import { Octokit } from "../types";

describe("repo-discovery", () => {
  const mockOctokit = {
    rest: {
      repos: {
        listForOrg: jest.fn(),
      },
    },
    paginate: jest.fn(),
  } as unknown as Octokit & { paginate: jest.Mock };

  beforeEach(() => {
    jest.resetAllMocks();

    // Setup default mock for pagination
    mockOctokit.paginate.mockImplementation(async (method, params) => {
      return Promise.resolve([
        { name: "sdk-repo1", node_id: "node-sdk-repo1" },
        { name: "sdk-repo2", node_id: "node-sdk-repo2" },
        { name: "client-repo", node_id: "node-client-repo" },
        { name: "app-web", node_id: "node-app-web" },
        { name: "api-service", node_id: "node-api-service" },
        { name: "test-lib", node_id: "node-test-lib" },
      ]);
    });
  });

  describe("discoverRepositories", () => {
    it("should discover repositories using name-pattern with starts-with operator", async () => {
      const config: Config = {
        allowed: { users: ["testuser"], teams: [] },
        targetRepositorySelectors: [
          { method: "name-pattern", pattern: "sdk-", operator: "starts-with" },
        ],
      };

      const repos = await discoverRepositories(mockOctokit, config, "test-org");

      expect(mockOctokit.paginate).toHaveBeenCalledWith(
        mockOctokit.rest.repos.listForOrg,
        { org: "test-org", per_page: 100 }
      );

      expect(repos).toHaveLength(2);
      expect(repos).toContainEqual({
        owner: "test-org",
        name: "sdk-repo1",
        nodeId: "node-sdk-repo1",
      });
      expect(repos).toContainEqual({
        owner: "test-org",
        name: "sdk-repo2",
        nodeId: "node-sdk-repo2",
      });
    });

    it("should discover repositories using name-pattern with contains operator", async () => {
      const config: Config = {
        allowed: { users: ["testuser"], teams: [] },
        targetRepositorySelectors: [
          { method: "name-pattern", pattern: "repo", operator: "contains" },
        ],
      };

      const repos = await discoverRepositories(mockOctokit, config, "test-org");

      expect(mockOctokit.paginate).toHaveBeenCalled();
      expect(repos).toHaveLength(3);
      expect(repos.map((r) => r.name)).toContain("sdk-repo1");
      expect(repos.map((r) => r.name)).toContain("sdk-repo2");
      expect(repos.map((r) => r.name)).toContain("client-repo");
    });

    it("should discover repositories using name-pattern with ends-with operator", async () => {
      const config: Config = {
        allowed: { users: ["testuser"], teams: [] },
        targetRepositorySelectors: [
          { method: "name-pattern", pattern: "web", operator: "ends-with" },
        ],
      };

      const repos = await discoverRepositories(mockOctokit, config, "test-org");

      expect(mockOctokit.paginate).toHaveBeenCalled();
      expect(repos).toHaveLength(1);
      expect(repos[0].name).toBe("app-web");
    });

    it("should discover repositories using explicit repository list", async () => {
      const config: Config = {
        allowed: { users: ["testuser"], teams: [] },
        targetRepositorySelectors: [
          {
            method: "explicit",
            repositories: ["test-lib", "api-service"],
          },
        ],
      };

      const repos = await discoverRepositories(mockOctokit, config, "test-org");

      // Should not call paginate for explicit repos
      expect(mockOctokit.paginate).not.toHaveBeenCalled();

      expect(repos).toHaveLength(2);
      expect(repos).toContainEqual({
        owner: "test-org",
        name: "test-lib",
      });
      expect(repos).toContainEqual({
        owner: "test-org",
        name: "api-service",
      });
    });

    it("should combine repositories from multiple selectors and remove duplicates", async () => {
      const config: Config = {
        allowed: { users: ["testuser"], teams: [] },
        targetRepositorySelectors: [
          { method: "name-pattern", pattern: "sdk-", operator: "starts-with" },
          { method: "explicit", repositories: ["sdk-repo1", "api-service"] },
        ],
      };

      const repos = await discoverRepositories(mockOctokit, config, "test-org");

      expect(mockOctokit.paginate).toHaveBeenCalled();

      // Should include sdk-repo1, sdk-repo2, api-service (with no duplicates)
      expect(repos).toHaveLength(3);
      expect(repos.map((r) => r.name).sort()).toEqual(
        ["api-service", "sdk-repo1", "sdk-repo2"].sort()
      );
    });

    it("should throw error for unsupported selector type", async () => {
      const config: Config = {
        allowed: { users: ["testuser"], teams: [] },
        targetRepositorySelectors: [
          { method: "invalid-selector" as any, pattern: "sdk-" } as any,
        ],
      };

      await expect(
        discoverRepositories(mockOctokit, config, "test-org")
      ).rejects.toThrow("Unsupported selector type");
    });

    it("should return empty array when no repositories match criteria", async () => {
      mockOctokit.paginate.mockResolvedValue([]);

      const config: Config = {
        allowed: { users: ["testuser"], teams: [] },
        targetRepositorySelectors: [
          {
            method: "name-pattern",
            pattern: "nonexistent",
            operator: "starts-with",
          },
        ],
      };

      const repos = await discoverRepositories(mockOctokit, config, "test-org");

      expect(repos).toHaveLength(0);
    });

    it("should handle empty repository list in explicit selector", async () => {
      const config: Config = {
        allowed: { users: ["testuser"], teams: [] },
        targetRepositorySelectors: [{ method: "explicit", repositories: [] }],
      };

      const repos = await discoverRepositories(mockOctokit, config, "test-org");

      expect(repos).toHaveLength(0);
    });

    it("should handle undefined repositories array in explicit selector", async () => {
      const config: Config = {
        allowed: { users: ["testuser"], teams: [] },
        targetRepositorySelectors: [{ method: "explicit" } as any],
      };

      const repos = await discoverRepositories(mockOctokit, config, "test-org");

      expect(repos).toHaveLength(0);
    });

    it("should default to contains operator when operator is not specified", async () => {
      const config: Config = {
        allowed: { users: ["testuser"], teams: [] },
        targetRepositorySelectors: [
          { method: "name-pattern", pattern: "repo" } as any,
        ],
      };

      const repos = await discoverRepositories(mockOctokit, config, "test-org");

      expect(repos).toHaveLength(3);
    });
  });
});

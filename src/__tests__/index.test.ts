import * as core from "@actions/core";
import { Context } from "@actions/github/lib/context";
import { runActionLogic, getConfig } from "../index";
import { validatePermission } from "../permissions";
import { discoverRepositories } from "../repo-discovery";
import {
  createChildIssue,
  getChildIssues,
  getIssueNodeId,
  linkIssueAsSubItem,
  updateChildIssue,
  updateChildIssueStatus,
} from "../issue-operations";
import { Config } from "../config";
import { Repository, Settings } from "../types";

// Mock all dependencies
jest.mock("@actions/core");
jest.mock("@actions/github");
jest.mock("../permissions");
jest.mock("../repo-discovery");
jest.mock("../issue-operations");

// Create mock implementations
const mockCore = jest.mocked(core);
const mockValidatePermission = jest.mocked(validatePermission);
const mockDiscoverRepositories = jest.mocked(discoverRepositories);
const mockGetIssueNodeId = jest.mocked(getIssueNodeId);
const mockCreateChildIssue = jest.mocked(createChildIssue);
const mockLinkIssueAsSubItem = jest.mocked(linkIssueAsSubItem);
const mockGetChildIssues = jest.mocked(getChildIssues);
const mockUpdateChildIssue = jest.mocked(updateChildIssue);
const mockUpdateChildIssueStatus = jest.mocked(updateChildIssueStatus);

// Mock Octokit client
const mockOctokit = {
  rest: {
    repos: {
      getContent: jest.fn(),
    },
    issues: {
      createComment: jest.fn(),
    },
  },
  graphql: jest.fn(),
} as any;

describe("index", () => {
  // Base inputs for tests
  const baseInputs = {
    configPath: ".github/federated-issue-action-config.json",
    requiredLabel: "federated",
    notifyMissingPermissions: true,
    closeIssuesOnParentClose: true,
    childIssueTitleTemplate: "${{ github.event.issue.title }}",
    childIssueBodyTemplate: "${{ github.event.issue.body }}",
  };

  // Base context for tests - fixed to match GitHub Context structure
  const baseContext = {
    repo: {
      owner: "test-owner",
      repo: "test-repo",
    },
    payload: {
      action: "labeled",
      issue: {
        number: 123,
        title: "Test Issue",
        body: "Test body content",
        user: {
          login: "testuser",
        },
        labels: [{ name: "federated" }],
        state: "open",
      },
    },
    ref: "main",
    sha: "1234567890abcdef1234567890abcdef12345678",
    workflow: "test-workflow",
    action: "test-action",
    actor: "test-actor",
    job: "test-job",
    runNumber: 1,
    runId: 1,
    apiUrl: "https://api.github.com",
    serverUrl: "https://github.com",
    graphqlUrl: "https://api.github.com/graphql",
  } as unknown as Context;

  // Reset mocks before each test
  beforeEach(() => {
    jest.resetAllMocks();

    // Set up default mocks
    mockCore.debug.mockImplementation(() => {});
    mockCore.info.mockImplementation(() => {});
    mockCore.warning.mockImplementation(() => {});
    mockCore.error.mockImplementation(() => {});

    // Set up default return values
    mockValidatePermission.mockResolvedValue(true);
    mockDiscoverRepositories.mockResolvedValue([
      { owner: "test-owner", name: "repo1" },
      { owner: "test-owner", name: "repo2" },
    ]);
    mockGetIssueNodeId.mockResolvedValue("parent-node-id");
    mockCreateChildIssue.mockImplementation((_, __, repo) =>
      Promise.resolve({
        owner: repo.owner,
        repo: repo.name,
        number: 456,
        nodeId: `${repo.name}-node-id`,
      })
    );
    mockLinkIssueAsSubItem.mockResolvedValue(undefined);

    // Mock getContent for config
    mockOctokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from(
          JSON.stringify({
            permittedUsers: ["testuser"],
            repoPatterns: ["repo1", "repo2"],
          })
        ).toString("base64"),
      },
    });
  });

  describe("GitHub Action Logic", () => {
    let mockConfig: Config;
    let mockRepos: Repository[];

    beforeEach(() => {
      jest.clearAllMocks();

      // Setup default mock values
      mockConfig = {
        allowed: { users: ["test-user"], teams: [] },
        targetRepositorySelectors: [
          { method: "name-pattern", pattern: "repo-", operator: "starts-with" },
        ],
      };

      mockRepos = [
        { owner: "test-owner", name: "repo-1", nodeId: "repo-1" },
        { owner: "test-owner", name: "repo-2", nodeId: "repo-2" },
      ];

      // Default mock implementations
      mockGetIssueNodeId.mockResolvedValue("parent-node-id");
      mockValidatePermission.mockResolvedValue(true);
      mockDiscoverRepositories.mockResolvedValue(mockRepos);
      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          content: Buffer.from(JSON.stringify(mockConfig)).toString("base64"),
        },
      });
      mockCreateChildIssue.mockImplementation((_, __, repo) =>
        Promise.resolve({
          owner: repo.owner,
          repo: repo.name,
          number: 456,
          nodeId: `child-node-id-${repo.name}`,
        })
      );
      mockGetChildIssues.mockResolvedValue([
        {
          owner: "test-owner",
          repo: "repo-1",
          number: 456,
          nodeId: "child-node-id-1",
        },
        {
          owner: "test-owner",
          repo: "repo-2",
          number: 457,
          nodeId: "child-node-id-2",
        },
      ]);
    });

    describe("runActionLogic", () => {
      const defaultInputs = {
        configPath: ".github/config.json",
        requiredLabel: "federated",
        notifyMissingPermissions: true,
        closeIssuesOnParentClose: true,
        childIssueTitleTemplate: "${{ github.event.issue.title }}",
        childIssueBodyTemplate: "${{ github.event.issue.body }}",
      } satisfies Settings;

      it("should skip processing if not an issue event", async () => {
        const customContext = {
          ...baseContext,
          payload: { ...baseContext.payload, issue: undefined },
        } as unknown as Context;

        await runActionLogic(mockOctokit, customContext, defaultInputs);

        expect(core.debug).toHaveBeenCalledWith("Not an issue event, skipping");
        expect(discoverRepositories).not.toHaveBeenCalled();
      });

      it("should skip processing if issue does not have the required label", async () => {
        const customContext = {
          ...baseContext,
          payload: {
            ...baseContext.payload,
            issue: {
              ...baseContext.payload.issue,
              labels: [{ name: "other-label" }],
            },
          },
        } as unknown as Context;

        await runActionLogic(mockOctokit, customContext, defaultInputs);

        expect(core.info).toHaveBeenCalledWith(
          "Issue does not have federated label, skipping"
        );
        expect(discoverRepositories).not.toHaveBeenCalled();
      });

      it("should notify user about missing permissions when configured", async () => {
        mockValidatePermission.mockResolvedValue(false);

        await runActionLogic(mockOctokit, baseContext, defaultInputs);

        expect(core.warning).toHaveBeenCalledWith(
          "User testuser does not have permission to create SDK parent issues"
        );
        expect(mockOctokit.rest.issues.createComment).toHaveBeenCalled();
        expect(discoverRepositories).not.toHaveBeenCalled();
      });

      it("should not notify about missing permissions when notification is disabled", async () => {
        mockValidatePermission.mockResolvedValue(false);

        await runActionLogic(mockOctokit, baseContext, {
          ...defaultInputs,
          notifyMissingPermissions: false,
        });

        expect(core.warning).toHaveBeenCalledWith(
          "User testuser does not have permission to create SDK parent issues"
        );
        expect(mockOctokit.rest.issues.createComment).not.toHaveBeenCalled();
        expect(discoverRepositories).not.toHaveBeenCalled();
      });

      it("should warn if no target repositories are found", async () => {
        mockDiscoverRepositories.mockResolvedValue([]);

        await runActionLogic(mockOctokit, baseContext, defaultInputs);

        expect(core.warning).toHaveBeenCalledWith(
          "No target repositories found for creating child issues"
        );
        expect(getIssueNodeId).not.toHaveBeenCalled();
      });

      it("should handle labeled event by creating child issues", async () => {
        const customContext = {
          ...baseContext,
          payload: { ...baseContext.payload, action: "labeled" },
        } as unknown as Context;

        await runActionLogic(mockOctokit, customContext, defaultInputs);

        expect(createChildIssue).toHaveBeenCalledTimes(2);
        expect(linkIssueAsSubItem).toHaveBeenCalledTimes(2);
        expect(core.info).toHaveBeenCalledWith(
          expect.stringContaining("Created and linked child issue")
        );
      });

      it("should handle edited event by updating child issues", async () => {
        const customContext = {
          ...baseContext,
          payload: { ...baseContext.payload, action: "edited" },
        } as unknown as Context;

        await runActionLogic(mockOctokit, customContext, defaultInputs);

        expect(getChildIssues).toHaveBeenCalledWith(
          mockOctokit,
          "parent-node-id"
        );
        expect(updateChildIssue).toHaveBeenCalledTimes(2);
      });

      it("should handle closed event by closing child issues when enabled", async () => {
        const customContext = {
          ...baseContext,
          payload: { ...baseContext.payload, action: "closed" },
        } as unknown as Context;

        await runActionLogic(mockOctokit, customContext, defaultInputs);

        expect(getChildIssues).toHaveBeenCalledWith(
          mockOctokit,
          "parent-node-id"
        );
        expect(updateChildIssueStatus).toHaveBeenCalledTimes(2);
      });

      it("should not close child issues when feature is disabled", async () => {
        const customContext = {
          ...baseContext,
          payload: { ...baseContext.payload, action: "closed" },
        } as unknown as Context;

        await runActionLogic(mockOctokit, customContext, {
          ...defaultInputs,
          closeIssuesOnParentClose: false,
        });

        expect(getChildIssues).not.toHaveBeenCalled();
        expect(updateChildIssueStatus).not.toHaveBeenCalled();
      });

      it("should skip actions for unhandled event types", async () => {
        const customContext = {
          ...baseContext,
          payload: { ...baseContext.payload, action: "unlabeled" },
        } as unknown as Context;

        await runActionLogic(mockOctokit, customContext, defaultInputs);

        expect(core.info).toHaveBeenCalledWith("Action unlabeled not handled");
        expect(createChildIssue).not.toHaveBeenCalled();
        expect(updateChildIssue).not.toHaveBeenCalled();
        expect(updateChildIssueStatus).not.toHaveBeenCalled();
      });

      it("should properly interpolate template variables", async () => {
        const customContext = {
          ...baseContext,
          payload: {
            ...baseContext.payload,
            action: "labeled",
            issue: {
              ...baseContext.payload.issue,
              title: "Custom Title",
              body: "Custom Body",
            },
          },
        } as unknown as Context;

        await runActionLogic(mockOctokit, customContext, defaultInputs);

        expect(createChildIssue).toHaveBeenCalledWith(
          mockOctokit,
          expect.objectContaining({
            title: "Custom Title",
            body: "Custom Body",
          }),
          expect.anything()
        );
      });
    });

    describe("getConfig", () => {
      it("should fetch and parse configuration from repository", async () => {
        const config = await getConfig(
          mockOctokit,
          "test-owner",
          "test-repo",
          "config.json",
          "main"
        );

        expect(mockOctokit.rest.repos.getContent).toHaveBeenCalledWith({
          owner: "test-owner",
          repo: "test-repo",
          path: "config.json",
          ref: "main",
        });
        expect(config).toEqual(mockConfig);
      });

      it("should throw error when configuration cannot be loaded", async () => {
        mockOctokit.rest.repos.getContent.mockRejectedValue(
          new Error("Not found")
        );

        await expect(
          getConfig(
            mockOctokit,
            "test-owner",
            "test-repo",
            "config.json",
            "main"
          )
        ).rejects.toThrow("Failed to load configuration from config.json");
      });

      it("should throw error when response does not contain content", async () => {
        mockOctokit.rest.repos.getContent.mockResolvedValue({
          data: { type: "dir" }, // No content field
        });

        await expect(
          getConfig(
            mockOctokit,
            "test-owner",
            "test-repo",
            "config.json",
            "main"
          )
        ).rejects.toThrow("Configuration file not found or invalid");
      });
    });

    describe("Error handling in helper functions", () => {
      it("should handle errors in handleIssueOpened", async () => {
        const customContext = {
          ...baseContext,
          payload: { ...baseContext.payload, action: "labeled" },
        } as unknown as Context;
        mockCreateChildIssue.mockRejectedValue(
          new Error("Failed to create issue")
        );

        await runActionLogic(mockOctokit, customContext, baseInputs);

        expect(core.error).toHaveBeenCalledWith(
          expect.stringContaining("Failed to create child issue")
        );
      });

      it("should handle errors in handleIssueEdited", async () => {
        const customContext = {
          ...baseContext,
          payload: { ...baseContext.payload, action: "edited" },
        } as unknown as Context;
        mockUpdateChildIssue.mockRejectedValue(
          new Error("Failed to update issue")
        );

        await runActionLogic(mockOctokit, customContext, baseInputs);

        expect(core.warning).toHaveBeenCalledWith(
          expect.stringContaining("Failed to update child issue")
        );
      });

      it("should handle errors in handleIssueStatusChanged", async () => {
        const customContext = {
          ...baseContext,
          payload: { ...baseContext.payload, action: "closed" },
        } as unknown as Context;
        mockUpdateChildIssueStatus.mockRejectedValue(
          new Error("Failed to update status")
        );

        await runActionLogic(mockOctokit, customContext, baseInputs);

        expect(core.warning).toHaveBeenCalledWith(
          expect.stringContaining("Failed to update status of child issue")
        );
      });
    });
  });
});

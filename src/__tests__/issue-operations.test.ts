import { 
  getIssueNodeId, 
  createChildIssue, 
  linkIssueAsSubItem, 
  getChildIssues, 
  updateChildIssue, 
  updateChildIssueStatus 
} from '../issue-operations';
import { IssueDetails, IssueReference, Repository } from '../types';

// Mock Octokit client
const mockOctokit = {
  graphql: jest.fn(),
  rest: {
    issues: {
      create: jest.fn(),
      update: jest.fn(),
    },
  },
} as any;

describe('issue-operations', () => {
  beforeEach(() => {
    // Reset mocks before each test
    mockOctokit.graphql.mockReset();
    mockOctokit.rest.issues.create.mockReset();
    mockOctokit.rest.issues.update.mockReset();
  });

  describe('getIssueNodeId', () => {
    it('should return the node ID for a given issue', async () => {
      const expectedNodeId = 'I_kwDOLw547s5p4i7K';
      mockOctokit.graphql.mockResolvedValue({
        repository: {
          issue: {
            id: expectedNodeId,
          },
        },
      });

      const nodeId = await getIssueNodeId(mockOctokit, 'owner', 'repo', 123);

      expect(nodeId).toBe(expectedNodeId);
      expect(mockOctokit.graphql).toHaveBeenCalledWith(
        expect.stringContaining('GetIssueId'),
        { owner: 'owner', repo: 'repo', number: 123 }
      );
    });
  });

  describe('createChildIssue', () => {
    it('should create an issue and return its reference', async () => {
      const childDetails: IssueDetails = { title: 'Child Title', body: 'Child Body', labels: ['bug'] };
      const targetRepo: Repository = { owner: 'child-owner', name: 'child-repo' };
      const mockApiResponse = {
        data: {
          number: 1,
          node_id: 'child-node-id',
        },
      };
      mockOctokit.rest.issues.create.mockResolvedValue(mockApiResponse);

      const issueRef = await createChildIssue(mockOctokit, childDetails, targetRepo);

      expect(issueRef).toEqual({
        owner: 'child-owner',
        repo: 'child-repo',
        number: 1,
        nodeId: 'child-node-id',
      });
      expect(mockOctokit.rest.issues.create).toHaveBeenCalledWith({
        owner: 'child-owner',
        repo: 'child-repo',
        title: 'Child Title',
        body: 'Child Body',
        labels: ['bug'],
      });
    });
  });

  describe('linkIssueAsSubItem', () => {
    it('should call the GraphQL mutation to link issues', async () => {
      const parentNodeId = 'parent-id';
      const childNodeId = 'child-id';
      mockOctokit.graphql.mockResolvedValue({ addSubIssue: { clientMutationId: null } });

      await linkIssueAsSubItem(mockOctokit, parentNodeId, childNodeId);

      expect(mockOctokit.graphql).toHaveBeenCalledWith(
        expect.stringContaining('AddSubIssue'),
        {
          parentId: parentNodeId,
          childId: childNodeId,
          headers: { "GraphQL-Features": "sub_issues" },
        }
      );
    });

    it('should throw error for invalid parentNodeId', async () => {
      await expect(linkIssueAsSubItem(mockOctokit, '', 'child-id')).rejects.toThrow('Invalid parent issue ID');
      await expect(linkIssueAsSubItem(mockOctokit, null as any, 'child-id')).rejects.toThrow('Invalid parent issue ID');
    });

    it('should throw error for invalid childNodeId', async () => {
      await expect(linkIssueAsSubItem(mockOctokit, 'parent-id', '')).rejects.toThrow('Invalid child issue ID');
      await expect(linkIssueAsSubItem(mockOctokit, 'parent-id', undefined as any)).rejects.toThrow('Invalid child issue ID');
    });
  });

  describe('getChildIssues', () => {
    it('should return a list of child issue references', async () => {
      const parentNodeId = 'parent-id';
      const mockApiResponse = {
        node: {
          subIssues: {
            nodes: [
              { repository: { name: 'repo1', owner: { login: 'owner1' } }, number: 10, id: 'node1' },
              { repository: { name: 'repo2', owner: { login: 'owner2' } }, number: 20, id: 'node2' },
            ],
          },
        },
      };
      mockOctokit.graphql.mockResolvedValue(mockApiResponse);

      const childIssues = await getChildIssues(mockOctokit, parentNodeId);

      expect(childIssues).toEqual([
        { owner: 'owner1', repo: 'repo1', number: 10, nodeId: 'node1' },
        { owner: 'owner2', repo: 'repo2', number: 20, nodeId: 'node2' },
      ]);
      expect(mockOctokit.graphql).toHaveBeenCalledWith(
        expect.stringContaining('SubIssues'),
        {
          parentId: parentNodeId,
          headers: { "GraphQL-Features": "sub_issues" },
        }
      );
    });

    it('should return an empty array if no child issues are found', async () => {
      const parentNodeId = 'parent-id';
      const mockApiResponse = {
        node: {
          subIssues: {
            nodes: [],
          },
        },
      };
      mockOctokit.graphql.mockResolvedValue(mockApiResponse);

      const childIssues = await getChildIssues(mockOctokit, parentNodeId);

      expect(childIssues).toEqual([]);
    });

     it('should throw error for invalid parentNodeId', async () => {
      await expect(getChildIssues(mockOctokit, '')).rejects.toThrow('Invalid parent issue ID');
    });
  });

  describe('updateChildIssue', () => {
    it('should call the update API with correct details', async () => {
      const childIssue: IssueReference = { owner: 'owner', repo: 'repo', number: 1, nodeId: 'node1' };
      const childDetails: IssueDetails = { title: 'New Title', body: 'New Body', labels: ['enhancement'] };
      mockOctokit.rest.issues.update.mockResolvedValue({}); // Response doesn't matter much here

      await updateChildIssue(mockOctokit, childIssue, childDetails);

      expect(mockOctokit.rest.issues.update).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 1,
        title: 'New Title',
        body: 'New Body',
        labels: ['enhancement'],
      });
    });
  });

  describe('updateChildIssueStatus', () => {
    it('should call the update API to close an issue', async () => {
      const childIssue: IssueReference = { owner: 'owner', repo: 'repo', number: 1, nodeId: 'node1' };
      mockOctokit.rest.issues.update.mockResolvedValue({});

      await updateChildIssueStatus(mockOctokit, childIssue, false);

      expect(mockOctokit.rest.issues.update).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 1,
        state: 'closed',
      });
    });

    it('should call the update API to open an issue', async () => {
      const childIssue: IssueReference = { owner: 'owner', repo: 'repo', number: 1, nodeId: 'node1' };
      mockOctokit.rest.issues.update.mockResolvedValue({});

      await updateChildIssueStatus(mockOctokit, childIssue, true);

      expect(mockOctokit.rest.issues.update).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 1,
        state: 'open',
      });
    });
  });
});

# Federated Issue Management GitHub Action

This GitHub Action helps manage issues across multiple repositories in a federated manner. When an issue with a specific label is created or updated in a "parent" repository, this action can automatically create, update, link, or close corresponding "child" issues in designated target repositories.

## Overview

The primary use case is for scenarios where a central issue needs to track work distributed across several related repositories (e.g., different SDKs for a single feature, components of a larger system).

**Key Features:**

*   **Automatic Child Issue Creation:** Creates issues in target repositories when a parent issue is labeled.
*   **Issue Linking:** Uses GitHub's sub-issue tracking feature to link child issues to the parent.
*   **Content Synchronization:** Updates child issue titles and bodies when the parent issue is edited.
*   **Status Synchronization:** Closes child issues when the parent issue is closed (configurable).
*   **Flexible Repository Discovery:** Target repositories can be specified explicitly or discovered using naming patterns.
*   **Permission Control:** Restrict who can trigger the creation of federated issues using user and team lists.

## Usage

To use this action, create a workflow file (e.g., `.github/workflows/federate-issues.yml`) in your parent repository:

```yaml
name: Federate Issues

on:
  issues:
    types: [labeled, edited, closed] # Trigger on relevant issue events

jobs:
  federate:
    runs-on: ubuntu-latest
    steps:
      - name: Federated Issue Management
        uses: beemer/federated-issue-action@v1 # Replace with the correct version tag
        with:
          # Required: GitHub token with necessary permissions
          github-token: ${{ secrets.YOUR_PAT_SECRET }} 
          
          # Optional: Label required on the parent issue to trigger the action (defaults to federated)
          required-label: 'federated'
          
          # Optional: Path to the configuration file (defaults to .github/federated-issue-action-config.json)
          config-path: '.github/federated-issues.json' 
          
          # Optional: Customize child issue title (defaults to parent title)
          # child-issue-title: '[Federated] ${{ github.event.issue.title }}' 
          
          # Optional: Customize child issue body (defaults to parent body)
          # child-issue-body: 'Parent issue: ${{ github.event.issue.html_url }}

${{ github.event.issue.body }}'
          
          # Optional: Notify user if they lack permissions (default: true)
          # notify-missing-permissions: 'true'
          
          # Optional: Close child issues when parent closes (default: true)
          # close-issues-on-parent-close: 'true'
```

**Important:** Replace `secrets.YOUR_PAT_SECRET` with the name of a repository secret containing a GitHub Personal Access Token (PAT) or use the default `secrets.GITHUB_TOKEN` if it has sufficient permissions (see (Permissions section)[permissions]).

## Configuration Options (Inputs)

The action accepts the following inputs (defined in `action.yml`):

*   `github-token` (**Required**): A GitHub token with permissions to manage issues across the relevant repositories. See the Permissions section below.
*   `required-label` (Optional, Default: `federated`): The label that must be present on the parent issue to trigger the action.
*   `config-path` (Optional, Default: `.github/federated-issue-action-config.json`): The path within the repository to the JSON configuration file.
*   `child-issue-title` (Optional, Default: Parent issue title): Template for the title of the child issues. You can use GitHub expression syntax (e.g., `${{ github.event.issue.title }}`).
*   `child-issue-body` (Optional, Default: Parent issue body): Template for the body of the child issues. You can use GitHub expression syntax.
*   `notify-missing-permissions` (Optional, Default: `true`): If `true`, adds a comment to the parent issue if the user triggering the action lacks the necessary permissions defined in the config file.
*   `close-issues-on-parent-close` (Optional, Default: `true`): If `true`, automatically closes linked child issues when the parent issue is closed.

## Configuration File

The action requires a JSON configuration file (specified by `config-path`) to define permissions and target repositories.

**Schema (`config.schema.json`):**

```json
{
  "allowed": {
    "users": ["username1", "username2"],
    "teams": ["org/team-slug1", "team-slug2"]
  },
  "targetRepositorySelectors": [
    {
      "method": "name-pattern",
      "identifier": "sdk",
      "patternType": "contains" 
    },
    {
      "method": "explicit",
      "repositories": ["my-specific-repo", "another-repo"]
    }
  ]
}
```

**Fields:**

*   `allowed`: (Optional) Defines who can trigger the creation/management of federated issues. If omitted or empty, anyone who can label the issue can trigger the action (subject to the `github-token` permissions).
    *   `users`: An array of GitHub usernames.
    *   `teams`: An array of GitHub team slugs. Use `org-name/team-slug` for teams outside the parent repository's organization.
*   `targetRepositorySelectors`: (**Required**) An array defining how to find the repositories where child issues should be created.
    *   `method`: How to select repositories.
        *   `name-pattern`: Selects repositories based on their name.
            *   `identifier`: The string pattern to match in the repository name.
            *   `patternType`: (Optional, Default: `contains`) How to match the `identifier`. Options: `starts-with`, `contains`, `ends-with`.
        *   `explicit`: Selects repositories by explicitly listing their names.
            *   `repositories`: An array of repository names (without the owner). The action assumes these repositories are in the same organization as the parent repository.

## Permissions

The `github-token` used requires the following permissions:

*   **Parent Repository:**
    *   `contents: read` (to read the configuration file)
    *   `issues: read` (to read issue details like labels, title, body)
    *   `issues: write` (to add comments if `notify-missing-permissions` is true)
    *   `metadata: read` (implicit)
*   **Target Repositories:**
    *   `issues: write` (to create, update, and close child issues)
*   **Organization (if using `allowed.teams`):**
    *   `members: read` (to check team membership)

It's recommended to use a **Personal Access Token (PAT)** with the necessary scopes (`repo`, `read:org`) stored as a repository secret, rather than the default `GITHUB_TOKEN`, especially if managing issues across different private repositories or organizations.

## How it Works

1.  **Trigger:** The workflow is triggered by `issues` events (`labeled`, `edited`, `closed`).
2.  **Label Check:** The action checks if the triggering issue has the `required-label`.
3.  **Configuration Load:** It reads the configuration file specified by `config-path`.
4.  **Permission Check:** If `allowed` users/teams are defined, it verifies if the user who triggered the event (e.g., added the label) is authorized. If not, it optionally comments and exits.
5.  **Repository Discovery:** It finds target repositories based on the `targetRepositorySelectors`.
6.  **Action Execution:** Based on the triggering event (`labeled`, `edited`, `closed`):
    *   **`labeled`:** Creates new issues in target repositories and links them as sub-issues to the parent.
    *   **`edited`:** Updates the title and body of existing linked child issues.
    *   **`closed`:** If `close-issues-on-parent-close` is true, closes linked child issues.
7.  **Logging:** Outputs information about discovered repositories and actions taken.

## Development

1.  Clone the repository.
2.  Install dependencies: `npm install`
3.  Build the TypeScript code: `npm run build`
4.  Run tests: `npm test`

Use `ncc` for packaging the action: `npm run build` (this compiles the code and dependencies into `dist/index.js`).

## License

This project is licensed under the Apache 2.0 License. See the [LICENSE](./LICENSE) file for details.
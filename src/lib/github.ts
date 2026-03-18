import { App } from 'octokit'

let githubApp: App | null = null

function getGithubApp(): App {
  if (!githubApp) {
    const privateKey = (process.env.GITHUB_APP_PRIVATE_KEY ?? '').replace(/\\n/g, '\n')
    githubApp = new App({
      appId: process.env.GITHUB_APP_ID!,
      privateKey,
      oauth: {
        clientId: process.env.GITHUB_APP_CLIENT_ID!,
        clientSecret: process.env.GITHUB_APP_CLIENT_SECRET!,
      },
      webhooks: {
        secret: process.env.GITHUB_WEBHOOK_SECRET!,
      },
    })
  }
  return githubApp
}

export async function getInstallationOctokit(installationId: number) {
  return getGithubApp().getInstallationOctokit(installationId)
}

// ─── Shared PR creation ───────────────────────────────────────────────────────

type OctokitInstance = Awaited<ReturnType<typeof getInstallationOctokit>>

export interface DocsPullRequestFileEntry {
  filePath: string
  content: string
}

interface DocsPullRequestOptions {
  ownerName: string
  repoName: string
  defaultBranch: string
  docDraftEntries: DocsPullRequestFileEntry[]
  branchPrefix: string
  commitMessage: string
  prTitle: string
  prBody: string
}

export interface DocsPullRequestResult {
  githubPrNumber: number
  githubPrUrl: string
  prTitle: string
}

interface GitBlobEntry {
  path: string
  mode: '100644'
  type: 'blob'
  sha: string
}

export async function createDocsPullRequest(
  octokit: OctokitInstance,
  options: DocsPullRequestOptions,
): Promise<DocsPullRequestResult> {
  const { ownerName, repoName, defaultBranch, docDraftEntries } = options

  // 1. Get HEAD SHA of default branch
  const refResponse = await octokit.rest.git.getRef({
    owner: ownerName,
    repo: repoName,
    ref: `heads/${defaultBranch}`,
  })
  const headCommitSha = refResponse.data.object.sha

  // 2. Get base tree SHA from HEAD commit
  const commitResponse = await octokit.rest.git.getCommit({
    owner: ownerName,
    repo: repoName,
    commit_sha: headCommitSha,
  })
  const baseTreeSha = commitResponse.data.tree.sha

  // 3. Create one blob per doc file
  const blobEntries: GitBlobEntry[] = []
  for (const docEntry of docDraftEntries) {
    const blobResponse = await octokit.rest.git.createBlob({
      owner: ownerName,
      repo: repoName,
      content: docEntry.content,
      encoding: 'utf-8',
    })
    blobEntries.push({
      path: docEntry.filePath,
      mode: '100644',
      type: 'blob',
      sha: blobResponse.data.sha,
    })
  }

  // 4. Create new tree with base_tree + blobs
  const newTreeResponse = await octokit.rest.git.createTree({
    owner: ownerName,
    repo: repoName,
    base_tree: baseTreeSha,
    tree: blobEntries,
  })
  const newTreeSha = newTreeResponse.data.sha

  // 5. Create commit
  const newCommitResponse = await octokit.rest.git.createCommit({
    owner: ownerName,
    repo: repoName,
    message: options.commitMessage,
    tree: newTreeSha,
    parents: [headCommitSha],
  })
  const newCommitSha = newCommitResponse.data.sha

  // 6. Create branch
  const branchName = `${options.branchPrefix}-${Date.now()}`
  await octokit.rest.git.createRef({
    owner: ownerName,
    repo: repoName,
    ref: `refs/heads/${branchName}`,
    sha: newCommitSha,
  })

  // 7. Open PR
  const prResponse = await octokit.rest.pulls.create({
    owner: ownerName,
    repo: repoName,
    title: options.prTitle,
    head: branchName,
    base: defaultBranch,
    body: options.prBody,
  })

  return {
    githubPrNumber: prResponse.data.number,
    githubPrUrl: prResponse.data.html_url,
    prTitle: options.prTitle,
  }
}

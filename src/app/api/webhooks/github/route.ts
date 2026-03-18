import { Webhooks } from '@octokit/webhooks'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../../../../../convex/_generated/api'
import { getInstallationOctokit } from '@/lib/github'

export const runtime = 'nodejs'

const webhooksVerifier = new Webhooks({
  secret: process.env.GITHUB_WEBHOOK_SECRET!,
})

const convexClient = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!)

interface GitHubPullRequestPayload {
  action: string
  pull_request: {
    number: number
    title: string
    merged: boolean
  }
  repository: {
    id: number
    full_name: string
  }
  installation?: {
    id: number
  }
}

interface GitHubInstallationRepoEntry {
  id: number
  full_name: string
}

interface GitHubInstallationRepositoriesPayload {
  action: 'added' | 'removed'
  installation: {
    id: number
    account: { login: string }
  }
  repositories_added: GitHubInstallationRepoEntry[]
  repositories_removed: GitHubInstallationRepoEntry[]
}

export async function POST(webhookRequest: Request): Promise<Response> {
  const rawBody = await webhookRequest.text()
  const signatureHeader = webhookRequest.headers.get('x-hub-signature-256') ?? ''

  const isValidSignature = await webhooksVerifier.verify(rawBody, signatureHeader)
  if (!isValidSignature) {
    return new Response('Invalid webhook signature', { status: 401 })
  }

  const eventType = webhookRequest.headers.get('x-github-event')

  if (eventType === 'installation_repositories') {
    return handleInstallationRepositories(rawBody)
  }

  if (eventType !== 'pull_request') {
    return new Response('Event type ignored', { status: 200 })
  }

  const webhookPayload = JSON.parse(rawBody) as GitHubPullRequestPayload
  const isPullRequestMerged =
    webhookPayload.action === 'closed' && webhookPayload.pull_request.merged === true

  if (!isPullRequestMerged) {
    return new Response('PR event ignored — not a merge', { status: 200 })
  }

  const githubInstallationId = webhookPayload.installation?.id
  if (githubInstallationId === undefined) {
    return new Response('Missing installation ID in webhook payload', { status: 400 })
  }

  try {
    await convexClient.mutation(api.runs.scheduleSyncRun, {
      githubInstallationId,
      githubRepoId: webhookPayload.repository.id,
      triggerPrNumber: webhookPayload.pull_request.number,
      triggerPrTitle: webhookPayload.pull_request.title,
    })
  } catch (convexError) {
    console.error('Failed to schedule sync run in Convex:', convexError)
    return new Response('Internal error scheduling sync run', { status: 500 })
  }

  return new Response('OK', { status: 200 })
}

async function handleInstallationRepositories(rawBody: string): Promise<Response> {
  const webhookPayload = JSON.parse(rawBody) as GitHubInstallationRepositoriesPayload

  const githubInstallationId = webhookPayload.installation.id

  const orgRecord = await convexClient.query(api.orgs.getOrgByInstallation, {
    githubInstallationId,
  })

  // Org hasn't been registered yet — user needs to go through the Setup URL flow first
  if (!orgRecord) {
    return new Response('Org not found — skipping', { status: 200 })
  }

  if (webhookPayload.action === 'added') {
    const installationOctokit = await getInstallationOctokit(githubInstallationId)

    for (const repoEntry of webhookPayload.repositories_added) {
      const existingRepo = await convexClient.query(api.repos.getRepoByGithubId, {
        githubRepoId: repoEntry.id,
      })
      if (existingRepo) continue

      const [ownerName, repoName] = repoEntry.full_name.split('/')
      const repoDetailsResponse = await installationOctokit.rest.repos.get({
        owner: ownerName,
        repo: repoName,
      })

      await convexClient.mutation(api.repos.createRepo, {
        orgId: orgRecord._id,
        githubRepoId: repoEntry.id,
        fullName: repoEntry.full_name,
        defaultBranch: repoDetailsResponse.data.default_branch,
        docTypes: ['readme', 'api_reference'],
      })
    }
  }

  if (webhookPayload.action === 'removed') {
    for (const repoEntry of webhookPayload.repositories_removed) {
      const existingRepo = await convexClient.query(api.repos.getRepoByGithubId, {
        githubRepoId: repoEntry.id,
      })
      if (existingRepo) {
        await convexClient.mutation(api.repos.updateRepoActiveStatus, {
          repoId: existingRepo._id,
          isActive: false,
        })
      }
    }
  }

  return new Response('OK', { status: 200 })
}

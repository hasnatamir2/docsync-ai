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
    console.warn('[webhook] invalid signature')
    return new Response('Invalid webhook signature', { status: 401 })
  }

  const eventType = webhookRequest.headers.get('x-github-event')
  console.log('[webhook] event:', eventType)

  if (eventType === 'installation_repositories') {
    return handleInstallationRepositories(rawBody)
  }

  if (eventType !== 'pull_request') {
    return new Response('Event type ignored', { status: 200 })
  }

  const webhookPayload = JSON.parse(rawBody) as GitHubPullRequestPayload
  const isPullRequestMerged =
    webhookPayload.action === 'closed' && webhookPayload.pull_request.merged === true

  console.log('[webhook] pull_request action:', webhookPayload.action, 'merged:', webhookPayload.pull_request.merged, 'repo:', webhookPayload.repository.full_name)

  if (!isPullRequestMerged) {
    return new Response('PR event ignored — not a merge', { status: 200 })
  }

  const githubInstallationId = webhookPayload.installation?.id
  if (githubInstallationId === undefined) {
    console.error('[webhook] missing installation ID in payload')
    return new Response('Missing installation ID in webhook payload', { status: 400 })
  }

  console.log('[webhook] scheduling sync run — installationId:', githubInstallationId, 'repoId:', webhookPayload.repository.id, 'pr:', webhookPayload.pull_request.number)

  try {
    const runId = await convexClient.mutation(api.runs.scheduleSyncRun, {
      githubInstallationId,
      githubRepoId: webhookPayload.repository.id,
      triggerPrNumber: webhookPayload.pull_request.number,
      triggerPrTitle: webhookPayload.pull_request.title,
    })
    console.log('[webhook] scheduleSyncRun result:', runId)
  } catch (convexError) {
    console.error('[webhook] failed to schedule sync run:', convexError instanceof Error ? convexError.message : convexError)
    return new Response('Internal error scheduling sync run', { status: 500 })
  }

  return new Response('OK', { status: 200 })
}

async function handleInstallationRepositories(rawBody: string): Promise<Response> {
  const webhookPayload = JSON.parse(rawBody) as GitHubInstallationRepositoriesPayload

  const githubInstallationId = webhookPayload.installation.id
  console.log('[webhook] installation_repositories action:', webhookPayload.action, 'installationId:', githubInstallationId, 'added:', webhookPayload.repositories_added.map((repo) => repo.full_name), 'removed:', webhookPayload.repositories_removed.map((repo) => repo.full_name))

  const orgRecord = await convexClient.query(api.orgs.getOrgByInstallation, {
    githubInstallationId,
  })
  console.log('[webhook] orgRecord for installationId', githubInstallationId, ':', orgRecord ? orgRecord._id : null)

  // Org hasn't been registered yet — user needs to go through the Setup URL flow first
  if (!orgRecord) {
    console.warn('[webhook] org not found for installationId:', githubInstallationId, '— skipping repo sync')
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

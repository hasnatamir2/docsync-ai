import { Webhooks } from '@octokit/webhooks'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../../../../../convex/_generated/api'

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

export async function POST(webhookRequest: Request): Promise<Response> {
  const rawBody = await webhookRequest.text()
  const signatureHeader = webhookRequest.headers.get('x-hub-signature-256') ?? ''

  const isValidSignature = await webhooksVerifier.verify(rawBody, signatureHeader)
  if (!isValidSignature) {
    return new Response('Invalid webhook signature', { status: 401 })
  }

  const eventType = webhookRequest.headers.get('x-github-event')
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

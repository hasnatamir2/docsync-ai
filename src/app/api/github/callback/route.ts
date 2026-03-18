import { auth } from '@clerk/nextjs/server'
import { ConvexHttpClient } from 'convex/browser'
import { NextRequest } from 'next/server'
import { api } from '../../../../../convex/_generated/api'
import { getInstallationOctokit } from '@/lib/github'

export const runtime = 'nodejs'

const convexClient = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!)

export async function GET(request: NextRequest): Promise<Response> {
  const { userId } = await auth()

  if (!userId) {
    return Response.redirect(new URL('/', request.url))
  }

  const installationIdParam = request.nextUrl.searchParams.get('installation_id')
  const setupAction = request.nextUrl.searchParams.get('setup_action')

  // 'request' means org admin approval is pending — nothing to store yet
  if (setupAction === 'request' || !installationIdParam) {
    return Response.redirect(new URL('/dashboard', request.url))
  }

  const githubInstallationId = parseInt(installationIdParam, 10)

  try {
    const installationOctokit = await getInstallationOctokit(githubInstallationId)

    const repoListResponse = await installationOctokit.rest.apps.listReposAccessibleToInstallation({
      per_page: 100,
    })
    const accessibleRepos = repoListResponse.data.repositories
    const githubLogin = accessibleRepos[0]?.owner.login ?? `installation-${githubInstallationId}`

    const existingOrg = await convexClient.query(api.orgs.getOrgByInstallation, {
      githubInstallationId,
    })

    if (existingOrg) {
      // Org already registered — sync any newly added repos
      for (const repoData of accessibleRepos) {
        const existingRepo = await convexClient.query(api.repos.getRepoByGithubId, {
          githubRepoId: repoData.id,
        })
        if (!existingRepo) {
          await convexClient.mutation(api.repos.createRepo, {
            orgId: existingOrg._id,
            githubRepoId: repoData.id,
            fullName: repoData.full_name,
            defaultBranch: repoData.default_branch,
            docTypes: ['readme', 'api_reference'],
          })
        }
      }
    } else {
      // First installation — create org then repos
      const newOrgId = await convexClient.mutation(api.orgs.createOrg, {
        clerkUserId: userId,
        githubInstallationId,
        githubLogin,
      })

      for (const repoData of accessibleRepos) {
        await convexClient.mutation(api.repos.createRepo, {
          orgId: newOrgId,
          githubRepoId: repoData.id,
          fullName: repoData.full_name,
          defaultBranch: repoData.default_branch,
          docTypes: ['readme', 'api_reference'],
        })
      }
    }
  } catch (callbackError) {
    console.error('GitHub App callback error:', callbackError)
  }

  return Response.redirect(new URL('/dashboard', request.url))
}

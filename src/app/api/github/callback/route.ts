import { auth } from '@clerk/nextjs/server'
import { ConvexHttpClient } from 'convex/browser'
import { NextRequest } from 'next/server'
import { api } from '../../../../../convex/_generated/api'
import { getInstallationOctokit } from '@/lib/github'

export const runtime = 'nodejs'

const convexClient = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!)

export async function GET(request: NextRequest): Promise<Response> {
  const { userId } = await auth()
  console.log('[github-callback] userId:', userId, 'url:', request.url)

  if (!userId) {
    console.warn('[github-callback] no userId — user not authenticated, redirecting to /')
    return Response.redirect(new URL('/', request.url))
  }

  const installationIdParam = request.nextUrl.searchParams.get('installation_id')
  const setupAction = request.nextUrl.searchParams.get('setup_action')

  // 'request' means org admin approval is pending — nothing to store yet
  if (setupAction === 'request' || !installationIdParam) {
    return Response.redirect(new URL('/dashboard', request.url))
  }

  const githubInstallationId = parseInt(installationIdParam, 10)
  console.log('[github-callback] installationId:', githubInstallationId, 'setupAction:', setupAction)

  try {
    console.log('[github-callback] calling getInstallationOctokit...')
    const installationOctokit = await getInstallationOctokit(githubInstallationId)
    console.log('[github-callback] getInstallationOctokit OK')

    console.log('[github-callback] listing accessible repos...')
    const repoListResponse = await installationOctokit.rest.apps.listReposAccessibleToInstallation({
      per_page: 100,
    })
    const accessibleRepos = repoListResponse.data.repositories
    const githubLogin = accessibleRepos[0]?.owner.login ?? `installation-${githubInstallationId}`
    console.log('[github-callback] accessible repos:', accessibleRepos.map((repo) => repo.full_name), 'githubLogin:', githubLogin)

    console.log('[github-callback] querying existing org by installationId...')
    let existingOrg = await convexClient.query(api.orgs.getOrgByInstallation, {
      githubInstallationId,
    })
    console.log('[github-callback] existingOrg by installationId:', existingOrg ? existingOrg._id : null)

    // Reinstall path — same Clerk user, new installation ID (uninstall + reinstall)
    if (!existingOrg) {
      console.log('[github-callback] not found by installationId, checking by clerkUserId...')
      const orgByClerkUser = await convexClient.query(api.orgs.getOrgByClerkUser, {
        clerkUserId: userId,
      })
      if (orgByClerkUser) {
        console.log('[github-callback] found existing org by clerkUserId:', orgByClerkUser._id, '— updating installationId from', orgByClerkUser.githubInstallationId, 'to', githubInstallationId)
        await convexClient.mutation(api.orgs.updateOrgInstallation, {
          orgId: orgByClerkUser._id,
          githubInstallationId,
          githubLogin,
        })
        existingOrg = { ...orgByClerkUser, githubInstallationId, githubLogin }
      }
    }

    if (existingOrg) {
      // Org already registered — sync any newly added repos
      for (const repoData of accessibleRepos) {
        const existingRepo = await convexClient.query(api.repos.getRepoByGithubId, {
          githubRepoId: repoData.id,
        })
        if (!existingRepo) {
          console.log('[github-callback] creating repo:', repoData.full_name)
          await convexClient.mutation(api.repos.createRepo, {
            orgId: existingOrg._id,
            githubRepoId: repoData.id,
            fullName: repoData.full_name,
            defaultBranch: repoData.default_branch,
            docTypes: ['readme', 'api_reference'],
          })
          console.log('[github-callback] repo created:', repoData.full_name)
        } else {
          console.log('[github-callback] repo already exists:', repoData.full_name)
        }
      }
    } else {
      // First installation — create org then repos
      console.log('[github-callback] creating org for installationId:', githubInstallationId)
      const newOrgId = await convexClient.mutation(api.orgs.createOrg, {
        clerkUserId: userId,
        githubInstallationId,
        githubLogin,
      })
      console.log('[github-callback] org created:', newOrgId)

      for (const repoData of accessibleRepos) {
        console.log('[github-callback] creating repo:', repoData.full_name)
        await convexClient.mutation(api.repos.createRepo, {
          orgId: newOrgId,
          githubRepoId: repoData.id,
          fullName: repoData.full_name,
          defaultBranch: repoData.default_branch,
          docTypes: ['readme', 'api_reference'],
        })
        console.log('[github-callback] repo created:', repoData.full_name)
      }
    }
    console.log('[github-callback] setup complete, redirecting to dashboard')
  } catch (callbackError) {
    console.error('[github-callback] error:', callbackError instanceof Error ? callbackError.message : callbackError)
    console.error('[github-callback] stack:', callbackError instanceof Error ? callbackError.stack : 'no stack')
    return Response.redirect(new URL('/dashboard?setup_error=1', request.url))
  }

  return Response.redirect(new URL('/dashboard', request.url))
}

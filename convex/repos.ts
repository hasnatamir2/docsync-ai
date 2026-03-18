import { mutation, query } from './_generated/server'
import { v } from 'convex/values'

export const getRepo = query({
  args: { repoId: v.id('repos') },
  handler: async (context, args) => {
    return context.db.get(args.repoId)
  },
})

export const listReposByOrg = query({
  args: { orgId: v.id('orgs') },
  handler: async (context, args) => {
    return context.db
      .query('repos')
      .withIndex('by_org', (queryBuilder) => queryBuilder.eq('orgId', args.orgId))
      .collect()
  },
})

export const getRepoByGithubId = query({
  args: { githubRepoId: v.number() },
  handler: async (context, args) => {
    return context.db
      .query('repos')
      .withIndex('by_github_repo_id', (queryBuilder) =>
        queryBuilder.eq('githubRepoId', args.githubRepoId),
      )
      .unique()
  },
})

export const createRepo = mutation({
  args: {
    orgId: v.id('orgs'),
    githubRepoId: v.number(),
    fullName: v.string(),
    defaultBranch: v.string(),
    docTypes: v.array(v.string()),
  },
  handler: async (context, args) => {
    return context.db.insert('repos', {
      orgId: args.orgId,
      githubRepoId: args.githubRepoId,
      fullName: args.fullName,
      defaultBranch: args.defaultBranch,
      isActive: true,
      docTypes: args.docTypes,
      createdAt: Date.now(),
    })
  },
})

export const updateRepoActiveStatus = mutation({
  args: { repoId: v.id('repos'), isActive: v.boolean() },
  handler: async (context, args) => {
    await context.db.patch(args.repoId, { isActive: args.isActive })
  },
})

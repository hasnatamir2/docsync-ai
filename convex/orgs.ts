import { mutation, query } from './_generated/server'
import { v } from 'convex/values'

export const getOrgByClerkUser = query({
  args: { clerkUserId: v.string() },
  handler: async (context, args) => {
    return context.db
      .query('orgs')
      .withIndex('by_clerk_user', (queryBuilder) =>
        queryBuilder.eq('clerkUserId', args.clerkUserId),
      )
      .unique()
  },
})

export const getOrgByInstallation = query({
  args: { githubInstallationId: v.number() },
  handler: async (context, args) => {
    return context.db
      .query('orgs')
      .withIndex('by_installation', (queryBuilder) =>
        queryBuilder.eq('githubInstallationId', args.githubInstallationId),
      )
      .unique()
  },
})

export const createOrg = mutation({
  args: {
    clerkUserId: v.string(),
    githubInstallationId: v.number(),
    githubLogin: v.string(),
  },
  handler: async (context, args) => {
    return context.db.insert('orgs', {
      clerkUserId: args.clerkUserId,
      githubInstallationId: args.githubInstallationId,
      githubLogin: args.githubLogin,
      plan: 'free',
      createdAt: Date.now(),
    })
  },
})

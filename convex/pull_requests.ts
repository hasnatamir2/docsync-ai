import { mutation, query } from './_generated/server'
import { v } from 'convex/values'

export const listPullRequestsByRepo = query({
  args: { repoId: v.id('repos') },
  handler: async (context, args) => {
    return context.db
      .query('pullRequests')
      .withIndex('by_repo', (queryBuilder) => queryBuilder.eq('repoId', args.repoId))
      .order('desc')
      .collect()
  },
})

export const getPullRequestByRun = query({
  args: { runId: v.id('runs') },
  handler: async (context, args) => {
    return context.db
      .query('pullRequests')
      .withIndex('by_run', (queryBuilder) => queryBuilder.eq('runId', args.runId))
      .unique()
  },
})

export const createPullRequest = mutation({
  args: {
    runId: v.id('runs'),
    repoId: v.id('repos'),
    githubPrNumber: v.number(),
    githubPrUrl: v.string(),
    title: v.string(),
  },
  handler: async (context, args) => {
    return context.db.insert('pullRequests', {
      runId: args.runId,
      repoId: args.repoId,
      githubPrNumber: args.githubPrNumber,
      githubPrUrl: args.githubPrUrl,
      title: args.title,
      status: 'open',
      createdAt: Date.now(),
    })
  },
})

export const updatePullRequestStatus = mutation({
  args: {
    pullRequestId: v.id('pullRequests'),
    status: v.union(v.literal('open'), v.literal('merged'), v.literal('closed')),
  },
  handler: async (context, args) => {
    await context.db.patch(args.pullRequestId, { status: args.status })
  },
})

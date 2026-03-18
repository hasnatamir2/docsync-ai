import { mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import { v } from 'convex/values'

export const getRun = query({
  args: { runId: v.id('runs') },
  handler: async (context, args) => {
    return context.db.get(args.runId)
  },
})

export const listRunsByRepo = query({
  args: { repoId: v.id('repos') },
  handler: async (context, args) => {
    return context.db
      .query('runs')
      .withIndex('by_repo', (queryBuilder) => queryBuilder.eq('repoId', args.repoId))
      .order('desc')
      .collect()
  },
})

export const getLatestRunByRepo = query({
  args: { repoId: v.id('repos') },
  handler: async (context, args) => {
    return context.db
      .query('runs')
      .withIndex('by_repo', (queryBuilder) => queryBuilder.eq('repoId', args.repoId))
      .order('desc')
      .first()
  },
})

export const createRun = mutation({
  args: {
    repoId: v.id('repos'),
    mode: v.union(v.literal('generate'), v.literal('sync')),
    triggerPrNumber: v.optional(v.number()),
    triggerPrTitle: v.optional(v.string()),
  },
  handler: async (context, args) => {
    return context.db.insert('runs', {
      repoId: args.repoId,
      mode: args.mode,
      status: 'pending',
      triggerPrNumber: args.triggerPrNumber,
      triggerPrTitle: args.triggerPrTitle,
      startedAt: Date.now(),
    })
  },
})

export const scheduleSyncRun = mutation({
  args: {
    githubInstallationId: v.number(),
    githubRepoId: v.number(),
    triggerPrNumber: v.number(),
    triggerPrTitle: v.string(),
  },
  handler: async (context, args) => {
    // 1. Org lookup
    const orgRecord = await context.db
      .query('orgs')
      .withIndex('by_installation', (queryBuilder) =>
        queryBuilder.eq('githubInstallationId', args.githubInstallationId),
      )
      .unique()
    if (orgRecord === null) {
      console.warn(
        `scheduleSyncRun: no org found for installationId=${args.githubInstallationId} — skipping`,
      )
      return null
    }

    // 2. Repo lookup
    const repoRecord = await context.db
      .query('repos')
      .withIndex('by_github_repo_id', (queryBuilder) =>
        queryBuilder.eq('githubRepoId', args.githubRepoId),
      )
      .unique()
    if (repoRecord === null) {
      console.warn(
        `scheduleSyncRun: no repo found for githubRepoId=${args.githubRepoId} — skipping`,
      )
      return null
    }
    if (!repoRecord.isActive) {
      console.warn(
        `scheduleSyncRun: repo ${repoRecord.fullName} is inactive — skipping`,
      )
      return null
    }

    // 3. Idempotency guard — return existing run if webhook is retried
    const existingRun = await context.db
      .query('runs')
      .withIndex('by_repo', (queryBuilder) => queryBuilder.eq('repoId', repoRecord._id))
      .filter((filterQuery) =>
        filterQuery.and(
          filterQuery.eq(filterQuery.field('triggerPrNumber'), args.triggerPrNumber),
          filterQuery.or(
            filterQuery.eq(filterQuery.field('status'), 'pending'),
            filterQuery.eq(filterQuery.field('status'), 'running'),
          ),
        ),
      )
      .first()
    if (existingRun !== null) return existingRun._id

    // 4. Create run
    const runId = await context.db.insert('runs', {
      repoId: repoRecord._id,
      mode: 'sync',
      status: 'pending',
      triggerPrNumber: args.triggerPrNumber,
      triggerPrTitle: args.triggerPrTitle,
      startedAt: Date.now(),
    })

    // 5. Schedule sync action
    await context.scheduler.runAfter(0, internal.actions.sync_docs.syncRepoDocsOnMerge, {
      runId,
      repoId: repoRecord._id,
      installationId: orgRecord.githubInstallationId,
      triggerPrNumber: args.triggerPrNumber,
      triggerPrTitle: args.triggerPrTitle,
    })

    return runId
  },
})

export const updateRunStatus = mutation({
  args: {
    runId: v.id('runs'),
    status: v.union(
      v.literal('pending'),
      v.literal('running'),
      v.literal('completed'),
      v.literal('failed'),
      v.literal('suppressed'),
    ),
    confidenceScore: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (context, args) => {
    const completedStatuses = ['completed', 'failed', 'suppressed']
    const isTerminal = completedStatuses.includes(args.status)
    await context.db.patch(args.runId, {
      status: args.status,
      ...(args.confidenceScore !== undefined && { confidenceScore: args.confidenceScore }),
      ...(args.errorMessage !== undefined && { errorMessage: args.errorMessage }),
      ...(isTerminal && { completedAt: Date.now() }),
    })
  },
})

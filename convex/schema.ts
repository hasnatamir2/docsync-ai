import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  orgs: defineTable({
    clerkUserId: v.string(),
    githubInstallationId: v.number(),
    githubLogin: v.string(),
    plan: v.union(v.literal('free'), v.literal('starter'), v.literal('team')),
    createdAt: v.number(),
  })
    .index('by_clerk_user', ['clerkUserId'])
    .index('by_installation', ['githubInstallationId']),

  repos: defineTable({
    orgId: v.id('orgs'),
    githubRepoId: v.number(),
    fullName: v.string(),
    defaultBranch: v.string(),
    isActive: v.boolean(),
    docTypes: v.array(v.string()),
    createdAt: v.number(),
  })
    .index('by_org', ['orgId'])
    .index('by_github_repo_id', ['githubRepoId']),

  runs: defineTable({
    repoId: v.id('repos'),
    mode: v.union(v.literal('generate'), v.literal('sync')),
    status: v.union(
      v.literal('pending'),
      v.literal('running'),
      v.literal('completed'),
      v.literal('failed'),
      v.literal('suppressed'),
    ),
    triggerPrNumber: v.optional(v.number()),
    triggerPrTitle: v.optional(v.string()),
    confidenceScore: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index('by_repo', ['repoId'])
    .index('by_repo_and_status', ['repoId', 'status']),

  docDrafts: defineTable({
    runId: v.id('runs'),
    docType: v.string(),
    filePath: v.string(),
    content: v.string(),
    status: v.union(
      v.literal('draft'),
      v.literal('pr_opened'),
      v.literal('merged'),
      v.literal('dismissed'),
    ),
    createdAt: v.number(),
  }).index('by_run', ['runId']),

  pullRequests: defineTable({
    runId: v.id('runs'),
    repoId: v.id('repos'),
    githubPrNumber: v.number(),
    githubPrUrl: v.string(),
    title: v.string(),
    status: v.union(v.literal('open'), v.literal('merged'), v.literal('closed')),
    createdAt: v.number(),
  })
    .index('by_run', ['runId'])
    .index('by_repo', ['repoId']),
})

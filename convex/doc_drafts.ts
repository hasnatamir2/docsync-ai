import { mutation, query } from './_generated/server'
import { v } from 'convex/values'

export const listDocDraftsByRun = query({
  args: { runId: v.id('runs') },
  handler: async (context, args) => {
    return context.db
      .query('docDrafts')
      .withIndex('by_run', (queryBuilder) => queryBuilder.eq('runId', args.runId))
      .collect()
  },
})

export const createDocDraft = mutation({
  args: {
    runId: v.id('runs'),
    docType: v.string(),
    filePath: v.string(),
    content: v.string(),
  },
  handler: async (context, args) => {
    return context.db.insert('docDrafts', {
      runId: args.runId,
      docType: args.docType,
      filePath: args.filePath,
      content: args.content,
      status: 'draft',
      createdAt: Date.now(),
    })
  },
})

export const updateDocDraftStatus = mutation({
  args: {
    docDraftId: v.id('docDrafts'),
    status: v.union(
      v.literal('draft'),
      v.literal('pr_opened'),
      v.literal('merged'),
      v.literal('dismissed'),
    ),
  },
  handler: async (context, args) => {
    await context.db.patch(args.docDraftId, { status: args.status })
  },
})

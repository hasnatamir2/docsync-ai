# DocSync AI — Claude Code Context

## What this project is

DocSync AI is a SaaS tool that automatically generates and keeps technical documentation in sync with a codebase. It monitors GitHub repositories and ensures docs never go stale.

Two modes, one shared LLM pipeline:

- **Generate mode** — user connects a repo, DocSync reads the codebase and opens a PR with a full doc set (README + API reference) generated from scratch
- **Sync mode** — triggered by every merged PR via webhook, DocSync diffs what changed, checks if any docs are now stale, and opens a PR with the suggested update

The core insight: these two modes share ~70% of the same pipeline. Generate has one input (code). Sync has two inputs (code diff + existing docs). Both output a GitHub PR with markdown files.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.1 (App Router, Turbopack default) |
| Language | TypeScript, strict mode |
| React | React 19.2 |
| Database + backend | Convex (DB, async actions, real-time subscriptions) |
| Auth | Clerk (GitHub OAuth for user login) |
| GitHub integration | Octokit (`octokit` App class + `@octokit/rest`) |
| Webhook verification | `@octokit/webhooks` |
| LLM | Anthropic Claude Sonnet (via `@anthropic-ai/sdk`) |
| Styling | Tailwind CSS v4 |
| UI components | shadcn/ui |
| Package manager | pnpm |
| Deployment | Vercel |

## Project structure

```
docsync-ai/
├── src/
│   ├── app/
│   │   ├── layout.tsx                  # ClerkProvider + ConvexClientProvider
│   │   ├── ConvexClientProvider.tsx    # 'use client' Convex wrapper
│   │   ├── page.tsx                    # Landing / connect repo CTA
│   │   ├── dashboard/
│   │   │   └── page.tsx               # Main dashboard (run history, repos)
│   │   └── api/
│   │       └── webhooks/
│   │           └── github/
│   │               └── route.ts       # GitHub webhook receiver
│   ├── lib/
│   │   ├── github.ts                  # GitHub App singleton + getInstallationOctokit()
│   │   ├── anthropic.ts               # Anthropic client singleton
│   │   └── utils.ts                   # Shared utilities
│   └── components/
│       └── ui/                        # shadcn/ui components
├── convex/
│   ├── schema.ts                      # Database schema (source of truth)
│   ├── orgs.ts                        # Org queries/mutations
│   ├── repos.ts                       # Repo queries/mutations
│   ├── runs.ts                        # Run queries/mutations
│   ├── docDrafts.ts                   # Doc draft queries/mutations
│   └── actions/
│       ├── generateDocs.ts            # Generate mode: full repo → doc set PR
│       └── syncDocs.ts                # Sync mode: diff + existing docs → update PR
├── .env.local                         # Never commit this
├── CLAUDE.md                          # This file
└── proxy.ts                           # Next.js 16 replacement for middleware.ts
```

## Convex schema (source of truth)

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  orgs: defineTable({
    clerkUserId: v.string(),
    githubInstallationId: v.number(),
    githubLogin: v.string(),         // GitHub org or username
    plan: v.union(v.literal('free'), v.literal('starter'), v.literal('team')),
    createdAt: v.number(),
  }).index('by_clerk_user', ['clerkUserId'])
    .index('by_installation', ['githubInstallationId']),

  repos: defineTable({
    orgId: v.id('orgs'),
    githubRepoId: v.number(),
    fullName: v.string(),            // "owner/repo"
    defaultBranch: v.string(),
    isActive: v.boolean(),
    docTypes: v.array(v.string()),   // ["readme", "api_reference"]
    createdAt: v.number(),
  }).index('by_org', ['orgId'])
    .index('by_github_repo_id', ['githubRepoId']),

  runs: defineTable({
    repoId: v.id('repos'),
    mode: v.union(v.literal('generate'), v.literal('sync')),
    status: v.union(
      v.literal('pending'),
      v.literal('running'),
      v.literal('completed'),
      v.literal('failed'),
      v.literal('suppressed')        // sync mode: confidence below threshold
    ),
    triggerPrNumber: v.optional(v.number()),   // sync mode: the PR that triggered this
    triggerPrTitle: v.optional(v.string()),
    confidenceScore: v.optional(v.number()),   // sync mode: 0-1
    errorMessage: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index('by_repo', ['repoId'])
    .index('by_repo_and_status', ['repoId', 'status']),

  docDrafts: defineTable({
    runId: v.id('runs'),
    docType: v.string(),             // "readme" | "api_reference"
    filePath: v.string(),            // e.g. "README.md" or "docs/api.md"
    content: v.string(),             // the generated markdown
    status: v.union(
      v.literal('draft'),
      v.literal('pr_opened'),
      v.literal('merged'),
      v.literal('dismissed')
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
  }).index('by_run', ['runId'])
    .index('by_repo', ['repoId']),
})
```

## Key files and their responsibilities

### `src/lib/github.ts`
GitHub App singleton. Always use `getInstallationOctokit(installationId)` to get an authenticated Octokit client for a specific repo installation. Never construct Octokit manually elsewhere — token rotation is handled here automatically.

### `src/app/api/webhooks/github/route.ts`
Receives all GitHub webhook events. Verifies signature first (reject anything unsigned). For `pull_request` events where `action === 'closed'` and `pull_request.merged === true`, enqueue a Convex action to run sync mode. Keep this handler thin — no business logic here, just validate + enqueue.

### `convex/actions/generateDocs.ts`
Long-running Convex action. Steps: fetch repo file tree → prioritize files (package.json → entry points → exports → skip tests/lockfiles) → chunk if needed → run LLM chain (analyze → plan → write) → commit files to new branch → open PR. Updates run status in DB throughout.

### `convex/actions/syncDocs.ts`
Long-running Convex action. Steps: fetch PR diff → fetch current doc files from repo → run LLM chain with both inputs → score confidence → if score > 0.7 open PR, otherwise mark run as suppressed. Updates run status in DB throughout.

### `src/lib/anthropic.ts`
Anthropic client singleton. All LLM calls go through here. Uses `claude-sonnet-4-5` model. Keep prompts in this file or co-located with the action that uses them.

## LLM pipeline

The pipeline is a 3-step chain used by both modes:

**Step 1 — Analyze**
What changed? (sync: semantic impact of the diff) / What is this? (generate: repo purpose and structure)

**Step 2 — Plan**
Which docs are affected and what sections need updating? Output a structured plan as JSON.

**Step 3 — Write**
Given the plan and relevant code context, write the markdown. One call per doc type.

Confidence scoring (sync only) happens between steps 2 and 3. If the plan says "no docs affected" or scores below 0.7, mark the run as `suppressed` and stop.

### Repo reading priority order (generate mode)
Always read in this order, stop when token budget is reached (~80k tokens):
1. `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod`
2. Entry points: `index.ts`, `src/index.ts`, `main.py`, `src/main.rs`, `cmd/main.go`
3. Files explicitly exported (check package.json `exports` field)
4. Source files in `src/` or `lib/`, shallowest first
5. Existing docs: `README.md`, `docs/`

Always skip: `node_modules/`, `dist/`, `build/`, `.next/`, `*.lock`, `*.log`, test files (`*.test.*`, `*.spec.*`, `__tests__/`)

## Environment variables

```bash
# Convex
CONVEX_DEPLOYMENT=dev:xxxx
NEXT_PUBLIC_CONVEX_URL=https://xxxx.convex.cloud

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# GitHub App
GITHUB_APP_ID=123456
GITHUB_APP_CLIENT_ID=Iv1.xxxx
GITHUB_APP_CLIENT_SECRET=xxxx
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nxxxx\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=your-random-secret

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

Private key note: the `.pem` file has real newlines. In `.env.local` these become literal `\n`. The `github.ts` singleton handles `.replace(/\\n/g, '\n')` automatically.

## Development setup

```bash
# Two terminals always running in dev:
pnpm dev           # Next.js (Turbopack, port 3000)
pnpm dlx convex dev  # Convex dev server (watches convex/ folder)

# For webhook testing (new URL each session — update GitHub App settings):
ngrok http 3000
```

## Next.js 16 specifics

- Turbopack is the default bundler — do not add `--turbopack` flag, it's redundant
- Use `proxy.ts` not `middleware.ts` for request interception (16 renamed it)
- `proxy.ts` runs Node.js runtime only — edge runtime is not supported
- Route handlers (`src/app/api/**/route.ts`) are unchanged from Next.js 15
- React Compiler is available but not enabled by default — don't enable unless needed

## Convex patterns

- **Queries** — `convex/` files exporting `query()`. Read-only, real-time by default.
- **Mutations** — `convex/` files exporting `mutation()`. Write operations.
- **Actions** — `convex/actions/` files exporting `action()`. Can call external APIs (GitHub, Anthropic). Can be long-running. Cannot directly read/write DB — must call mutations/queries via `ctx.runMutation()` / `ctx.runQuery()`.
- Always update run status at the start and end of every action so the dashboard reflects live state.

## Phase 0 scope (current)

Building the core pipeline only. No billing enforcement, no Notion/Confluence connectors, no fancy UI. The goal is one working end-to-end loop: connect a real repo → get a real PR opened with real generated docs.

Tasks in order:
- [x] T1 — Project setup + GitHub App registration
- [ ] T2 — Convex schema (define tables, indexes)
- [ ] T3 — Repo reader + file chunking strategy
- [ ] T4 — LLM pipeline (Generate mode)
- [ ] T5 — LLM pipeline (Sync mode + webhook wiring)
- [ ] T6 — PR creation via GitHub API

Out of scope for Phase 0:
- Dashboard UI beyond basic run status
- Stripe / billing enforcement
- Notion, Confluence, or any non-GitHub doc sources
- Confidence score tuning (hardcode 0.7 threshold for now)
- Team/multi-user features

## Coding conventions

- All new files in `src/` use TypeScript strict mode — no `any`, no unchecked nulls
- Convex schema is the single source of truth for data shapes — derive types from it, don't duplicate
- Async actions always have try/catch and update run status to `failed` with `errorMessage` on error
- No business logic in route handlers — validate + enqueue only
- No direct Anthropic API calls outside `src/lib/anthropic.ts` and the action files
- No direct GitHub API calls outside `src/lib/github.ts` and the action files
- Prefer `pnpm dlx` over `npx` for one-off commands

## Competitive context (for product decisions)

DocSync sits in the "auto-generated + continuously synced" quadrant that no competitor owns for modern dev teams:
- **DocuWriter** — closest competitor, but dashboard-centric (suggestions shown in their UI, not native to GitHub PR flow)
- **Swimm** — drift detection via CI but manual initial authoring
- **Mintlify** — beautiful hosting, but manual authoring at its core
- **Kodesage** — generate + sync but enterprise/legacy focus only

DocSync's differentiator: GitHub-native. Suggestions appear as PRs in the developer's existing workflow, not in a separate dashboard they have to remember to check.
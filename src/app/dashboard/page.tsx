'use client'

import { useState, useMemo } from 'react'
import { useUser, UserButton } from '@clerk/nextjs'
import { useQuery } from 'convex/react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'

const GITHUB_APP_INSTALL_URL = process.env.NEXT_PUBLIC_GITHUB_APP_INSTALL_URL ?? 'https://github.com/apps'

export default function DashboardPage() {
  const { user, isLoaded: isUserLoaded } = useUser()

  const org = useQuery(
    api.orgs.getOrgByClerkUser,
    isUserLoaded && user?.id ? { clerkUserId: user.id } : 'skip',
  )

  const repos = useQuery(
    api.repos.listReposByOrg,
    org ? { orgId: org._id } : 'skip',
  )

  const isLoading = !isUserLoaded || org === undefined || (org !== null && repos === undefined)

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="mx-auto max-w-5xl px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2 cursor-pointer">
              <span className="text-sm font-semibold text-foreground">DocSync AI</span>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">beta</Badge>
            </Link>
            <Separator orientation="vertical" className="" />
            <nav className="flex items-center gap-1">
              <Link
                href="/dashboard"
                className="inline-flex items-center h-7 rounded-md px-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors cursor-pointer"
              >
                Repositories
              </Link>
            </nav>
          </div>
          <UserButton />
        </div>
      </header>

      <main className="flex-1 mx-auto max-w-5xl w-full px-4 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Your repositories</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Repos connected to DocSync AI
            </p>
          </div>
          <a href={GITHUB_APP_INSTALL_URL} target="_blank" rel="noreferrer">
            <Button size="sm" className="cursor-pointer gap-1.5">
              <PlusIcon />
              Add repository
            </Button>
          </a>
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-3">
            {[1, 2, 3].map((num) => (
              <RepoCardSkeleton key={num} />
            ))}
          </div>
        ) : !org || !repos || repos.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
              <div className="size-12 rounded-xl bg-muted flex items-center justify-center text-muted-foreground">
                <BookOpenIcon />
              </div>
              <div className="flex flex-col gap-1">
                <CardTitle className="text-base font-medium">No repos connected yet</CardTitle>
                <CardDescription className="max-w-sm text-sm">
                  Install the DocSync GitHub App on a repository to start generating and syncing docs automatically.
                </CardDescription>
              </div>
              <a href={GITHUB_APP_INSTALL_URL} target="_blank" rel="noreferrer">
                <Button variant="outline" size="sm" className="cursor-pointer gap-1.5 mt-2">
                  <GitHubIcon />
                  Install GitHub App
                </Button>
              </a>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {repos.map((repoRecord) => (
              <RepoCard key={repoRecord._id} repo={repoRecord} />
            ))}
          </div>
        )}

        <div className="mt-10">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
            Run status legend
          </p>
          <div className="flex flex-wrap gap-2">
            <RunStatusBadge status="pending" />
            <RunStatusBadge status="running" />
            <RunStatusBadge status="completed" />
            <RunStatusBadge status="failed" />
            <RunStatusBadge status="suppressed" />
          </div>
        </div>
      </main>
    </div>
  )
}

interface RepoRecord {
  _id: Id<'repos'>
  fullName: string
  defaultBranch: string
  isActive: boolean
}

function RepoCard({ repo }: { repo: RepoRecord }) {
  const [isExpanded, setIsExpanded] = useState(false)

  const latestRun = useQuery(api.runs.getLatestRunByRepo, { repoId: repo._id })
  const runs = useQuery(api.runs.listRunsByRepo, isExpanded ? { repoId: repo._id } : 'skip')
  const pullRequests = useQuery(
    api.pull_requests.listPullRequestsByRepo,
    isExpanded ? { repoId: repo._id } : 'skip',
  )

  type PullRequestRecord = NonNullable<typeof pullRequests>[number]
  const pullRequestsByRunId = useMemo((): Map<string, PullRequestRecord> => {
    if (!pullRequests) return new Map()
    return new Map(pullRequests.map((pullRequest) => [pullRequest.runId, pullRequest]))
  }, [pullRequests])

  return (
    <Card className="overflow-hidden">
      <CardContent
        className="flex items-center justify-between py-4 cursor-pointer hover:bg-muted/40 transition-colors duration-150"
        onClick={() => setIsExpanded((prev) => !prev)}
      >
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
            <GitHubIcon />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">{repo.fullName}</span>
            <span className="text-xs text-muted-foreground">
              Default branch: {repo.defaultBranch}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={repo.isActive ? 'secondary' : 'outline'} className="gap-1.5">
            <span className={`size-1.5 rounded-full inline-block ${repo.isActive ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />
            {repo.isActive ? 'Active' : 'Inactive'}
          </Badge>
          {latestRun !== undefined && latestRun !== null && (
            <RunStatusBadge status={latestRun.status} />
          )}
          <ChevronDownIcon isExpanded={isExpanded} />
        </div>
      </CardContent>

      {isExpanded && (
        <div className="border-t border-border">
          {runs === undefined ? (
            <RunHistorySkeleton />
          ) : runs.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No runs yet. Trigger a generate or wait for a PR to merge.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {runs.map((run) => (
                <RunRow
                  key={run._id}
                  run={run}
                  pullRequest={pullRequestsByRunId.get(run._id) ?? null}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

interface RunRowProps {
  run: {
    _id: Id<'runs'>
    mode: 'generate' | 'sync'
    status: RunStatus
    triggerPrNumber?: number
    triggerPrTitle?: string
    confidenceScore?: number
    startedAt: number
    completedAt?: number
  }
  pullRequest: { githubPrUrl: string; githubPrNumber: number } | null
}

function RunRow({ run, pullRequest }: RunRowProps) {
  const description =
    run.mode === 'sync' && run.triggerPrTitle
      ? run.triggerPrTitle
      : run.mode === 'generate'
        ? 'Initial docs generation'
        : 'Sync run'

  const prLabel =
    run.mode === 'sync' && run.triggerPrNumber !== undefined
      ? `#${run.triggerPrNumber}`
      : null

  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors duration-150">
      <div className="flex items-center gap-2 w-[72px] shrink-0">
        <Badge
          variant={run.mode === 'generate' ? 'default' : 'secondary'}
          className="text-[10px] px-1.5 py-0 uppercase tracking-wide"
        >
          {run.mode === 'generate' ? 'Gen' : 'Sync'}
        </Badge>
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">{description}</p>
        {prLabel !== null && (
          <p className="text-xs text-muted-foreground mt-0.5">Triggered by {prLabel}</p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs text-muted-foreground">{formatRelativeTime(run.startedAt)}</span>
        <RunStatusBadge status={run.status} />
        {pullRequest !== null ? (
          <a
            href={pullRequest.githubPrUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(clickEvent) => clickEvent.stopPropagation()}
            className="text-muted-foreground hover:text-foreground transition-colors duration-150"
            aria-label={`Open PR #${pullRequest.githubPrNumber} on GitHub`}
          >
            <ExternalLinkIcon />
          </a>
        ) : (
          <div className="size-3.5" />
        )}
      </div>
    </div>
  )
}

function RunHistorySkeleton() {
  return (
    <div className="divide-y divide-border">
      {[1, 2, 3].map((num) => (
        <div key={num} className="flex items-center gap-3 px-4 py-3">
          <div className="h-4 w-10 rounded-full bg-muted animate-pulse shrink-0" />
          <div className="flex-1 h-3.5 rounded-full bg-muted animate-pulse" />
          <div className="h-4 w-20 rounded-full bg-muted animate-pulse shrink-0" />
        </div>
      ))}
    </div>
  )
}

function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp
  const diffMins = Math.floor(diffMs / 60_000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) return `${diffDays}d ago`
  const diffMonths = Math.floor(diffDays / 30)
  return `${diffMonths}mo ago`
}

function ChevronDownIcon({ isExpanded }: { isExpanded: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={`size-3.5 text-muted-foreground transition-transform duration-200 ${isExpanded ? 'rotate-180' : 'rotate-0'}`}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
    </svg>
  )
}

function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3.5" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
  )
}

function RepoCardSkeleton() {
  return (
    <Card>
      <CardContent className="flex items-center justify-between py-4">
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-lg bg-muted animate-pulse" />
          <div className="flex flex-col gap-1.5">
            <div className="h-3.5 w-36 rounded-full bg-muted animate-pulse" />
            <div className="h-3 w-28 rounded-full bg-muted/60 animate-pulse" />
          </div>
        </div>
        <div className="h-5 w-14 rounded-full bg-muted animate-pulse" />
      </CardContent>
    </Card>
  )
}

type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'suppressed'

const RUN_STATUS_CONFIG: Record<RunStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; dot: string }> = {
  pending:    { label: 'Pending',    variant: 'secondary',   dot: 'bg-muted-foreground' },
  running:    { label: 'Running',    variant: 'outline',     dot: 'bg-blue-500 animate-pulse' },
  completed:  { label: 'Completed',  variant: 'secondary',   dot: 'bg-emerald-500' },
  failed:     { label: 'Failed',     variant: 'destructive', dot: 'bg-destructive' },
  suppressed: { label: 'Suppressed', variant: 'outline',     dot: 'bg-muted-foreground' },
}

function RunStatusBadge({ status }: { status: RunStatus }) {
  const config = RUN_STATUS_CONFIG[status]
  return (
    <Badge variant={config.variant} className="gap-1.5">
      <span className={`size-1.5 rounded-full ${config.dot} inline-block`} />
      {config.label}
    </Badge>
  )
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3.5" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  )
}

function BookOpenIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-6" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
    </svg>
  )
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5 fill-current" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  )
}

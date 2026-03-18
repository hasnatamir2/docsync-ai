import { Show, SignInButton, UserButton } from '@clerk/nextjs'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="fixed top-4 left-4 right-4 z-50">
        <div className="mx-auto max-w-5xl rounded-xl border border-border bg-card/80 px-4 py-2.5 backdrop-blur-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">DocSync AI</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">beta</Badge>
          </div>
          <Show
            when="signed-in"
            fallback={
              <SignInButton mode="modal">
                <Button size="sm" className="cursor-pointer">
                  Sign in
                </Button>
              </SignInButton>
            }
          >
            <div className="flex items-center gap-3">
              <Link href="/dashboard">
                <Button size="sm" variant="ghost" className="cursor-pointer">
                  Dashboard
                </Button>
              </Link>
              <UserButton />
            </div>
          </Show>
        </div>
      </header>

      <main className="relative flex flex-1 flex-col items-center justify-center px-4 pt-24 pb-16 overflow-hidden">
        <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 h-[28rem] w-[56rem] rounded-full bg-primary/8 blur-3xl" aria-hidden="true" />
        <div className="mx-auto max-w-2xl flex flex-col items-center gap-6 text-center relative">
          <Badge variant="outline" className="gap-1.5 text-xs font-normal">
            <span className="size-1.5 rounded-full bg-emerald-500 inline-block" />
            Docs that stay in sync with your code
          </Badge>

          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl text-foreground">
            Never write stale docs again
          </h1>

          <p className="text-base text-muted-foreground leading-relaxed max-w-lg">
            DocSync AI watches your GitHub repos and opens a PR whenever your docs fall behind.
            Every merged PR triggers a review — automatically.
          </p>

          <div className="flex items-center gap-3 pt-2">
            <Show
              when="signed-in"
              fallback={
                <SignInButton mode="modal">
                  <Button size="lg" className="cursor-pointer gap-2">
                    <GitHubIcon />
                    Connect GitHub
                  </Button>
                </SignInButton>
              }
            >
              <Link href="/dashboard">
                <Button size="lg" className="cursor-pointer gap-2">
                  <GitHubIcon />
                  Go to Dashboard
                </Button>
              </Link>
            </Show>
          </div>
        </div>

        <Separator className="mt-20 max-w-5xl mx-auto" />

        {/* Feature grid */}
        <div className="mt-16 mx-auto max-w-5xl w-full grid grid-cols-1 sm:grid-cols-3 gap-4 px-4">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="rounded-xl border border-border bg-card p-5 flex flex-col gap-3 transition-colors hover:border-border/60"
            >
              <div className={`size-8 rounded-lg flex items-center justify-center ${feature.iconClassName}`}>
                {feature.icon}
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">{feature.title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{feature.description}</p>
              </div>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t border-border py-6 text-center">
        <p className="text-xs text-muted-foreground">
          DocSync AI — built for developer teams
        </p>
      </footer>
    </div>
  )
}

const FEATURES = [
  {
    title: 'Auto-generate docs',
    description: 'Connect a repo and get a full README + API reference PR in minutes, generated from your source code.',
    icon: <SparklesIcon />,
    iconClassName: 'bg-primary/10 text-primary',
  },
  {
    title: 'Sync on every merge',
    description: 'Every merged PR triggers a diff analysis. If docs are affected, a sync PR is opened automatically.',
    icon: <ArrowPathIcon />,
    iconClassName: 'bg-emerald-500/10 text-emerald-400',
  },
  {
    title: 'Confidence scoring',
    description: "Changes below 70% confidence are suppressed — you only get PRs when something actually needs updating.",
    icon: <ShieldCheckIcon />,
    iconClassName: 'bg-violet-500/10 text-violet-400',
  },
]

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  )
}

function SparklesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-4" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" />
    </svg>
  )
}

function ArrowPathIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-4" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
    </svg>
  )
}

function ShieldCheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-4" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
    </svg>
  )
}

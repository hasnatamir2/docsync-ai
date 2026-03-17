import { Show, SignInButton, UserButton } from '@clerk/nextjs'
import Link from 'next/link'

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-4 bg-white dark:bg-zinc-950">
      <div className="flex flex-col items-center gap-4 text-center max-w-xl">
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          DocSync AI
        </h1>
        <p className="text-lg text-zinc-500 dark:text-zinc-400">
          Automatically generates and keeps your technical documentation in sync with your codebase.
          Every merged PR triggers a doc review — no stale docs, ever.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <Show
          when="signed-in"
          fallback={
            <SignInButton mode="modal">
              <button className="rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200">
                Connect GitHub
              </button>
            </SignInButton>
          }
        >
          <Link
            href="/dashboard"
            className="rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Go to Dashboard
          </Link>
          <UserButton />
        </Show>
      </div>
    </main>
  )
}

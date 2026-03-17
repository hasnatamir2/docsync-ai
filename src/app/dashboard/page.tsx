export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 px-4 py-12">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50 mb-8">
          Your repositories
        </h1>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-12 flex flex-col items-center gap-4 text-center">
          <p className="text-zinc-500 dark:text-zinc-400 text-sm">No repos connected yet</p>
          <p className="text-zinc-400 dark:text-zinc-500 text-xs max-w-sm">
            Install the DocSync GitHub App on a repository to start generating and syncing docs automatically.
          </p>
        </div>
      </div>
    </main>
  )
}

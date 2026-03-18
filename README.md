# docsync-ai

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Features

- **GitHub App Integration**: Connect repositories directly through GitHub App installation
- **Automated Documentation Generation**: Initial documentation creation for newly connected repositories
- **Smart Documentation Sync**: Automatically updates documentation when pull requests are merged
- **Interactive Dashboard**: Monitor all connected repositories with expandable cards showing:
  - Repository status (Active/Inactive)
  - Latest run status at a glance
  - Complete run history with timestamps
  - Run type indicators (Generate vs. Sync)
  - Associated pull request links
  - Real-time status updates
- **Pull Request Tracking**: View which PRs triggered documentation updates with direct GitHub links

## Getting Started

First, run the development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Dashboard Usage

Once you've connected your repositories via the GitHub App, the dashboard provides comprehensive visibility into your documentation automation:

1. **Repository Overview**: Each connected repository displays as an expandable card showing its full name, default branch, and activity status
2. **Latest Status**: The most recent run status is displayed directly on each repository card for quick status checks
3. **Detailed Run History**: Click any repository card to expand and view:
   - All documentation generation and sync runs
   - Run type badges (Generate for initial creation, Sync for updates)
   - Timestamps showing when each run occurred
   - Current status of each run (pending, in progress, completed, or failed)
   - Triggering pull request information (for sync runs)
   - Direct links to associated documentation PRs on GitHub
4. **PR Integration**: For sync runs, see which code PRs triggered documentation updates and access the resulting documentation PRs with a single click

The dashboard automatically refreshes to show real-time updates as documentation runs progress.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

import { App } from 'octokit'

const privateKey = (process.env.GITHUB_APP_PRIVATE_KEY ?? '').replace(/\\n/g, '\n')

const githubApp = new App({
  appId: process.env.GITHUB_APP_ID!,
  privateKey,
  oauth: {
    clientId: process.env.GITHUB_APP_CLIENT_ID!,
    clientSecret: process.env.GITHUB_APP_CLIENT_SECRET!,
  },
  webhooks: {
    secret: process.env.GITHUB_WEBHOOK_SECRET!,
  },
})

export async function getInstallationOctokit(installationId: number) {
  return githubApp.getInstallationOctokit(installationId)
}

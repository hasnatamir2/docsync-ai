import Anthropic from '@anthropic-ai/sdk'

export const MODEL = 'claude-sonnet-4-5'

let client: Anthropic | null = null

export function getAnthropicClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return client
}

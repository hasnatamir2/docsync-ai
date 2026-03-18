"use node"

import { internalAction } from '../_generated/server'
import { api } from '../_generated/api'
import { v } from 'convex/values'
import type { Id } from '../_generated/dataModel'
import { getInstallationOctokit, createDocsPullRequest } from '../../src/lib/github'
import type { DocsPullRequestFileEntry } from '../../src/lib/github'
import { getAnthropicClient, MODEL } from '../../src/lib/anthropic'

// ─── Constants ────────────────────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.7
const DOCS_BRANCH_PREFIX_SYNC = 'docs/sync'
const SYNC_DOC_FILE_PATHS: Record<string, string> = {
  readme: 'README.md',
  api_reference: 'docs/api.md',
}

// ─── Types ────────────────────────────────────────────────────────────────────

type OctokitInstance = Awaited<ReturnType<typeof getInstallationOctokit>>

interface PullRequestFileDiff {
  filePath: string
  status: string
  additions: number
  deletions: number
  patch: string | undefined
}

interface DiffAnalysisResult {
  semanticImpact: string
  affectedAreas: string[]
  changeCategory: 'feature' | 'bugfix' | 'refactor' | 'chore' | 'breaking'
  hasPublicApiChanges: boolean
  hasConfigChanges: boolean
}

interface SyncDocPlan {
  affectedDocTypes: string[]
  filePathMap: Record<string, string>
  sectionsToUpdate: Record<string, string[]>
  reasoning: string
  confidence: number
}

interface ExistingDocContent {
  docType: string
  filePath: string
  content: string
  wasFetched: boolean
}

interface DocDraftEntry {
  docType: string
  filePath: string
  content: string
  docDraftId: Id<'docDrafts'>
}

// ─── LLM prompt constants ─────────────────────────────────────────────────────

const SYNC_ANALYZE_SYSTEM_PROMPT =
  'You are a senior software engineer analyzing a pull request diff to understand its semantic impact on technical documentation. Respond with a JSON object only. No markdown fences, no explanation outside JSON.'

const SYNC_PLAN_SYSTEM_PROMPT =
  'You are a technical documentation architect deciding whether a merged PR requires documentation updates. Respond with a JSON object only. No markdown fences, no explanation outside JSON.'

const SYNC_WRITE_SYSTEM_PROMPT =
  'You are an expert technical writer updating existing documentation to reflect merged code changes. Output raw markdown only — no JSON, no explanation, no outer code fences.'

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildSyncAnalyzePrompt(
  repoFullName: string,
  triggerPrTitle: string,
  formattedDiff: string,
): string {
  return `Analyze the following repository: ${repoFullName}
Pull request title: "${triggerPrTitle}"

Here is the diff of files changed in this PR:

${formattedDiff}

Respond with this exact JSON structure:
{
  "semanticImpact": "<one to three sentences describing what changed and why it matters for docs>",
  "affectedAreas": ["<area 1>", "<area 2>"],
  "changeCategory": "<feature|bugfix|refactor|chore|breaking>",
  "hasPublicApiChanges": <true|false>,
  "hasConfigChanges": <true|false>
}`
}

function buildSyncPlanPrompt(
  repoFullName: string,
  diffAnalysis: DiffAnalysisResult,
  existingDocContents: ExistingDocContent[],
  requestedDocTypes: string[],
): string {
  const existingDocsSection = existingDocContents
    .map((docContent) =>
      docContent.wasFetched
        ? `### ${docContent.docType} (${docContent.filePath})\n${docContent.content}`
        : `### ${docContent.docType} (${docContent.filePath})\n[File does not exist yet]`,
    )
    .join('\n\n')

  return `Repository: ${repoFullName}
Registered doc types: ${requestedDocTypes.join(', ')}

Diff analysis:
${JSON.stringify(diffAnalysis, null, 2)}

Current documentation content:
${existingDocsSection}

Based on the diff analysis and current docs, decide which documents need updating.

Respond with this exact JSON structure:
{
  "affectedDocTypes": ["readme", "api_reference"],
  "filePathMap": {
    "readme": "README.md",
    "api_reference": "docs/api.md"
  },
  "sectionsToUpdate": {
    "readme": ["Usage", "Configuration"],
    "api_reference": ["Endpoints", "Authentication"]
  },
  "reasoning": "<brief explanation of what needs updating and why>",
  "confidence": <float between 0.0 and 1.0 indicating certainty that docs actually need updating>
}

If the diff has no meaningful impact on documentation, return an empty "affectedDocTypes" array and a low confidence score (below 0.5).
A score of 0.7 or above means you are confident docs need updating. Below 0.7 the update will be suppressed.`
}

function buildSyncWritePrompt(
  repoFullName: string,
  docType: string,
  filePath: string,
  diffAnalysis: DiffAnalysisResult,
  existingContent: string,
  sectionsToUpdate: string[],
  formattedDiff: string,
): string {
  return `Repository: ${repoFullName}
Doc type: ${docType}
File path: ${filePath}

What changed (diff analysis):
${JSON.stringify(diffAnalysis, null, 2)}

Sections that need updating:
- ${sectionsToUpdate.join('\n- ')}

Current documentation:
${existingContent}

Code diff for reference:
${formattedDiff}

Rewrite the full ${docType} document incorporating the changes. Keep all sections that don't need updating exactly as they were.
Only update sections that are directly affected by the code changes described above.
Output the complete updated markdown document starting from the first heading.`
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseJsonFromLlmResponse<ParsedType>(rawText: string): ParsedType {
  const trimmedText = rawText.trim()
  const fenceMatch = trimmedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  const jsonText = fenceMatch !== null ? fenceMatch[1] : trimmedText
  return JSON.parse(jsonText) as ParsedType
}

function formatPullRequestDiffForLlm(diffEntries: PullRequestFileDiff[]): string {
  const formattedEntries = diffEntries.map((diffEntry) => {
    const headerLine = `### ${diffEntry.status.toUpperCase()}: ${diffEntry.filePath} (+${diffEntry.additions}/-${diffEntry.deletions})`
    const patchBlock =
      diffEntry.patch !== undefined
        ? `\`\`\`diff\n${diffEntry.patch}\n\`\`\``
        : '_Binary file — no text diff available_'
    return `${headerLine}\n${patchBlock}`
  })
  return formattedEntries.join('\n\n')
}

// ─── GitHub fetch helpers ─────────────────────────────────────────────────────

async function fetchPullRequestDiff(
  octokit: OctokitInstance,
  ownerName: string,
  repoName: string,
  triggerPrNumber: number,
): Promise<PullRequestFileDiff[]> {
  const filesResponse = await octokit.rest.pulls.listFiles({
    owner: ownerName,
    repo: repoName,
    pull_number: triggerPrNumber,
    per_page: 100,
  })
  return filesResponse.data.map((fileEntry) => ({
    filePath: fileEntry.filename,
    status: fileEntry.status,
    additions: fileEntry.additions,
    deletions: fileEntry.deletions,
    patch: fileEntry.patch,
  }))
}

async function fetchExistingDocContents(
  octokit: OctokitInstance,
  ownerName: string,
  repoName: string,
  defaultBranch: string,
  requestedDocTypes: string[],
): Promise<ExistingDocContent[]> {
  const docContents: ExistingDocContent[] = []

  for (const docType of requestedDocTypes) {
    const filePath = SYNC_DOC_FILE_PATHS[docType] ?? `docs/${docType}.md`

    try {
      const contentResponse = await octokit.rest.repos.getContent({
        owner: ownerName,
        repo: repoName,
        path: filePath,
        ref: defaultBranch,
      })
      const responseData = contentResponse.data

      if (Array.isArray(responseData) || responseData.type !== 'file') {
        docContents.push({ docType, filePath, content: '', wasFetched: false })
        continue
      }

      const decodedContent = Buffer.from(responseData.content, 'base64').toString('utf-8')
      docContents.push({ docType, filePath, content: decodedContent, wasFetched: true })
    } catch {
      // File does not exist in repo yet — include with empty content
      docContents.push({ docType, filePath, content: '', wasFetched: false })
    }
  }

  return docContents
}

// ─── Main action ──────────────────────────────────────────────────────────────

export const syncRepoDocsOnMerge = internalAction({
  args: {
    runId: v.id('runs'),
    repoId: v.id('repos'),
    installationId: v.number(),
    triggerPrNumber: v.number(),
    triggerPrTitle: v.string(),
  },
  handler: async (actionContext, args) => {
    // 1. Mark run as running
    await actionContext.runMutation(api.runs.updateRunStatus, {
      runId: args.runId,
      status: 'running',
    })

    try {
      // 2. Fetch repo record
      const repoRecord = await actionContext.runQuery(api.repos.getRepo, {
        repoId: args.repoId,
      })
      if (repoRecord === null) {
        throw new Error(`Repo not found in database: ${args.repoId}`)
      }

      const splitResult = repoRecord.fullName.split('/')
      const ownerName = splitResult[0]
      const repoName = splitResult[1]
      if (ownerName === undefined || repoName === undefined) {
        throw new Error(`Invalid repo fullName format: ${repoRecord.fullName}`)
      }

      const requestedDocTypes =
        repoRecord.docTypes.length > 0 ? repoRecord.docTypes : ['readme', 'api_reference']

      const octokit = await getInstallationOctokit(args.installationId)

      // 3. Fetch PR diff
      const pullRequestDiffEntries = await fetchPullRequestDiff(
        octokit,
        ownerName,
        repoName,
        args.triggerPrNumber,
      )
      const formattedDiff = formatPullRequestDiffForLlm(pullRequestDiffEntries)

      // 4. Fetch existing doc files
      const existingDocContents = await fetchExistingDocContents(
        octokit,
        ownerName,
        repoName,
        repoRecord.defaultBranch,
        requestedDocTypes,
      )

      const anthropicClient = getAnthropicClient()

      // ── Analyze step ────────────────────────────────────────────────────────
      const analyzeResponse = await anthropicClient.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: SYNC_ANALYZE_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: buildSyncAnalyzePrompt(
              repoRecord.fullName,
              args.triggerPrTitle,
              formattedDiff,
            ),
          },
        ],
      })

      const analyzeTextBlock = analyzeResponse.content.find((block) => block.type === 'text')
      if (analyzeTextBlock === undefined || analyzeTextBlock.type !== 'text') {
        throw new Error('Analyze step returned no text content from LLM')
      }
      const diffAnalysis = parseJsonFromLlmResponse<DiffAnalysisResult>(analyzeTextBlock.text)

      // ── Plan step ───────────────────────────────────────────────────────────
      const planResponse = await anthropicClient.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: SYNC_PLAN_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: buildSyncPlanPrompt(
              repoRecord.fullName,
              diffAnalysis,
              existingDocContents,
              requestedDocTypes,
            ),
          },
        ],
      })

      const planTextBlock = planResponse.content.find((block) => block.type === 'text')
      if (planTextBlock === undefined || planTextBlock.type !== 'text') {
        throw new Error('Plan step returned no text content from LLM')
      }
      const syncDocPlan = parseJsonFromLlmResponse<SyncDocPlan>(planTextBlock.text)

      // ── Confidence gate ──────────────────────────────────────────────────────
      const isConfidenceAboveThreshold = syncDocPlan.confidence >= CONFIDENCE_THRESHOLD
      if (!isConfidenceAboveThreshold || syncDocPlan.affectedDocTypes.length === 0) {
        await actionContext.runMutation(api.runs.updateRunStatus, {
          runId: args.runId,
          status: 'suppressed',
          confidenceScore: syncDocPlan.confidence,
        })
        return
      }

      // ── Write step (serial per affected doc type) ────────────────────────────
      const docDraftEntries: DocDraftEntry[] = []

      for (const docType of syncDocPlan.affectedDocTypes) {
        const filePath =
          syncDocPlan.filePathMap[docType] ??
          SYNC_DOC_FILE_PATHS[docType] ??
          `docs/${docType}.md`
        const sectionsToUpdate = syncDocPlan.sectionsToUpdate[docType] ?? []

        const existingDocEntry = existingDocContents.find(
          (docContent) => docContent.docType === docType,
        )
        const existingContent = existingDocEntry?.content ?? ''

        const writeResponse = await anthropicClient.messages.create({
          model: MODEL,
          max_tokens: 4096,
          system: SYNC_WRITE_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: buildSyncWritePrompt(
                repoRecord.fullName,
                docType,
                filePath,
                diffAnalysis,
                existingContent,
                sectionsToUpdate,
                formattedDiff,
              ),
            },
          ],
        })

        const writeTextBlock = writeResponse.content.find((block) => block.type === 'text')
        if (writeTextBlock === undefined || writeTextBlock.type !== 'text') {
          throw new Error(`Write step returned no text content for doc type: ${docType}`)
        }

        const docDraftId = await actionContext.runMutation(api.doc_drafts.createDocDraft, {
          runId: args.runId,
          docType,
          filePath,
          content: writeTextBlock.text,
        })

        docDraftEntries.push({ docType, filePath, content: writeTextBlock.text, docDraftId })
      }

      // ── Create GitHub branch + commit + PR ──────────────────────────────────
      const fileList = docDraftEntries.map((entry) => `- \`${entry.filePath}\``).join('\n')
      const prTitle = `docs: sync documentation for PR #${args.triggerPrNumber}`

      const prCreationResult = await createDocsPullRequest(octokit, {
        ownerName,
        repoName,
        defaultBranch: repoRecord.defaultBranch,
        docDraftEntries: docDraftEntries.map((entry): DocsPullRequestFileEntry => ({
          filePath: entry.filePath,
          content: entry.content,
        })),
        branchPrefix: DOCS_BRANCH_PREFIX_SYNC,
        commitMessage: `docs: sync documentation for PR #${args.triggerPrNumber} via DocSync AI`,
        prTitle,
        prBody: [
          `## Documentation update triggered by PR #${args.triggerPrNumber}`,
          '',
          `> **${args.triggerPrTitle}**`,
          '',
          `**Confidence score:** ${(syncDocPlan.confidence * 100).toFixed(0)}%`,
          '',
          `**Reasoning:** ${syncDocPlan.reasoning}`,
          '',
          '### Files updated',
          fileList,
          '',
          '---',
          '_Generated by DocSync AI. Review and merge when ready._',
        ].join('\n'),
      })

      // ── Record PR and update draft statuses ─────────────────────────────────
      await actionContext.runMutation(api.pull_requests.createPullRequest, {
        runId: args.runId,
        repoId: args.repoId,
        githubPrNumber: prCreationResult.githubPrNumber,
        githubPrUrl: prCreationResult.githubPrUrl,
        title: prCreationResult.prTitle,
      })

      for (const docDraftEntry of docDraftEntries) {
        await actionContext.runMutation(api.doc_drafts.updateDocDraftStatus, {
          docDraftId: docDraftEntry.docDraftId,
          status: 'pr_opened',
        })
      }

      // ── Mark run completed ───────────────────────────────────────────────────
      await actionContext.runMutation(api.runs.updateRunStatus, {
        runId: args.runId,
        status: 'completed',
        confidenceScore: syncDocPlan.confidence,
      })
    } catch (caughtError) {
      const errorMessage =
        caughtError instanceof Error
          ? caughtError.message
          : 'Unknown error in syncRepoDocsOnMerge action'

      await actionContext.runMutation(api.runs.updateRunStatus, {
        runId: args.runId,
        status: 'failed',
        errorMessage,
      })
    }
  },
})

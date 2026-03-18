"use node"

import { internalAction } from '../_generated/server'
import { internal } from '../_generated/api'
import { v } from 'convex/values'
import type { Id } from '../_generated/dataModel'
import { getInstallationOctokit, createDocsPullRequest } from '../../src/lib/github'
import type { DocsPullRequestFileEntry } from '../../src/lib/github'
import { getAnthropicClient, MODEL } from '../../src/lib/anthropic'
import { fetchRepoContext } from '../../src/lib/repo-reader'
import type { RepoContext } from '../../src/lib/repo-reader'

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_DOC_TYPES: string[] = ['readme', 'api_reference']

const FILE_PATH_DEFAULTS: Record<string, string> = {
  readme: 'README.md',
  api_reference: 'docs/api.md',
}

const DOCS_BRANCH_PREFIX = 'docs/generate'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RepoAnalysisResult {
  repoPurpose: string
  primaryLanguage: string
  keyFeatures: string[]
  techStack: string[]
  hasExistingDocs: boolean
  estimatedComplexity: 'simple' | 'moderate' | 'complex'
}

interface DocPlan {
  docTypes: string[]
  filePathMap: Record<string, string>
  sections: Record<string, string[]>
  reasoning: string
}

interface DocDraftEntry {
  docType: string
  filePath: string
  content: string
  docDraftId: Id<'docDrafts'>
}

// ─── LLM prompt constants ─────────────────────────────────────────────────────

const ANALYZE_SYSTEM_PROMPT =
  'You are a senior technical writer analyzing a software repository to understand what it is and how it works. Respond with a JSON object only. No markdown fences, no explanation outside JSON.'

const PLAN_SYSTEM_PROMPT =
  'You are a technical documentation architect. Given a code analysis, decide which documentation files to generate and what sections each should contain. Respond with a JSON object only. No markdown fences, no explanation outside JSON.'

const WRITE_SYSTEM_PROMPT =
  'You are an expert technical writer. Write complete, production-quality markdown documentation. Output raw markdown only — no JSON, no explanation, no outer code fences.'

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildAnalyzePrompt(repoFullName: string, formattedFileChunks: string): string {
  return `Analyze the following repository: ${repoFullName}

Here are the source files:

${formattedFileChunks}

Respond with this exact JSON structure:
{
  "repoPurpose": "<one sentence describing what this repo does>",
  "primaryLanguage": "<primary programming language>",
  "keyFeatures": ["<feature 1>", "<feature 2>"],
  "techStack": ["<technology 1>", "<technology 2>"],
  "hasExistingDocs": <true|false>,
  "estimatedComplexity": "<simple|moderate|complex>"
}`
}

function buildPlanPrompt(
  repoFullName: string,
  analysisResult: RepoAnalysisResult,
  requestedDocTypes: string[],
): string {
  return `Repository: ${repoFullName}
Analysis: ${JSON.stringify(analysisResult)}

The user has requested the following doc types: ${requestedDocTypes.join(', ')}

For each requested doc type, plan the documentation. Map each doc type to a file path and a list of section headings.

Respond with this exact JSON structure:
{
  "docTypes": ["readme", "api_reference"],
  "filePathMap": {
    "readme": "README.md",
    "api_reference": "docs/api.md"
  },
  "sections": {
    "readme": ["Overview", "Installation", "Usage", "Configuration", "Contributing"],
    "api_reference": ["Introduction", "Authentication", "Endpoints", "Request Format", "Response Format", "Error Codes"]
  },
  "reasoning": "<brief explanation of documentation strategy>"
}

Only include doc types from the requested list. If docTypes should be empty (the repo has no meaningful public API or docs to generate), return an empty array for docTypes.`
}

function buildWritePrompt(
  repoFullName: string,
  docType: string,
  filePath: string,
  analysisResult: RepoAnalysisResult,
  sections: string[],
  formattedFileChunks: string,
): string {
  return `Repository: ${repoFullName}
Doc type: ${docType}
File path: ${filePath}

Code analysis:
${JSON.stringify(analysisResult, null, 2)}

Sections to include:
- ${sections.join('\n- ')}

Source files for reference:
${formattedFileChunks}

Write the complete ${docType} documentation as a single markdown document. Start directly with the first heading.
Include concrete examples from the actual code where relevant. Be specific — only document what actually exists in the code.
The document must contain all of these sections: ${sections.join(', ')}.`
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatFileChunksForLlm(repoContext: RepoContext): string {
  const formattedSections: string[] = []

  for (const fileChunk of repoContext.fileChunks) {
    const chunkHeader =
      fileChunk.totalChunks > 1
        ? `### FILE: ${fileChunk.path} (part ${fileChunk.chunkIndex + 1}/${fileChunk.totalChunks})`
        : `### FILE: ${fileChunk.path}`

    formattedSections.push(`${chunkHeader}\n\`\`\`\n${fileChunk.content}\n\`\`\``)
  }

  const truncationNotice = repoContext.isTruncated
    ? `> Note: Codebase was truncated. ${repoContext.totalFilesIncluded} of ${repoContext.totalFilesScanned} files shown.\n\n`
    : ''

  return `${truncationNotice}${formattedSections.join('\n\n')}`
}

function parseJsonFromLlmResponse<ParsedType>(rawText: string): ParsedType {
  const trimmedText = rawText.trim()
  const fenceMatch = trimmedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  const jsonText = fenceMatch !== null ? fenceMatch[1] : trimmedText
  return JSON.parse(jsonText) as ParsedType
}

// ─── Main action ──────────────────────────────────────────────────────────────

export const generateRepoDocs = internalAction({
  args: {
    runId: v.id('runs'),
    repoId: v.id('repos'),
    installationId: v.number(),
  },
  handler: async (actionContext, args) => {
    // 1. Mark run as running
    await actionContext.runMutation(internal.runs.updateRunStatus, {
      runId: args.runId,
      status: 'running',
    })

    try {
      // 2. Fetch repo record from DB
      const repoRecord = await actionContext.runQuery(internal.repos.getRepo, {
        repoId: args.repoId,
      })
      if (repoRecord === null) {
        throw new Error(`Repo not found in database: ${args.repoId}`)
      }

      // 3. Split fullName into owner/repo parts
      const splitResult = repoRecord.fullName.split('/')
      const ownerName = splitResult[0]
      const repoName = splitResult[1]
      if (ownerName === undefined || repoName === undefined) {
        throw new Error(`Invalid repo fullName format: ${repoRecord.fullName}`)
      }

      const requestedDocTypes =
        repoRecord.docTypes.length > 0 ? repoRecord.docTypes : DEFAULT_DOC_TYPES

      // 4. Fetch repo context (file tree + prioritized chunks)
      const repoContext = await fetchRepoContext({
        repoFullName: repoRecord.fullName,
        defaultBranch: repoRecord.defaultBranch,
        installationId: args.installationId,
      })

      // 5. Format chunks for LLM
      const formattedFileChunks = formatFileChunksForLlm(repoContext)
      const anthropicClient = getAnthropicClient()

      // ── Analyze step ────────────────────────────────────────────────────────
      const analyzeResponse = await anthropicClient.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: ANALYZE_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: buildAnalyzePrompt(repoRecord.fullName, formattedFileChunks),
          },
        ],
      })

      const analyzeTextBlock = analyzeResponse.content.find((block) => block.type === 'text')
      if (analyzeTextBlock === undefined || analyzeTextBlock.type !== 'text') {
        throw new Error('Analyze step returned no text content from LLM')
      }
      const analysisResult = parseJsonFromLlmResponse<RepoAnalysisResult>(analyzeTextBlock.text)

      // ── Plan step ───────────────────────────────────────────────────────────
      const planResponse = await anthropicClient.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: PLAN_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: buildPlanPrompt(repoRecord.fullName, analysisResult, requestedDocTypes),
          },
        ],
      })

      const planTextBlock = planResponse.content.find((block) => block.type === 'text')
      if (planTextBlock === undefined || planTextBlock.type !== 'text') {
        throw new Error('Plan step returned no text content from LLM')
      }
      const docPlan = parseJsonFromLlmResponse<DocPlan>(planTextBlock.text)

      // Early exit if plan has nothing to generate
      if (docPlan.docTypes.length === 0) {
        await actionContext.runMutation(internal.runs.updateRunStatus, {
          runId: args.runId,
          status: 'completed',
          errorMessage: 'Doc plan returned no document types — nothing to generate.',
        })
        return
      }

      // ── Write step (serial per doc type) ────────────────────────────────────
      const docDraftEntries: DocDraftEntry[] = []

      for (const docType of docPlan.docTypes) {
        const filePath =
          docPlan.filePathMap[docType] ?? FILE_PATH_DEFAULTS[docType] ?? `docs/${docType}.md`
        const sections = docPlan.sections[docType] ?? []

        const writeResponse = await anthropicClient.messages.create({
          model: MODEL,
          max_tokens: 4096,
          system: WRITE_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: buildWritePrompt(
                repoRecord.fullName,
                docType,
                filePath,
                analysisResult,
                sections,
                formattedFileChunks,
              ),
            },
          ],
        })

        const writeTextBlock = writeResponse.content.find((block) => block.type === 'text')
        if (writeTextBlock === undefined || writeTextBlock.type !== 'text') {
          throw new Error(`Write step returned no text content for doc type: ${docType}`)
        }

        const docDraftId = await actionContext.runMutation(internal.doc_drafts.createDocDraft, {
          runId: args.runId,
          docType,
          filePath,
          content: writeTextBlock.text,
        })

        docDraftEntries.push({
          docType,
          filePath,
          content: writeTextBlock.text,
          docDraftId,
        })
      }

      // ── Create GitHub branch + commit + PR ──────────────────────────────────
      const octokit = await getInstallationOctokit(args.installationId)
      const fileList = docDraftEntries.map((entry) => `- \`${entry.filePath}\``).join('\n')
      const prCreationResult = await createDocsPullRequest(octokit, {
        ownerName,
        repoName,
        defaultBranch: repoRecord.defaultBranch,
        docDraftEntries: docDraftEntries.map((entry): DocsPullRequestFileEntry => ({
          filePath: entry.filePath,
          content: entry.content,
        })),
        branchPrefix: DOCS_BRANCH_PREFIX,
        commitMessage: 'docs: generate initial documentation via DocSync AI',
        prTitle: 'docs: generate initial documentation',
        prBody: [
          '## Documentation generated by DocSync AI',
          '',
          'This PR adds initial documentation generated from the codebase.',
          '',
          '### Files included',
          fileList,
          '',
          '---',
          '_Generated by DocSync AI. Review and merge when ready._',
        ].join('\n'),
      })

      // ── Record PR and update draft statuses ─────────────────────────────────
      await actionContext.runMutation(internal.pull_requests.createPullRequest, {
        runId: args.runId,
        repoId: args.repoId,
        githubPrNumber: prCreationResult.githubPrNumber,
        githubPrUrl: prCreationResult.githubPrUrl,
        title: prCreationResult.prTitle,
      })

      for (const docDraftEntry of docDraftEntries) {
        await actionContext.runMutation(internal.doc_drafts.updateDocDraftStatus, {
          docDraftId: docDraftEntry.docDraftId,
          status: 'pr_opened',
        })
      }

      // ── Mark run completed ───────────────────────────────────────────────────
      await actionContext.runMutation(internal.runs.updateRunStatus, {
        runId: args.runId,
        status: 'completed',
      })
    } catch (caughtError) {
      const errorMessage =
        caughtError instanceof Error
          ? caughtError.message
          : 'Unknown error in generateRepoDocs action'

      await actionContext.runMutation(internal.runs.updateRunStatus, {
        runId: args.runId,
        status: 'failed',
        errorMessage,
      })
    }
  },
})

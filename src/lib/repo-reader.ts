import { getInstallationOctokit } from './github'

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_TOKEN_BUDGET = 80_000
const CHARS_PER_TOKEN = 4
const MAX_FILE_TOKEN_SIZE = 8_000
const MAX_BINARY_FILE_BYTES = 500_000

const SKIP_PATH_PREFIXES: string[] = [
  'node_modules/',
  'dist/',
  'build/',
  '.next/',
  '.git/',
  'vendor/',
  '.turbo/',
  'coverage/',
  '__pycache__/',
  '.venv/',
]

const SKIP_FILE_SUFFIXES: string[] = ['.lock', '.log', '-lock.json']

const SKIP_TEST_PATTERNS: RegExp[] = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /__tests__\//,
  /\.test\.py$/,
  /test_.*\.py$/,
]

const MANIFEST_FILE_NAMES: string[] = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod']

const ENTRY_POINT_PATHS: string[] = [
  'index.ts',
  'index.js',
  'src/index.ts',
  'src/index.js',
  'main.py',
  'src/main.rs',
  'cmd/main.go',
  'main.go',
]

const SOURCE_DIR_PREFIXES: string[] = ['src/', 'lib/']

const DOC_FILE_NAMES: string[] = ['README.md', 'readme.md', 'README.mdx']

const SOURCE_EXPORT_EXTENSIONS: string[] = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

// ─── Types ────────────────────────────────────────────────────────────────────

type FilePriorityTier = 1 | 2 | 3 | 4 | 5

interface RepoFileEntry {
  path: string
  sha: string
  sizeBytes: number
}

interface PrioritizedFileEntry extends RepoFileEntry {
  priorityTier: FilePriorityTier
  depthLevel: number
}

interface FileChunk {
  path: string
  chunkIndex: number
  totalChunks: number
  content: string
  estimatedTokenCount: number
}

export interface RepoContext {
  repoFullName: string
  defaultBranch: string
  totalFilesScanned: number
  totalFilesIncluded: number
  isTruncated: boolean
  fileChunks: FileChunk[]
}

export interface RepoContextOptions {
  repoFullName: string
  defaultBranch: string
  installationId: number
}

type OctokitInstance = Awaited<ReturnType<typeof getInstallationOctokit>>

// ─── Token & skip helpers ─────────────────────────────────────────────────────

function estimateTokenCount(content: string): number {
  return Math.ceil(content.length / CHARS_PER_TOKEN)
}

function shouldSkipPath(filePath: string): boolean {
  for (const prefix of SKIP_PATH_PREFIXES) {
    if (filePath.startsWith(prefix)) return true
  }
  for (const suffix of SKIP_FILE_SUFFIXES) {
    if (filePath.endsWith(suffix)) return true
  }
  for (const pattern of SKIP_TEST_PATTERNS) {
    if (pattern.test(filePath)) return true
  }
  return false
}

function isBinaryContent(content: string): boolean {
  return content.includes('\0')
}

// ─── Priority tier assignment ─────────────────────────────────────────────────

function assignPriorityTier(
  filePath: string,
  exportedPaths: Set<string>,
): FilePriorityTier | null {
  const fileName = filePath.split('/').at(-1) ?? ''

  if (MANIFEST_FILE_NAMES.includes(fileName)) return 1
  if (ENTRY_POINT_PATHS.includes(filePath)) return 2
  if (exportedPaths.has(filePath)) return 3
  if (SOURCE_DIR_PREFIXES.some((prefix) => filePath.startsWith(prefix))) return 4
  if (DOC_FILE_NAMES.includes(filePath) || filePath.startsWith('docs/')) return 5

  return null
}

function extractExportedPaths(packageJsonContent: string): Set<string> {
  const exportedPaths = new Set<string>()

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(packageJsonContent) as Record<string, unknown>
  } catch {
    return exportedPaths
  }

  function collectLeafStrings(value: unknown): void {
    if (typeof value === 'string') {
      const normalized = value.replace(/^\.\//, '')
      if (SOURCE_EXPORT_EXTENSIONS.some((ext) => normalized.endsWith(ext))) {
        exportedPaths.add(normalized)
      }
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const child of Object.values(value as Record<string, unknown>)) {
        collectLeafStrings(child)
      }
    }
  }

  collectLeafStrings(parsed['exports'])
  collectLeafStrings(parsed['main'])
  collectLeafStrings(parsed['module'])

  return exportedPaths
}

function buildPrioritizedFileList(
  allEntries: RepoFileEntry[],
  exportedPaths: Set<string>,
): PrioritizedFileEntry[] {
  const prioritized: PrioritizedFileEntry[] = []

  for (const fileEntry of allEntries) {
    if (shouldSkipPath(fileEntry.path)) continue
    const priorityTier = assignPriorityTier(fileEntry.path, exportedPaths)
    if (priorityTier === null) continue
    prioritized.push({
      ...fileEntry,
      priorityTier,
      depthLevel: fileEntry.path.split('/').length - 1,
    })
  }

  prioritized.sort(
    (fileA, fileB) =>
      fileA.priorityTier - fileB.priorityTier ||
      fileA.depthLevel - fileB.depthLevel ||
      fileA.path.localeCompare(fileB.path),
  )

  return prioritized
}

// ─── File chunking ────────────────────────────────────────────────────────────

function splitFileIntoChunks(filePath: string, content: string): FileChunk[] {
  const totalTokenCount = estimateTokenCount(content)

  if (totalTokenCount <= MAX_FILE_TOKEN_SIZE) {
    return [{ path: filePath, chunkIndex: 0, totalChunks: 1, content, estimatedTokenCount: totalTokenCount }]
  }

  const lines = content.split('\n')
  const chunks: string[] = []
  let currentLines: string[] = []
  let currentTokenCount = 0

  for (const line of lines) {
    const lineTokenCount = estimateTokenCount(line + '\n')

    if (currentTokenCount + lineTokenCount > MAX_FILE_TOKEN_SIZE && currentLines.length > 0) {
      chunks.push(currentLines.join('\n'))
      currentLines = [line]
      currentTokenCount = lineTokenCount
    } else {
      currentLines.push(line)
      currentTokenCount += lineTokenCount
    }
  }

  if (currentLines.length > 0) {
    chunks.push(currentLines.join('\n'))
  }

  return chunks.map((chunkContent, index) => ({
    path: filePath,
    chunkIndex: index,
    totalChunks: chunks.length,
    content: chunkContent,
    estimatedTokenCount: estimateTokenCount(chunkContent),
  }))
}

// ─── GitHub fetch helpers ─────────────────────────────────────────────────────

async function fetchFileContent(
  octokit: OctokitInstance,
  owner: string,
  repoName: string,
  filePath: string,
): Promise<string> {
  const response = await octokit.rest.repos.getContent({ owner, repo: repoName, path: filePath })
  const responseData = response.data

  if (Array.isArray(responseData) || responseData.type !== 'file') {
    throw new Error(`Expected file at path ${filePath}, got directory or symlink`)
  }

  // Files >1MB have empty content field — fall back to blob API
  if (responseData.content === '' && responseData.sha) {
    const blobResponse = await octokit.rest.git.getBlob({
      owner,
      repo: repoName,
      file_sha: responseData.sha,
    })
    return Buffer.from(blobResponse.data.content, 'base64').toString('utf-8')
  }

  return Buffer.from(responseData.content, 'base64').toString('utf-8')
}

async function fetchRepoFileTree(
  octokit: OctokitInstance,
  owner: string,
  repoName: string,
  defaultBranch: string,
): Promise<RepoFileEntry[]> {
  const refResponse = await octokit.rest.git.getRef({
    owner,
    repo: repoName,
    ref: `heads/${defaultBranch}`,
  })
  const commitSha = refResponse.data.object.sha

  const commitResponse = await octokit.rest.git.getCommit({
    owner,
    repo: repoName,
    commit_sha: commitSha,
  })
  const treeSha = commitResponse.data.tree.sha

  const treeResponse = await octokit.rest.git.getTree({
    owner,
    repo: repoName,
    tree_sha: treeSha,
    recursive: '1',
  })

  return treeResponse.data.tree
    .filter((treeEntry) => treeEntry.type === 'blob' && treeEntry.path)
    .map((treeEntry) => ({
      path: treeEntry.path ?? '',
      sha: treeEntry.sha ?? '',
      sizeBytes: treeEntry.size ?? 0,
    }))
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function fetchRepoContext(options: RepoContextOptions): Promise<RepoContext> {
  const [owner, repoName] = options.repoFullName.split('/')
  const octokit = await getInstallationOctokit(options.installationId)
  const contentCache = new Map<string, string>()

  const allTreeEntries = await fetchRepoFileTree(
    octokit,
    owner,
    repoName,
    options.defaultBranch,
  )

  // Pre-fetch package.json to extract exported paths for tier-3 priority
  let exportedPaths = new Set<string>()
  const packageJsonEntry = allTreeEntries.find((entry) => entry.path === 'package.json')
  if (packageJsonEntry !== undefined) {
    const packageJsonContent = await fetchFileContent(octokit, owner, repoName, 'package.json')
    contentCache.set('package.json', packageJsonContent)
    exportedPaths = extractExportedPaths(packageJsonContent)
  }

  const prioritizedEntries = buildPrioritizedFileList(allTreeEntries, exportedPaths)

  const collectedChunks: FileChunk[] = []
  let remainingTokenBudget = MAX_TOKEN_BUDGET
  let isTruncated = false

  for (const fileEntry of prioritizedEntries) {
    if (remainingTokenBudget <= 0) {
      isTruncated = true
      break
    }

    // Skip oversized files before fetching
    if (fileEntry.sizeBytes > MAX_BINARY_FILE_BYTES) {
      isTruncated = true
      continue
    }

    const cachedContent = contentCache.get(fileEntry.path)
    const fileContent =
      cachedContent ?? (await fetchFileContent(octokit, owner, repoName, fileEntry.path))

    if (cachedContent === undefined) {
      contentCache.set(fileEntry.path, fileContent)
    }

    // Skip binary files
    if (isBinaryContent(fileContent)) {
      isTruncated = true
      continue
    }

    const fileChunks = splitFileIntoChunks(fileEntry.path, fileContent)

    for (const fileChunk of fileChunks) {
      if (fileChunk.estimatedTokenCount > remainingTokenBudget) {
        isTruncated = true
        if (fileChunk.chunkIndex === 0) {
          // Not even the first chunk fits — skip the whole file
        }
        // Partial file: stop here regardless
        remainingTokenBudget = 0
        break
      }
      collectedChunks.push(fileChunk)
      remainingTokenBudget -= fileChunk.estimatedTokenCount
    }
  }

  const includedFilePaths = new Set(collectedChunks.map((chunk) => chunk.path))

  return {
    repoFullName: options.repoFullName,
    defaultBranch: options.defaultBranch,
    totalFilesScanned: allTreeEntries.length,
    totalFilesIncluded: includedFilePaths.size,
    isTruncated,
    fileChunks: collectedChunks,
  }
}

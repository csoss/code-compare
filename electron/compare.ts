import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  CompareOptions,
  CompareResult,
  ComparedEntry,
  LineStatEntry,
  LineStatsResult
} from '../src/shared/types'

interface FileMeta {
  size: number
  modified: number
  absolutePath: string
}

const ALWAYS_IGNORED_NAMES = new Set(['.git', '.svn', '.hg', '.DS_Store', 'Thumbs.db'])
const MAX_LINE_DIFF_BYTES = 2 * 1024 * 1024
const MAX_LINE_COUNT = 30_000
const MAX_EDIT_DISTANCE = 4_000
const COMPARE_CHUNK_BYTES = 256 * 1024
const equalityCache = new Map<string, boolean>()
const lineStatsCache = new Map<string, Omit<LineStatEntry, 'path'>>()

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '')
  let source = ''
  for (let index = 0; index < normalized.length; index++) {
    const character = normalized[index]
    if (character === '*') {
      if (normalized[index + 1] === '*') {
        source += '.*'
        index++
      } else {
        source += '[^/]*'
      }
    } else if (character === '?') {
      source += '[^/]'
    } else {
      source += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    }
  }
  return normalized.includes('/')
    ? new RegExp(`^${source}(?:/.*)?$`, 'i')
    : new RegExp(`(?:^|/)${source}(?:/|$)`, 'i')
}

export function createExcludeMatcher(patterns: string[]): (relativePath: string) => boolean {
  const matchers = patterns
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .map(globToRegExp)
  return (relativePath) => {
    const normalized = relativePath.replaceAll('\\', '/')
    return matchers.some((matcher) => matcher.test(normalized))
  }
}

async function collectFiles(root: string, excludePatterns: string[]): Promise<Map<string, FileMeta>> {
  const files = new Map<string, FileMeta>()
  const pending = ['']
  const isExcluded = createExcludeMatcher(excludePatterns)

  while (pending.length) {
    const relativeDir = pending.pop()!
    const absoluteDir = path.join(root, relativeDir)
    const children = await fs.readdir(absoluteDir, { withFileTypes: true })

    for (const child of children) {
      if (ALWAYS_IGNORED_NAMES.has(child.name)) continue
      const relativePath = path.join(relativeDir, child.name)
      const normalizedPath = relativePath.split(path.sep).join('/')
      if (isExcluded(normalizedPath)) continue
      const absolutePath = path.join(root, relativePath)
      if (child.isDirectory()) {
        pending.push(relativePath)
      } else if (child.isFile()) {
        const stat = await fs.stat(absolutePath)
        files.set(normalizedPath, {
          size: stat.size,
          modified: stat.mtimeMs,
          absolutePath
        })
      }
    }
  }

  return files
}

function metaSignature(meta: FileMeta | undefined): string {
  return meta ? `${meta.absolutePath}:${meta.size}:${meta.modified}` : '-'
}

async function filesEqual(left: FileMeta, right: FileMeta): Promise<boolean> {
  if (left.size !== right.size) return false
  if (left.size === 0) return true
  const cacheKey = `${metaSignature(left)}|${metaSignature(right)}`
  const cached = equalityCache.get(cacheKey)
  if (cached !== undefined) return cached

  const [leftHandle, rightHandle] = await Promise.all([
    fs.open(left.absolutePath, 'r'),
    fs.open(right.absolutePath, 'r')
  ])
  let equal = true
  try {
    const leftBuffer = Buffer.allocUnsafe(COMPARE_CHUNK_BYTES)
    const rightBuffer = Buffer.allocUnsafe(COMPARE_CHUNK_BYTES)
    let position = 0
    while (position < left.size) {
      const length = Math.min(COMPARE_CHUNK_BYTES, left.size - position)
      const [leftRead, rightRead] = await Promise.all([
        leftHandle.read(leftBuffer, 0, length, position),
        rightHandle.read(rightBuffer, 0, length, position)
      ])
      if (
        leftRead.bytesRead !== rightRead.bytesRead ||
        !leftBuffer.subarray(0, leftRead.bytesRead).equals(rightBuffer.subarray(0, rightRead.bytesRead))
      ) {
        equal = false
        break
      }
      if (leftRead.bytesRead === 0) {
        equal = false
        break
      }
      position += leftRead.bytesRead
    }
  } finally {
    await Promise.all([leftHandle.close(), rightHandle.close()])
  }
  if (equalityCache.size > 50_000) equalityCache.clear()
  equalityCache.set(cacheKey, equal)
  return equal
}

function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000))
  return sample.includes(0)
}

function textLines(buffer: Buffer): string[] {
  if (!buffer.length) return []
  const text = buffer.toString('utf8')
  const lines = text.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()
  return lines
}

function myersDistance(left: string[], right: string[]): number | undefined {
  if (left.length + right.length > MAX_LINE_COUNT) return undefined
  const maximum = left.length + right.length
  const diagonal = new Map<number, number>([[1, 0]])
  for (let distance = 0; distance <= Math.min(maximum, MAX_EDIT_DISTANCE); distance++) {
    for (let k = -distance; k <= distance; k += 2) {
      let x: number
      if (k === -distance || (k !== distance && (diagonal.get(k - 1) ?? -1) < (diagonal.get(k + 1) ?? -1))) {
        x = diagonal.get(k + 1) ?? 0
      } else {
        x = (diagonal.get(k - 1) ?? 0) + 1
      }
      let y = x - k
      while (x < left.length && y < right.length && left[x] === right[y]) {
        x++
        y++
      }
      diagonal.set(k, x)
      if (x >= left.length && y >= right.length) return distance
    }
  }
  return undefined
}

async function lineChanges(
  left: FileMeta | undefined,
  right: FileMeta | undefined
): Promise<{ addedLines?: number; removedLines?: number; isBinary?: boolean }> {
  if ((left?.size ?? 0) > MAX_LINE_DIFF_BYTES || (right?.size ?? 0) > MAX_LINE_DIFF_BYTES) return {}
  const [leftBuffer, rightBuffer] = await Promise.all([
    left ? fs.readFile(left.absolutePath) : Promise.resolve(Buffer.alloc(0)),
    right ? fs.readFile(right.absolutePath) : Promise.resolve(Buffer.alloc(0))
  ])
  if (looksBinary(leftBuffer) || looksBinary(rightBuffer)) return { isBinary: true }
  const leftLines = textLines(leftBuffer)
  const rightLines = textLines(rightBuffer)
  const distance = myersDistance(leftLines, rightLines)
  if (distance === undefined) return {}
  const delta = rightLines.length - leftLines.length
  return {
    addedLines: (distance + delta) / 2,
    removedLines: (distance - delta) / 2,
    isBinary: false
  }
}

function safeEntryPath(root: string, relativePath: string): string {
  const absoluteRoot = path.resolve(root)
  const candidate = path.resolve(absoluteRoot, relativePath)
  const prefix = absoluteRoot.endsWith(path.sep) ? absoluteRoot : `${absoluteRoot}${path.sep}`
  if (!candidate.startsWith(prefix)) throw new Error('非法文件路径')
  return candidate
}

function extensionOf(relativePath: string): string {
  return path.extname(relativePath).slice(1).toLowerCase()
}

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++
      results[index] = await mapper(values[index])
    }
  })
  await Promise.all(workers)
  return results
}

export async function compareFolders(
  leftRoot: string,
  rightRoot: string,
  options: CompareOptions = { excludePatterns: [] }
): Promise<CompareResult> {
  const startedAt = performance.now()
  const excludePatterns = options.excludePatterns ?? []
  const [leftFiles, rightFiles] = await Promise.all([
    collectFiles(leftRoot, excludePatterns),
    collectFiles(rightRoot, excludePatterns)
  ])
  const paths = [...new Set([...leftFiles.keys(), ...rightFiles.keys()])].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  )

  const entries = await mapWithConcurrency<string, ComparedEntry>(
    paths,
    8,
    async (relativePath) => {
      const left = leftFiles.get(relativePath)
      const right = rightFiles.get(relativePath)
      let status: ComparedEntry['status']
      if (!left) status = 'right-only'
      else if (!right) status = 'left-only'
      else status = (await filesEqual(left, right)) ? 'same' : 'modified'

      return {
        path: relativePath,
        name: path.basename(relativePath),
        extension: extensionOf(relativePath),
        status,
        leftSize: left?.size,
        rightSize: right?.size,
        leftModified: left?.modified,
        rightModified: right?.modified
      }
    }
  )

  return {
    leftRoot,
    rightRoot,
    entries,
    durationMs: Math.round(performance.now() - startedAt),
    excludedPatterns: excludePatterns,
    addedLines: 0,
    removedLines: 0,
    lineStatsSkipped: 0,
    lineStatsComplete: false
  }
}

export async function calculateLineStats(
  leftRoot: string,
  rightRoot: string,
  entries: ComparedEntry[]
): Promise<LineStatsResult> {
  const changedEntries = entries.filter((entry) => entry.status !== 'same')
  const stats = await mapWithConcurrency<ComparedEntry, LineStatEntry>(
    changedEntries,
    4,
    async (entry) => {
      const left = entry.status === 'right-only' ? undefined : {
        absolutePath: safeEntryPath(leftRoot, entry.path),
        size: entry.leftSize ?? 0,
        modified: entry.leftModified ?? 0
      }
      const right = entry.status === 'left-only' ? undefined : {
        absolutePath: safeEntryPath(rightRoot, entry.path),
        size: entry.rightSize ?? 0,
        modified: entry.rightModified ?? 0
      }
      const cacheKey = `${metaSignature(left)}|${metaSignature(right)}`
      let changes = lineStatsCache.get(cacheKey)
      if (!changes) {
        changes = await lineChanges(left, right)
        if (lineStatsCache.size > 50_000) lineStatsCache.clear()
        lineStatsCache.set(cacheKey, changes)
      }
      return { path: entry.path, ...changes }
    }
  )
  return {
    entries: stats,
    addedLines: stats.reduce((total, entry) => total + (entry.addedLines ?? 0), 0),
    removedLines: stats.reduce((total, entry) => total + (entry.removedLines ?? 0), 0),
    skipped: stats.filter((entry) => entry.addedLines === undefined).length
  }
}

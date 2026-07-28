export type CompareStatus = 'same' | 'modified' | 'left-only' | 'right-only' | 'type-change'

export interface ComparedEntry {
  path: string
  name: string
  extension: string
  status: CompareStatus
  leftSize?: number
  rightSize?: number
  leftModified?: number
  rightModified?: number
  isBinary?: boolean
  addedLines?: number
  removedLines?: number
}

export interface CompareResult {
  leftRoot: string
  rightRoot: string
  entries: ComparedEntry[]
  durationMs: number
  excludedPatterns: string[]
  addedLines: number
  removedLines: number
  lineStatsSkipped: number
  lineStatsComplete: boolean
}

export interface LineStatEntry {
  path: string
  addedLines?: number
  removedLines?: number
  isBinary?: boolean
}

export interface LineStatsResult {
  entries: LineStatEntry[]
  addedLines: number
  removedLines: number
  skipped: number
}

export interface CompareOptions {
  excludePatterns: string[]
}

export interface FileContent {
  path: string
  name: string
  content: string
  size: number
  binary: boolean
  truncated: boolean
}

export interface DesktopApi {
  selectDirectory: () => Promise<string | null>
  selectFile: () => Promise<string | null>
  compareFolders: (
    leftRoot: string,
    rightRoot: string,
    options?: CompareOptions
  ) => Promise<CompareResult>
  calculateLineStats: (
    leftRoot: string,
    rightRoot: string,
    entries: ComparedEntry[]
  ) => Promise<LineStatsResult>
  readRelativeFile: (root: string, relativePath: string) => Promise<FileContent>
  readFile: (path: string) => Promise<FileContent>
  revealFile: (path: string) => Promise<void>
  platform: string
}

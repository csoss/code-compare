import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { calculateLineStats, compareFolders, createExcludeMatcher } from './compare'

const created: string[] = []

async function fixture(): Promise<{ left: string; right: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'code-compare-'))
  created.push(root)
  const left = path.join(root, 'left')
  const right = path.join(root, 'right')
  await Promise.all([mkdir(left), mkdir(right)])
  return { left, right }
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('compareFolders', () => {
  it('classifies same, modified and one-sided files', async () => {
    const { left, right } = await fixture()
    await Promise.all([
      writeFile(path.join(left, 'same.txt'), 'same'),
      writeFile(path.join(right, 'same.txt'), 'same'),
      writeFile(path.join(left, 'changed.ts'), 'const answer = 41\n'),
      writeFile(path.join(right, 'changed.ts'), 'const answer = 42\n'),
      writeFile(path.join(left, 'left.md'), '# left'),
      writeFile(path.join(right, 'right.md'), '# right')
    ])

    const result = await compareFolders(left, right)
    expect(Object.fromEntries(result.entries.map((entry) => [entry.path, entry.status]))).toEqual({
      'changed.ts': 'modified',
      'left.md': 'left-only',
      'right.md': 'right-only',
      'same.txt': 'same'
    })
    expect(result.lineStatsComplete).toBe(false)
    const lineStats = await calculateLineStats(left, right, result.entries)
    expect(lineStats.entries.find((entry) => entry.path === 'changed.ts')).toMatchObject({
      addedLines: 1,
      removedLines: 1
    })
    expect(lineStats.addedLines).toBe(2)
    expect(lineStats.removedLines).toBe(2)
  })

  it('walks nested directories and ignores repository metadata', async () => {
    const { left, right } = await fixture()
    await Promise.all([
      mkdir(path.join(left, 'src'), { recursive: true }),
      mkdir(path.join(right, 'src'), { recursive: true }),
      mkdir(path.join(left, '.git'), { recursive: true })
    ])
    await Promise.all([
      writeFile(path.join(left, 'src', 'app.ts'), 'left'),
      writeFile(path.join(right, 'src', 'app.ts'), 'right'),
      writeFile(path.join(left, '.git', 'index'), 'ignored')
    ])

    const result = await compareFolders(left, right)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]).toMatchObject({ path: 'src/app.ts', status: 'modified' })
  })

  it('excludes build folders and user glob patterns', async () => {
    const { left, right } = await fixture()
    for (const root of [left, right]) {
      await Promise.all([
        mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true }),
        mkdir(path.join(root, 'dist'), { recursive: true }),
        mkdir(path.join(root, 'src', 'generated'), { recursive: true })
      ])
      await Promise.all([
        writeFile(path.join(root, 'node_modules', 'pkg', 'index.js'), root),
        writeFile(path.join(root, 'dist', 'bundle.js'), root),
        writeFile(path.join(root, 'src', 'generated', 'schema.ts'), root),
        writeFile(path.join(root, 'src', 'app.ts'), root)
      ])
    }

    const result = await compareFolders(left, right, {
      excludePatterns: ['node_modules', 'dist', 'src/generated/**']
    })
    expect(result.entries.map((entry) => entry.path)).toEqual(['src/app.ts'])
  })

  it('short-circuits large files after the first different chunk and caches the result', async () => {
    const { left, right } = await fixture()
    const leftBuffer = Buffer.alloc(8 * 1024 * 1024, 65)
    const rightBuffer = Buffer.from(leftBuffer)
    rightBuffer[0] = 66
    await Promise.all([
      writeFile(path.join(left, 'large.log'), leftBuffer),
      writeFile(path.join(right, 'large.log'), rightBuffer)
    ])

    const first = await compareFolders(left, right)
    const repeated = await compareFolders(left, right)
    expect(first.entries[0].status).toBe('modified')
    expect(repeated.entries[0].status).toBe('modified')
    expect(first.durationMs).toBeLessThan(4_000)
    expect(repeated.durationMs).toBeLessThan(100)
  })
})

describe('createExcludeMatcher', () => {
  it('supports segment names and glob paths', () => {
    const matches = createExcludeMatcher(['node_modules', '*.min.js', 'coverage/**'])
    expect(matches('packages/app/node_modules/lib.js')).toBe(true)
    expect(matches('public/app.min.js')).toBe(true)
    expect(matches('coverage/unit/index.html')).toBe(true)
    expect(matches('src/index.js')).toBe(false)
  })
})

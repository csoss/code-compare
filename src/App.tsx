import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { DiffEditor, type MonacoDiffEditor } from '@monaco-editor/react'
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ClipboardPaste,
  File,
  FileCode2,
  Folder,
  FolderOpen,
  FolderTree,
  History,
  LoaderCircle,
  EyeOff,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Settings2,
  X
} from 'lucide-react'
import type {
  CompareResult,
  CompareStatus,
  ComparedEntry,
  FileContent
} from './shared/types'

type Mode = 'folders' | 'files'
type Filter = 'changes' | CompareStatus | 'all'

const DEFAULT_EXCLUSIONS = [
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  '.next',
  '.nuxt',
  'coverage',
  '*.min.js',
  '*.map'
]

interface TreeNode {
  id: string
  name: string
  path: string
  kind: 'directory' | 'file'
  status: CompareStatus
  children: TreeNode[]
  entry?: ComparedEntry
}

const statusMeta: Record<CompareStatus, { label: string; short: string }> = {
  modified: { label: '已修改', short: 'M' },
  'left-only': { label: '仅左侧', short: 'L' },
  'right-only': { label: '仅右侧', short: 'R' },
  same: { label: '相同', short: '✓' },
  'type-change': { label: '类型变化', short: 'T' }
}

const languageByExtension: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  css: 'css',
  scss: 'scss',
  html: 'html',
  htm: 'html',
  md: 'markdown',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  java: 'java',
  kt: 'kotlin',
  py: 'python',
  go: 'go',
  rs: 'rust',
  c: 'c',
  h: 'cpp',
  cpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sql: 'sql',
  sh: 'shell',
  bat: 'bat',
  ps1: 'powershell'
}

function fileLanguage(name?: string): string {
  const extension = name?.split('.').pop()?.toLowerCase() ?? ''
  return languageByExtension[extension] ?? 'plaintext'
}

function shortPath(value: string | null): string {
  if (!value) return '选择文件夹'
  const pieces = value.split(/[\\/]/).filter(Boolean)
  return pieces.at(-1) || value
}

function formatBytes(value?: number): string {
  if (value === undefined) return '—'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function buildTree(entries: ComparedEntry[]): TreeNode[] {
  const root: TreeNode = {
    id: 'root',
    name: '',
    path: '',
    kind: 'directory',
    status: 'same',
    children: []
  }

  for (const entry of entries) {
    const parts = entry.path.split('/')
    let parent = root
    parts.forEach((part, index) => {
      const nodePath = parts.slice(0, index + 1).join('/')
      const isFile = index === parts.length - 1
      let node = parent.children.find((child) => child.name === part)
      if (!node) {
        node = {
          id: `${isFile ? 'file' : 'dir'}:${nodePath}`,
          name: part,
          path: nodePath,
          kind: isFile ? 'file' : 'directory',
          status: isFile ? entry.status : 'same',
          children: [],
          entry: isFile ? entry : undefined
        }
        parent.children.push(node)
      }
      parent = node
    })
  }

  const finalize = (node: TreeNode): CompareStatus => {
    node.children.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
      return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
    })
    if (node.kind === 'file') return node.status
    const statuses = node.children.map(finalize)
    if (!statuses.length || statuses.every((status) => status === 'same')) node.status = 'same'
    else if (statuses.every((status) => status === 'left-only')) node.status = 'left-only'
    else if (statuses.every((status) => status === 'right-only')) node.status = 'right-only'
    else node.status = 'modified'
    return node.status
  }
  finalize(root)
  return root.children
}

function createPathMatcher(patterns: string[]): (filePath: string) => boolean {
  const expressions = patterns.map((pattern) => {
    const normalized = pattern.trim().replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '')
    let source = ''
    for (let index = 0; index < normalized.length; index++) {
      const character = normalized[index]
      if (character === '*') {
        if (normalized[index + 1] === '*') {
          source += '.*'
          index++
        } else source += '[^/]*'
      } else if (character === '?') source += '[^/]'
      else source += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    }
    return normalized.includes('/')
      ? new RegExp(`^${source}(?:/.*)?$`, 'i')
      : new RegExp(`(?:^|/)${source}(?:/|$)`, 'i')
  })
  return (filePath) => expressions.some((expression) => expression.test(filePath))
}

function filterCompareResult(result: CompareResult, patterns: string[]): CompareResult {
  const isExcluded = createPathMatcher(patterns)
  const entries = result.entries.filter((entry) => !isExcluded(entry.path))
  return {
    ...result,
    entries,
    excludedPatterns: patterns,
    addedLines: entries.reduce((total, entry) => total + (entry.addedLines ?? 0), 0),
    removedLines: entries.reduce((total, entry) => total + (entry.removedLines ?? 0), 0),
    lineStatsSkipped: result.lineStatsComplete
      ? entries.filter((entry) => entry.status !== 'same' && entry.addedLines === undefined).length
      : 0
  }
}

function pastedContent(side: 'left' | 'right', content: string): FileContent {
  return {
    path: side === 'left' ? '粘贴内容（左侧）' : '粘贴内容（右侧）',
    name: '粘贴文本.txt',
    content,
    size: new TextEncoder().encode(content).length,
    binary: false,
    truncated: false
  }
}

function loadRecentRoots(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem('code-compare.recent-roots') ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function App() {
  const [mode, setMode] = useState<Mode>('folders')
  const [leftRoot, setLeftRoot] = useState<string | null>(null)
  const [rightRoot, setRightRoot] = useState<string | null>(null)
  const [leftFile, setLeftFile] = useState<FileContent | null>(null)
  const [rightFile, setRightFile] = useState<FileContent | null>(null)
  const [result, setResult] = useState<CompareResult | null>(null)
  const [selected, setSelected] = useState<ComparedEntry | null>(null)
  const [leftContent, setLeftContent] = useState<FileContent | null>(null)
  const [rightContent, setRightContent] = useState<FileContent | null>(null)
  const [filter, setFilter] = useState<Filter>('changes')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [fileBusy, setFileBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [excludePatterns, setExcludePatterns] = useState(DEFAULT_EXCLUSIONS)
  const [excludeDialogOpen, setExcludeDialogOpen] = useState(false)
  const [excludeDraft, setExcludeDraft] = useState(DEFAULT_EXCLUSIONS.join('\n'))
  const [pasteDialogOpen, setPasteDialogOpen] = useState(false)
  const [leftPaste, setLeftPaste] = useState('')
  const [rightPaste, setRightPaste] = useState('')
  const [recentRoots, setRecentRoots] = useState<string[]>(loadRecentRoots)
  const [lineStatsBusy, setLineStatsBusy] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem('code-compare.sidebar-width'))
    return Number.isFinite(saved) && saved >= 240 && saved <= 620 ? saved : 330
  })
  const diffEditor = useRef<MonacoDiffEditor | null>(null)
  const statsRequest = useRef(0)

  const startLineStats = useCallback((comparison: CompareResult) => {
    const requestId = ++statsRequest.current
    setLineStatsBusy(true)
    window.desktop
      .calculateLineStats(comparison.leftRoot, comparison.rightRoot, comparison.entries)
      .then((stats) => {
        if (requestId !== statsRequest.current) return
        const byPath = new Map(stats.entries.map((entry) => [entry.path, entry]))
        setResult((current) => {
          if (
            !current ||
            current.leftRoot !== comparison.leftRoot ||
            current.rightRoot !== comparison.rightRoot
          ) return current
          const entries = current.entries.map((entry) => ({ ...entry, ...byPath.get(entry.path) }))
          return {
            ...current,
            entries,
            addedLines: entries.reduce((total, entry) => total + (entry.addedLines ?? 0), 0),
            removedLines: entries.reduce((total, entry) => total + (entry.removedLines ?? 0), 0),
            lineStatsSkipped: entries.filter(
              (entry) => entry.status !== 'same' && entry.addedLines === undefined
            ).length,
            lineStatsComplete: true
          }
        })
      })
      .catch((reason) => {
        if (requestId === statsRequest.current) {
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      })
      .finally(() => {
        if (requestId === statsRequest.current) setLineStatsBusy(false)
      })
  }, [])

  const runCompare = useCallback(async (
    left = leftRoot,
    right = rightRoot,
    patterns = excludePatterns
  ) => {
    if (!left || !right) return
    statsRequest.current++
    setLineStatsBusy(false)
    setBusy(true)
    setError(null)
    setSelected(null)
    setLeftContent(null)
    setRightContent(null)
    try {
      const next = await window.desktop.compareFolders(left, right, { excludePatterns: patterns })
      setResult(next)
      startLineStats(next)
      const firstChange = next.entries.find((entry) => entry.status !== 'same')
      if (firstChange) setSelected(firstChange)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }, [excludePatterns, leftRoot, rightRoot, startLineStats])

  const rememberRoot = (directory: string) => {
    setRecentRoots((current) => {
      const next = [directory, ...current.filter((item) => item !== directory)].slice(0, 10)
      localStorage.setItem('code-compare.recent-roots', JSON.stringify(next))
      return next
    })
  }

  const selectRoot = (side: 'left' | 'right', directory: string) => {
    rememberRoot(directory)
    if (side === 'left') {
      setLeftRoot(directory)
      if (rightRoot) void runCompare(directory, rightRoot)
    } else {
      setRightRoot(directory)
      if (leftRoot) void runCompare(leftRoot, directory)
    }
  }

  const chooseRoot = async (side: 'left' | 'right') => {
    const directory = await window.desktop.selectDirectory()
    if (directory) selectRoot(side, directory)
  }

  const chooseFile = async (side: 'left' | 'right') => {
    const filePath = await window.desktop.selectFile()
    if (!filePath) return
    setFileBusy(true)
    setError(null)
    try {
      const content = await window.desktop.readFile(filePath)
      if (side === 'left') setLeftFile(content)
      else setRightFile(content)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setFileBusy(false)
    }
  }

  useEffect(() => {
    if (!selected || !result) return
    let cancelled = false
    setFileBusy(true)
    Promise.all([
      selected.status === 'right-only'
        ? Promise.resolve(null)
        : window.desktop.readRelativeFile(result.leftRoot, selected.path),
      selected.status === 'left-only'
        ? Promise.resolve(null)
        : window.desktop.readRelativeFile(result.rightRoot, selected.path)
    ])
      .then(([left, right]) => {
        if (!cancelled) {
          setLeftContent(left)
          setRightContent(right)
        }
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!cancelled) setFileBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [selected, result])

  const counts = useMemo(() => {
    const values: Record<CompareStatus, number> = {
      same: 0,
      modified: 0,
      'left-only': 0,
      'right-only': 0,
      'type-change': 0
    }
    result?.entries.forEach((entry) => values[entry.status]++)
    return values
  }, [result])

  const visibleEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return (result?.entries ?? []).filter((entry) => {
      const filterMatches =
        filter === 'all' ||
        (filter === 'changes' ? entry.status !== 'same' : entry.status === filter)
      return filterMatches && (!normalizedQuery || entry.path.toLowerCase().includes(normalizedQuery))
    })
  }, [filter, query, result])
  const treeNodes = useMemo(() => buildTree(visibleEntries), [visibleEntries])

  const activeLeft = mode === 'folders' ? leftContent : leftFile
  const activeRight = mode === 'folders' ? rightContent : rightFile
  const activeName = selected?.name ?? leftFile?.name ?? rightFile?.name
  const hasBinary = activeLeft?.binary || activeRight?.binary
  const isTruncated = activeLeft?.truncated || activeRight?.truncated

  const navigateDiff = (direction: 'next' | 'previous') => {
    diffEditor.current?.goToDiff(direction)
  }

  const startSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!sidebarOpen) return
    event.preventDefault()
    const initialX = event.clientX
    const initialWidth = sidebarWidth
    document.body.classList.add('resizing-sidebar')
    const move = (moveEvent: PointerEvent) => {
      setSidebarWidth(Math.min(620, Math.max(240, initialWidth + moveEvent.clientX - initialX)))
    }
    const stop = (upEvent: PointerEvent) => {
      const width = Math.min(620, Math.max(240, initialWidth + upEvent.clientX - initialX))
      setSidebarWidth(width)
      localStorage.setItem('code-compare.sidebar-width', String(width))
      document.body.classList.remove('resizing-sidebar')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  const swapSides = () => {
    if (mode === 'folders') {
      const left = rightRoot
      const right = leftRoot
      setLeftRoot(left)
      setRightRoot(right)
      setResult(null)
      setSelected(null)
      if (left && right) void runCompare(left, right)
    } else {
      setLeftFile(rightFile)
      setRightFile(leftFile)
    }
  }

  const openPasteDialog = () => {
    setLeftPaste(leftFile?.binary ? '' : leftFile?.content ?? '')
    setRightPaste(rightFile?.binary ? '' : rightFile?.content ?? '')
    setPasteDialogOpen(true)
  }

  const applyPastedText = () => {
    setLeftFile(pastedContent('left', leftPaste))
    setRightFile(pastedContent('right', rightPaste))
    setPasteDialogOpen(false)
  }

  const applyExclusions = () => {
    const patterns = excludeDraft
      .split(/[\n,]/)
      .map((pattern) => pattern.trim())
      .filter(Boolean)
    const uniquePatterns = [...new Set(patterns)]
    const onlyAddsPatterns = excludePatterns.every((pattern) => uniquePatterns.includes(pattern))
    setExcludePatterns(uniquePatterns)
    setExcludeDialogOpen(false)
    if (result && onlyAddsPatterns) {
      setResult((current) => current ? filterCompareResult(current, uniquePatterns) : current)
      if (selected && createPathMatcher(uniquePatterns)(selected.path)) setSelected(null)
    } else if (leftRoot && rightRoot) {
      void runCompare(leftRoot, rightRoot, uniquePatterns)
    }
  }

  const excludeDirectory = (directoryPath: string) => {
    const patterns = [...new Set([...excludePatterns, directoryPath])]
    setExcludePatterns(patterns)
    setExcludeDraft(patterns.join('\n'))
    setResult((current) => current ? filterCompareResult(current, patterns) : current)
    if (selected?.path.startsWith(`${directoryPath}/`)) setSelected(null)
  }

  return (
    <div className={`app platform-${window.desktop.platform} ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
      <header className="topbar">
        <div className="brand">
          <span>Code Compare</span>
        </div>
        <nav className="mode-switch" aria-label="对比模式">
          <button className={mode === 'folders' ? 'active' : ''} onClick={() => setMode('folders')}>
            <Folder size={15} /> 文件夹
          </button>
          <button className={mode === 'files' ? 'active' : ''} onClick={() => setMode('files')}>
            <FileCode2 size={15} /> 文本文件
          </button>
        </nav>
        <div className="window-drag" />
        {result && mode === 'folders' && (
          <span className="scan-time">
            {result.entries.length} 个文件 ·
            {lineStatsBusy ? (
              <em> 行数统计中…</em>
            ) : (
              <>
                <b className="lines-added"> +{result.addedLines}</b>
                <b className="lines-removed"> −{result.removedLines}</b>
              </>
            )}
          </span>
        )}
      </header>

      <section className="sourcebar">
        <button className="icon-button sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
          {sidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
        </button>
        {mode === 'folders' ? (
          <>
            <SourcePicker
              side="左侧"
              value={leftRoot}
              recentValues={recentRoots}
              onRecent={(value) => selectRoot('left', value)}
              onClick={() => void chooseRoot('left')}
            />
            <button className="swap-button" onClick={swapSides} title="交换左右">
              <ArrowLeftRight size={17} />
            </button>
            <SourcePicker
              side="右侧"
              value={rightRoot}
              recentValues={recentRoots}
              onRecent={(value) => selectRoot('right', value)}
              onClick={() => void chooseRoot('right')}
            />
            <button
              className="secondary-button"
              onClick={() => {
                setExcludeDraft(excludePatterns.join('\n'))
                setExcludeDialogOpen(true)
              }}
              title="配置排除规则"
            >
              <Settings2 size={16} />
              排除 <span>{excludePatterns.length}</span>
            </button>
            <button
              className="primary-button"
              disabled={!leftRoot || !rightRoot || busy}
              onClick={() => void runCompare()}
            >
              {busy ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
              {result ? '重新对比' : '开始对比'}
            </button>
          </>
        ) : (
          <>
            <SourcePicker side="左侧" value={leftFile?.path ?? null} file onClick={() => void chooseFile('left')} />
            <button className="swap-button" onClick={swapSides} title="交换左右">
              <ArrowLeftRight size={17} />
            </button>
            <SourcePicker side="右侧" value={rightFile?.path ?? null} file onClick={() => void chooseFile('right')} />
            <button className="primary-button" onClick={openPasteDialog}>
              <ClipboardPaste size={16} />
              粘贴文本
            </button>
          </>
        )}
      </section>

      <main
        className="workspace"
        style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}
      >
        <aside className="sidebar">
          {mode === 'folders' ? (
            result ? (
              <>
                <div className="sidebar-summary">
                  <div>
                    <strong>{counts.modified + counts['left-only'] + counts['right-only']}</strong>
                    <span>个差异文件</span>
                  </div>
                  <div className="line-summary">
                    {lineStatsBusy ? (
                      <span className="stats-loading"><LoaderCircle className="spin" size={11} /> 后台统计差异行…</span>
                    ) : (
                      <>
                        <span className="lines-added">+{result.addedLines} 行</span>
                        <span className="lines-removed">−{result.removedLines} 行</span>
                      </>
                    )}
                    {result.lineStatsSkipped > 0 && <span>{result.lineStatsSkipped} 个大文件未统计</span>}
                  </div>
                  <div className="summary-track">
                    <i className="modified" style={{ flex: counts.modified || 0 }} />
                    <i className="left-only" style={{ flex: counts['left-only'] || 0 }} />
                    <i className="right-only" style={{ flex: counts['right-only'] || 0 }} />
                    <i className="same" style={{ flex: counts.same || 0 }} />
                  </div>
                </div>
                <div className="filters">
                  {([
                    ['changes', '差异', counts.modified + counts['left-only'] + counts['right-only']],
                    ['modified', '修改', counts.modified],
                    ['left-only', '左侧', counts['left-only']],
                    ['right-only', '右侧', counts['right-only']],
                    ['same', '相同', counts.same]
                  ] as [Filter, string, number][]).map(([value, label, count]) => (
                    <button
                      key={value}
                      className={filter === value ? 'active' : ''}
                      onClick={() => setFilter(value)}
                    >
                      {label}<span>{count}</span>
                    </button>
                  ))}
                </div>
                <label className="search">
                  <Search size={14} />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="筛选文件路径"
                  />
                  {query && <button onClick={() => setQuery('')}><X size={13} /></button>}
                </label>
                <div className="file-list">
                  <DirectoryTree
                    nodes={treeNodes}
                    selectedPath={selected?.path}
                    query={query}
                    onSelect={setSelected}
                    onExclude={excludeDirectory}
                  />
                  {!visibleEntries.length && (
                    <div className="empty-list"><Check size={18} /><span>没有匹配的文件</span></div>
                  )}
                </div>
              </>
            ) : (
              <div className="sidebar-placeholder">
                <FolderOpen size={30} />
                <strong>选择两个文件夹</strong>
                <span>差异文件会显示在这里</span>
              </div>
            )
          ) : (
            <div className="sidebar-placeholder file-mode-tip">
              <ClipboardPaste size={30} />
              <strong>文本文件对比</strong>
              <span>从顶部选择两个文件，或点击“粘贴文本”直接输入左右内容。</span>
              <button className="sidebar-action" onClick={openPasteDialog}>粘贴或编辑文本</button>
            </div>
          )}
        </aside>
        <div
          className="sidebar-resizer"
          onPointerDown={startSidebarResize}
          title="左右拖动调整目录宽度"
        />

        <section className="diff-pane">
          {error && (
            <div className="error-banner">
              <CircleAlert size={16} /><span>{error}</span><button onClick={() => setError(null)}><X size={14} /></button>
            </div>
          )}
          {(activeLeft || activeRight) ? (
            <>
              <div className="diff-toolbar">
                <div className="diff-title">
                  <FileCode2 size={16} />
                  <strong>{activeName}</strong>
                  {selected && <span className={`status-pill ${selected.status}`}>{statusMeta[selected.status].label}</span>}
                  {selected && selected.addedLines !== undefined && (
                    <span className="selected-lines">
                      <b className="lines-added">+{selected.addedLines}</b>
                      <b className="lines-removed">−{selected.removedLines ?? 0}</b>
                    </span>
                  )}
                  {isTruncated && <span className="warning-pill">仅显示前 5 MB</span>}
                </div>
                <div className="diff-actions">
                  <button onClick={() => navigateDiff('previous')} title="上一个差异"><ArrowUp size={15} /></button>
                  <button onClick={() => navigateDiff('next')} title="下一个差异"><ArrowDown size={15} /></button>
                </div>
              </div>
              <div className="file-headings">
                <FileHeading content={activeLeft} fallback={mode === 'folders' ? leftRoot : null} />
                <FileHeading content={activeRight} fallback={mode === 'folders' ? rightRoot : null} />
              </div>
              <div className="editor-shell">
                {fileBusy ? (
                  <div className="center-state"><LoaderCircle className="spin" size={24} /><span>正在读取文件…</span></div>
                ) : hasBinary ? (
                  <div className="center-state">
                    <CircleAlert size={28} />
                    <strong>二进制文件无法按文本显示</strong>
                    <span>左侧 {formatBytes(activeLeft?.size)} · 右侧 {formatBytes(activeRight?.size)}</span>
                  </div>
                ) : (
                  <DiffEditor
                    height="100%"
                    language={fileLanguage(activeName)}
                    original={activeLeft?.content ?? ''}
                    modified={activeRight?.content ?? ''}
                    theme="code-compare"
                    loading={(
                      <div className="center-state">
                        <LoaderCircle className="spin" size={24} />
                        <span>正在加载本地编辑器…</span>
                      </div>
                    )}
                    onMount={(editor, monaco) => {
                      diffEditor.current = editor
                      monaco.editor.defineTheme('code-compare', {
                        base: 'vs-dark',
                        inherit: true,
                        rules: [],
                        colors: {
                          'editor.background': '#111318',
                          'editorGutter.background': '#111318',
                          'diffEditor.insertedTextBackground': '#1f6f464f',
                          'diffEditor.removedTextBackground': '#a43d4552',
                          'diffEditor.insertedLineBackground': '#163d2c77',
                          'diffEditor.removedLineBackground': '#46222977',
                          'editorLineNumber.foreground': '#555c68',
                          'editorLineNumber.activeForeground': '#aab2c0'
                        }
                      })
                      monaco.editor.setTheme('code-compare')
                    }}
                    options={{
                      readOnly: true,
                      renderSideBySide: true,
                      automaticLayout: true,
                      minimap: { enabled: true, showSlider: 'always' },
                      fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
                      fontSize: 13,
                      lineHeight: 21,
                      scrollBeyondLastLine: false,
                      renderOverviewRuler: true,
                      originalEditable: false,
                      wordWrap: 'off',
                      padding: { top: 12, bottom: 12 }
                    }}
                  />
                )}
              </div>
              <div className="statusbar">
                <span>{fileLanguage(activeName)}</span>
                <span>UTF-8</span>
                <span>只读</span>
              </div>
            </>
          ) : (
            <Welcome mode={mode} />
          )}
        </section>
      </main>
      {excludeDialogOpen && (
        <div className="modal-backdrop" onMouseDown={() => setExcludeDialogOpen(false)}>
          <section className="modal-card compact-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <Settings2 size={18} />
                <div><strong>排除文件与目录</strong><span>扫描时不会读取匹配的内容</span></div>
              </div>
              <button onClick={() => setExcludeDialogOpen(false)}><X size={16} /></button>
            </div>
            <label className="modal-field">
              <span>每行一个名称或 Glob 规则</span>
              <textarea
                autoFocus
                value={excludeDraft}
                onChange={(event) => setExcludeDraft(event.target.value)}
                spellCheck={false}
                placeholder={'node_modules\ndist\n*.map\npackages/legacy/**'}
              />
            </label>
            <div className="rule-help">
              <code>dist</code> 匹配任意层级目录，<code>*.map</code> 匹配文件名，
              <code>generated/**</code> 匹配指定路径。
            </div>
            <div className="modal-footer">
              <button
                className="text-button"
                onClick={() => setExcludeDraft(DEFAULT_EXCLUSIONS.join('\n'))}
              >
                恢复默认
              </button>
              <div />
              <button className="secondary-button" onClick={() => setExcludeDialogOpen(false)}>取消</button>
              <button className="primary-button" onClick={applyExclusions}>应用过滤</button>
            </div>
          </section>
        </div>
      )}
      {pasteDialogOpen && (
        <div className="modal-backdrop" onMouseDown={() => setPasteDialogOpen(false)}>
          <section className="modal-card paste-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <ClipboardPaste size={18} />
                <div><strong>粘贴文本对比</strong><span>直接输入或粘贴左右两段内容</span></div>
              </div>
              <button onClick={() => setPasteDialogOpen(false)}><X size={16} /></button>
            </div>
            <div className="paste-grid">
              <label className="modal-field">
                <span>左侧原始文本</span>
                <textarea
                  autoFocus
                  value={leftPaste}
                  onChange={(event) => setLeftPaste(event.target.value)}
                  spellCheck={false}
                  placeholder="在这里粘贴原始内容…"
                />
              </label>
              <label className="modal-field">
                <span>右侧新文本</span>
                <textarea
                  value={rightPaste}
                  onChange={(event) => setRightPaste(event.target.value)}
                  spellCheck={false}
                  placeholder="在这里粘贴修改后的内容…"
                />
              </label>
            </div>
            <div className="modal-footer">
              <span className="paste-count">左 {leftPaste.length} 字符 · 右 {rightPaste.length} 字符</span>
              <div />
              <button className="secondary-button" onClick={() => setPasteDialogOpen(false)}>取消</button>
              <button className="primary-button" onClick={applyPastedText}>开始对比</button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function DirectoryTree({
  nodes,
  selectedPath,
  query,
  onSelect,
  onExclude
}: {
  nodes: TreeNode[]
  selectedPath?: string
  query: string
  onSelect: (entry: ComparedEntry) => void
  onExclude: (directoryPath: string) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const directoryPaths = useMemo(() => {
    const paths: string[] = []
    const visit = (items: TreeNode[]) => {
      items.forEach((node) => {
        if (node.kind !== 'directory') return
        paths.push(node.path)
        visit(node.children)
      })
    }
    visit(nodes)
    return paths
  }, [nodes])
  const allExpanded = directoryPaths.length > 0 &&
    directoryPaths.every((directoryPath) => expanded.has(directoryPath))

  useEffect(() => {
    const defaults = new Set<string>()
    const visit = (items: TreeNode[], depth: number) => {
      items.forEach((node) => {
        if (node.kind === 'directory') {
          if (depth < 2 || query || selectedPath?.startsWith(`${node.path}/`)) defaults.add(node.path)
          visit(node.children, depth + 1)
        }
      })
    }
    visit(nodes, 0)
    setExpanded((current) => new Set([...current, ...defaults]))
  }, [nodes, query, selectedPath])

  const renderNode = (node: TreeNode, depth: number) => {
    if (node.kind === 'directory') {
      const isOpen = expanded.has(node.path)
      return (
        <div key={node.id} className="tree-branch">
          <button
            className="tree-row directory-row"
            style={{ paddingLeft: 7 + depth * 15 }}
            onClick={() => {
              setExpanded((current) => {
                const next = new Set(current)
                if (next.has(node.path)) next.delete(node.path)
                else next.add(node.path)
                return next
              })
            }}
          >
            {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <Folder size={15} />
            <strong>{node.name}</strong>
            <span className={`tree-state ${node.status}`} />
            <small>{node.children.length}</small>
            <span
              className="tree-exclude"
              title={`排除 ${node.path}`}
              onClick={(event) => {
                event.stopPropagation()
                onExclude(node.path)
              }}
            >
              <EyeOff size={12} />
            </span>
          </button>
          {isOpen && <div>{node.children.map((child) => renderNode(child, depth + 1))}</div>}
        </div>
      )
    }

    const entry = node.entry!
    return (
      <button
        key={node.id}
        className={`tree-row file-row ${selectedPath === entry.path ? 'selected' : ''}`}
        style={{ paddingLeft: 22 + depth * 15 }}
        onClick={() => onSelect(entry)}
        title={entry.path}
      >
        <span className={`status-dot ${entry.status}`}>{statusMeta[entry.status].short}</span>
        <File size={14} />
        <span className="file-identity"><strong>{entry.name}</strong></span>
        {entry.addedLines !== undefined && (entry.addedLines > 0 || (entry.removedLines ?? 0) > 0) && (
          <span className="file-line-stats">
            {entry.addedLines > 0 && <b className="lines-added">+{entry.addedLines}</b>}
            {(entry.removedLines ?? 0) > 0 && <b className="lines-removed">−{entry.removedLines}</b>}
          </span>
        )}
        <ChevronRight className="row-arrow" size={13} />
      </button>
    )
  }

  return (
    <>
      {directoryPaths.length > 0 && (
        <div className="tree-toolbar">
          <span>{directoryPaths.length} 个目录</span>
          <button
            onClick={() => setExpanded(new Set(directoryPaths))}
            disabled={allExpanded}
            title="展开所有目录"
          >
            <ChevronDown size={12} />
            全部展开
          </button>
          <button
            onClick={() => setExpanded(new Set())}
            disabled={expanded.size === 0}
            title="折叠所有目录"
          >
            <ChevronRight size={12} />
            全部折叠
          </button>
        </div>
      )}
      {nodes.map((node) => renderNode(node, 0))}
    </>
  )
}

function SourcePicker({
  side,
  value,
  file = false,
  recentValues = [],
  onRecent,
  onClick
}: {
  side: string
  value: string | null
  file?: boolean
  recentValues?: string[]
  onRecent?: (value: string) => void
  onClick: () => void
}) {
  const [recentOpen, setRecentOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!recentOpen) return
    const closeOnOutside = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setRecentOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRecentOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [recentOpen])

  return (
    <div className="source-picker-wrap" ref={pickerRef}>
      <button
        className={`source-picker ${value ? 'has-value' : ''}`}
        onClick={() => {
          setRecentOpen(false)
          onClick()
        }}
      >
        <span className="source-icon">{file ? <File size={17} /> : <FolderOpen size={17} />}</span>
        <span className="source-copy">
          <small>{side}</small>
          <strong>{file && !value ? '选择文本文件' : shortPath(value)}</strong>
        </span>
        {value && <span className="source-fullpath">{value}</span>}
      </button>
      {!file && recentValues.length > 0 && (
        <>
          <button
            className="recent-trigger"
            onClick={() => setRecentOpen((open) => !open)}
            title="最近使用的文件夹"
          >
            <History size={14} /><ChevronDown size={11} />
          </button>
          {recentOpen && (
            <div className="recent-menu">
              <span>最近使用</span>
              {recentValues.map((recent) => (
                <button
                  key={recent}
                  onClick={() => {
                    setRecentOpen(false)
                    onRecent?.(recent)
                  }}
                  title={recent}
                >
                  <Folder size={14} />
                  <span><strong>{shortPath(recent)}</strong><small>{recent}</small></span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function FileHeading({ content, fallback }: { content: FileContent | null; fallback: string | null }) {
  return (
    <div className={`file-heading ${content ? '' : 'missing'}`}>
      <span>{content?.path ?? fallback ?? '未选择'}</span>
      <small>{content ? formatBytes(content.size) : '文件不存在'}</small>
    </div>
  )
}

function Welcome({ mode }: { mode: Mode }) {
  return (
    <div className="welcome">
      <div className="welcome-graphic">
        <div className="paper left"><span /><span /><span /></div>
        <div className="compare-arrows"><ArrowLeftRight size={25} /></div>
        <div className="paper right"><span /><span /><span /></div>
      </div>
      <h1>{mode === 'folders' ? '清晰看见每一处变化' : '选择文件或直接粘贴文本'}</h1>
      <p>
        {mode === 'folders'
          ? '所有文件都在本机对比，不会上传。选择左右两个文件夹即可开始。'
          : '支持代码、配置、日志和普通文本，也可以粘贴两段内容立即查看差异。'}
      </p>
      <div className="welcome-features">
        <span><Check size={14} /> 本地离线</span>
        <span><Check size={14} /> 递归扫描</span>
        <span><Check size={14} /> 语法高亮</span>
      </div>
    </div>
  )
}

export default App

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { calculateLineStats, compareFolders } from './compare'
import type { CompareOptions, ComparedEntry, FileContent } from '../src/shared/types'

const MAX_TEXT_BYTES = 5 * 1024 * 1024

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#101216',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.webContents.once('did-finish-load', () => window.show())
  window.webContents.on('did-fail-load', (_event, code, description) => {
    console.error(`Renderer failed to load (${code}): ${description}`)
    window.show()
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer process exited:', details.reason)
  })
  setTimeout(() => {
    if (!window.isDestroyed() && !window.isVisible()) window.show()
  }, 800)
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function isBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000))
  if (sample.includes(0)) return true
  let suspicious = 0
  for (const byte of sample) {
    if (byte < 7 || (byte > 13 && byte < 32)) suspicious++
  }
  return sample.length > 0 && suspicious / sample.length > 0.1
}

async function readTextFile(filePath: string): Promise<FileContent> {
  const stat = await fs.stat(filePath)
  if (!stat.isFile()) throw new Error('所选路径不是文件')
  const handle = await fs.open(filePath, 'r')
  try {
    const length = Math.min(stat.size, MAX_TEXT_BYTES)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, 0)
    const binary = isBinary(buffer)
    return {
      path: filePath,
      name: path.basename(filePath),
      content: binary ? '' : buffer.toString('utf8'),
      size: stat.size,
      binary,
      truncated: stat.size > MAX_TEXT_BYTES
    }
  } finally {
    await handle.close()
  }
}

function safeRelativePath(root: string, relativePath: string): string {
  const absoluteRoot = path.resolve(root)
  const candidate = path.resolve(absoluteRoot, relativePath)
  const prefix = absoluteRoot.endsWith(path.sep) ? absoluteRoot : absoluteRoot + path.sep
  if (candidate !== absoluteRoot && !candidate.startsWith(prefix)) {
    throw new Error('非法文件路径')
  }
  return candidate
}

app.whenReady().then(() => {
  ipcMain.handle('dialog:directory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('dialog:file', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'] })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('compare:folders', (
    _event,
    leftRoot: string,
    rightRoot: string,
    options?: CompareOptions
  ) =>
    compareFolders(leftRoot, rightRoot, options)
  )
  ipcMain.handle('compare:line-stats', (
    _event,
    leftRoot: string,
    rightRoot: string,
    entries: ComparedEntry[]
  ) => calculateLineStats(leftRoot, rightRoot, entries))
  ipcMain.handle('file:relative', (_event, root: string, relativePath: string) =>
    readTextFile(safeRelativePath(root, relativePath))
  )
  ipcMain.handle('file:absolute', (_event, filePath: string) => readTextFile(path.resolve(filePath)))
  ipcMain.handle('file:reveal', async (_event, filePath: string) => {
    shell.showItemInFolder(path.resolve(filePath))
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApi } from '../src/shared/types'

const api: DesktopApi = {
  selectDirectory: () => ipcRenderer.invoke('dialog:directory'),
  selectFile: () => ipcRenderer.invoke('dialog:file'),
  compareFolders: (leftRoot, rightRoot, options) =>
    ipcRenderer.invoke('compare:folders', leftRoot, rightRoot, options),
  calculateLineStats: (leftRoot, rightRoot, entries) =>
    ipcRenderer.invoke('compare:line-stats', leftRoot, rightRoot, entries),
  readRelativeFile: (root, relativePath) =>
    ipcRenderer.invoke('file:relative', root, relativePath),
  readFile: (filePath) => ipcRenderer.invoke('file:absolute', filePath),
  revealFile: (filePath) => ipcRenderer.invoke('file:reveal', filePath),
  platform: process.platform
}

contextBridge.exposeInMainWorld('desktop', api)

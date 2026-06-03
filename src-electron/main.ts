import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mkv', 'mov']

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Handball Analyzer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

ipcMain.handle('open-video', async () => {
  if (!mainWindow) {
    return { canceled: true, filePath: null }
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Video File',
    filters: [
      { name: 'Video Files', extensions: VIDEO_EXTENSIONS },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true, filePath: null }
  }

  return { canceled: false, filePath: result.filePaths[0] }
})

ipcMain.handle('cut-segment', async (_event, _startTime: number, _endTime: number) => {
  return { success: false, outputPath: null }
})

ipcMain.handle('export-segment', async (_event, _segmentId: string) => {
  return { success: false, outputPath: null }
})

ipcMain.handle('export-group', async (_event, _groupId: string) => {
  return { success: false, outputPath: null }
})

ipcMain.handle('save-project', async (_event, _projectData: unknown) => {
  return { success: false, path: null }
})

ipcMain.handle('load-project', async () => {
  return { success: false, project: null }
})

ipcMain.handle('get-ffmpeg-path', async () => {
  return { path: null }
})

function getCachePath(sourceVideoPath: string): string {
  const dir = path.dirname(sourceVideoPath)
  return path.join(dir, '.handball-cache.json')
}

ipcMain.handle('write-cache', async (_event, sourceVideoPath: string, data: unknown) => {
  if (!sourceVideoPath) return { success: false }
  try {
    const cachePath = getCachePath(sourceVideoPath)
    fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf-8')
    return { success: true }
  } catch {
    return { success: false }
  }
})

ipcMain.handle('read-cache', async (_event, sourceVideoPath: string) => {
  if (!sourceVideoPath) return { success: false, data: null }
  try {
    const cachePath = getCachePath(sourceVideoPath)
    if (!fs.existsSync(cachePath)) return { success: false, data: null }
    const raw = fs.readFileSync(cachePath, 'utf-8')
    return { success: true, data: JSON.parse(raw) }
  } catch {
    return { success: false, data: null }
  }
})

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

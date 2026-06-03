import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg') as { path: string }
const ffmpegPath = ffmpegInstaller.path

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

interface ExportSegmentData {
  startTime: number
  endTime: number
  sourceVideoPath: string
  sourceVideoFileName: string
  slowMotionSpeed: number
}

ipcMain.handle('export-segment', async (_event, data: ExportSegmentData) => {
  if (!mainWindow) {
    return { success: false, outputPath: null, error: 'No application window' }
  }

  const ext = path.extname(data.sourceVideoFileName) || '.mp4'
  const baseName = path.basename(data.sourceVideoFileName, ext)
  const defaultName = `${baseName}_segment_${data.startTime.toFixed(1)}-${data.endTime.toFixed(1)}.mp4`

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Segment',
    defaultPath: defaultName,
    filters: [
      { name: 'MP4 Video', extensions: ['mp4'] },
    ],
  })

  if (result.canceled || !result.filePath) {
    return { success: false, outputPath: null, error: 'Export canceled' }
  }

  const outputPath = result.filePath

  return new Promise((resolve) => {
    let args: string[]

    if (data.slowMotionSpeed < 1 && data.slowMotionSpeed > 0) {
      const setpts = (1 / data.slowMotionSpeed).toFixed(4)
      args = [
        '-ss', String(data.startTime),
        '-to', String(data.endTime),
        '-i', data.sourceVideoPath,
        '-filter:v', `setpts=${setpts}*PTS`,
        '-filter:a', `atempo=${data.slowMotionSpeed.toFixed(4)}`,
        '-y',
        outputPath,
      ]
    } else {
      args = [
        '-ss', String(data.startTime),
        '-to', String(data.endTime),
        '-i', data.sourceVideoPath,
        '-c', 'copy',
        '-y',
        outputPath,
      ]
    }

    const proc = spawn(ffmpegPath, args)

    let stderr = ''

    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.on('close', (code: number | null) => {
      if (code === 0) {
        resolve({ success: true, outputPath, error: null })
      } else {
        resolve({
          success: false,
          outputPath: null,
          error: `ffmpeg exited with code ${code}: ${stderr.slice(-500)}`,
        })
      }
    })

    proc.on('error', (err: Error) => {
      resolve({
        success: false,
        outputPath: null,
        error: `Failed to run ffmpeg: ${err.message}`,
      })
    })
  })
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
  return { path: ffmpegPath }
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

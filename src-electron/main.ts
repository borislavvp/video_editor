import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
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

interface ExportGroupSegment {
  id: string
  title: string
  startTime: number
  endTime: number
  slowMotionSpeed: number
}

interface ExportGroupRequestData {
  sourceVideoPath: string
  sourceVideoFileName: string
  segments: ExportGroupSegment[]
  groupTitle: string
}

function escapeDrawtext(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
}

function trimSegmentToFile(
  seg: ExportGroupSegment,
  sourceVideoPath: string,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-ss', String(seg.startTime),
      '-to', String(seg.endTime),
      '-i', sourceVideoPath,
    ]

    const needsSlowMo = seg.slowMotionSpeed < 1 && seg.slowMotionSpeed > 0
    const hasTitle = !!seg.title

    if (!needsSlowMo && !hasTitle) {
      args.push('-c', 'copy')
    } else {
      const vfParts: string[] = []

      if (needsSlowMo) {
        const setpts = (1 / seg.slowMotionSpeed).toFixed(4)
        vfParts.push(`setpts=${setpts}*PTS`)
      }

      if (hasTitle) {
        const escaped = escapeDrawtext(seg.title)
        vfParts.push(
          `drawtext=text='${escaped}':fontsize=24:fontcolor=white:bordercolor=black:borderw=2:x=10:y=h-th-10:enable='between(t,0,3)'`,
        )
      }

      args.push('-filter:v', vfParts.join(','))
      args.push('-c:v', 'libx264')
      args.push('-preset', 'ultrafast')

      if (needsSlowMo) {
        args.push('-filter:a', `atempo=${seg.slowMotionSpeed.toFixed(4)}`)
        args.push('-c:a', 'aac')
      } else {
        args.push('-c:a', 'copy')
      }
    }

    args.push('-y', outputPath)

    const proc = spawn(ffmpegPath, args)

    let stderr = ''
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.on('close', (code: number | null) => {
      if (code === 0) {
        resolve()
      } else {
        reject(
          new Error(
            `segment trim failed with code ${code}: ${stderr.slice(-300)}`,
          ),
        )
      }
    })

    proc.on('error', (err: Error) => {
      reject(new Error(`ffmpeg error: ${err.message}`))
    })
  })
}

ipcMain.handle('export-group', async (_event, data: ExportGroupRequestData) => {
  if (!mainWindow) {
    return { success: false, outputPath: null, error: 'No application window' }
  }

  if (!data.segments || data.segments.length === 0) {
    return { success: false, outputPath: null, error: 'No segments in group' }
  }

  const ext = path.extname(data.sourceVideoFileName) || '.mp4'
  const baseName = path.basename(data.sourceVideoFileName, ext)
  const safeGroupTitle = data.groupTitle.replace(/[^a-zA-Z0-9 _-]/g, '')
  const defaultName = `${baseName}_${safeGroupTitle}_group.mp4`

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Group',
    defaultPath: defaultName,
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
  })

  if (result.canceled || !result.filePath) {
    return { success: false, outputPath: null, error: 'Export canceled' }
  }

  const outputPath = result.filePath
  const tempDir = path.join(os.tmpdir(), `handball-group-${Date.now()}`)
  const tempFiles: string[] = []

  try {
    fs.mkdirSync(tempDir, { recursive: true })

    for (let i = 0; i < data.segments.length; i++) {
      const seg = data.segments[i]
      const tempFile = path.join(tempDir, `seg_${String(i).padStart(4, '0')}.ts`)
      tempFiles.push(tempFile)
      await trimSegmentToFile(seg, data.sourceVideoPath, tempFile)
    }

    const concatList = path.join(tempDir, 'concat.txt')
    const concatContent = tempFiles
      .map((f) => `file '${f.replace(/'/g, "'\\''")}'`)
      .join('\n')
    fs.writeFileSync(concatList, concatContent, 'utf-8')

    await new Promise<void>((resolve, reject) => {
      const args = [
        '-f', 'concat',
        '-safe', '0',
        '-i', concatList,
        '-c', 'copy',
        '-y',
        outputPath,
      ]

      const proc = spawn(ffmpegPath, args)

      let stderr = ''
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })

      proc.on('close', (code: number | null) => {
        if (code === 0) {
          resolve()
        } else {
          reject(
            new Error(
              `concat failed with code ${code}: ${stderr.slice(-500)}`,
            ),
          )
        }
      })

      proc.on('error', (err: Error) => {
        reject(new Error(`concat ffmpeg error: ${err.message}`))
      })
    })

    return { success: true, outputPath, error: null }
  } catch (err) {
    return {
      success: false,
      outputPath: null,
      error: `Export failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  }
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

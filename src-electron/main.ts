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

interface SaveProjectData {
  version: string
  sourceVideoPath: string | null
  sourceVideoFileName: string | null
  segments: {
    id: string
    groupId: string | null
    title: string
    comments: string
    startTime: number
    endTime: number
    slowMotionSpeed: number
  }[]
  groups: {
    id: string
    title: string
    comments: string
    order: number
    visible: boolean
  }[]
  projectName: string
}

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, '_').slice(0, 200) || 'segment'
}

function runFfmpegExport(
  sourceVideoPath: string,
  startTime: number,
  endTime: number,
  slowMotionSpeed: number,
  outputPath: string,
): Promise<{ success: boolean; error: string | null }> {
  return new Promise((resolve) => {
    let args: string[]

    if (slowMotionSpeed < 1 && slowMotionSpeed > 0) {
      const setpts = (1 / slowMotionSpeed).toFixed(4)
      args = [
        '-ss', String(startTime),
        '-to', String(endTime),
        '-i', sourceVideoPath,
        '-filter:v', `setpts=${setpts}*PTS`,
        '-filter:a', `atempo=${slowMotionSpeed.toFixed(4)}`,
        '-y',
        outputPath,
      ]
    } else {
      args = [
        '-ss', String(startTime),
        '-to', String(endTime),
        '-i', sourceVideoPath,
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
        resolve({ success: true, error: null })
      } else {
        resolve({
          success: false,
          error: `ffmpeg exited with code ${code}: ${stderr.slice(-500)}`,
        })
      }
    })

    proc.on('error', (err: Error) => {
      resolve({
        success: false,
        error: `Failed to run ffmpeg: ${err.message}`,
      })
    })
  })
}

ipcMain.handle('save-project', async (_event, projectData: SaveProjectData) => {
  if (!mainWindow) {
    return { success: false, path: null, error: 'No application window' }
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Destination Folder for Project',
    properties: ['openDirectory', 'createDirectory'],
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, path: null, error: 'Save canceled' }
  }

  const destFolder = result.filePaths[0]
  const safeName = sanitizeFilename(projectData.projectName || 'handball-project')
  const projectRoot = path.join(destFolder, safeName)

  try {
    fs.mkdirSync(projectRoot, { recursive: true })
  } catch (err) {
    return { success: false, path: null, error: `Failed to create project directory: ${err}` }
  }

  const groupFolders = new Map<string | null, string>()

  for (const group of projectData.groups) {
    const folderName = sanitizeFilename(group.title) || `group_${group.id}`
    const folderPath = path.join(projectRoot, folderName)
    try {
      fs.mkdirSync(folderPath, { recursive: true })
      groupFolders.set(group.id, folderPath)
    } catch {
      return { success: false, path: null, error: `Failed to create folder for group: ${group.title}` }
    }
  }

  const ungroupedFolder = path.join(projectRoot, 'Ungrouped')
  try {
    fs.mkdirSync(ungroupedFolder, { recursive: true })
    groupFolders.set(null, ungroupedFolder)
  } catch {
    return { success: false, path: null, error: 'Failed to create Ungrouped folder' }
  }

  if (!projectData.sourceVideoPath) {
    return { success: false, path: null, error: 'No source video loaded' }
  }

  for (const segment of projectData.segments) {
    const folderPath = groupFolders.get(segment.groupId) ?? ungroupedFolder
    const baseName = sanitizeFilename(segment.title) || `segment_${segment.id}`
    const segName = `${baseName}_${segment.startTime.toFixed(1)}-${segment.endTime.toFixed(1)}`
    const outputPath = path.join(folderPath, `${segName}.mp4`)

    const exportResult = await runFfmpegExport(
      projectData.sourceVideoPath,
      segment.startTime,
      segment.endTime,
      segment.slowMotionSpeed,
      outputPath,
    )

    if (!exportResult.success) {
      return {
        success: false,
        path: null,
        error: `Failed to export segment "${segment.title}": ${exportResult.error}`,
      }
    }
  }

  const projectJson: Record<string, unknown> = {
    version: projectData.version,
    projectName: projectData.projectName,
    sourceVideoPath: projectData.sourceVideoPath,
    sourceVideoFileName: projectData.sourceVideoFileName,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    segments: projectData.segments,
    groups: projectData.groups,
  }

  try {
    fs.writeFileSync(
      path.join(projectRoot, 'project.json'),
      JSON.stringify(projectJson, null, 2),
      'utf-8',
    )
  } catch {
    return { success: false, path: null, error: 'Failed to write project.json' }
  }

  return { success: true, path: projectRoot, error: null }
})

ipcMain.handle('load-project', async () => {
  if (!mainWindow) {
    return { success: false, project: null, projectPath: null, error: 'No application window' }
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Project Folder',
    properties: ['openDirectory'],
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, project: null, projectPath: null, error: 'Load canceled' }
  }

  const projectDir = result.filePaths[0]
  const projectJsonPath = path.join(projectDir, 'project.json')

  if (!fs.existsSync(projectJsonPath)) {
    return {
      success: false,
      project: null,
      projectPath: null,
      error: 'No project.json found in the selected folder',
    }
  }

  try {
    const raw = fs.readFileSync(projectJsonPath, 'utf-8')
    const project = JSON.parse(raw)
    return { success: true, project, projectPath: projectDir, error: null }
  } catch (err) {
    return {
      success: false,
      project: null,
      projectPath: null,
      error: `Failed to read project.json: ${err}`,
    }
  }
})

ipcMain.handle('get-ffmpeg-path', async () => {
  return { path: ffmpegPath }
})

function getCachePath(sourceVideoPath: string): string {
  const dir = path.dirname(sourceVideoPath)
  return path.join(dir, '.handball-cache.json')
}

ipcMain.handle('file-exists', async (_event, filePath: string) => {
  if (!filePath) return false
  try {
    return fs.existsSync(filePath)
  } catch {
    return false
  }
})

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

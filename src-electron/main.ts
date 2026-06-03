import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'

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

// Placeholder IPC handlers
ipcMain.handle('open-video', async () => {
  return { canceled: true, filePath: null }
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

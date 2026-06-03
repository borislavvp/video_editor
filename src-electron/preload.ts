import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  openVideo: () => ipcRenderer.invoke('open-video'),
  cutSegment: (startTime: number, endTime: number) =>
    ipcRenderer.invoke('cut-segment', startTime, endTime),
  exportSegment: (data: {
    startTime: number
    endTime: number
    sourceVideoPath: string
    sourceVideoFileName: string
    slowMotionSpeed: number
  }) => ipcRenderer.invoke('export-segment', data),
  exportGroup: (data: {
    sourceVideoPath: string
    sourceVideoFileName: string
    segments: { id: string; title: string; startTime: number; endTime: number; slowMotionSpeed: number }[]
    groupTitle: string
  }) => ipcRenderer.invoke('export-group', data),
  saveProject: (projectData: unknown) =>
    ipcRenderer.invoke('save-project', projectData),
  loadProject: () => ipcRenderer.invoke('load-project'),
  getFFmpegPath: () => ipcRenderer.invoke('get-ffmpeg-path'),
  writeCache: (sourceVideoPath: string, data: unknown) =>
    ipcRenderer.invoke('write-cache', sourceVideoPath, data),
  readCache: (sourceVideoPath: string) =>
    ipcRenderer.invoke('read-cache', sourceVideoPath),
})

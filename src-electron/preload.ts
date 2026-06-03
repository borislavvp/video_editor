import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  openVideo: () => ipcRenderer.invoke('open-video'),
  cutSegment: (startTime: number, endTime: number) =>
    ipcRenderer.invoke('cut-segment', startTime, endTime),
  exportSegment: (segmentId: string) =>
    ipcRenderer.invoke('export-segment', segmentId),
  exportGroup: (groupId: string) =>
    ipcRenderer.invoke('export-group', groupId),
  saveProject: (projectData: unknown) =>
    ipcRenderer.invoke('save-project', projectData),
  loadProject: () => ipcRenderer.invoke('load-project'),
  getFFmpegPath: () => ipcRenderer.invoke('get-ffmpeg-path'),
})

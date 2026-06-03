export interface ElectronAPI {
  openVideo: () => Promise<{ canceled: boolean; filePath: string | null }>
  cutSegment: (startTime: number, endTime: number) => Promise<{ success: boolean; outputPath: string | null }>
  exportSegment: (segmentId: string) => Promise<{ success: boolean; outputPath: string | null }>
  exportGroup: (groupId: string) => Promise<{ success: boolean; outputPath: string | null }>
  saveProject: (projectData: unknown) => Promise<{ success: boolean; path: string | null }>
  loadProject: () => Promise<{ success: boolean; project: unknown }>
  getFFmpegPath: () => Promise<{ path: string | null }>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}

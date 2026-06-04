export interface ExportSegmentData {
  startTime: number
  endTime: number
  sourceVideoPath: string
  sourceVideoFileName: string
  slowMotionSpeed: number
  title: string
}

export interface ExportResult {
  success: boolean
  outputPath: string | null
  error: string | null
}

export interface SaveProjectData {
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

export interface SaveProjectResult {
  success: boolean
  path: string | null
  error: string | null
}

export interface LoadProjectResult {
  success: boolean
  project: SaveProjectData | null
  projectPath: string | null
  error: string | null
}

export interface ExportGroupSegmentData {
  id: string
  title: string
  startTime: number
  endTime: number
  slowMotionSpeed: number
}

export interface ExportGroupData {
  sourceVideoPath: string
  sourceVideoFileName: string
  segments: ExportGroupSegmentData[]
  groupTitle: string
}

export interface ElectronAPI {
  openVideo: () => Promise<{ canceled: boolean; filePath: string | null }>
  cutSegment: (startTime: number, endTime: number) => Promise<{ success: boolean; outputPath: string | null }>
  exportSegment: (data: ExportSegmentData) => Promise<ExportResult>
  exportGroup: (data: ExportGroupData) => Promise<ExportResult>
  saveProject: (projectData: SaveProjectData) => Promise<SaveProjectResult>
  loadProject: () => Promise<LoadProjectResult>
  getFFmpegPath: () => Promise<{ path: string | null }>
  writeCache: (sourceVideoPath: string, data: unknown) => Promise<{ success: boolean }>
  readCache: (sourceVideoPath: string) => Promise<{ success: boolean; data: unknown }>
  fileExists: (filePath: string) => Promise<boolean>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}

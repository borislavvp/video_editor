import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

export interface Segment {
  id: string
  groupId: string | null
  title: string
  comments: string
  startTime: number
  endTime: number
  slowMotionSpeed: number
}

export interface Group {
  id: string
  title: string
  comments: string
  order: number
  visible: boolean
}

export const useProjectStore = defineStore('project', () => {
  const sourceVideoPath = ref<string | null>(null)
  const sourceVideoFileName = ref<string | null>(null)
  const groups = ref<Group[]>([])
  const segments = ref<Segment[]>([])

  const hasVideo = computed(() => sourceVideoPath.value !== null)

  function setSourceVideo(filePath: string) {
    sourceVideoPath.value = filePath
    const parts = filePath.replace(/\\/g, '/').split('/')
    sourceVideoFileName.value = parts[parts.length - 1] ?? filePath
  }

  return {
    sourceVideoPath,
    sourceVideoFileName,
    groups,
    segments,
    hasVideo,
    setSourceVideo,
  }
})

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

let nextId = 1

export function updateNextId(maxId: number) {
  nextId = Math.max(nextId, maxId + 1)
}

export const useProjectStore = defineStore('project', () => {
  const sourceVideoPath = ref<string | null>(null)
  const sourceVideoFileName = ref<string | null>(null)
  const groups = ref<Group[]>([])
  const segments = ref<Segment[]>([])
  const selectedSegmentId = ref<string | null>(null)
  const inMarker = ref<number | null>(null)
  const outMarker = ref<number | null>(null)
  let segmentCounter = 0

  const hasVideo = computed(() => sourceVideoPath.value !== null)
  const hasInMarker = computed(() => inMarker.value !== null)
  const hasOutMarker = computed(() => outMarker.value !== null)
  const selectedSegment = computed(() =>
    segments.value.find((s) => s.id === selectedSegmentId.value) ?? null,
  )

  function setSourceVideo(filePath: string) {
    sourceVideoPath.value = filePath
    const parts = filePath.replace(/\\/g, '/').split('/')
    sourceVideoFileName.value = parts[parts.length - 1] ?? filePath
    segments.value = []
    groups.value = []
    selectedSegmentId.value = null
    clearMarkers()
    segmentCounter = 0
  }

  function setInMarker(time: number) {
    inMarker.value = time
  }

  function setOutMarker(time: number) {
    outMarker.value = time
  }

  function clearMarkers() {
    inMarker.value = null
    outMarker.value = null
  }

  function addSegment(startTime: number, endTime: number): Segment {
    if (endTime < startTime) {
      ;[startTime, endTime] = [endTime, startTime]
    }
    segmentCounter++
    const segment: Segment = {
      id: String(nextId++),
      groupId: null,
      title: `Segment ${segmentCounter}`,
      comments: '',
      startTime,
      endTime,
      slowMotionSpeed: 1,
    }
    segments.value.push(segment)
    clearMarkers()
    return segment
  }

  function removeSegment(id: string) {
    const idx = segments.value.findIndex((s) => s.id === id)
    if (idx !== -1) {
      segments.value.splice(idx, 1)
    }
    if (selectedSegmentId.value === id) {
      selectedSegmentId.value = null
    }
  }

  function deleteSelectedSegment() {
    if (selectedSegmentId.value) {
      removeSegment(selectedSegmentId.value)
    }
  }

  function selectSegment(id: string | null) {
    selectedSegmentId.value = id
  }

  function updateSegmentTitle(id: string, title: string) {
    const segment = segments.value.find((s) => s.id === id)
    if (segment) {
      segment.title = title
    }
  }

  function updateSegmentComments(id: string, comments: string) {
    const segment = segments.value.find((s) => s.id === id)
    if (segment) {
      segment.comments = comments
    }
  }

  function updateSegmentSlowMotionSpeed(id: string, speed: number) {
    const segment = segments.value.find((s) => s.id === id)
    if (segment) {
      segment.slowMotionSpeed = speed
    }
  }

  function restoreState(state: {
    segments?: Segment[]
    groups?: Group[]
    inMarker?: number | null
    outMarker?: number | null
  }) {
    if (state.segments) {
      segments.value = state.segments
      const maxId = Math.max(
        ...state.segments.map((s) => Number(s.id)).filter((n) => !isNaN(n)),
        0,
      )
      updateNextId(maxId)
      segmentCounter = state.segments.length
    }
    if (state.groups) {
      groups.value = state.groups
    }
    if (state.inMarker !== undefined) {
      inMarker.value = state.inMarker
    }
    if (state.outMarker !== undefined) {
      outMarker.value = state.outMarker
    }
  }

  return {
    sourceVideoPath,
    sourceVideoFileName,
    groups,
    segments,
    selectedSegmentId,
    inMarker,
    outMarker,
    hasVideo,
    hasInMarker,
    hasOutMarker,
    selectedSegment,
    setSourceVideo,
    setInMarker,
    setOutMarker,
    clearMarkers,
    addSegment,
    removeSegment,
    deleteSelectedSegment,
    selectSegment,
    updateSegmentTitle,
    updateSegmentComments,
    updateSegmentSlowMotionSpeed,
    restoreState,
  }
})

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
  let groupCounter = 0

  const hasVideo = computed(() => sourceVideoPath.value !== null)
  const hasInMarker = computed(() => inMarker.value !== null)
  const hasOutMarker = computed(() => outMarker.value !== null)
  const selectedSegment = computed(() =>
    segments.value.find((s) => s.id === selectedSegmentId.value) ?? null,
  )
  const sortedGroups = computed(() =>
    [...groups.value].sort((a, b) => a.order - b.order),
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

  function updateSegment(
    id: string,
    updates: Partial<{
      startTime: number
      endTime: number
      title: string
      comments: string
      groupId: string | null
      slowMotionSpeed: number
    }>,
  ) {
    const seg = segments.value.find((s) => s.id === id)
    if (seg) {
      if (updates.startTime !== undefined) seg.startTime = updates.startTime
      if (updates.endTime !== undefined) seg.endTime = updates.endTime
      if (updates.title !== undefined) seg.title = updates.title
      if (updates.comments !== undefined) seg.comments = updates.comments
      if (updates.groupId !== undefined) seg.groupId = updates.groupId
      if (updates.slowMotionSpeed !== undefined) seg.slowMotionSpeed = updates.slowMotionSpeed
    }
  }

  function setSegments(val: Segment[]) {
    segments.value = val
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

  function addGroup(): Group {
    groupCounter++
    const group: Group = {
      id: `g${Date.now()}`,
      title: `Group ${groupCounter}`,
      comments: '',
      order: groups.value.length,
      visible: true,
    }
    groups.value.push(group)
    return group
  }

  function updateGroup(
    id: string,
    updates: Partial<{ title: string; comments: string; visible: boolean }>,
  ) {
    const g = groups.value.find((g) => g.id === id)
    if (g) {
      if (updates.title !== undefined) g.title = updates.title
      if (updates.comments !== undefined) g.comments = updates.comments
      if (updates.visible !== undefined) g.visible = updates.visible
    }
  }

  function removeGroup(id: string) {
    groups.value = groups.value.filter((g) => g.id !== id)
    for (const seg of segments.value) {
      if (seg.groupId === id) {
        seg.groupId = null
      }
    }
  }

  function reorderGroups(orderedIds: string[]) {
    for (const g of groups.value) {
      const idx = orderedIds.indexOf(g.id)
      if (idx !== -1) {
        g.order = idx
      }
    }
  }

  function setGroups(val: Group[]) {
    groups.value = val
  }

  function assignSegmentToGroup(segmentId: string, groupId: string | null) {
    const seg = segments.value.find((s) => s.id === segmentId)
    if (!seg) return

    if (seg.groupId !== groupId) {
      seg.groupId = groupId
      moveSegmentToEndOfGroup(segmentId, groupId)
    }
  }

  function moveSegmentToEndOfGroup(segmentId: string, groupId: string | null) {
    const idx = segments.value.findIndex((s) => s.id === segmentId)
    if (idx === -1) return
    const [seg] = segments.value.splice(idx, 1)
    const lastIdx = findLastIndex(
      segments.value,
      (s) => s.groupId === groupId,
    )
    segments.value.splice(lastIdx + 1, 0, seg)
  }

  function moveSegment(
    segmentId: string,
    targetGroupId: string | null,
    insertBeforeSegmentId: string | null,
  ) {
    const idx = segments.value.findIndex((s) => s.id === segmentId)
    if (idx === -1) return

    const seg = segments.value[idx]
    seg.groupId = targetGroupId

    const [removed] = segments.value.splice(idx, 1)

    if (insertBeforeSegmentId) {
      const targetIdx = segments.value.findIndex(
        (s) => s.id === insertBeforeSegmentId,
      )
      if (targetIdx !== -1) {
        segments.value.splice(targetIdx, 0, removed)
        return
      }
    }

    const lastIdx = findLastIndex(
      segments.value,
      (s) => s.groupId === targetGroupId,
    )
    segments.value.splice(lastIdx + 1, 0, removed)
  }

  function reorderSegmentWithinGroup(
    segmentId: string,
    insertBeforeSegmentId: string | null,
  ) {
    const seg = segments.value.find((s) => s.id === segmentId)
    if (!seg) return
    moveSegment(segmentId, seg.groupId, insertBeforeSegmentId)
  }

  function findLastIndex<T>(arr: T[], predicate: (item: T) => boolean): number {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (predicate(arr[i])) return i
    }
    return -1
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
      groupCounter = state.groups.length
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
    sortedGroups,
    setSourceVideo,
    setInMarker,
    setOutMarker,
    clearMarkers,
    addSegment,
    removeSegment,
    deleteSelectedSegment,
    selectSegment,
    updateSegment,
    setSegments,
    updateSegmentTitle,
    updateSegmentComments,
    updateSegmentSlowMotionSpeed,
    restoreState,
    addGroup,
    updateGroup,
    removeGroup,
    reorderGroups,
    setGroups,
    assignSegmentToGroup,
    moveSegment,
    reorderSegmentWithinGroup,
  }
})

<script setup lang="ts">
import { ref, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { useProjectStore } from '../stores/project'
import type { Segment, Group } from '../stores/project'
import { usePlayerStore } from '../stores/player'
import TimelineCanvas from '../components/TimelineCanvas.vue'

const projectStore = useProjectStore()
const player = usePlayerStore()

const videoRef = ref<HTMLVideoElement | null>(null)
const videoWidth = ref<number>(0)
const videoHeight = ref<number>(0)
const videoError = ref<string | null>(null)
const editingTitleId = ref<string | null>(null)
const editingTitleValue = ref('')
const segmentSpeedApplied = ref(false)

const collapsedGroups = ref<Set<string>>(new Set())
const editingGroupTitleId = ref<string | null>(null)
const editingGroupTitleValue = ref('')
const dragState = ref<{ type: 'segment'; segmentId: string } | { type: 'group'; groupId: string } | null>(null)
const dragOverSegment = ref<{ segmentId: string; position: 'before' | 'after' } | null>(null)
const dragOverGroup = ref<string | null>(null)
const exportingSegmentId = ref<string | null>(null)
const exportError = ref<string | null>(null)
const savingProject = ref(false)
const saveProjectError = ref<string | null>(null)
const loadingProject = ref(false)
const loadProjectError = ref<string | null>(null)
const showCacheRestorePrompt = ref(false)
const cacheRestoreData = ref<Record<string, unknown> | null>(null)

const FRAME_STEP = 1 / 30

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '00:00.00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 100)
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`
}

function startEditingTitle(id: string) {
  editingTitleId.value = id
  editingTitleValue.value =
    projectStore.segments.find((s) => s.id === id)?.title ?? ''
  nextTick(() => {
    const input = document.querySelector<HTMLInputElement>(
      `input[data-segment-title="${id}"]`,
    )
    input?.focus()
    input?.select()
  })
}

function saveTitle(id: string) {
  projectStore.updateSegmentTitle(id, editingTitleValue.value)
  editingTitleId.value = null
}

function togglePlay() {
  const v = videoRef.value
  if (!v) return
  if (v.paused || v.ended) {
    v.play()
  } else {
    v.pause()
  }
}

function frameStep(direction: -1 | 1) {
  const v = videoRef.value
  if (!v || !v.paused) return
  v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + direction * FRAME_STEP))
  player.updateTime(v.currentTime)
}

function seekTo(time: number) {
  const v = videoRef.value
  if (!v) return
  v.currentTime = time
  player.updateTime(time)
}

function startSlowMotion() {
  const v = videoRef.value
  if (!v) return
  player.startSlowMotion(v.playbackRate)
  v.playbackRate = 0.25
}

function stopSlowMotion() {
  const v = videoRef.value
  if (!v) return
  player.stopSlowMotion()
  v.playbackRate = player.savedRate
}

async function openVideo() {
  videoError.value = null
  const result = await window.electronAPI.openVideo()
  if (result.canceled || !result.filePath) return

  player.reset()
  projectStore.setSourceVideo(result.filePath)

  if (videoRef.value) {
    videoRef.value.src = `file://${result.filePath}`
  }

  restoreCache()
}

function markIn() {
  projectStore.setInMarker(player.currentTime)
}

function markOut() {
  const t = player.currentTime
  projectStore.setOutMarker(t)
  if (projectStore.hasInMarker && projectStore.inMarker !== null) {
    projectStore.addSegment(projectStore.inMarker, t)
  }
}

function deleteSelected() {
  projectStore.deleteSelectedSegment()
}

function updateSegment(id: string, startTime: number, endTime: number) {
  projectStore.updateSegment(id, { startTime, endTime })
}

function createGroup() {
  projectStore.addGroup()
}

function toggleCollapse(groupId: string) {
  if (collapsedGroups.value.has(groupId)) {
    collapsedGroups.value.delete(groupId)
  } else {
    collapsedGroups.value.add(groupId)
  }
}

function toggleGroupVisibility(groupId: string) {
  const g = projectStore.groups.find((g) => g.id === groupId)
  if (g) {
    projectStore.updateGroup(groupId, { visible: !g.visible })
  }
}

function startEditingGroupTitle(groupId: string) {
  editingGroupTitleId.value = groupId
  editingGroupTitleValue.value =
    projectStore.groups.find((g) => g.id === groupId)?.title ?? ''
  nextTick(() => {
    const input = document.querySelector<HTMLInputElement>(
      `input[data-group-title="${groupId}"]`,
    )
    input?.focus()
    input?.select()
  })
}

function saveGroupTitle(groupId: string) {
  projectStore.updateGroup(groupId, { title: editingGroupTitleValue.value })
  editingGroupTitleId.value = null
}

function getGroupSegments(groupId: string | null) {
  return projectStore.segments.filter((s) => s.groupId === groupId)
}

function onSegmentDragStart(e: DragEvent, segmentId: string) {
  if (!e.dataTransfer) return
  dragState.value = { type: 'segment', segmentId }
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', segmentId)
}

function onSegmentDragEnd() {
  dragState.value = null
  dragOverSegment.value = null
  dragOverGroup.value = null
}

function onSegmentDragOver(e: DragEvent, segmentId: string | null) {
  if (!dragState.value || dragState.value.type !== 'segment') return
  e.preventDefault()
  if (!e.dataTransfer) return
  e.dataTransfer.dropEffect = 'move'

  if (dragOverGroup.value) {
    dragOverGroup.value = null
  }

  if (segmentId) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    dragOverSegment.value = {
      segmentId,
      position: e.clientY < midY ? 'before' : 'after',
    }
  }
}

function onSegmentDragLeave(e: DragEvent) {
  if (dragOverSegment.value) {
    const segId = dragOverSegment.value.segmentId
    const target = e.currentTarget as HTMLElement
    const related = e.relatedTarget as HTMLElement
    if (related && target.contains(related)) return
    if (dragOverSegment.value.segmentId === segId) {
      dragOverSegment.value = null
    }
  }
}

function onSegmentDrop(
  e: DragEvent,
  targetGroupId: string | null,
  targetSegmentId: string | null,
  position: 'before' | 'after' | null,
) {
  e.preventDefault()
  if (!dragState.value || dragState.value.type !== 'segment') return

  const segmentId = dragState.value.segmentId
  const seg = projectStore.segments.find((s) => s.id === segmentId)
  if (!seg) {
    onSegmentDragEnd()
    return
  }

  if (targetSegmentId && position) {
    const targetSeg = projectStore.segments.find(
      (s) => s.id === targetSegmentId,
    )
    if (targetSeg) {
      const insertBeforeId =
        position === 'before' ? targetSegmentId : findNextSiblingId(targetSegmentId, targetSeg.groupId)
      projectStore.moveSegment(segmentId, targetSeg.groupId, insertBeforeId)
    }
  } else if (targetGroupId !== undefined) {
    projectStore.assignSegmentToGroup(segmentId, targetGroupId)
  }

  onSegmentDragEnd()
}

function findNextSiblingId(segmentId: string, groupId: string | null): string | null {
  const groupSegs = projectStore.segments.filter((s) => s.groupId === groupId)
  const idx = groupSegs.findIndex((s) => s.id === segmentId)
  if (idx !== -1 && idx + 1 < groupSegs.length) {
    return groupSegs[idx + 1].id
  }
  return null
}

function onGroupDropZoneDragOver(e: DragEvent, groupId: string | null) {
  if (!dragState.value) return
  e.preventDefault()
  if (!e.dataTransfer) return
  e.dataTransfer.dropEffect = 'move'

  if (dragState.value.type === 'segment') {
    dragOverSegment.value = null
    dragOverGroup.value = groupId
  }
}

function onGroupDropZoneDragLeave() {
  dragOverGroup.value = null
}

function onGroupDropZoneDrop(e: DragEvent, groupId: string | null) {
  e.preventDefault()
  if (!dragState.value) return

  if (dragState.value.type === 'segment') {
    projectStore.assignSegmentToGroup(dragState.value.segmentId, groupId)
    onSegmentDragEnd()
  }
}

function onGroupDragStart(e: DragEvent, groupId: string) {
  if (!e.dataTransfer) return
  dragState.value = { type: 'group', groupId }
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', groupId)
}

function onGroupDragEnd() {
  dragState.value = null
  dragOverGroup.value = null
}

function onGroupHeaderDragOver(e: DragEvent, groupId: string) {
  if (!dragState.value || dragState.value.type !== 'group') return
  e.preventDefault()
  if (!e.dataTransfer) return
  e.dataTransfer.dropEffect = 'move'

  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const midY = rect.top + rect.height / 2
  dragOverGroup.value = e.clientY < midY ? 'before:' + groupId : 'after:' + groupId
}

function onGroupHeaderDrop(e: DragEvent, targetGroupId: string) {
  e.preventDefault()
  if (
    !dragState.value ||
    dragState.value.type !== 'group' ||
    dragState.value.groupId === targetGroupId
  ) {
    onGroupDragEnd()
    return
  }

  const groups = projectStore.sortedGroups
  const draggedId = dragState.value.groupId
  const position = dragOverGroup.value

  let insertBefore = targetGroupId
  if (position && position.startsWith('after:')) {
    const targetIdx = groups.findIndex((g) => g.id === targetGroupId)
    if (targetIdx !== -1 && targetIdx + 1 < groups.length) {
      insertBefore = groups[targetIdx + 1].id
    } else {
      insertBefore = ''
    }
  }

  const reordered = groups.filter((g) => g.id !== draggedId)
  if (insertBefore) {
    const idx = reordered.findIndex((g) => g.id === insertBefore)
    if (idx !== -1) {
      const dragged = groups.find((g) => g.id === draggedId)
      if (dragged) {
        reordered.splice(idx, 0, dragged)
      } else {
        reordered.splice(idx, 0, { ...groups.find((g) => g.id === draggedId)! })
      }
    }
  } else {
    const dragged = groups.find((g) => g.id === draggedId)
    if (dragged) {
      reordered.push(dragged)
    }
  }

  projectStore.reorderGroups(reordered.map((g) => g.id))
  onGroupDragEnd()
}

async function exportSegment(segmentId: string) {
  const segment = projectStore.segments.find((s) => s.id === segmentId)
  if (!segment || !projectStore.sourceVideoPath || !projectStore.sourceVideoFileName) return

  exportingSegmentId.value = segmentId
  exportError.value = null

  const result = await window.electronAPI.exportSegment({
    startTime: segment.startTime,
    endTime: segment.endTime,
    sourceVideoPath: projectStore.sourceVideoPath,
    sourceVideoFileName: projectStore.sourceVideoFileName,
    slowMotionSpeed: segment.slowMotionSpeed,
  })

  exportingSegmentId.value = null

  if (!result.success) {
    exportError.value = result.error ?? 'Export failed'
    setTimeout(() => { exportError.value = null }, 5000)
  }
}

async function saveProject() {
  if (!projectStore.hasVideo || !projectStore.sourceVideoPath) return

  savingProject.value = true
  saveProjectError.value = null

  const projectName = projectStore.sourceVideoFileName
    ? projectStore.sourceVideoFileName.replace(/\.[^.]+$/, '')
    : 'handball-project'

  const result = await window.electronAPI.saveProject({
    version: '1',
    sourceVideoPath: projectStore.sourceVideoPath,
    sourceVideoFileName: projectStore.sourceVideoFileName,
    segments: JSON.parse(JSON.stringify(projectStore.segments)),
    groups: JSON.parse(JSON.stringify(projectStore.groups)),
    projectName,
  })

  savingProject.value = false

  if (!result.success) {
    saveProjectError.value = result.error ?? 'Failed to save project'
    setTimeout(() => { saveProjectError.value = null }, 8000)
  }
}

async function loadProject() {
  loadingProject.value = true
  loadProjectError.value = null

  const result = await window.electronAPI.loadProject()

  if (!result.success) {
    loadingProject.value = false
    if (result.error !== 'Load canceled') {
      loadProjectError.value = result.error ?? 'Failed to load project'
      setTimeout(() => { loadProjectError.value = null }, 8000)
    }
    return
  }

  const project = result.project as unknown as Record<string, unknown>
  const srcPath = project.sourceVideoPath as string | undefined

  player.reset()

  if (srcPath && await window.electronAPI.fileExists(srcPath)) {
    projectStore.sourceVideoPath = srcPath as string
    const parts = (srcPath as string).replace(/\\/g, '/').split('/')
    projectStore.sourceVideoFileName = parts[parts.length - 1] ?? (srcPath as string)
    if (videoRef.value) {
      videoRef.value.src = `file://${srcPath}`
    }
    projectStore.restoreState({
      segments: project.segments as Segment[] | undefined,
      groups: project.groups as Group[] | undefined,
      inMarker: null,
      outMarker: null,
    })
  } else {
    projectStore.restoreState({
      segments: project.segments as Segment[] | undefined,
      groups: project.groups as Group[] | undefined,
      inMarker: null,
      outMarker: null,
    })

    const fileResult = await window.electronAPI.openVideo()
    if (!fileResult.canceled && fileResult.filePath) {
      projectStore.sourceVideoPath = fileResult.filePath
      const parts = fileResult.filePath.replace(/\\/g, '/').split('/')
      projectStore.sourceVideoFileName = parts[parts.length - 1] ?? fileResult.filePath
      if (videoRef.value) {
        videoRef.value.src = `file://${fileResult.filePath}`
      }
    }
  }

  loadingProject.value = false
}

function onVideoLoaded() {
  const v = videoRef.value
  if (!v) return
  player.updateDuration(v.duration)
  videoWidth.value = v.videoWidth
  videoHeight.value = v.videoHeight
}

function onVideoError() {
  videoError.value = 'Failed to load video file. The format may be unsupported.'
}

function onTimeUpdate() {
  const v = videoRef.value
  if (!v) return
  player.updateTime(v.currentTime)

  const seg = projectStore.selectedSegment
  if (seg && seg.slowMotionSpeed !== 1 && !player.slowMotionActive) {
    if (v.currentTime >= seg.startTime && v.currentTime <= seg.endTime) {
      if (v.playbackRate !== seg.slowMotionSpeed) {
        v.playbackRate = seg.slowMotionSpeed
        segmentSpeedApplied.value = true
      }
    } else if (segmentSpeedApplied.value) {
      v.playbackRate = 1
      segmentSpeedApplied.value = false
    }
  } else if (segmentSpeedApplied.value && !player.slowMotionActive) {
    v.playbackRate = 1
    segmentSpeedApplied.value = false
  }
}

function onPlay() {
  player.setPlaying(true)
}

function onPause() {
  player.setPlaying(false)
}

function onRateChange() {
  const v = videoRef.value
  if (!v) return
  if (!player.slowMotionActive) {
    player.setPlaybackRate(v.playbackRate)
  }
}

function handleKeyDown(e: KeyboardEvent) {
  const v = videoRef.value
  if (!v) return

  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

  switch (e.code) {
    case 'Space':
      e.preventDefault()
      togglePlay()
      break
    case 'ArrowLeft':
      e.preventDefault()
      frameStep(-1)
      break
    case 'ArrowRight':
      e.preventDefault()
      frameStep(1)
      break
    case 'KeyS':
      if (!e.repeat) {
        e.preventDefault()
        startSlowMotion()
      }
      break
    case 'KeyI':
      e.preventDefault()
      markIn()
      break
    case 'KeyO':
      e.preventDefault()
      markOut()
      break
    case 'Backspace':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        deleteSelected()
      }
      break
    case 'KeyG':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        createGroup()
      }
      break
  }
}

function handleKeyUp(e: KeyboardEvent) {
  const v = videoRef.value
  if (!v) return

  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

  if (e.code === 'KeyS') {
    stopSlowMotion()
  }
}

let cacheTimer: ReturnType<typeof setTimeout> | null = null

function saveCache() {
  if (!projectStore.sourceVideoPath) return
  const data = {
    segments: projectStore.segments,
    groups: projectStore.groups,
    inMarker: projectStore.inMarker,
    outMarker: projectStore.outMarker,
  }
  window.electronAPI.writeCache(projectStore.sourceVideoPath, data)
}

function debouncedSaveCache() {
  if (cacheTimer) clearTimeout(cacheTimer)
  cacheTimer = setTimeout(saveCache, 1000)
}

async function restoreCache() {
  if (!projectStore.sourceVideoPath) return
  const result = await window.electronAPI.readCache(projectStore.sourceVideoPath)
  if (!result.success || !result.data) return

  cacheRestoreData.value = result.data as Record<string, unknown>
  showCacheRestorePrompt.value = true
}

function confirmRestoreCache() {
  if (cacheRestoreData.value) {
    projectStore.restoreState(cacheRestoreData.value)
  }
  dismissRestoreCache()
}

function dismissRestoreCache() {
  showCacheRestorePrompt.value = false
  cacheRestoreData.value = null
}

onMounted(() => {
  if (projectStore.sourceVideoPath && videoRef.value) {
    videoRef.value.src = `file://${projectStore.sourceVideoPath}`
    restoreCache()
  }
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)
  watch(
    [
      () => projectStore.segments,
      () => projectStore.groups,
      () => projectStore.inMarker,
      () => projectStore.outMarker,
    ],
    () => {
      debouncedSaveCache()
    },
    { deep: true },
  )
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('keyup', handleKeyUp)
  if (cacheTimer) clearTimeout(cacheTimer)
})
</script>

<template>
  <div class="flex flex-col h-screen bg-gray-900 text-gray-100">
    <!-- Toolbar -->
    <div class="h-12 bg-gray-800 flex items-center px-4 border-b border-gray-700 flex-shrink-0">
      <button
        class="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-md transition-colors"
        @click="openVideo"
      >
        Open Video
      </button>
      <button
        v-if="projectStore.hasVideo"
        class="px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded-md transition-colors ml-2"
        :disabled="savingProject"
        @click="saveProject"
      >
        <span v-if="savingProject" class="inline-flex items-center gap-1">
          <svg class="w-3.5 h-3.5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Saving...
        </span>
        <span v-else>Save Project</span>
      </button>
      <button
        class="px-4 py-1.5 bg-gray-600 hover:bg-gray-500 text-white text-sm rounded-md transition-colors ml-2"
        :disabled="loadingProject"
        @click="loadProject"
      >
        <span v-if="loadingProject" class="inline-flex items-center gap-1">
          <svg class="w-3.5 h-3.5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading...
        </span>
        <span v-else>Load Project</span>
      </button>
      <span
        v-if="projectStore.sourceVideoFileName"
        class="ml-4 text-sm text-gray-400 truncate max-w-md"
      >
        {{ projectStore.sourceVideoFileName }}
      </span>
      <span
        v-if="saveProjectError"
        class="ml-4 text-xs text-red-400 truncate"
      >
        {{ saveProjectError }}
      </span>
      <span
        v-if="loadProjectError"
        class="ml-4 text-xs text-red-400 truncate"
      >
        {{ loadProjectError }}
      </span>
    </div>

    <!-- Cache restore prompt -->
    <div
      v-if="showCacheRestorePrompt"
      class="bg-yellow-500/10 border-b border-yellow-500/30 px-4 py-2 flex items-center gap-3 flex-shrink-0"
    >
      <p class="text-sm text-yellow-400 flex-1">
        Found auto-recovery data for this video. Restore previous session?
      </p>
      <button
        class="px-3 py-1 bg-yellow-600 hover:bg-yellow-500 text-white text-xs rounded transition-colors"
        @click="confirmRestoreCache"
      >
        Restore
      </button>
      <button
        class="px-3 py-1 bg-gray-600 hover:bg-gray-500 text-white text-xs rounded transition-colors"
        @click="dismissRestoreCache"
      >
        Dismiss
      </button>
    </div>

    <!-- Main content area: Video + Sidebar -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Video area (left/main) -->
      <div class="flex-1 flex flex-col">
        <div class="flex-1 bg-black flex items-center justify-center mx-2 mt-2 rounded-t-lg relative overflow-hidden">
          <video
            v-if="projectStore.hasVideo"
            ref="videoRef"
            class="max-w-full max-h-full"
            preload="metadata"
            @loadedmetadata="onVideoLoaded"
            @error="onVideoError"
            @timeupdate="onTimeUpdate"
            @play="onPlay"
            @pause="onPause"
            @ratechange="onRateChange"
          />
          <p
            v-if="!projectStore.hasVideo"
            class="text-gray-500 text-lg"
          >
            Open a video file to begin
          </p>
          <p
            v-if="videoError"
            class="text-red-400 text-sm absolute bottom-4 left-4 bg-black/70 px-3 py-1 rounded"
          >
            {{ videoError }}
          </p>
        </div>

        <!-- Transport bar -->
        <div
          v-if="projectStore.hasVideo"
          class="h-10 bg-gray-800 mx-2 flex items-center px-3 gap-3 border-t border-gray-700"
        >
          <button
            class="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-700 transition-colors text-gray-300 hover:text-white"
            @click="togglePlay"
            :title="player.isPlaying ? 'Pause (Space)' : 'Play (Space)'"
          >
            <!-- Play icon -->
            <svg v-if="!player.isPlaying" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
              <path d="M8 5v14l11-7z"/>
            </svg>
            <!-- Pause icon -->
            <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
            </svg>
          </button>

          <span class="text-sm font-mono text-gray-300 tabular-nums select-none">
            {{ formatTime(player.currentTime) }}
            <span class="text-gray-600 mx-0.5">/</span>
            {{ formatTime(player.duration) }}
          </span>

          <div class="flex-1" />

          <span
            v-if="projectStore.hasInMarker"
            class="text-xs font-mono px-2 py-0.5 rounded bg-green-500/20 text-green-400"
            title="I marker set"
          >
            In: {{ formatTime(projectStore.inMarker!) }}
          </span>

          <span
            v-if="projectStore.hasOutMarker"
            class="text-xs font-mono px-2 py-0.5 rounded bg-red-500/20 text-red-400"
            title="O marker set"
          >
            Out: {{ formatTime(projectStore.outMarker!) }}
          </span>

          <span
            class="text-xs font-mono px-2 py-0.5 rounded"
            :class="player.slowMotionActive ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-700 text-gray-400'"
          >
            {{ player.playbackRate }}x
          </span>
        </div>

        <!-- Timeline (bottom) -->
        <div
          v-if="projectStore.hasVideo && player.duration > 0"
          class="h-24 bg-gray-800 mx-2 mb-2 rounded-b-lg overflow-hidden"
        >
          <TimelineCanvas
            :duration="player.duration"
            :current-time="player.currentTime"
            :segments="projectStore.segments"
            :in-marker="projectStore.inMarker"
            :out-marker="projectStore.outMarker"
            :selected-segment-id="projectStore.selectedSegmentId"
            @seek="seekTo"
            @update-segment="updateSegment"
            @select-segment="(id: string) => projectStore.selectSegment(id)"
          />
        </div>
        <div v-else class="h-24 bg-gray-800 mx-2 mb-2 rounded-b-lg flex items-center justify-center">
          <p class="text-gray-500 text-sm">Timeline</p>
        </div>
      </div>

      <!-- Sidebar (right) -->
      <div class="w-72 bg-gray-800 m-2 ml-0 rounded-lg flex flex-col overflow-y-auto">
        <div class="p-4 border-b border-gray-700">
          <p class="text-sm font-medium text-gray-400">Video Info</p>
        </div>
        <div class="p-4">
          <div v-if="projectStore.hasVideo && player.duration > 0" class="space-y-2 text-sm text-gray-400">
            <p>Duration: {{ formatTime(player.duration) }}</p>
            <p>Resolution: {{ videoWidth }}x{{ videoHeight }}</p>
          </div>
          <p v-else-if="!projectStore.hasVideo" class="text-sm text-gray-500">
            No video loaded
          </p>
        </div>

        <!-- Segments header -->
        <div class="p-4 border-t border-gray-700 flex items-center justify-between">
          <p class="text-sm font-medium text-gray-400">Segments</p>
          <div class="flex items-center gap-2">
            <span class="text-xs text-gray-500">{{ projectStore.segments.length }}</span>
            <button
              class="text-xs text-gray-500 hover:text-blue-400 bg-gray-700 hover:bg-gray-600 px-2 py-0.5 rounded transition-colors"
              title="Create Group (Ctrl+G)"
              @click="createGroup"
            >
              + Group
            </button>
          </div>
        </div>

        <!-- Segment list with groups -->
        <div class="flex-1 overflow-y-auto">
          <div v-if="projectStore.segments.length === 0" class="flex items-center justify-center h-full">
            <p class="text-gray-500 text-sm text-center px-4">
              Press <kbd class="text-gray-400 bg-gray-700 px-1 rounded text-xs">I</kbd> then <kbd class="text-gray-400 bg-gray-700 px-1 rounded text-xs">O</kbd> to mark segments
            </p>
          </div>
          <div v-if="exportError" class="px-4 py-2 bg-red-500/10 border-b border-red-500/20">
            <p class="text-xs text-red-400">{{ exportError }}</p>
          </div>
          <div v-else>
            <!-- Ungrouped section -->
            <div
              class="border-b border-gray-700"
              :class="dragOverGroup === null ? 'bg-blue-500/10 ring-1 ring-blue-500/30' : ''"
              @dragover="onGroupDropZoneDragOver($event, null)"
              @dragleave="onGroupDropZoneDragLeave"
              @drop="onGroupDropZoneDrop($event, null)"
            >
              <div class="px-4 py-2 flex items-center gap-2 select-none">
                <span class="text-xs font-medium text-gray-500 uppercase tracking-wider">Ungrouped</span>
                <span class="text-[10px] text-gray-600">{{ getGroupSegments(null).length }}</span>
              </div>
              <div v-if="getGroupSegments(null).length > 0">
                <div
                  v-for="segment in getGroupSegments(null)"
                  :key="segment.id"
                  class="px-4 py-3 cursor-pointer transition-colors relative group"
                  :class="[
                    segment.id === projectStore.selectedSegmentId ? 'bg-gray-700/80' : 'hover:bg-gray-700/40',
                    dragState?.type === 'segment' && dragState.segmentId === segment.id ? 'opacity-40' : '',
                  ]"
                  draggable="true"
                  @click="seekTo(segment.startTime); projectStore.selectSegment(segment.id)"
                  @dragstart="onSegmentDragStart($event, segment.id)"
                  @dragend="onSegmentDragEnd"
                  @dragover="onSegmentDragOver($event, segment.id)"
                  @dragleave="onSegmentDragLeave"
                  @drop="onSegmentDrop($event, null, segment.id, dragOverSegment?.segmentId === segment.id ? dragOverSegment.position : null)"
                >
                  <div v-if="dragOverSegment?.segmentId === segment.id && dragOverSegment.position === 'before'" class="absolute top-0 left-2 right-2 h-0.5 bg-blue-500 rounded" />
                  <div class="flex items-start gap-2">
                    <div class="flex-1 min-w-0">
                      <div
                        v-if="editingTitleId !== segment.id"
                        class="text-sm text-gray-300 font-medium truncate cursor-text hover:text-white"
                        @click.stop="startEditingTitle(segment.id); projectStore.selectSegment(segment.id)"
                      >
                        {{ segment.title }}
                      </div>
                      <input
                        v-else
                        :data-segment-title="segment.id"
                        v-model="editingTitleValue"
                        class="text-sm bg-gray-700 text-gray-100 rounded px-1.5 py-0.5 w-full border border-gray-600 focus:border-blue-500 focus:outline-none"
                        @keydown.enter.prevent="saveTitle(segment.id)"
                        @blur="saveTitle(segment.id)"
                        @click.stop
                      />
                      <p class="text-xs text-gray-500 font-mono mt-0.5">
                        {{ formatTime(segment.startTime) }} - {{ formatTime(segment.endTime) }}
                      </p>
                      <span
                        v-if="segment.slowMotionSpeed !== 1"
                        class="inline-block mt-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400"
                      >
                        {{ segment.slowMotionSpeed }}x
                      </span>
                    </div>
                    <button
                      class="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-gray-600 text-gray-500 hover:text-blue-400 transition-colors opacity-0 group-hover:opacity-100"
                      :class="{ 'opacity-100': exportingSegmentId === segment.id }"
                      :disabled="exportingSegmentId !== null"
                      @click.stop="exportSegment(segment.id)"
                      title="Export Segment"
                    >
                      <svg
                        v-if="exportingSegmentId === segment.id"
                        class="w-4 h-4 animate-spin text-blue-400"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <svg
                        v-else
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        class="w-4 h-4"
                      >
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                    </button>
                  </div>

                  <div
                    v-if="segment.id === projectStore.selectedSegmentId"
                    class="mt-2 space-y-2"
                    @click.stop
                  >
                    <textarea
                      :value="segment.comments"
                      class="w-full bg-gray-700 text-gray-200 text-xs rounded px-2 py-1.5 h-16 resize-y border border-gray-600 focus:border-blue-500 focus:outline-none placeholder-gray-500"
                      placeholder="Add tactical notes..."
                      @input="projectStore.updateSegmentComments(segment.id, ($event.target as HTMLTextAreaElement).value)"
                    />

                    <div class="flex items-center gap-2">
                      <label class="text-xs text-gray-500 shrink-0">Speed:</label>
                      <select
                        :value="segment.slowMotionSpeed"
                        class="flex-1 bg-gray-700 text-gray-200 text-xs rounded px-2 py-1 border border-gray-600 focus:border-blue-500 focus:outline-none"
                        @change="projectStore.updateSegmentSlowMotionSpeed(segment.id, Number(($event.target as HTMLSelectElement).value))"
                      >
                        <option :value="1">1x (Normal)</option>
                        <option :value="0.75">0.75x</option>
                        <option :value="0.5">0.5x</option>
                        <option :value="0.25">0.25x</option>
                      </select>
                    </div>
                  </div>
                  <div v-if="dragOverSegment?.segmentId === segment.id && dragOverSegment.position === 'after'" class="absolute bottom-0 left-2 right-2 h-0.5 bg-blue-500 rounded" />
                </div>
              </div>
              <p v-else class="px-4 pb-2 text-[10px] text-gray-600 italic">
                Drop segments here or press Ctrl+G to create groups
              </p>
            </div>

            <!-- Groups -->
            <div v-for="group in projectStore.sortedGroups" :key="group.id">
              <div
                class="border-b border-gray-700"
                :class="dragOverGroup === group.id ? 'bg-blue-500/10 ring-1 ring-blue-500/30' : ''"
                @dragover="onGroupDropZoneDragOver($event, group.id)"
                @dragleave="onGroupDropZoneDragLeave"
                @drop="onGroupDropZoneDrop($event, group.id)"
              >
                <!-- Group header (draggable) -->
                <div
                  class="px-4 py-2 flex items-center gap-2 select-none cursor-pointer"
                  :class="[
                    group.visible ? 'cursor-grab active:cursor-grabbing' : '',
                    dragState?.type === 'group' && dragOverGroup && dragOverGroup.startsWith('after:') && dragOverGroup.split(':')[1] === group.id ? 'border-b-2 border-blue-500' : '',
                    dragState?.type === 'group' && dragOverGroup && dragOverGroup.startsWith('before:') && dragOverGroup.split(':')[1] === group.id ? 'border-t-2 border-blue-500' : '',
                  ]"
                  draggable="true"
                  @dragstart="onGroupDragStart($event, group.id)"
                  @dragend="onGroupDragEnd"
                  @dragover="onGroupHeaderDragOver($event, group.id)"
                  @drop="onGroupHeaderDrop($event, group.id)"
                >
                  <!-- Collapse chevron -->
                  <button
                    class="text-gray-500 hover:text-gray-300 transition-colors shrink-0"
                    @click.stop="toggleCollapse(group.id)"
                  >
                    <svg
                      class="w-3.5 h-3.5 transition-transform"
                      :class="collapsedGroups.has(group.id) ? '' : 'rotate-90'"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" />
                    </svg>
                  </button>

                  <!-- Group title (editable) -->
                  <div v-if="editingGroupTitleId !== group.id" class="flex-1 min-w-0">
                    <div
                      class="text-sm font-medium truncate cursor-text"
                      :class="group.visible ? 'text-gray-300' : 'text-gray-500'"
                      @click.stop="startEditingGroupTitle(group.id)"
                    >
                      {{ group.title }}
                    </div>
                  </div>
                  <input
                    v-else
                    :data-group-title="group.id"
                    v-model="editingGroupTitleValue"
                    class="flex-1 text-sm bg-gray-700 text-gray-100 rounded px-1.5 py-0.5 border border-gray-600 focus:border-blue-500 focus:outline-none min-w-0"
                    @keydown.enter.prevent="saveGroupTitle(group.id)"
                    @blur="saveGroupTitle(group.id)"
                    @click.stop
                  />

                  <!-- Segment count -->
                  <span class="text-[10px] text-gray-600">{{ getGroupSegments(group.id).length }}</span>

                  <!-- Visibility toggle -->
                  <button
                    class="text-gray-500 hover:text-gray-300 transition-colors shrink-0"
                    :title="group.visible ? 'Hide group' : 'Show group'"
                    @click.stop="toggleGroupVisibility(group.id)"
                  >
                    <svg v-if="group.visible" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4">
                      <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
                      <path fill-rule="evenodd" d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd" />
                    </svg>
                    <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4">
                      <path fill-rule="evenodd" d="M3.28 2.22a.75.75 0 00-1.06 1.06l14.5 14.5a.75.75 0 101.06-1.06l-1.745-1.745a10.029 10.029 0 003.3-4.38 1.651 1.651 0 000-1.185A10.004 10.004 0 009.999 3a9.956 9.956 0 00-4.744 1.194L3.28 2.22zM7.752 6.69l1.092 1.092a2.5 2.5 0 013.374 3.373l1.091 1.092a4 4 0 00-5.557-5.557z" clip-rule="evenodd" />
                      <path d="M10.748 13.93l2.523 2.523a9.987 9.987 0 01-3.27.547c-4.258 0-7.894-2.66-9.337-6.41a1.651 1.651 0 010-1.186A10.007 10.007 0 012.839 6.02L6.07 9.252a4 4 0 004.678 4.678z" />
                    </svg>
                  </button>
                </div>

                <!-- Group segments (when expanded and visible) -->
                <div v-if="!collapsedGroups.has(group.id) && group.visible">
                  <div
                    v-for="segment in getGroupSegments(group.id)"
                    :key="segment.id"
                    class="px-4 py-3 cursor-pointer transition-colors relative group"
                    :class="[
                      segment.id === projectStore.selectedSegmentId ? 'bg-gray-700/80' : 'hover:bg-gray-700/40',
                      dragState?.type === 'segment' && dragState.segmentId === segment.id ? 'opacity-40' : '',
                    ]"
                    draggable="true"
                    @click="seekTo(segment.startTime); projectStore.selectSegment(segment.id)"
                    @dragstart="onSegmentDragStart($event, segment.id)"
                    @dragend="onSegmentDragEnd"
                    @dragover="onSegmentDragOver($event, segment.id)"
                    @dragleave="onSegmentDragLeave"
                    @drop="onSegmentDrop($event, group.id, segment.id, dragOverSegment?.segmentId === segment.id ? dragOverSegment.position : null)"
                  >
                    <div v-if="dragOverSegment?.segmentId === segment.id && dragOverSegment.position === 'before'" class="absolute top-0 left-2 right-2 h-0.5 bg-blue-500 rounded" />
                    <div class="flex items-start gap-2">
                      <div class="flex-1 min-w-0">
                        <div
                          v-if="editingTitleId !== segment.id"
                          class="text-sm text-gray-300 font-medium truncate cursor-text hover:text-white"
                          @click.stop="startEditingTitle(segment.id); projectStore.selectSegment(segment.id)"
                        >
                          {{ segment.title }}
                        </div>
                        <input
                          v-else
                          :data-segment-title="segment.id"
                          v-model="editingTitleValue"
                          class="text-sm bg-gray-700 text-gray-100 rounded px-1.5 py-0.5 w-full border border-gray-600 focus:border-blue-500 focus:outline-none"
                          @keydown.enter.prevent="saveTitle(segment.id)"
                          @blur="saveTitle(segment.id)"
                          @click.stop
                        />
                        <p class="text-xs text-gray-500 font-mono mt-0.5">
                          {{ formatTime(segment.startTime) }} - {{ formatTime(segment.endTime) }}
                        </p>
                        <span
                          v-if="segment.slowMotionSpeed !== 1"
                          class="inline-block mt-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400"
                        >
                          {{ segment.slowMotionSpeed }}x
                        </span>
                      </div>
                      <button
                        class="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-gray-600 text-gray-500 hover:text-blue-400 transition-colors opacity-0 group-hover:opacity-100"
                        :class="{ 'opacity-100': exportingSegmentId === segment.id }"
                        :disabled="exportingSegmentId !== null"
                        @click.stop="exportSegment(segment.id)"
                        title="Export Segment"
                      >
                        <svg
                          v-if="exportingSegmentId === segment.id"
                          class="w-4 h-4 animate-spin text-blue-400"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <svg
                          v-else
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          class="w-4 h-4"
                        >
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                      </button>
                    </div>

                    <div
                      v-if="segment.id === projectStore.selectedSegmentId"
                      class="mt-2 space-y-2"
                      @click.stop
                    >
                      <textarea
                        :value="segment.comments"
                        class="w-full bg-gray-700 text-gray-200 text-xs rounded px-2 py-1.5 h-16 resize-y border border-gray-600 focus:border-blue-500 focus:outline-none placeholder-gray-500"
                        placeholder="Add tactical notes..."
                        @input="projectStore.updateSegmentComments(segment.id, ($event.target as HTMLTextAreaElement).value)"
                      />

                      <div class="flex items-center gap-2">
                        <label class="text-xs text-gray-500 shrink-0">Speed:</label>
                        <select
                          :value="segment.slowMotionSpeed"
                          class="flex-1 bg-gray-700 text-gray-200 text-xs rounded px-2 py-1 border border-gray-600 focus:border-blue-500 focus:outline-none"
                          @change="projectStore.updateSegmentSlowMotionSpeed(segment.id, Number(($event.target as HTMLSelectElement).value))"
                        >
                          <option :value="1">1x (Normal)</option>
                          <option :value="0.75">0.75x</option>
                          <option :value="0.5">0.5x</option>
                          <option :value="0.25">0.25x</option>
                        </select>
                      </div>
                    </div>
                    <div v-if="dragOverSegment?.segmentId === segment.id && dragOverSegment.position === 'after'" class="absolute bottom-0 left-2 right-2 h-0.5 bg-blue-500 rounded" />
                  </div>
                  <!-- Group comments -->
                  <div class="px-4 pb-2" @click.stop>
                    <textarea
                      :value="group.comments"
                      class="w-full bg-gray-700 text-gray-200 text-xs rounded px-2 py-1.5 h-10 resize-y border border-gray-600 focus:border-blue-500 focus:outline-none placeholder-gray-500"
                      placeholder="Group notes..."
                      @input="projectStore.updateGroup(group.id, { comments: ($event.target as HTMLTextAreaElement).value })"
                    />
                  </div>
                  <p v-if="getGroupSegments(group.id).length === 0" class="px-4 pb-2 text-[10px] text-gray-600 italic">
                    Drop segments here
                  </p>
                </div>

                <!-- Collapsed indicator -->
                <p v-if="collapsedGroups.has(group.id) && group.visible" class="px-4 pb-2 text-[10px] text-gray-600 italic">
                  {{ getGroupSegments(group.id).length }} segment{{ getGroupSegments(group.id).length !== 1 ? 's' : '' }} hidden
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- Shortcuts -->
        <div class="border-t border-gray-700">
          <div class="p-4">
            <p class="text-sm font-medium text-gray-400">Shortcuts</p>
          </div>
          <div class="px-4 pb-4 space-y-1.5 text-xs">
            <div class="flex items-center gap-2 text-gray-400">
              <kbd class="inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded bg-gray-700 text-gray-300 font-mono text-[10px]">Space</kbd>
              <span>Play / Pause</span>
            </div>
            <div class="flex items-center gap-2 text-gray-400">
              <kbd class="inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded bg-gray-700 text-gray-300 font-mono text-[10px]">&larr; &rarr;</kbd>
              <span>Frame step (paused)</span>
            </div>
            <div class="flex items-center gap-2 text-gray-400">
              <kbd class="inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded bg-gray-700 text-gray-300 font-mono text-[10px]">Hold S</kbd>
              <span>Slow motion 0.25x</span>
            </div>
            <div class="flex items-center gap-2 text-gray-400">
              <kbd class="inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded bg-gray-700 text-gray-300 font-mono text-[10px]">I</kbd>
              <span>Mark in point</span>
            </div>
            <div class="flex items-center gap-2 text-gray-400">
              <kbd class="inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded bg-gray-700 text-gray-300 font-mono text-[10px]">O</kbd>
              <span>Mark out &amp; create segment</span>
            </div>
            <div class="flex items-center gap-2 text-gray-400">
              <kbd class="inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded bg-gray-700 text-gray-300 font-mono text-[10px]">Ctrl+Bksp</kbd>
              <span>Delete selected segment</span>
            </div>
            <div class="flex items-center gap-2 text-gray-400">
              <kbd class="inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded bg-gray-700 text-gray-300 font-mono text-[10px]">Ctrl+G</kbd>
              <span>Create group</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

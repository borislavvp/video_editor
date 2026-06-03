<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useProjectStore } from '../stores/project'
import { usePlayerStore } from '../stores/player'

const projectStore = useProjectStore()
const player = usePlayerStore()

const videoRef = ref<HTMLVideoElement | null>(null)
const videoWidth = ref<number>(0)
const videoHeight = ref<number>(0)
const videoError = ref<string | null>(null)

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
  projectStore.restoreState(result.data as Record<string, unknown>)
}

onMounted(() => {
  if (projectStore.sourceVideoPath && videoRef.value) {
    videoRef.value.src = `file://${projectStore.sourceVideoPath}`
    restoreCache()
  }
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)
  watch(
    [() => projectStore.segments, () => projectStore.inMarker, () => projectStore.outMarker],
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
      <span
        v-if="projectStore.sourceVideoFileName"
        class="ml-4 text-sm text-gray-400 truncate max-w-md"
      >
        {{ projectStore.sourceVideoFileName }}
      </span>
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
        <div class="h-24 bg-gray-800 mx-2 mb-2 rounded-b-lg flex items-center justify-center">
          <div v-if="projectStore.hasVideo && player.duration > 0" class="w-full h-full px-4 py-2">
            <div class="relative w-full h-full">
              <div class="absolute top-0 left-0 w-full h-1 bg-gray-700 rounded" />
              <div
                v-if="projectStore.hasInMarker"
                class="absolute top-0 w-0.5 h-3 bg-green-400 rounded"
                :style="{ left: (projectStore.inMarker! / player.duration) * 100 + '%' }"
                title="In marker"
              />
              <div
                v-if="projectStore.hasOutMarker"
                class="absolute top-0 w-0.5 h-3 bg-red-400 rounded"
                :style="{ left: (projectStore.outMarker! / player.duration) * 100 + '%' }"
                title="Out marker"
              />
              <div
                v-for="segment in projectStore.segments"
                :key="segment.id"
                class="absolute top-1 h-2 rounded cursor-pointer transition-colors"
                :class="segment.id === projectStore.selectedSegmentId ? 'bg-blue-400' : 'bg-blue-500/60 hover:bg-blue-400'"
                :style="{
                  left: (segment.startTime / player.duration) * 100 + '%',
                  width: Math.max(0.5, ((segment.endTime - segment.startTime) / player.duration) * 100) + '%',
                }"
                :title="segment.title"
                @click="seekTo(segment.startTime); projectStore.selectSegment(segment.id)"
              />
              <div
                v-if="projectStore.inMarker !== null || projectStore.outMarker !== null"
                class="absolute top-1 h-2 rounded bg-yellow-400/50"
                :style="{
                  left: ((projectStore.inMarker ?? projectStore.outMarker!) / player.duration) * 100 + '%',
                  width: projectStore.inMarker !== null && projectStore.outMarker !== null
                    ? Math.max(0.5, ((projectStore.outMarker - projectStore.inMarker) / player.duration) * 100) + '%'
                    : '0.5%',
                }"
              />
            </div>
          </div>
          <p v-else class="text-gray-500 text-sm">Timeline</p>
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

        <!-- Segments -->
        <div class="p-4 border-t border-gray-700 flex items-center justify-between">
          <p class="text-sm font-medium text-gray-400">Segments</p>
          <span class="text-xs text-gray-500">{{ projectStore.segments.length }}</span>
        </div>
        <div class="flex-1 overflow-y-auto">
          <div v-if="projectStore.segments.length === 0" class="flex items-center justify-center h-full">
            <p class="text-gray-500 text-sm text-center px-4">
              Press <kbd class="text-gray-400 bg-gray-700 px-1 rounded text-xs">I</kbd> then <kbd class="text-gray-400 bg-gray-700 px-1 rounded text-xs">O</kbd> to mark segments
            </p>
          </div>
          <div v-else class="divide-y divide-gray-700/50">
            <div
              v-for="segment in projectStore.segments"
              :key="segment.id"
              class="px-4 py-3 cursor-pointer transition-colors"
              :class="segment.id === projectStore.selectedSegmentId ? 'bg-gray-700/80' : 'hover:bg-gray-700/40'"
              @click="seekTo(segment.startTime); projectStore.selectSegment(segment.id)"
            >
              <p class="text-sm text-gray-300 font-medium truncate">{{ segment.title }}</p>
              <p class="text-xs text-gray-500 font-mono mt-0.5">
                {{ formatTime(segment.startTime) }} - {{ formatTime(segment.endTime) }}
              </p>
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
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

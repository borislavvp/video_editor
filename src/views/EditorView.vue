<script setup lang="ts">
import { ref, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { useProjectStore } from '../stores/project'
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

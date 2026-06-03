<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useProjectStore } from '../stores/project'

const projectStore = useProjectStore()

const videoRef = ref<HTMLVideoElement | null>(null)
const videoDuration = ref<number>(0)
const videoWidth = ref<number>(0)
const videoHeight = ref<number>(0)
const videoError = ref<string | null>(null)

async function openVideo() {
  videoError.value = null
  const result = await window.electronAPI.openVideo()
  if (result.canceled || !result.filePath) return

  projectStore.setSourceVideo(result.filePath)

  if (videoRef.value) {
    videoRef.value.src = `file://${result.filePath}`
  }
}

function onVideoLoaded() {
  if (!videoRef.value) return
  videoDuration.value = videoRef.value.duration
  videoWidth.value = videoRef.value.videoWidth
  videoHeight.value = videoRef.value.videoHeight
}

function onVideoError() {
  videoError.value = 'Failed to load video file. The format may be unsupported.'
}

onMounted(() => {
  if (projectStore.sourceVideoPath && videoRef.value) {
    videoRef.value.src = `file://${projectStore.sourceVideoPath}`
  }
})
</script>

<template>
  <div class="flex flex-col h-screen bg-gray-900 text-gray-100">
    <!-- Toolbar -->
    <div class="h-12 bg-gray-800 flex items-center px-4 border-b border-gray-700">
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
        <div class="flex-1 bg-black flex items-center justify-center m-2 rounded-lg relative overflow-hidden">
          <video
            v-if="projectStore.hasVideo"
            ref="videoRef"
            class="max-w-full max-h-full"
            preload="metadata"
            @loadedmetadata="onVideoLoaded"
            @error="onVideoError"
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

        <!-- Timeline (bottom) -->
        <div class="h-24 bg-gray-800 m-2 mt-0 rounded-lg flex items-center justify-center">
          <p class="text-gray-500 text-sm">Timeline</p>
        </div>
      </div>

      <!-- Sidebar (right) -->
      <div class="w-72 bg-gray-800 m-2 ml-0 rounded-lg flex flex-col">
        <div class="p-4 border-b border-gray-700">
          <p class="text-sm font-medium text-gray-400">Video Info</p>
        </div>
        <div class="p-4">
          <div v-if="projectStore.hasVideo && videoDuration > 0" class="space-y-2 text-sm text-gray-400">
            <p>Duration: {{ Math.floor(videoDuration / 60) }}:{{ String(Math.floor(videoDuration % 60)).padStart(2, '0') }}</p>
            <p>Resolution: {{ videoWidth }}x{{ videoHeight }}</p>
          </div>
          <p v-else-if="!projectStore.hasVideo" class="text-sm text-gray-500">
            No video loaded
          </p>
        </div>
        <div class="p-4 border-t border-gray-700">
          <p class="text-sm font-medium text-gray-400">Segments</p>
        </div>
        <div class="flex-1 flex items-center justify-center">
          <p class="text-gray-500 text-sm">Sidebar</p>
        </div>
      </div>
    </div>
  </div>
</template>

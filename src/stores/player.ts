import { ref } from 'vue'
import { defineStore } from 'pinia'

export const usePlayerStore = defineStore('player', () => {
  const isPlaying = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const playbackRate = ref(1)
  const slowMotionActive = ref(false)
  const savedRate = ref(1)

  function updateTime(time: number) {
    currentTime.value = time
  }

  function updateDuration(dur: number) {
    duration.value = dur
  }

  function setPlaying(playing: boolean) {
    isPlaying.value = playing
  }

  function setPlaybackRate(rate: number) {
    playbackRate.value = rate
  }

  function startSlowMotion(currentRate: number) {
    if (slowMotionActive.value) return
    savedRate.value = currentRate
    slowMotionActive.value = true
    playbackRate.value = 0.25
  }

  function stopSlowMotion() {
    if (!slowMotionActive.value) return
    slowMotionActive.value = false
    playbackRate.value = savedRate.value
  }

  function reset() {
    isPlaying.value = false
    currentTime.value = 0
    duration.value = 0
    playbackRate.value = 1
    slowMotionActive.value = false
    savedRate.value = 1
  }

  return {
    isPlaying,
    currentTime,
    duration,
    playbackRate,
    slowMotionActive,
    savedRate,
    updateTime,
    updateDuration,
    setPlaying,
    setPlaybackRate,
    startSlowMotion,
    stopSlowMotion,
    reset,
  }
})

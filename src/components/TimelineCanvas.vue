<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import type { Segment } from '../stores/project'

const props = defineProps<{
  duration: number
  currentTime: number
  segments: Segment[]
  inMarker: number | null
  outMarker: number | null
  selectedSegmentId: string | null
}>()

const emit = defineEmits<{
  (e: 'seek', time: number): void
  (e: 'updateSegment', id: string, startTime: number, endTime: number): void
  (e: 'selectSegment', id: string): void
}>()

const containerRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)

const zoomLevel = ref(1)
const scrollOffset = ref(0)

const MIN_ZOOM = 0.25
const MAX_ZOOM = 200
const EDGE_HIT_PX = 8

const RULER_H = 20
const TRACK_TOP = RULER_H + 2

type DragState = {
  type: 'start' | 'end'
  segmentId: string
  origStart: number
  origEnd: number
}

const dragState = ref<DragState | null>(null)

let rafId = 0
let canvasWidth = 0
let canvasHeight = 0

function pixelToTime(px: number): number {
  if (!canvasWidth || !props.duration) return 0
  const visDur = props.duration / zoomLevel.value
  return scrollOffset.value + (px / canvasWidth) * visDur
}

function timeToPixel(t: number): number {
  if (!canvasWidth || !props.duration) return 0
  const visDur = props.duration / zoomLevel.value
  return ((t - scrollOffset.value) / visDur) * canvasWidth
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function clampScroll() {
  const visDur = props.duration / zoomLevel.value
  scrollOffset.value = clamp(scrollOffset.value, 0, Math.max(0, props.duration - visDur))
}

function formatTick(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function getTickInterval(visDur: number): number {
  if (visDur <= 10) return 0.5
  if (visDur <= 30) return 2
  if (visDur <= 60) return 5
  if (visDur <= 120) return 10
  if (visDur <= 300) return 15
  if (visDur <= 600) return 30
  if (visDur <= 1200) return 60
  if (visDur <= 3600) return 120
  if (visDur <= 7200) return 300
  return 600
}

function draw() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const w = canvasWidth
  const h = canvasHeight
  const dpr = window.devicePixelRatio || 1

  ctx.save()
  ctx.scale(dpr, dpr)

  ctx.clearRect(0, 0, w, h)

  if (!props.duration || props.duration <= 0) {
    ctx.fillStyle = '#374151'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#6b7280'
    ctx.font = '12px monospace'
    ctx.textAlign = 'center'
    ctx.fillText('No video loaded', w / 2, h / 2)
    ctx.textAlign = 'start'
    ctx.restore()
    return
  }

  drawTrack(ctx, w, h)
  drawRuler(ctx, w, h)
  drawSegments(ctx, w, h)
  drawMarkers(ctx, w, h)
  drawPlayhead(ctx, w, h)

  ctx.restore()
}

function drawTrack(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const trackY = TRACK_TOP + 12
  const trackH = 28

  ctx.fillStyle = '#374151'
  ctx.fillRect(0, 0, w, h)

  ctx.fillStyle = '#1f2937'
  ctx.strokeStyle = '#4b5563'
  ctx.lineWidth = 1

  roundRect(ctx, 4, trackY, w - 8, trackH, 4)
  ctx.fill()
  ctx.stroke()
}

function drawRuler(ctx: CanvasRenderingContext2D, w: number, _h: number) {
  const visDur = props.duration / zoomLevel.value
  const interval = getTickInterval(visDur)
  const visStart = scrollOffset.value
  const visEnd = scrollOffset.value + visDur

  ctx.fillStyle = '#1f2937'
  ctx.fillRect(0, 0, w, RULER_H)

  ctx.strokeStyle = '#4b5563'
  ctx.fillStyle = '#9ca3af'
  ctx.font = '10px monospace'
  ctx.textAlign = 'center'

  let tickTime = Math.ceil(visStart / interval) * interval
  let lastLabelX = -100

  while (tickTime <= visEnd) {
    const x = timeToPixel(tickTime)
    if (x >= 0 && x <= w) {
      ctx.beginPath()
      ctx.moveTo(x, RULER_H - 5)
      ctx.lineTo(x, RULER_H)
      ctx.stroke()

      const label = formatTick(tickTime)
      if (x - lastLabelX > 50) {
        ctx.fillText(label, x, RULER_H - 6)
        lastLabelX = x
      }
    }
    tickTime += interval
  }

  ctx.textAlign = 'start'
}

function drawSegments(ctx: CanvasRenderingContext2D, _w: number, _h: number) {
  const visStart = scrollOffset.value
  const visEnd = scrollOffset.value + props.duration / zoomLevel.value
  const trackY = TRACK_TOP + 14
  const barH = 16

  for (const seg of props.segments) {
    if (seg.endTime < visStart || seg.startTime > visEnd) continue

    const x1 = timeToPixel(seg.startTime)
    const x2 = timeToPixel(seg.endTime)
    const segW = Math.max(3, x2 - x1)

    const isSelected = seg.id === props.selectedSegmentId

    ctx.fillStyle = isSelected ? 'rgba(96, 165, 250, 0.85)' : 'rgba(59, 130, 246, 0.45)'
    roundRect(ctx, x1, trackY, segW, barH, 3)
    ctx.fill()

    if (isSelected || dragState.value?.segmentId === seg.id) {
      ctx.fillStyle = 'rgba(147, 197, 253, 0.7)'
      ctx.fillRect(x1, trackY, 4, barH)
      ctx.fillRect(x2 - 4, trackY, 4, barH)
    }
  }
}

function drawMarkers(ctx: CanvasRenderingContext2D, w: number, h: number) {
  if (props.inMarker !== null) {
    const x = timeToPixel(props.inMarker)
    if (x >= 0 && x <= w) {
      ctx.strokeStyle = '#4ade80'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
      ctx.stroke()
      ctx.setLineDash([])

      ctx.fillStyle = '#4ade80'
      ctx.font = '9px monospace'
      ctx.textAlign = 'start'
      ctx.fillText('I', x + 3, 11)
    }
  }

  if (props.outMarker !== null) {
    const x = timeToPixel(props.outMarker)
    if (x >= 0 && x <= w) {
      ctx.strokeStyle = '#f87171'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
      ctx.stroke()
      ctx.setLineDash([])

      ctx.fillStyle = '#f87171'
      ctx.font = '9px monospace'
      ctx.textAlign = 'start'
      ctx.fillText('O', x + 3, 11)
    }
  }
}

function drawPlayhead(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const x = timeToPixel(props.currentTime)
  if (x < -10 || x > w + 10) return

  const clampedX = clamp(x, 0, w)

  ctx.fillStyle = '#ef4444'
  ctx.beginPath()
  ctx.moveTo(clampedX - 6, 0)
  ctx.lineTo(clampedX + 6, 0)
  ctx.lineTo(clampedX, 8)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = '#ef4444'
  ctx.fillRect(clampedX - 1, 0, 2, h)
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

function resizeCanvas() {
  const container = containerRef.value
  const canvas = canvasRef.value
  if (!container || !canvas) return

  const rect = container.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1

  canvasWidth = rect.width
  canvasHeight = rect.height

  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  canvas.style.width = rect.width + 'px'
  canvas.style.height = rect.height + 'px'

  clampScroll()
  draw()
}

function zoomAtPoint(centerX: number, newZoom: number) {
  const oldTime = pixelToTime(centerX)
  zoomLevel.value = clamp(newZoom, MIN_ZOOM, MAX_ZOOM)
  const visDur = props.duration / zoomLevel.value
  scrollOffset.value = oldTime - (centerX / canvasWidth) * visDur
  clampScroll()
}

function zoomIn() {
  zoomAtPoint(canvasWidth / 2, zoomLevel.value * 1.5)
}

function zoomOut() {
  zoomAtPoint(canvasWidth / 2, zoomLevel.value / 1.5)
}

function zoomToFit() {
  zoomLevel.value = 1
  scrollOffset.value = 0
}

function hitTestEdge(
  clientX: number,
  clientY: number,
): { type: 'start' | 'end'; segmentId: string } | null {
  const canvas = canvasRef.value
  if (!canvas) return null

  const rect = canvas.getBoundingClientRect()
  const x = clientX - rect.left
  const y = clientY - rect.top

  const trackY = TRACK_TOP + 14
  if (y < trackY - 4 || y > trackY + 20) return null

  const visStart = scrollOffset.value
  const visEnd = scrollOffset.value + props.duration / zoomLevel.value

  const edgePx = Math.max(EDGE_HIT_PX, 4 / zoomLevel.value)

  for (const seg of props.segments) {
    if (seg.endTime < visStart || seg.startTime > visEnd) continue

    const x1 = timeToPixel(seg.startTime)
    const x2 = timeToPixel(seg.endTime)

    if (Math.abs(x - x1) <= edgePx) {
      return { type: 'start', segmentId: seg.id }
    }
    if (Math.abs(x - x2) <= edgePx) {
      return { type: 'end', segmentId: seg.id }
    }
  }

  return null
}

function getCursorForPosition(clientX: number, clientY: number): string {
  const edge = hitTestEdge(clientX, clientY)
  if (edge) return 'ew-resize'

  const canvas = canvasRef.value
  if (!canvas) return 'default'

  const rect = canvas.getBoundingClientRect()
  const x = clientX - rect.left
  const time = pixelToTime(x)

  for (const seg of props.segments) {
    if (time >= seg.startTime && time <= seg.endTime) return 'pointer'
  }

  return 'crosshair'
}

function onMouseDown(e: MouseEvent) {
  if (!props.duration) return

  const canvas = canvasRef.value
  if (!canvas) return

  const edge = hitTestEdge(e.clientX, e.clientY)
  if (edge) {
    const seg = props.segments.find((s) => s.id === edge.segmentId)
    if (seg) {
      dragState.value = {
        type: edge.type,
        segmentId: seg.id,
        origStart: seg.startTime,
        origEnd: seg.endTime,
      }
      canvas.style.cursor = 'ew-resize'
    }
    return
  }

  const rect = canvas.getBoundingClientRect()
  const x = e.clientX - rect.left
  const time = clamp(pixelToTime(x), 0, props.duration)

  for (const seg of props.segments) {
    if (time >= seg.startTime && time <= seg.endTime) {
      emit('selectSegment', seg.id)
      emit('seek', seg.startTime)
      return
    }
  }

  emit('seek', time)
}

function onMouseMove(e: MouseEvent) {
  const canvas = canvasRef.value
  if (!canvas) return

  if (dragState.value) {
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const time = clamp(pixelToTime(x), 0, props.duration)
    const seg = props.segments.find((s) => s.id === dragState.value!.segmentId)
    if (!seg) {
      dragState.value = null
      return
    }

    let newStart = seg.startTime
    let newEnd = seg.endTime

    if (dragState.value.type === 'start') {
      newStart = clamp(time, 0, seg.endTime - 0.001)
    } else {
      newEnd = clamp(time, seg.startTime + 0.001, props.duration)
    }

    emit('updateSegment', seg.id, newStart, newEnd)
    return
  }

  canvas.style.cursor = getCursorForPosition(e.clientX, e.clientY)
}

function onMouseUp(_e: MouseEvent) {
  dragState.value = null
  const canvas = canvasRef.value
  if (canvas) {
    canvas.style.cursor = 'crosshair'
  }
}

function onMouseLeave() {
  dragState.value = null
  const canvas = canvasRef.value
  if (canvas) {
    canvas.style.cursor = 'crosshair'
  }
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  if (!props.duration) return

  const canvas = canvasRef.value
  if (!canvas) return

  const visDur = props.duration / zoomLevel.value

  if (e.ctrlKey || e.metaKey) {
    const factor = 1 - e.deltaY * 0.002
    const newZoom = zoomLevel.value * factor
    zoomAtPoint(e.offsetX, newZoom)
  } else {
    const deltaTime = (e.deltaY / canvasWidth) * visDur * 0.5
    scrollOffset.value += deltaTime
    clampScroll()
  }
}

watch(
  () => [
    props.segments,
    props.duration,
    props.inMarker,
    props.outMarker,
    props.selectedSegmentId,
    zoomLevel.value,
    scrollOffset.value,
  ],
  () => draw(),
  { deep: false },
)

onMounted(() => {
  resizeCanvas()

  const ro = new ResizeObserver(() => {
    resizeCanvas()
  })
  if (containerRef.value) {
    ro.observe(containerRef.value)
  }

  function loop() {
    draw()
    rafId = requestAnimationFrame(loop)
  }
  rafId = requestAnimationFrame(loop)

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)

  onUnmounted(() => {
    cancelAnimationFrame(rafId)
    ro.disconnect()
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  })
})
</script>

<template>
  <div class="w-full h-full flex flex-col">
    <div class="flex items-center justify-between px-2 py-0.5 bg-gray-800 border-b border-gray-700 flex-shrink-0">
      <span class="text-[10px] text-gray-500 font-mono select-none">TIMELINE</span>
      <div class="flex items-center gap-1">
        <button
          class="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-gray-700 text-xs font-mono leading-none transition-colors"
          title="Zoom out"
          @click="zoomOut"
        >
          &minus;
        </button>
        <button
          class="text-[10px] text-gray-400 font-mono px-1 rounded hover:bg-gray-700 transition-colors select-none"
          title="Zoom to fit"
          @click="zoomToFit"
        >
          {{ Math.round(zoomLevel * 100) }}%
        </button>
        <button
          class="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-gray-700 text-xs font-mono leading-none transition-colors"
          title="Zoom in"
          @click="zoomIn"
        >
          +
        </button>
      </div>
    </div>
    <div ref="containerRef" class="flex-1 relative cursor-crosshair">
      <canvas
        ref="canvasRef"
        class="w-full h-full block"
        @mousedown.prevent="onMouseDown"
        @mouseleave="onMouseLeave"
        @wheel.prevent="onWheel"
      />
    </div>
  </div>
</template>

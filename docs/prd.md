# PRD: Handball Match Video Analyzer

## Problem Statement

Handball coaches and analysts need to review long match videos (up to 8 hours), extract key moments (goals, defensive formations, attacks), organize them into thematic groups, annotate with titles and comments, and export curated clip collections — all without internet connectivity. Existing video editors are either too complex (Premiere, DaVinci), require internet (cloud tools), or lack sports-specific organization features (grouping, reordering, per-clip slow motion).

## Solution

A desktop video analysis tool purpose-built for handball matches. Works completely offline. Users upload a match video, mark segments with keyboard shortcuts during playback, organize clips into named groups (e.g., "First Half Attacks", "Defensive Errors"), add titles and comments, and export curated clip folders or concatenated group videos with title overlays. Everything saves locally as portable project folders.

## User Stories

1. As a handball coach, I want to open a match video file (any common format, up to 8 hours), so that I can start analyzing it immediately without format conversion.
2. As a handball coach, I want to press a keyboard shortcut (I) to mark the start of a clip during playback, so that I can capture moments without stopping the video.
3. As a handball coach, I want to press a keyboard shortcut (O) to mark the end of a clip, and have a segment automatically created, so that marking moments is fast and intuitive.
4. As a handball coach, I want to delete a mistakenly created segment with Ctrl+Backspace, so that I can correct errors quickly.
5. As a handball coach, I want to see all my cut segments listed in a sidebar, so that I can review and organize what I've captured.
6. As a handball coach, I want to give each segment a custom title, so that I know what the clip represents (e.g., "Goal #3 - Wing attack").
7. As a handball coach, I want to add comments to each segment, so that I can include tactical notes for later review.
8. As a handball coach, I want to create named groups (e.g., "Attack", "Defense", "Set Pieces"), so that I can categorize clips by tactical theme.
9. As a handball coach, I want to give each group a title and comments, so that I can describe the tactical theme of the entire collection.
10. As a handball coach, I want to drag segments into groups in the sidebar, so that I can organize clips after the fact.
11. As a handball coach, I want to reorder segments within a group by dragging, so that I can arrange clips in a logical narrative flow.
12. As a handball coach, I want to reorder groups themselves, so that I can control the overall presentation order.
13. As a handball coach, I want to toggle group visibility in the sidebar, so that I can focus on specific tactical themes when many groups exist.
14. As a handball coach, I want to watch the full source video with slow motion by holding the S key, so that I can catch fast plays (counter-attacks, shots) in detail.
15. As a handball coach, I want to set a per-segment slow-motion speed override, so that critical clips (e.g., goals) always play back slower while routine play stays at normal speed.
16. As a handball coach, I want to step frame-by-frame with arrow keys when paused, so that I can precisely find the exact moment of a ball release or contact.
17. As a handball coach, I want to see a timeline at the bottom showing the full video with markers for all my segments, so that I have visual context of where cuts are.
18. As a handball coach, I want to click on a segment in the sidebar and jump the video to that timestamp, so that I can quickly review a specific clip.
19. As a handball coach, I want to export a single segment as an .mp4 file, so that I can share one specific moment with a player.
20. As a handball coach, I want to export an entire group as a single concatenated .mp4 video, with the title of each segment appearing as an overlay when each clip starts, so that viewers understand what they're watching.
21. As a handball coach, I want to export all groups into a folder structure (one subfolder per group, with individual .mp4 segments inside), so that I have a clean, organized output.
22. As a handball coach, I want exported segments to optionally render at their per-segment slow-motion speed, so that the exported clip already plays in slow motion.
23. As a handball coach, I want to save my entire project as a folder containing all exported segments plus a project.json file, so that I can archive, move to another drive, or share the complete analysis.
24. As a handball coach, I want to reopen a saved project by pointing the app to the project folder, so that I can continue work later or hand off analysis to another coach.
25. As a handball coach, I want the app to auto-cache my marking state periodically, so that if the app crashes and I reopen the same video, I can resume where I left off without losing marker positions.
26. As a handball coach, I want the app to work completely offline — no internet connection required at any point, so that I can use it in gyms, arenas, or travel.

## Implementation Decisions

### Architecture
- **Desktop shell**: Electron, single-window application
- **Frontend**: Vue 3 with Composition API, Vite bundler, TypeScript
- **State management**: Pinia stores (project store for segments/groups, player store for playback state)
- **Styling**: Tailwind CSS v4 (no component library — custom components for timeline and sidebar)
- **Routing**: Vue Router for navigation between editor view and project open/save screens

### Video Processing
- **Playback**: Native HTML `<video>` element for hardware-accelerated playback
- **Cutting**: Lossless trim via ffmpeg (`-c copy`), executed as a child process through the Electron main process
- **Export**: Individual segments — ffmpeg trim. Group concatenation — ffmpeg concat demuxer with drawtext filter for title overlays. Slow-motion — ffmpeg setpts filter.
- **FFmpeg bundling**: `@ffmpeg-installer/ffmpeg` provides platform-specific ffmpeg binary bundled with the app

### Project Data Model

```typescript
interface Project {
  version: string
  sourceVideoPath: string
  sourceVideoFileName: string
  createdAt: string
  updatedAt: string
  groups: Group[]
  segments: Segment[]
  cachePath: string
}

interface Segment {
  id: string
  groupId: string | null
  title: string
  comments: string
  startTime: number       // seconds from video start
  endTime: number         // seconds from video start
  slowMotionSpeed: number // 1 = normal, 0.5 = half, 0.25 = quarter
}

interface Group {
  id: string
  title: string
  comments: string
  order: number
  visible: boolean
}
```

### Data Flow
- **Save**: User selects a destination folder → app exports all segment .mp4 files into group subfolders + writes `project.json` at root
- **Load**: User selects folder containing `project.json` → app reads metadata, segments point to .mp4 files within the folder. Source video file must be re-linked if not found at original path.
- **Auto-recovery cache**: On every marker placement / segment creation, the current state is debounced and written to a `.handball-cache.json` file next to the source video. On app launch with same video, the cache is offered for restoration.

### IPC Architecture
- **Main process**: Handles ffmpeg execution, file system operations (open/save dialogs, read/write project files)
- **Renderer process**: Vue app, video playback, timeline rendering, UI state
- **Preload script**: Exposes a typed `window.electronAPI` with methods: `openVideo()`, `cutSegment()`, `exportSegment()`, `exportGroup()`, `saveProject()`, `loadProject()`, `getFFmpegPath()`

### Timeline UI
- Bottom panel: Canvas-rendered timeline strip showing full video duration with overlaid segment markers
- Playhead syncs with `<video>` element currentTime
- Click to seek, drag markers to adjust segment boundaries
- Zoom in/out for precision

### Keyboard Shortcuts
- **Space**: Play/pause
- **I**: Mark segment start (in point)
- **O**: Mark segment end (out point), auto-creates segment
- **← →**: Frame step (when paused)
- **S** (hold): Slow motion while held (0.25x playbackRate)
- **Ctrl+Backspace**: Delete selected segment
- **Ctrl+G**: Create new group

## Testing Decisions

- **What makes a good test**: Test external behavior — can a user mark a segment, does it appear in the sidebar, can they export it and get a valid .mp4. Do not test Vue internals or DOM implementation details.
- **Modules to test**: Pinia stores (segment creation, grouping logic), Electron IPC handlers (ffmpeg command construction, file I/O), video processing (output file validity).
- **Test approach**: Integration tests using Electron `webContents.executeJavaScript` or Vitest with mocked IPC. ffmpeg integration tests against a small test video file.

## Out of Scope

- Drawing tools on paused frames (arrows, circles)
- Tagging system (goal, foul, defense tags)
- Score overlay on exported video
- Multi-monitor / detachable panels
- Cloud sync or online sharing
- User authentication or multi-user
- Audio-only editing
- Video encoding other than H.264 .mp4
- Import from other video analysis tools

## Further Notes

- The app name internally is `video_editor`, but the user-visible name should be something sport-appropriate (e.g., "Handball Analyzer" or "Match Cutter").
- 8-hour video support is expected — the `<video>` element handles this efficiently via streaming, but the timeline rendering and segment list in the sidebar must use virtualization for performance with large numbers of segments.
- The project file format (JSON) is intentionally simple and human-readable so coaches can inspect or manually repair it if needed.

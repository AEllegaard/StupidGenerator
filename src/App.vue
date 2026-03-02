<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
// jsPDF is used to generate a downloadable PDF from the exported raster image
import { jsPDF } from 'jspdf'

const canvasDimensions = [
  //SoMe presets
  { name: 'Instagram Post', width: 1080, height: 1080 },
  { name: 'Instagram Story', width: 1080, height: 1920 },
  { name: 'Facebook Post', width: 1200, height: 630 },
  { name: 'Twitter Post', width: 1200, height: 675 },
  { name: 'LinkedIn Post', width: 1200, height: 627 },

  //Print presets
  { name: 'Letter Portrait', width: 2550, height: 3300 },
  { name: 'Letter Landscape', width: 3300, height: 2550 },
  { name: 'A5 Portrait', width: 1748, height: 2480 },
  { name: 'A5 Landscape', width: 2480, height: 1748 },
  { name: 'A4 Portrait', width: 2480, height: 3508 },
  { name: 'A4 Landscape', width: 3508, height: 2480 },
  { name: 'A3 Portrait', width: 3508, height: 4961 },
  { name: 'A3 Landscape', width: 4961, height: 3508 },
  { name: 'Business Card', width: 1050, height: 600 },

  //Presentation presets
  { name: '16:9', width: 1920, height: 1080 },
  { name: '4:3', width: 1600, height: 1200 },
  { name: '1:1', width: 1080, height: 1080 },

  //Other presets
  { name: 'Custom', width: 1000, height: 1000 },
]

// Assets definition
const assets = [
  { name: 'Circle', path: '/Assets/Circle.svg' },
  {
    name: 'Corner',
    path: '/Assets/Corner.svg',
  },
  { name: 'Quarter Circle', path: '/Assets/Quarter_circle.svg' },
  {
    name: 'Half Circle',
    path: '/Assets/Half_circle.svg',
  },
  {
    name: 'Star',
    path: '/Assets/Star.svg',
  },
]

// User-uploaded SVG assets (treated the same as the predefined assets).
// Stored as data URLs so they work offline and don't require server storage.
const uploadedSvgAssets = ref([]) // [{ name, path, dataUrl, isUploadedSvg: true }]

// File input ref for uploading SVG assets
const uploadSvgInputRef = ref(null)

const onUploadSvgAsset = (e) => {
  const files = e?.target?.files
  if (!files || !files.length) return

  for (const file of files) {
    // Basic guard: accept only SVGs (both by mime and extension fallback)
    const isSvg = file.type === 'image/svg+xml' || (file.name || '').toLowerCase().endsWith('.svg')
    if (!isSvg) continue

    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev?.target?.result
      if (!dataUrl) return

      // Pattern finder behavior: uploaded SVG becomes a large background layer
      // behind the canvas viewport (viewport masks/clips it).
      // We store it in backgroundImages so it renders under placed assets.
      if (editorMode.value === 'pattern') {
        try {
          // Put it at the origin and scale it up by using a large logical size.
          // The render layer clips anything outside the canvas.
          pushHistory()

          backgroundImages.value = [
            {
              id: Date.now() + Math.floor(Math.random() * 100000),
              name: file.name || 'Pattern background SVG',
              path: dataUrl,
              dataUrl,
              isUploaded: true,
              // Offsets from canvas center (used by drag + sliders)
              x: patternBackground.value.x || 0,
              y: patternBackground.value.y || 0,
              rotation: patternBackground.value.rotation || 0,
              // Explicit render size in pixels for pattern-finder background.
              // We render this behind the viewport; anything outside is clipped.
              renderW: 6000,
              renderH: 6000,
              scale: patternBackground.value.scale || 1,
              multiplier: 0,
            },
          ]

          // Also clear any placed SVG assets so focus stays on the background.
          // (Safe default; remove if you want to keep existing assets.)
          placedAssets.value = []
        } catch (err) {
          console.warn('Pattern finder SVG background insert failed', err)
        }

        return
      }

      const baseName = (file.name || 'Uploaded SVG').replace(/\.svg$/i, '')
      // Ensure unique display names in the palette
      let name = baseName
      let i = 2
      const exists = (n) =>
        assets.some((a) => a.name === n) || uploadedSvgAssets.value.some((a) => a.name === n)
      while (exists(name)) {
        name = `${baseName} ${i}`
        i++
      }

      uploadedSvgAssets.value.push({
        name,
        path: dataUrl,
        dataUrl,
        isUploadedSvg: true,
      })
    }
    reader.readAsDataURL(file)
  }

  // reset so the same file can be re-uploaded if needed
  e.target.value = ''
}

const removeUploadedSvgAsset = (asset) => {
  const idx = uploadedSvgAssets.value.indexOf(asset)
  if (idx !== -1) uploadedSvgAssets.value.splice(idx, 1)
}

// --- Editor mode ------------------------------------------------------
// Sandbox: manual placement via palette clicks/drag.
// Pattern finder: focuses on the Pattern Randomizer workflow.
const editorMode = ref('sandbox') // 'sandbox' | 'pattern'

// Keep the Pattern finder background SVG around, but don't show it in Sandbox.
// We'll store the last pattern background object here when switching away.
const patternBackgroundStash = ref(null)

const setEditorMode = (mode) => {
  if (mode !== 'sandbox' && mode !== 'pattern') return

  // Switching between modes should not allow the Pattern background to sit under
  // Sandbox assets (but it should come back when returning to Pattern finder).
  if (editorMode.value === 'pattern' && mode === 'sandbox') {
    // stash pattern background (the one with renderW/renderH) and remove it from canvas
    const idx = backgroundImages.value.findIndex((img) => img && img.renderW && img.renderH)
    if (idx !== -1) {
      patternBackgroundStash.value = backgroundImages.value[idx]
      backgroundImages.value.splice(idx, 1)
    }
  } else if (editorMode.value === 'sandbox' && mode === 'pattern') {
    // When returning to Pattern finder, clear anything made in Sandbox so it
    // doesn't sit on top of the pattern background.
    // Keep only the Pattern background (stored separately in the stash).
    try {
      placedAssets.value = []
    } catch (e) {
      // ignore
    }

    // Remove any background images that are NOT the Pattern background.
    // (Pattern background is identified by renderW/renderH and is restored below)
    try {
      backgroundImages.value = (backgroundImages.value || []).filter(
        (img) => img && img.renderW && img.renderH,
      )
    } catch (e) {
      // ignore
    }

    // restore stashed pattern background if not already present
    const exists = backgroundImages.value.some((img) => img && img.renderW && img.renderH)
    if (!exists && patternBackgroundStash.value) {
      backgroundImages.value.unshift(patternBackgroundStash.value)
    }
  }

  editorMode.value = mode
}

const openUploadSvgPicker = () => {
  // Vue template refs point to the DOM element on `.value`
  const el = uploadSvgInputRef.value
  if (el && typeof el.click === 'function') el.click()
}

// --- Pattern finder background controls ------------------------------
// These values control the big uploaded SVG that sits behind the canvas
// and is clipped by the viewport.
const patternBackground = ref({
  scale: 1,
  x: 0,
  y: 0,
  rotation: 0,
})

// Visible canvas viewport center (in CSS pixels). Used as a stable pivot
// for Pattern finder background transforms.
const canvasCenterPx = computed(() => {
  try {
    if (!canvasRef.value || !canvasRef.value.getBoundingClientRect) return { cx: 0, cy: 0 }
    const r = canvasRef.value.getBoundingClientRect()
    return { cx: r.width / 2, cy: r.height / 2 }
  } catch (e) {
    return { cx: 0, cy: 0 }
  }
})

// Lock Pattern finder pivot to the *visible canvas viewport* center.
// We return percentages so transforms stay stable even if the canvas is scaled
// via responsive CSS. (Using px here caused subtle drift when layout changed.)
const canvasCenterCss = computed(() => {
  return {
    left: '50%',
    top: '50%',
  }
})

// Asset palette: click to spawn centered.
const onPaletteAssetClick = (asset) => {
  if (!asset) return
  spawnAssetCentered(asset)
}

// Combined asset pool used by the pattern generator.
// Includes both predefined assets and user-uploaded SVG assets.
const generatorAssets = computed(() => {
  // Filter out any falsy entries just in case.
  return [...assets, ...(uploadedSvgAssets.value || [])].filter(Boolean)
})

// (no disable/enable feature) All assets can be used by the generator.

const currentCanvasPreset = ref(canvasDimensions[0])
const gridSize = ref(5)
const placedAssets = ref([]) // Array to store placed assets on canvas
// Uploaded images placed on the canvas should always sit UNDER the SVG assets.
// We keep them in a separate list and render them in a layer below.
const backgroundImages = ref([]) // Array to store placed uploaded images (raster) under assets
const draggedAsset = ref(null)
const canvasRef = ref(null)

const canvasStyle = computed(() => {
  const maxWidth = 800 // max width to fit in the canvas area
  const maxHeight = 600 // max height to fit in the canvas area

  const widthRatio = maxWidth / currentCanvasPreset.value.width
  const heightRatio = maxHeight / currentCanvasPreset.value.height
  const scale = Math.min(widthRatio, heightRatio, 1)

  return {
    width: `${currentCanvasPreset.value.width * scale}px`,
    height: `${currentCanvasPreset.value.height * scale}px`,
    background: selectedBackgroundColor.value,
  }
})

// Color presets for canvas background and asset tint
const colorPresets = [
  { name: 'Red / Rosa', bg: '#f0604d', asset: '#ff9698' },
  { name: 'Dark green / ultra violet', bg: '#164230', asset: '#322fb0' },
  { name: 'Ultra Violet / Blue', bg: '#4055b2', asset: '#322fb0' },
  { name: 'Dark green / Blue', bg: '#164230', asset: '#4055b2' },
]

const selectedBackgroundColor = ref(colorPresets[0].bg)
const selectedAssetColor = ref(colorPresets[0].asset)

const selectColorPreset = (preset) => {
  pushHistory()
  selectedBackgroundColor.value = preset.bg
  selectedAssetColor.value = preset.asset
}

// Swap background and asset colors
const invertColors = () => {
  pushHistory()
  const bg = selectedBackgroundColor.value
  const asset = selectedAssetColor.value
  selectedBackgroundColor.value = asset
  selectedAssetColor.value = bg
}

// Simple undo stack (keep snapshots of relevant app state)
const historyStack = ref([])
const redoStack = ref([])
const maxHistory = 100
const maxRedo = 100

const getSnapshot = () => {
  return {
    placedAssets: JSON.parse(JSON.stringify(placedAssets.value)),
    backgroundImages: JSON.parse(JSON.stringify(backgroundImages.value)),
    selectedBackgroundColor: selectedBackgroundColor.value,
    selectedAssetColor: selectedAssetColor.value,
    gridSize: gridSize.value,
    currentCanvasPresetName: currentCanvasPreset.value?.name,
  }
}

const pushHistory = () => {
  try {
    const snap = getSnapshot()
    // Avoid pushing identical consecutive snapshots
    const last = historyStack.value[historyStack.value.length - 1]
    if (last && JSON.stringify(last) === JSON.stringify(snap)) return
    historyStack.value.push(snap)
    // Clear redo when new action is made
    redoStack.value = []
    // Cap history size
    if (historyStack.value.length > maxHistory) historyStack.value.shift()
  } catch (e) {
    console.error('pushHistory error', e)
  }
}

const applySnapshot = (snap) => {
  if (!snap) return
  placedAssets.value = JSON.parse(JSON.stringify(snap.placedAssets || []))
  backgroundImages.value = JSON.parse(JSON.stringify(snap.backgroundImages || []))
  selectedBackgroundColor.value = snap.selectedBackgroundColor || selectedBackgroundColor.value
  selectedAssetColor.value = snap.selectedAssetColor || selectedAssetColor.value
  gridSize.value = snap.gridSize || gridSize.value
  // restore preset by name if available
  if (snap.currentCanvasPresetName) {
    const p = canvasDimensions.find((c) => c.name === snap.currentCanvasPresetName)
    if (p) currentCanvasPreset.value = p
  }
}

const undo = () => {
  if (historyStack.value.length === 0) return
  // save current state onto redo stack so we can redo
  try {
    redoStack.value.push(getSnapshot())
    if (redoStack.value.length > maxRedo) redoStack.value.shift()
  } catch (e) {
    console.error('undo push to redo error', e)
  }

  const snap = historyStack.value.pop()
  applySnapshot(snap)
}

const redo = () => {
  if (redoStack.value.length === 0) return
  // before redoing, push current state onto history so undo can go back
  try {
    historyStack.value.push(getSnapshot())
    if (historyStack.value.length > maxHistory) historyStack.value.shift()
  } catch (e) {
    console.error('redo push to history error', e)
  }

  const snap = redoStack.value.pop()
  applySnapshot(snap)
}

// key handler for Ctrl+Z / Cmd+Z
const onKeyDown = (e) => {
  const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')
  const isRedo = (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z')
  if (isUndo) {
    e.preventDefault()
    undo()
  } else if (isRedo) {
    e.preventDefault()
    redo()
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKeyDown)
  // Wait for DOM updates so canvasRef has correct size, then seed an initial pattern.
  await nextTick()
  // Slight timeout to ensure layout/measurements are stable in all browsers.
  setTimeout(() => {
    try {
      randomizePattern()
    } catch (e) {
      console.warn('initial randomizePattern failed', e)
    }
  }, 50)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown))

// Calculate cell size to ensure perfect squares that fit within canvas
const cellSize = computed(() => {
  const canvasWidth = currentCanvasPreset.value.width

  // Cell size is determined by dividing canvas width by number of columns
  // This ensures we get exactly gridSize number of columns that fill the width
  return canvasWidth / gridSize.value
})

// Calculate how many cells actually fit in each dimension
const gridColumns = computed(() => {
  return gridSize.value
})

const gridRows = computed(() => {
  const canvasHeight = currentCanvasPreset.value.height
  // Calculate how many rows of perfect squares fit in the height
  const calculatedRows = Math.floor(canvasHeight / cellSize.value)
  // Ensure minimum 2 rows
  return Math.max(calculatedRows, 2)
})

const gridStyle = computed(() => {
  return {
    display: 'grid',
    gridTemplateColumns: `repeat(${gridColumns.value}, 1fr)`,
    gridTemplateRows: `repeat(${gridRows.value}, 1fr)`,
    gap: '0px',
    width: '100%',
    height: '100%',
  }
})

const gridCells = computed(() => {
  return Array.from({ length: gridColumns.value * gridRows.value }, (_, i) => i)
})

// Helper: snap to grid
// - 1x assets: snap to CENTER of nearest cell
// - 2x assets: snap to nearest GRID INTERSECTION
//   (so the 2x tile occupies a clean 2×2 block)
const computeSnapFromPointer = (pointerX, pointerY, canvasWidth, canvasHeight, multiplier = 1) => {
  const cellWidth = canvasWidth / gridColumns.value
  const cellHeight = canvasHeight / Math.max(1, gridRows.value)

  // Clamp pointer inside the canvas to keep intersection math stable
  const px = Math.max(0, Math.min(canvasWidth, pointerX))
  const py = Math.max(0, Math.min(canvasHeight, pointerY))

  // 2x (or bigger) should anchor to intersections
  if ((multiplier || 1) > 1) {
    const col = Math.round(px / cellWidth)
    const row = Math.round(py / cellHeight)
    const clampedCol = Math.max(0, Math.min(gridColumns.value, col))
    const clampedRow = Math.max(0, Math.min(gridRows.value, row))
    return { x: clampedCol * cellWidth, y: clampedRow * cellHeight }
  }

  // 1x: center of nearest cell
  const col = Math.max(0, Math.min(gridColumns.value - 1, Math.floor(px / cellWidth)))
  const row = Math.max(0, Math.min(gridRows.value - 1, Math.floor(py / cellHeight)))
  return { x: (col + 0.5) * cellWidth, y: (row + 0.5) * cellHeight }
}

// Drag and drop functions
const startDrag = (asset, event) => {
  draggedAsset.value = asset
  event.dataTransfer.effectAllowed = 'copy'
  // Some browsers / nested layers can cause the reactive ref to be cleared
  // before drop. Store a full payload so onDrop can recover reliably.
  try {
    event.dataTransfer.setData('application/x-stupidgenerator-asset', JSON.stringify(asset))
  } catch (e) {
    // ignore
  }
  event.dataTransfer.setData('text/plain', asset.name)
  // show trash while dragging from palette
  trashVisible.value = true
  draggedOverTrash.value = false
}

const onDragEnd = (event) => {
  // hide trash when palette drag ends (drop or cancel)
  trashVisible.value = false
  draggedOverTrash.value = false
  // clear draggedAsset (drop handlers will handle placement)
  draggedAsset.value = null
}

const onDragOver = (event) => {
  event.preventDefault()
  event.dataTransfer.dropEffect = 'copy'
}

const onDrop = (event) => {
  event.preventDefault()
  // Recover the dragged asset either from reactive state (normal path)
  // or from the drag dataTransfer payload (more robust across layers).
  let dragged = draggedAsset.value
  if (!dragged) {
    try {
      const raw = event.dataTransfer.getData('application/x-stupidgenerator-asset')
      if (raw) dragged = JSON.parse(raw)
    } catch (e) {
      // ignore
    }
  }
  if (!dragged || !canvasRef.value) return

  const canvasRect = canvasRef.value.getBoundingClientRect()
  const canvasWidth = canvasRect.width
  const canvasHeight = canvasRect.height

  // Get drop position relative to canvas
  const x = event.clientX - canvasRect.left
  const y = event.clientY - canvasRect.top

  // Calculate cell dimensions in pixels
  const cellWidth = canvasWidth / gridColumns.value
  const cellHeight = canvasHeight / gridRows.value

  // Decide size multiplier.
  // - SVG assets use the existing 1x/2x control (and Star is forced 2x)
  // - Uploaded images use their own 1–4 grid-square control
  let currentMultiplier = assetMultiplier.value || 1
  if (dragged && dragged.isUploaded) currentMultiplier = backgroundImageMultiplier.value || 1
  // Manual placement: allow Star to be 1x if the user picked 1x.
  const forcedCurrentMultiplier = currentMultiplier

  // Snap anchor: 1x -> cell center, 2x -> intersection
  const snapAnchor = computeSnapFromPointer(
    x,
    y,
    canvasWidth,
    canvasHeight,
    forcedCurrentMultiplier,
  )
  const snappedX = snapAnchor.x
  const snappedY = snapAnchor.y

  // Use current canvas cell width and the selected multiplier so the new
  // placed asset will scale with the grid when the slider changes.
  const currentAssetSize = Math.round(cellWidth * forcedCurrentMultiplier)
  // Only apply horizontal asset-specific offset for 1x assets — larger
  // multipliers may amplify the offset too much (Half Circle padding fix).
  const dropOffsetX = (currentMultiplier === 1 ? dragged.offsetX || 0 : 0) * currentAssetSize
  const dropOffsetY = (dragged.offsetY || 0) * currentAssetSize

  // Compute top-left:
  // - 1x: center on the cell center anchor
  // - 2x: anchor is intersection, so top-left should be on that intersection
  //   to occupy a clean 2×2 block.
  let finalX, finalY
  if (forcedCurrentMultiplier > 1) {
    finalX = snappedX
    finalY = snappedY
  } else {
    finalX = snappedX - currentAssetSize / 2
    finalY = snappedY - currentAssetSize / 2
  }

  // Apply asset-specific offsets (fractions of asset size)
  finalX += dropOffsetX
  finalY += dropOffsetY

  // Round to integer pixels and clamp inside canvas bounds to avoid sub-pixel
  // placement and small negative values caused by tiny offsets (like -0.001)
  finalX = Math.round(finalX)
  finalY = Math.round(finalY)
  finalX = Math.max(0, Math.min(finalX, canvasWidth - currentAssetSize))
  finalY = Math.max(0, Math.min(finalY, canvasHeight - currentAssetSize))

  // snap calculations executed
  // record state before adding new asset so Ctrl+Z can undo
  pushHistory()

  const newItem = {
    ...dragged,
    x: finalX,
    y: finalY,
    rotation: 0,
    id: Date.now(),
    multiplier: currentMultiplier,
  }
  // Uploaded raster images always go to the background layer
  if (newItem.isUploaded) backgroundImages.value.push(newItem)
  else placedAssets.value.push(newItem)
  // hide trash after a successful drop on canvas
  trashVisible.value = false
  draggedOverTrash.value = false

  draggedAsset.value = null
}

// Allow dropping even if the pointer is over an overlay layer.
// We forward to the canvas handlers and prevent the overlay from blocking.
const onOverlayDragOver = (event) => {
  onDragOver(event)
}
const onOverlayDrop = (event) => {
  onDrop(event)
}

// Spawn an asset at the visual center of the canvas. This respects the
// current snapping rules (1x = cell center, 2x = intersections).
const spawnAssetCentered = (asset) => {
  if (!canvasRef.value) return
  try {
    const canvasRect = canvasRef.value.getBoundingClientRect()
    const canvasWidth = canvasRect.width
    const canvasHeight = canvasRect.height

    // Center point in canvas coordinates
    const centerX = canvasWidth / 2
    const centerY = canvasHeight / 2

    // Decide size multiplier.
    // - SVG assets use the existing 1x/2x control
    // - Uploaded images use their own 1–4 grid-square control
    let currentMultiplier = assetMultiplier.value || 1
    if (asset && asset.isUploaded) currentMultiplier = backgroundImageMultiplier.value || 1

    // Snap anchor: 1x -> cell center, 2x -> intersection
    const snapAnchor = computeSnapFromPointer(
      centerX,
      centerY,
      canvasWidth,
      canvasHeight,
      currentMultiplier,
    )
    const cellWidth = canvasWidth / gridColumns.value
    const cellHeight = canvasHeight / Math.max(1, gridRows.value)
    const currentAssetSize = Math.round(cellWidth * currentMultiplier)
    const dropOffsetX = (currentMultiplier === 1 ? asset.offsetX || 0 : 0) * currentAssetSize
    const dropOffsetY = (asset.offsetY || 0) * currentAssetSize

    // Placement:
    // - 1x: center on the cell center anchor
    // - 2x: anchor is intersection -> top-left on that intersection
    let finalX, finalY
    if (currentMultiplier > 1) {
      finalX = Math.round(snapAnchor.x + dropOffsetX)
      finalY = Math.round(snapAnchor.y + dropOffsetY)
    } else {
      finalX = Math.round(snapAnchor.x - currentAssetSize / 2 + dropOffsetX)
      finalY = Math.round(snapAnchor.y - currentAssetSize / 2 + dropOffsetY)
    }

    // Clamp so the asset remains at least partially visible inside canvas
    finalX = Math.max(0, Math.min(finalX, canvasWidth - currentAssetSize))
    finalY = Math.max(0, Math.min(finalY, canvasHeight - currentAssetSize))

    pushHistory()
    const newItem = {
      ...asset,
      x: finalX,
      y: finalY,
      rotation: 0,
      id: Date.now(),
      multiplier: currentMultiplier,
    }
    // Uploaded raster images always go under assets
    if (newItem.isUploaded) backgroundImages.value.push(newItem)
    else placedAssets.value.push(newItem)
  } catch (e) {
    console.debug('spawnAssetCentered failed', e)
  }
}

// Trash drag/drop handlers (for palette HTML5 drags)
const onTrashDragOver = (e) => {
  e.preventDefault()
}

const onTrashDragLeave = (e) => {
  // no-op; we rely on dragend to hide the trash
}

const onTrashDrop = (e) => {
  e.preventDefault()
  // Dropped a palette asset onto trash -> do nothing (don't add to canvas)
  draggedAsset.value = null
  trashVisible.value = false
  draggedOverTrash.value = false
}

// Move existing assets
const draggedPlacedAsset = ref(null)
const dragOffset = ref({ x: 0, y: 0 })
// Pattern finder: keep the dragged SVG under the cursor even when scale/rotation
// change by recording where on the SVG the user grabbed it.
// Everything is in *rendered canvas CSS pixels*.
const patternGrab = ref(null) // { localX, localY, startX, startY, startScale, startRotation }

// Pattern finder: when scaling the big uploaded SVG background, keep the pivot
// locked to the visible canvas center (50%/50%).
// If the user is currently dragging (patternGrab is set), use the grabbed local
// point to keep that exact point under the cursor stable too.
const updatePatternBackgroundScale = (newScale) => {
  const bg = (backgroundImages.value || []).find((img) => img && img.renderW && img.renderH)
  if (!bg) return

  const prevScale = Number(bg.scale || 1) || 1
  const nextScale = Number(newScale || 1) || 1
  if (!Number.isFinite(prevScale) || !Number.isFinite(nextScale) || prevScale === nextScale) return

  // Keep the visual pivot fixed by shifting translation when scale changes.
  // Model: element is centered at canvas center with translation (x,y).
  // Scaling around element center would move a local point: delta = local * (s2 - s1).
  // We compensate by adjusting translation by -rotate(local*(s2-s1), rotation).
  const rot = Number(bg.rotation || 0)
  const local = patternGrab.value
    ? { x: Number(patternGrab.value.localX || 0), y: Number(patternGrab.value.localY || 0) }
    : { x: 0, y: 0 }

  const diff = {
    x: local.x * (nextScale - prevScale),
    y: local.y * (nextScale - prevScale),
  }
  const screen = rotatePoint(diff.x, diff.y, rot)

  const nextX = Math.round((Number(bg.x || 0) || 0) - screen.x)
  const nextY = Math.round((Number(bg.y || 0) || 0) - screen.y)

  bg.scale = nextScale
  bg.x = nextX
  bg.y = nextY

  // keep UI model in sync
  patternBackground.value.scale = nextScale
  patternBackground.value.x = nextX
  patternBackground.value.y = nextY
}

// Rotate the point (x,y) by angleDeg around origin.
const rotatePoint = (x, y, angleDeg) => {
  const a = (Number(angleDeg) || 0) * (Math.PI / 180)
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos,
  }
}

// Pattern finder: we keep the pivot locked to the canvas center.
// During drag we simply update translation offsets (x/y). These offsets are stored
// in *screen (canvas CSS) pixels* and should NOT be divided by scale.
const lastSnap = ref({ x: 0, y: 0 })
const draggedDuringInteraction = ref(false)
const justDragged = ref(false)
const trashRef = ref(null)
const trashVisible = ref(false)
const draggedOverTrash = ref(false)
const draggedElement = ref(null) // store the actual DOM element being dragged
const _globalMoveHandler = { fn: null }
const _globalUpHandler = { fn: null }
const _globalPointerMoveHandler = { fn: null }
const _globalPointerUpHandler = { fn: null }
const moveListenersAdded = ref(false)
const dragActive = ref(false)

// Asset size multiplier: 1 = one grid square wide, 2 = two grid squares wide
const assetMultiplier = ref(2)

// Uploaded/background image size in grid squares (independent of SVG asset size)
// This decides how many grid squares a newly placed uploaded image should fill.
const backgroundImageMultiplier = ref(1)

const changeAssetSize = (mult) => {
  // Accept only 1 or 2 for now; ignore invalid values
  if (mult !== 1 && mult !== 2) return
  assetMultiplier.value = mult
}

const changeBackgroundImageSize = (mult) => {
  // 4 choices requested: 1–4 grid squares
  if (![1, 2, 3, 4].includes(mult)) return
  backgroundImageMultiplier.value = mult
}

// Pattern generation mode: 'random' (existing), 'checkerboard' (alternating 1x/2x tiles)
// Default to checkerboard so the single Pattern Randomizer button creates
// the tiled motif similar to the provided example.
const patternMode = ref('checkerboard')

const startMovingAsset = (asset, event, el = null) => {
  draggedPlacedAsset.value = asset

  // Pattern finder background uses a fixed pivot at canvas center (50%/50%).
  // While dragging, we must NOT let the pivot move; instead we update asset.x/y
  // (translation) such that the point the user grabbed stays under the pointer.
  if (editorMode.value === 'pattern' && asset && asset.renderW && asset.renderH) {
    try {
      const canvasRect = canvasRef.value.getBoundingClientRect()

      // Pointer position in canvas-local coords
      const ptrX = event.clientX - canvasRect.left
      const ptrY = event.clientY - canvasRect.top

      // Current translation offsets (center-offset space)
      const tx = asset.x || 0
      const ty = asset.y || 0

      const rot = Number(asset.rotation || 0)
      const scale = Number(asset.scale || 1) || 1

      // Compute pointer position relative to the SVG's *current* center.
      // SVG center is always canvas center + translation.
      const dx = ptrX - (canvasRect.width / 2 + tx)
      const dy = ptrY - (canvasRect.height / 2 + ty)

      // Store grabbed offset in the SVG's local (unrotated/unscaled) space.
      // This makes dragging stable even after rotation/scale changes.
      const unrot = rotatePoint(dx, dy, -rot)
      const localX = unrot.x / scale
      const localY = unrot.y / scale

      patternGrab.value = {
        // Stored in local object space
        localX,
        localY,
        startX: tx,
        startY: ty,
        startScale: scale,
        startRotation: rot,
      }
    } catch (e) {
      patternGrab.value = null
    }
  } else {
    patternGrab.value = null
  }

  const canvasRect = canvasRef.value.getBoundingClientRect()
  const mouseX = event.clientX - canvasRect.left
  const mouseY = event.clientY - canvasRect.top

  // Prefer computing drag offset from the element's actual bounding rect
  // (accounts for SVG viewBox, internal padding, rotation, mask centering).
  // Fallback to using stored asset.x/asset.y if element rect isn't provided.
  try {
    // Pattern finder background: asset.x/asset.y are OFFSETS from canvas center,
    // and the element may be scaled. Compute the visual top-left so dragging
    // doesn't jump when scale changes.
    if (editorMode.value === 'pattern' && asset && asset.renderW && asset.renderH) {
      const rect = canvasRect
      const w = asset.renderW
      const h = asset.renderH
      // With the 50%/50% anchor model the visual top-left is center - half size + offsets
      const left = rect.width / 2 - w / 2 + (asset.x || 0)
      const top = rect.height / 2 - h / 2 + (asset.y || 0)
      dragOffset.value = { x: mouseX - left, y: mouseY - top }
      draggedElement.value = el
    } else if (el && el.getBoundingClientRect) {
      const elRect = el.getBoundingClientRect()
      const elLeftRel = elRect.left - canvasRect.left
      const elTopRel = elRect.top - canvasRect.top
      dragOffset.value = { x: mouseX - elLeftRel, y: mouseY - elTopRel }
      draggedElement.value = el
    } else {
      dragOffset.value = { x: mouseX - asset.x, y: mouseY - asset.y }
    }
  } catch (e) {
    // if anything goes wrong, fall back to the previous calculation
    dragOffset.value = {
      x: mouseX - asset.x,
      y: mouseY - asset.y,
    }
  }
  draggedDuringInteraction.value = false
  // show trash while moving an existing asset
  trashVisible.value = true
  draggedOverTrash.value = false
  // indicate active drag so canvas can allow overflow
  // (but keep Pattern finder clipped so bg doesn't float outside the viewport)
  dragActive.value = editorMode.value !== 'pattern'
  // attach global listeners so we can continue dragging outside the canvas
  if (!moveListenersAdded.value) {
    _globalMoveHandler.fn = (e) => onCanvasMouseMove(e)
    _globalUpHandler.fn = (e) => onCanvasMouseUp(e)
    // Pointer events (covers trackpad/touch/pen and fixes <img> quirks)
    _globalPointerMoveHandler.fn = (e) => onCanvasMouseMove(e)
    _globalPointerUpHandler.fn = (e) => onCanvasMouseUp(e)
    window.addEventListener('mousemove', _globalMoveHandler.fn)
    window.addEventListener('mouseup', _globalUpHandler.fn)
    window.addEventListener('pointermove', _globalPointerMoveHandler.fn)
    window.addEventListener('pointerup', _globalPointerUpHandler.fn)
    window.addEventListener('pointercancel', _globalPointerUpHandler.fn)
    moveListenersAdded.value = true
  }
}

// Delegated pointerdown handler on the asset layers so every placed asset is draggable.
// Pointer events are more reliable than mouse events on <img> across browsers.
const onAssetsLayerPointerDown = (event) => {
  // In some cases (especially <img>), the pointer event target can be the layer
  // rather than the element; search from composedPath as a fallback.
  let el = event.target && event.target.closest && event.target.closest('.placed-asset-shape')
  if (!el && typeof event.composedPath === 'function') {
    const path = event.composedPath()
    el = path.find((n) => n && n.classList && n.classList.contains('placed-asset-shape'))
  }
  if (!el) return
  const id = el.dataset && el.dataset.id
  if (!id) return
  // Selection priority:
  // - Hold Alt/Option to grab BACKGROUND images (even if assets are on top)
  // - Otherwise grab regular placed assets as usual
  const preferBackground = !!event.altKey
  const found = preferBackground
    ? backgroundImages.value.find((a) => String(a.id) === String(id))
    : placedAssets.value.find((a) => String(a.id) === String(id)) ||
      backgroundImages.value.find((a) => String(a.id) === String(id))
  if (!found) return

  // Capture pointer so we keep receiving move events even if the pointer
  // leaves the element/canvas while dragging.
  try {
    if (typeof el.setPointerCapture === 'function' && event.pointerId != null) {
      el.setPointerCapture(event.pointerId)
    }
  } catch (e) {
    // ignore
  }

  startMovingAsset(found, event, el)
  event.preventDefault()
}

const onCanvasPointerMove = (event) => {
  // Delegate to existing mousemove logic (it only relies on clientX/clientY).
  onCanvasMouseMove(event)
}

const onCanvasPointerUp = (event) => {
  onCanvasMouseUp(event)
}

// Alt/Option-drag for background images:
// When assets are on top you can't click the background image element, so we
// hit-test against backgroundImages by pointer position and start dragging the
// topmost background image under the cursor.
const findTopmostBackgroundImageAt = (canvasX, canvasY) => {
  if (!canvasRef.value) return null
  // iterate from last to first so the most recently placed one wins
  for (let i = backgroundImages.value.length - 1; i >= 0; i--) {
    const img = backgroundImages.value[i]
    const w = img.renderW || getAssetPixelSize(img)
    const h = img.renderH || getAssetPixelSize(img)

    // Pattern finder background is centered; treat img.x/img.y as offsets from center
    let left = img.x || 0
    let top = img.y || 0
    if (img.renderW && img.renderH) {
      try {
        const rect = canvasRef.value.getBoundingClientRect()
        left = rect.width / 2 - img.renderW / 2 + (img.x || 0)
        top = rect.height / 2 - img.renderH / 2 + (img.y || 0)
      } catch (e) {}
    }

    if (canvasX >= left && canvasX <= left + w && canvasY >= top && canvasY <= top + h) {
      return img
    }
  }
  return null
}

const onCanvasPointerDown = (event) => {
  // Sandbox: background dragging requires Alt/Option.
  // Pattern finder: allow dragging the big background directly.
  if (editorMode.value !== 'pattern' && !event.altKey) return
  if (!canvasRef.value) return
  // Don't interfere with palette HTML5 drag/drop.
  if (draggedAsset.value) return

  const canvasRect = canvasRef.value.getBoundingClientRect()
  const x = event.clientX - canvasRect.left
  const y = event.clientY - canvasRect.top

  const hit = findTopmostBackgroundImageAt(x, y)
  if (!hit) return

  // Find the actual element so offset uses its rendered box (rotation etc.).
  const el = canvasRef.value.querySelector(`.placed-asset-shape[data-id="${hit.id}"]`)
  startMovingAsset(hit, event, el)
  event.preventDefault()
}

const onCanvasMouseMove = (event) => {
  if (!draggedPlacedAsset.value || !canvasRef.value) return

  // Pattern finder background should move freely (no grid snapping).
  if (
    editorMode.value === 'pattern' &&
    draggedPlacedAsset.value.renderW &&
    draggedPlacedAsset.value.renderH
  ) {
    draggedDuringInteraction.value = true

    const canvasRect = canvasRef.value.getBoundingClientRect()

    // Pointer position in canvas-local coords
    const ptrX = event.clientX - canvasRect.left
    const ptrY = event.clientY - canvasRect.top

    // Keep the originally grabbed point under the cursor.
    // Translation = pointer - canvasCenter - grabbedOffset.
    let displayX = ptrX - canvasRect.width / 2
    let displayY = ptrY - canvasRect.height / 2

    if (patternGrab.value) {
      const rot = Number(draggedPlacedAsset.value.rotation || 0)
      const scale = Number(draggedPlacedAsset.value.scale || 1) || 1
      // Convert the stored local point back into screen-space (rotated+scaled)
      const scaledLocal = {
        x: patternGrab.value.localX * scale,
        y: patternGrab.value.localY * scale,
      }
      const screen = rotatePoint(scaledLocal.x, scaledLocal.y, rot)
      displayX = displayX - screen.x
      displayY = displayY - screen.y
    }

    displayX = Math.round(displayX)
    displayY = Math.round(displayY)

    draggedPlacedAsset.value.x = displayX
    draggedPlacedAsset.value.y = displayY
    patternBackground.value.x = displayX
    patternBackground.value.y = displayY

    // still allow trash hover feedback
    if (trashRef.value) {
      const trashRect = trashRef.value.getBoundingClientRect()
      const w = draggedPlacedAsset.value.renderW || 0
      const h = draggedPlacedAsset.value.renderH || 0
      const assetRect = {
        left: canvasRect.left + displayX,
        top: canvasRect.top + displayY,
        right: canvasRect.left + displayX + w,
        bottom: canvasRect.top + displayY + h,
      }
      const intersects = !(
        assetRect.right < trashRect.left ||
        assetRect.left > trashRect.right ||
        assetRect.bottom < trashRect.top ||
        assetRect.top > trashRect.bottom
      )
      draggedOverTrash.value = intersects
    }
    return
  }

  // mark that we're moving an asset (used to suppress click->rotate after drag)
  draggedDuringInteraction.value = true

  const canvasRect = canvasRef.value.getBoundingClientRect()
  const canvasWidth = canvasRect.width
  const canvasHeight = canvasRect.height

  // Get mouse position relative to canvas and compute the raw (unsnapped)
  // desired top-left for the asset so it follows the cursor exactly.
  const rawX = event.clientX - canvasRect.left - dragOffset.value.x
  const rawY = event.clientY - canvasRect.top - dragOffset.value.y

  // Calculate cell dimensions in pixels (use on-screen square cells).
  // Use the rendered canvas width to derive the cell width; keep cells
  // square by making height equal to width. This avoids mixing preset-based
  // sizes with rendered sizes which caused snapping mismatches.
  const cellWidth = canvasWidth / gridColumns.value
  const cellHeight = canvasHeight / Math.max(1, gridRows.value)

  // Compute a snapped anchor.
  // - 1x assets: cell center
  // - 2x assets: grid intersection
  // We don't apply it live (to avoid jumpy dragging); we store it in lastSnap
  // and apply it on mouseup.
  const px = rawX + dragOffset.value.x
  const py = rawY + dragOffset.value.y
  const dragMult = draggedPlacedAsset.value?.multiplier || 1
  const snapAnchor = computeSnapFromPointer(px, py, canvasWidth, canvasHeight, dragMult)
  const snappedX = snapAnchor.x
  const snappedY = snapAnchor.y

  // Store snapped anchor for drop-time application
  // Clamp snapped anchor to canvas bounds so out-of-canvas pointers don't
  // produce anchors outside the visible grid (helps when dragging slightly
  // outside the canvas to the left/top/right/bottom).
  const clampedSnappedX = Math.max(0, Math.min(snappedX, canvasWidth))
  const clampedSnappedY = Math.max(0, Math.min(snappedY, canvasHeight))
  lastSnap.value = { x: clampedSnappedX, y: clampedSnappedY }

  // Determine this asset's effective size (compute from multiplier so it
  // scales with the grid when grid/canvas size changes)
  const currentDraggingAssetSize = getAssetPixelSize(draggedPlacedAsset.value)

  // (debug info removed)

  // Live display follows the raw pointer-based position so the cursor stays
  // locked to the same visual point on the asset while dragging.
  let displayX = rawX
  let displayY = rawY

  // Apply visual per-asset offsets during drag for natural feel (still not
  // overriding pointer alignment)
  if (draggedPlacedAsset.value.offsetX)
    displayX += (draggedPlacedAsset.value.offsetX || 0) * currentDraggingAssetSize
  if (draggedPlacedAsset.value.offsetY)
    displayY += (draggedPlacedAsset.value.offsetY || 0) * currentDraggingAssetSize

  // Round display position (do NOT clamp here so the asset can be dragged outside the canvas)
  displayX = Math.round(displayX)
  displayY = Math.round(displayY)

  draggedPlacedAsset.value.x = displayX
  draggedPlacedAsset.value.y = displayY

  // Keep Pattern finder sliders in sync when dragging the big background
  if (
    editorMode.value === 'pattern' &&
    draggedPlacedAsset.value.renderW &&
    draggedPlacedAsset.value.renderH
  ) {
    patternBackground.value.x = displayX
    patternBackground.value.y = displayY
    // rotation/scale are controlled by sliders; leave them as-is
  }

  // Check intersection with trash while dragging a placed asset
  if (trashRef.value) {
    const trashRect = trashRef.value.getBoundingClientRect()

    // Prefer using the actual element rect if available (handles transforms,
    // masks, and any visual differences between model coords and rendered box).
    let assetRect
    try {
      if (draggedElement.value && draggedElement.value.getBoundingClientRect) {
        const elRect = draggedElement.value.getBoundingClientRect()
        assetRect = {
          left: elRect.left,
          top: elRect.top,
          right: elRect.right,
          bottom: elRect.bottom,
        }
      } else {
        assetRect = {
          left: canvasRect.left + displayX,
          top: canvasRect.top + displayY,
          right: canvasRect.left + displayX + currentDraggingAssetSize,
          bottom: canvasRect.top + displayY + currentDraggingAssetSize,
        }
      }
    } catch (e) {
      assetRect = {
        left: canvasRect.left + displayX,
        top: canvasRect.top + displayY,
        right: canvasRect.left + displayX + currentDraggingAssetSize,
        bottom: canvasRect.top + displayY + currentDraggingAssetSize,
      }
    }

    const intersects = !(
      assetRect.right < trashRect.left ||
      assetRect.left > trashRect.right ||
      assetRect.bottom < trashRect.top ||
      assetRect.top > trashRect.bottom
    )
    draggedOverTrash.value = intersects
    // trash intersection check (no debug log)
  }
}

const onCanvasMouseUp = (event) => {
  // When finishing a drag, apply offsets (if any) and snapping to the final position
  if (draggedPlacedAsset.value) {
    // Only delete if the POINTER is over the trash button at mouseup.
    // This avoids deleting when the asset's visual bbox overlaps the trash but
    // the user didn't actually release the mouse over the trash control.
    if (event && trashRef.value) {
      try {
        const tRect = trashRef.value.getBoundingClientRect()
        const px = event.clientX
        const py = event.clientY
        const pointerOverTrash =
          px >= tRect.left && px <= tRect.right && py >= tRect.top && py <= tRect.bottom
        // update visual flag for consistency
        draggedOverTrash.value = pointerOverTrash
        if (pointerOverTrash) {
          // record previous state so undo can revert the deletion
          pushHistory()
          const idToRemove = draggedPlacedAsset.value.id
          const idxBg = backgroundImages.value.findIndex((a) => a.id === idToRemove)
          const idx = placedAssets.value.findIndex((a) => a.id === idToRemove)
          if (idxBg !== -1) backgroundImages.value.splice(idxBg, 1)
          else if (idx !== -1) placedAssets.value.splice(idx, 1)
          // hide trash and reset flags
          draggedPlacedAsset.value = null
          draggedOverTrash.value = false
          trashVisible.value = false
          return
        }
      } catch (e) {
        console.debug('trash pointer check failed', e)
      }
    }
    const asset = draggedPlacedAsset.value

    // Pattern finder background: keep free-drag position (no snapping)
    if (editorMode.value === 'pattern' && asset.renderW && asset.renderH) {
      // record previous state before finalizing the move so undo can revert
      pushHistory()
      patternBackground.value.x = asset.x || 0
      patternBackground.value.y = asset.y || 0
      // Rebase pivot after drop: any subsequent scale should be around the
      // visible canvas center, not around the last grabbed point.
      // Clearing patternGrab ensures updatePatternBackgroundScale uses local=(0,0)
      // which represents the element center.
      patternGrab.value = null
      try {
        const bg = (backgroundImages.value || []).find((img) => img && img.renderW && img.renderH)
        if (bg) {
          bg.x = patternBackground.value.x
          bg.y = patternBackground.value.y
          bg.scale = patternBackground.value.scale
          bg.rotation = patternBackground.value.rotation
        }
      } catch (e) {
        // ignore
      }
      // stop dragging-out mode
      dragActive.value = false
      if (draggedDuringInteraction.value) {
        justDragged.value = true
        setTimeout(() => (justDragged.value = false), 250)
      }
      draggedDuringInteraction.value = false

      draggedPlacedAsset.value = null
      trashVisible.value = false
      draggedOverTrash.value = false
      draggedElement.value = null
      // remove global listeners if added
      if (moveListenersAdded.value) {
        try {
          if (_globalMoveHandler.fn) window.removeEventListener('mousemove', _globalMoveHandler.fn)
          if (_globalUpHandler.fn) window.removeEventListener('mouseup', _globalUpHandler.fn)
          if (_globalPointerMoveHandler.fn)
            window.removeEventListener('pointermove', _globalPointerMoveHandler.fn)
          if (_globalPointerUpHandler.fn)
            window.removeEventListener('pointerup', _globalPointerUpHandler.fn)
          if (_globalPointerUpHandler.fn)
            window.removeEventListener('pointercancel', _globalPointerUpHandler.fn)
        } catch (e) {
          console.warn('error removing global move listeners', e)
        }
        _globalMoveHandler.fn = null
        _globalUpHandler.fn = null
        _globalPointerMoveHandler.fn = null
        _globalPointerUpHandler.fn = null
        moveListenersAdded.value = false
      }
      return
    }
    // Prefer snapping to the last computed snap anchor (from lastSnap) so the
    // final placement respects the snap mode. However, avoid large jumps that
    // surprise the user: only apply snap if the snap displacement is within a
    // reasonable tolerance (fraction of asset size). Otherwise keep the live
    // dragged position.
    let finalX, finalY
    const displayX = asset.x
    const displayY = asset.y

    // compute the asset's pixel size based on its multiplier so it will
    // change when the grid size is adjusted by the slider
    const currentAssetSize = getAssetPixelSize(asset)
    if (lastSnap.value && typeof lastSnap.value.x === 'number') {
      // Measure canvas now so drop offsets can be computed from the
      // current rendered size (avoid referencing uninitialized canvasRect).
      const canvasRectNow = canvasRef.value.getBoundingClientRect()
      const dropOffsetX =
        (currentAssetSize ===
          Math.round((canvasRectNow.width / gridColumns.value) * assetMultiplier.value) &&
        assetMultiplier.value === 1
          ? asset.offsetX || 0
          : 0) * currentAssetSize
      const dropOffsetY = (asset.offsetY || 0) * currentAssetSize
      let pointerX = event ? event.clientX - canvasRectNow.left : null
      let pointerY = event ? event.clientY - canvasRectNow.top : null
      // Clamp pointer to canvas bounds for snap calculations so we don't
      // accidentally snap to negative or out-of-range anchors when the
      // cursor is slightly outside the canvas during drop.
      if (pointerX !== null && pointerY !== null) {
        pointerX = Math.max(0, Math.min(pointerX, canvasRectNow.width))
        pointerY = Math.max(0, Math.min(pointerY, canvasRectNow.height))
      }

      let snapAnchor = lastSnap.value
      const currentMultiplier = asset.multiplier || assetMultiplier.value || 1
      if (pointerX !== null && pointerY !== null) {
        // For 2x+ intersection snapping we must snap based on the tile's
        // top-left position, not the pointer position (which is typically
        // somewhere inside the tile). Using the pointer can make it feel like
        // snapping is disabled or inconsistent.
        const snapInputX = currentMultiplier > 1 ? displayX : pointerX
        const snapInputY = currentMultiplier > 1 ? displayY : pointerY

        snapAnchor = computeSnapFromPointer(
          snapInputX,
          snapInputY,
          canvasRectNow.width,
          canvasRectNow.height,
          currentMultiplier,
        )
      }

      // Treat snapAnchor differently for assets sized 1x: align to the
      // containing cell top-left so the 1x asset occupies a single cell.
      const cellWidthNow = canvasRectNow.width / gridColumns.value
      const cellHeightNow = canvasRectNow.height / Math.max(1, gridRows.value)
      let snappedTopLeftX, snappedTopLeftY
      if (currentMultiplier === 1) {
        // Center the 1x asset in its target cell.
        snappedTopLeftX = snapAnchor.x - currentAssetSize / 2
        snappedTopLeftY = snapAnchor.y - currentAssetSize / 2
      } else {
        // Uploaded images: for any multiplier > 1, snap TOP-LEFT to a grid
        // intersection so the image occupies whole squares (e.g. 3x3).
        if (asset.isUploaded) {
          const maxCol = Math.max(0, gridColumns.value - currentMultiplier)
          const maxRow = Math.max(0, gridRows.value - currentMultiplier)
          let col = Math.round(snapAnchor.x / cellWidthNow)
          let row = Math.round(snapAnchor.y / cellHeightNow)
          col = Math.max(0, Math.min(maxCol, col))
          row = Math.max(0, Math.min(maxRow, row))
          snappedTopLeftX = col * cellWidthNow
          snappedTopLeftY = row * cellHeightNow
        } else {
          // 2x SVG assets: anchor is an intersection, so place top-left on it
          snappedTopLeftX = snapAnchor.x
          snappedTopLeftY = snapAnchor.y
        }
      }
      const candidateX = snappedTopLeftX + dropOffsetX
      const candidateY = snappedTopLeftY + dropOffsetY

      // Decide to snap based on how close the POINTER was to the snap anchor
      // (not on how far the element would move). Use the recomputed snapAnchor
      // when available so snap is based on the pointer location.
      let shouldSnap = false
      let pointerDist = null
      let moveDist = null
      let snapTolerance = null
      if (pointerX !== null && pointerY !== null) {
        // For 2x+ we compare the tile's top-left to the snap intersection.
        // For 1x we keep using the pointer distance to the cell-center anchor.
        const distX = currentMultiplier > 1 ? displayX : pointerX
        const distY = currentMultiplier > 1 ? displayY : pointerY
        const dxp = distX - snapAnchor.x
        const dyp = distY - snapAnchor.y
        pointerDist = Math.hypot(dxp, dyp)
        // tolerance: snap when pointer is reasonably close to the snap anchor
        const cellWidthNow = canvasRectNow.width / gridColumns.value
        snapTolerance = Math.max(
          8,
          Math.min(currentAssetSize * 0.8, Math.max(cellWidthNow || 0, currentAssetSize * 0.5)),
        )
        shouldSnap = pointerDist <= snapTolerance
      } else {
        // previous fallback: compare candidate vs display position
        const dx = candidateX - displayX
        const dy = candidateY - displayY
        moveDist = Math.hypot(dx, dy)
        snapTolerance = Math.max(8, currentAssetSize * 0.6)
        shouldSnap = moveDist <= snapTolerance
      }

      // Detailed drop-time debug to explain the snap decision
      // drop-time debug removed

      if (shouldSnap) {
        finalX = Math.round(candidateX)
        finalY = Math.round(candidateY)
      } else {
        finalX = Math.round(displayX)
        finalY = Math.round(displayY)
      }
    } else {
      // No snap available — use live dragged position
      finalX = Math.round(displayX)
      finalY = Math.round(displayY)
    }

    // Allow assets to be partially outside the canvas (so they're clipped by the edge).
    // Keep at least 1px visible inside the canvas to avoid fully losing the asset.
    const canvasRect = canvasRef.value.getBoundingClientRect()
    const canvasWidth = canvasRect.width
    const canvasHeight = canvasRect.height
    const minX = -Math.floor(currentAssetSize) + 1
    const minY = -Math.floor(currentAssetSize) + 1
    const maxX = Math.max(1, canvasWidth - 1)
    const maxY = Math.max(1, canvasHeight - 1)

    finalX = Math.max(minX, Math.min(finalX, maxX))
    finalY = Math.max(minY, Math.min(finalY, maxY))

    // record previous state before finalizing the move so undo can revert
    pushHistory()

    asset.x = finalX
    asset.y = finalY
    // stop dragging-out mode
    dragActive.value = false
    // if we moved the asset during this interaction, mark a short-lived flag
    if (draggedDuringInteraction.value) {
      justDragged.value = true
      setTimeout(() => (justDragged.value = false), 250)
    }
    draggedDuringInteraction.value = false
  }

  draggedPlacedAsset.value = null
  // hide trash after interaction
  trashVisible.value = false
  draggedOverTrash.value = false
  // clear stored element ref
  draggedElement.value = null
  // remove global listeners if added
  if (moveListenersAdded.value) {
    try {
      if (_globalMoveHandler.fn) window.removeEventListener('mousemove', _globalMoveHandler.fn)
      if (_globalUpHandler.fn) window.removeEventListener('mouseup', _globalUpHandler.fn)
      if (_globalPointerMoveHandler.fn)
        window.removeEventListener('pointermove', _globalPointerMoveHandler.fn)
      if (_globalPointerUpHandler.fn)
        window.removeEventListener('pointerup', _globalPointerUpHandler.fn)
      if (_globalPointerUpHandler.fn)
        window.removeEventListener('pointercancel', _globalPointerUpHandler.fn)
    } catch (e) {
      console.warn('error removing global move listeners', e)
    }
    _globalMoveHandler.fn = null
    _globalUpHandler.fn = null
    _globalPointerMoveHandler.fn = null
    _globalPointerUpHandler.fn = null
    moveListenersAdded.value = false
  }
}

// Calculate asset size based on grid cell size
const assetSize = computed(() => {
  if (!canvasRef.value) return 100 // fallback value

  const canvasRect = canvasRef.value.getBoundingClientRect()
  if (!canvasRect || canvasRect.width === 0) return 100

  const cellWidth = (canvasRect.width / gridColumns.value) * assetMultiplier.value

  // Asset size is assetMultiplier * the width of one grid square
  return cellWidth
})

// Return the current rendered pixel size for a placed asset.
// This uses the asset's stored multiplier (grid units) and the current
// rendered canvas width so placed assets scale when the grid/canvas size
// changes. Falls back to asset.size or global assetSize if necessary.
const getAssetPixelSize = (asset) => {
  try {
    if (!canvasRef.value) return asset.size || assetSize.value
    const canvasRect = canvasRef.value.getBoundingClientRect()
    if (!canvasRect || canvasRect.width === 0) return asset.size || assetSize.value
    const cellWidthNow = canvasRect.width / gridColumns.value
    // If the asset explicitly stores a multiplier (grid units), use that so
    // the asset scales with the grid. If it's an older asset that only stored
    // an absolute pixel size, preserve that size.
    if (asset.multiplier || asset.multiplier === 0) {
      const mult = asset.multiplier || 1
      return Math.round(cellWidthNow * mult)
    }
    if (asset.size) return asset.size
    return assetSize.value
  } catch (e) {
    return asset.size || assetSize.value
  }
}

// Watch for grid / canvas dimension changes and remove placed assets that
// no longer fit in the new grid (e.g. when scaling reduces columns/rows).
watch(
  () => [
    gridColumns.value,
    gridSize.value,
    currentCanvasPreset.value.width,
    currentCanvasPreset.value.height,
  ],
  () => {
    try {
      if (!canvasRef.value) return
      const canvasRect = canvasRef.value.getBoundingClientRect()
      const canvasWidth = canvasRect.width
      const canvasHeight = canvasRect.height
      const cols = gridColumns.value
      const cellW = canvasWidth / Math.max(1, cols)
      const cellH = cellW
      const rows = Math.max(2, Math.floor(canvasHeight / cellH))

      const pruneList = (list) =>
        list.filter((asset) => {
          const w = getAssetPixelSize(asset)
          const h = w
          const left = asset.x
          const top = asset.y
          const startCol = Math.floor(left / cellW)
          const endCol = Math.floor((left + w - 1) / cellW)
          const startRow = Math.floor(top / cellH)
          const endRow = Math.floor((top + h - 1) / cellH)

          // If asset occupies any cell outside the new grid, drop it.
          if (startCol < 0 || endCol >= cols || startRow < 0 || endRow >= rows) return false
          return true
        })

      const beforeCount = placedAssets.value.length
      const kept = pruneList(placedAssets.value)
      const beforeBgCount = backgroundImages.value.length
      const keptBg = pruneList(backgroundImages.value)

      if (kept.length !== beforeCount || keptBg.length !== beforeBgCount) {
        pushHistory()
        placedAssets.value = kept
        backgroundImages.value = keptBg
      }
    } catch (e) {
      console.warn('error pruning placed assets after grid change', e)
    }
  },
)

// --- Export helpers ----------------------------------------------------
const svgEscape = (str) =>
  String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

// Synchronous SVG builder that references assets by path. Kept for fallback.
// (old synchronous exporter removed — use getExportSVGStringAsync which inlines assets)

// Helper: convert a Blob to a base64 string
const blobToBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const dataUrl = reader.result
      const comma = dataUrl.indexOf(',')
      if (comma === -1) return resolve('')
      resolve(dataUrl.slice(comma + 1))
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })

// Fetch an asset and return a data URL suitable for embedding in the export SVG.
// For SVG assets we fetch text and base64-encode to avoid encoding issues.
const fetchAssetDataUrl = async (path) => {
  try {
    const res = await fetch(path, { cache: 'no-store' })
    if (!res.ok) throw new Error('fetch failed: ' + res.status)
    const contentType = res.headers.get('content-type') || ''
    if (contentType.includes('svg') || path.toLowerCase().endsWith('.svg')) {
      const text = await res.text()
      // base64 encode safely (handle unicode)
      const base64 = btoa(unescape(encodeURIComponent(text)))
      return { type: 'svg', text, dataUrl: `data:image/svg+xml;charset=utf-8;base64,${base64}` }
    }
    // other image types -> blob -> base64
    const blob = await res.blob()
    const base64 = await blobToBase64(blob)
    return { type: 'image', dataUrl: `data:${blob.type};base64,${base64}` }
  } catch (e) {
    console.warn('fetchAssetDataUrl failed for', path, e)
    return { type: 'fallback', dataUrl: path }
  }
}

// Utility: extract inner content and viewBox from an SVG text string
const extractSVGParts = (svgText) => {
  try {
    // remove XML prolog
    const cleaned = svgText.replace(/<\?xml[^>]*\?>/, '')
    const m = cleaned.match(/<svg[^>]*viewBox="([^"]+)"[^>]*>([\s\S]*?)<\/svg>/i)
    if (m) {
      const vb = m[1].trim().split(/\s+/).map(Number)
      const inner = m[2]
      return { minX: vb[0], minY: vb[1], vbW: vb[2], vbH: vb[3], inner }
    }
    // fallback: try width/height attributes
    const m2 = cleaned.match(
      /<svg[^>]*width="([^"]+)"[^>]*height="([^"]+)"[^>]*>([\s\S]*?)<\/svg>/i,
    )
    if (m2) {
      const w = parseFloat(m2[1]) || 100
      const h = parseFloat(m2[2]) || 100
      return { minX: 0, minY: 0, vbW: w, vbH: h, inner: m2[3] }
    }
    // last resort: embed whole text
    return { minX: 0, minY: 0, vbW: 100, vbH: 100, inner: cleaned }
  } catch (e) {
    return { minX: 0, minY: 0, vbW: 100, vbH: 100, inner: svgText }
  }
}

// Robust tinting using DOMParser: parse the SVG, set shape fill/style to the
// chosen color, and serialize back. This avoids brittle regex replacement and
// preserves structure (defs, groups). Works in the browser environment.
const tintSVGWithDOM = (svgText, color) => {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(svgText, 'image/svg+xml')
    const svgEl = doc.documentElement

    // Tags that represent drawable shapes
    const shapeTags = new Set([
      'path',
      'circle',
      'rect',
      'ellipse',
      'polygon',
      'polyline',
      'line',
      'text',
      'use',
    ])

    // Remove internal <style> blocks (they may contain class-based fills)
    // and strip class attributes so stylesheet rules can't override our
    // presentation attributes. This ensures the forced fill/stroke we set
    // is the one used during export.
    try {
      const styles = svgEl.getElementsByTagName('style')
      // convert HTMLCollection to array to avoid live collection issues
      const stylesArr = Array.from(styles || [])
      stylesArr.forEach((s) => {
        s.parentNode && s.parentNode.removeChild(s)
      })
    } catch (e) {
      // ignore
    }

    // Force exact color on shapes: set fill and stroke to the chosen color
    // (unless explicitly 'none'), and ensure opacities are set to 1 so the
    // exported raster matches the exact hex. Also replace gradient/url refs.
    const walker = doc.createTreeWalker(svgEl, NodeFilter.SHOW_ELEMENT, null)
    let node = walker.currentNode
    while (node) {
      try {
        // remove class so selectors in removed styles don't apply
        try {
          if (node.hasAttribute && node.hasAttribute('class')) node.removeAttribute('class')
        } catch (e) {}
        const tag = node.tagName && String(node.tagName).toLowerCase()

        // Replace fill attributes and remove gradient/url references
        const curFill = node.getAttribute && node.getAttribute('fill')
        if (curFill && /url\(/i.test(curFill)) {
          node.setAttribute('fill', color)
        }

        // For shape tags, enforce fill/stroke values
        if (shapeTags.has(tag)) {
          const cur = node.getAttribute && node.getAttribute('fill')
          if (!cur || String(cur).toLowerCase() !== 'none') {
            node.setAttribute('fill', color)
          }
          // force stroke to match color unless explicitly 'none'
          const curStroke = node.getAttribute && node.getAttribute('stroke')
          if (!curStroke || String(curStroke).toLowerCase() !== 'none') {
            node.setAttribute('stroke', color)
          }

          // ensure full opacity so color appears exactly as chosen
          node.setAttribute('fill-opacity', '1')
          node.setAttribute('stroke-opacity', '1')
        }

        // Update any inline style declarations affecting fill/stroke/opacities
        const st = node.getAttribute && node.getAttribute('style')
        if (st) {
          let replaced = st
            .replace(/fill\s*:\s*[^;]+;?/gi, `fill: ${color};`)
            .replace(/stroke\s*:\s*[^;]+;?/gi, `stroke: ${color};`)
            .replace(/fill-opacity\s*:\s*[^;]+;?/gi, `fill-opacity: 1;`)
            .replace(/stroke-opacity\s*:\s*[^;]+;?/gi, `stroke-opacity: 1;`)
          node.setAttribute('style', replaced)
        }

        // If the node references a paint server (gradient) in any attribute,
        // replace that reference with the solid color to guarantee exact tint.
        ;['fill', 'stroke'].forEach((attr) => {
          try {
            const v = node.getAttribute && node.getAttribute(attr)
            if (v && /url\(/i.test(v)) node.setAttribute(attr, color)
          } catch (e) {}
        })
      } catch (e) {
        // ignore per-node errors
      }
      node = walker.nextNode()
    }

    // Serialize all child nodes of the original svg (preserves <defs> and
    // other support elements so geometry/clipping remain intact).
    const serializer = new XMLSerializer()
    let inner = ''
    for (let i = 0; i < svgEl.childNodes.length; i++) {
      const ch = svgEl.childNodes[i]
      inner += serializer.serializeToString(ch)
    }
    return inner
  } catch (e) {
    return svgText
  }
}

// Async SVG builder that inlines asset files as data URLs so the exported
// SVG is self-contained and can be rasterized without external requests/CORS.
const getExportSVGStringAsync = async () => {
  if (!canvasRef.value) return null
  const canvasRect = canvasRef.value.getBoundingClientRect()
  const renderedW = canvasRect.width
  const renderedH = canvasRect.height
  const exportW = currentCanvasPreset.value.width
  const exportH = currentCanvasPreset.value.height
  const scale = exportW / renderedW

  let svg = `<?xml version="1.0" encoding="utf-8"?>\n`
  // include an empty defs placeholder so we can inject masks/defs later
  svg +=
    `<svg xmlns="http://www.w3.org/2000/svg" width="${exportW}" height="${exportH}" viewBox="0 0 ${exportW} ${exportH}">\n` +
    `<defs/>\n`
  svg += `<rect x="0" y="0" width="${exportW}" height="${exportH}" fill="${svgEscape(
    selectedBackgroundColor.value,
  )}"/>\n`

  // Background images (uploaded) are rendered first so they sit under assets.
  for (const a of backgroundImages.value) {
    const rx = (a.x || 0) * scale
    const ry = (a.y || 0) * scale
    const rw = getAssetPixelSize(a) * scale
    const rh = rw
    const rotation = a.rotation || 0
    const cx = rx + rw / 2
    const cy = ry + rh / 2
    const href = a.dataUrl || a.path
    svg += `<g transform="rotate(${rotation} ${cx} ${cy})">\n`
    svg += `<image href="${svgEscape(href)}" x="${rx}" y="${ry}" width="${rw}" height="${rh}" preserveAspectRatio="xMidYMid meet" />\n`
    svg += `</g>\n`
  }

  // Build each asset; fetch and inline its data URL first
  let defs = ''
  let idx = 0
  for (const a of placedAssets.value) {
    const rx = (a.x || 0) * scale
    const ry = (a.y || 0) * scale
    const assetSizeRendered = getAssetPixelSize(a)
    const rw = assetSizeRendered * scale
    const rh = rw
    const rotation = a.rotation || 0
    const cx = rx + rw / 2
    const cy = ry + rh / 2

    // Keep export positioning consistent with on-screen rendering.
    // We no longer use per-asset snapType-based mask positioning.
    const preserveAspect = 'xMidYMid meet'

    let fetched = null
    try {
      fetched = await fetchAssetDataUrl(a.path)
    } catch (e) {
      console.warn('inline fetch failed', a.path, e)
      fetched = { type: 'fallback', dataUrl: a.path }
    }

    if (fetched && fetched.type === 'svg' && typeof fetched.text === 'string') {
      // Inline SVG markup and tint it by replacing fills/styles. This gives
      // more predictable color results than masking a rasterized SVG image.
      const parts = extractSVGParts(fetched.text)
      // Tint using DOM parser to reliably replace fills/styles
      const tintedInner = tintSVGWithDOM(fetched.text, selectedAssetColor.value)

      // Embed the SVG inside its own <svg> element positioned at rx,ry and
      // sized to rw/rh. Use preserveAspectRatio so aspect is preserved like
      // the on-screen rendering ('xMidYMid meet'). Rotation is applied on the
      // outer group so behavior remains consistent.
      svg += `<g transform="rotate(${rotation} ${cx} ${cy})">\n`
      svg += `<svg x="${rx}" y="${ry}" width="${rw}" height="${rh}" viewBox="${parts.minX} ${parts.minY} ${parts.vbW} ${parts.vbH}" preserveAspectRatio="${preserveAspect}">\n`
      svg += `${tintedInner}\n`
      svg += `</svg>\n</g>\n`
    } else if (fetched && fetched.type === 'image') {
      // raster image: draw directly
      svg += `<g transform="rotate(${rotation} ${cx} ${cy})">\n`
      svg += `<image href="${svgEscape(fetched.dataUrl)}" x="${rx}" y="${ry}" width="${rw}" height="${rh}" preserveAspectRatio="${preserveAspect}" />\n`
      svg += `</g>\n`
    } else {
      // fallback: draw with provided path or dataUrl
      const href = fetched && fetched.dataUrl ? fetched.dataUrl : a.path
      svg += `<g transform="rotate(${rotation} ${cx} ${cy})">\n`
      svg += `<image href="${svgEscape(href)}" x="${rx}" y="${ry}" width="${rw}" height="${rh}" preserveAspectRatio="${preserveAspect}" />\n`
      svg += `</g>\n`
    }
    idx++
  }
  if (defs) svg = svg.replace('<defs/>', `<defs>${defs}</defs>`) // insert defs if any

  svg += `</svg>`
  return svg
}

const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

const exportAsSVG = async () => {
  // Use the async builder to inline assets so the resulting SVG is self-contained.
  const svgString = await getExportSVGStringAsync()
  if (!svgString) return
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
  downloadBlob(blob, `${currentCanvasPreset.value.name || 'canvas'}.svg`)
}

const exportRasterFromSVG = async (type = 'image/png', quality = 0.92) => {
  // Build an inlined SVG (assets embedded) and rasterize it to a data URL.
  const svgString = await getExportSVGStringAsync()
  if (!svgString) return null
  const exportW = currentCanvasPreset.value.width
  const exportH = currentCanvasPreset.value.height
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    await new Promise((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = (e) => reject(e)
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = exportW
    canvas.height = exportH
    const ctx = canvas.getContext('2d')
    // White background for JPG (SVG may be transparent)
    if (type === 'image/jpeg') {
      ctx.fillStyle = selectedBackgroundColor.value || '#ffffff'
      ctx.fillRect(0, 0, exportW, exportH)
    }
    ctx.drawImage(img, 0, 0, exportW, exportH)
    const dataUrl = canvas.toDataURL(type, quality)
    URL.revokeObjectURL(url)
    return dataUrl
  } catch (e) {
    URL.revokeObjectURL(url)
    console.error('exportRasterFromSVG failed', e)
    return null
  }
}

const exportAsPNG = async () => {
  const dataUrl = await exportRasterFromSVG('image/png')
  if (!dataUrl) return
  // convert dataURL to blob
  const res = await fetch(dataUrl)
  const blob = await res.blob()
  downloadBlob(blob, `${currentCanvasPreset.value.name || 'canvas'}.png`)
}

const exportAsJPG = async () => {
  const dataUrl = await exportRasterFromSVG('image/jpeg', 0.92)
  if (!dataUrl) return
  const res = await fetch(dataUrl)
  const blob = await res.blob()
  downloadBlob(blob, `${currentCanvasPreset.value.name || 'canvas'}.jpg`)
}

const exportAsPDF = async () => {
  // Generate a raster image of the export SVG and embed it into a PDF using jsPDF.
  // The PDF will be sized to the preset (native) pixel dimensions so the result
  // matches the canvas export resolution.
  const dataUrl = await exportRasterFromSVG('image/jpeg', 0.92)
  if (!dataUrl) return

  try {
    const exportW = currentCanvasPreset.value.width
    const exportH = currentCanvasPreset.value.height

    // Create a PDF with point units matching pixels by using 'px' and a custom format
    const orientation = exportW >= exportH ? 'landscape' : 'portrait'
    const pdf = new jsPDF({ orientation, unit: 'px', format: [exportW, exportH] })

    // Choose image format based on the data URL (we requested JPEG)
    // Add the image covering the full page
    pdf.addImage(dataUrl, 'JPEG', 0, 0, exportW, exportH)

    const filename = `${currentCanvasPreset.value.name || 'canvas'}.pdf`
    pdf.save(filename)
  } catch (e) {
    console.error('exportAsPDF failed', e)
    // Fallback: open print window if PDF generation fails
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(
      '<!doctype html><html><head><title>Print</title></head><body style="margin:0">',
    )
    w.document.write('<img src="' + dataUrl + '" style="width:100%;height:auto;display:block"/>')
    w.document.write('</body></html>')
    w.document.close()
  }
}

// --- Uploaded images (user-provided raster assets) ---------------------
const uploadedImages = ref([]) // [{ name, dataUrl, isUploaded }]
const uploadInputRef = ref(null)

const onUploadImage = (e) => {
  const files = e.target.files
  if (!files || !files.length) return
  for (const file of files) {
    const reader = new FileReader()
    reader.onload = (ev) => {
      uploadedImages.value.push({
        name: file.name,
        path: ev.target.result,
        dataUrl: ev.target.result,
        isUploaded: true,
      })
    }
    reader.readAsDataURL(file)
  }
  // reset so the same file can be re-uploaded if needed
  e.target.value = ''
}

const removeUploadedImage = (img) => {
  const idx = uploadedImages.value.indexOf(img)
  if (idx !== -1) uploadedImages.value.splice(idx, 1)
}

// --- Rotate a placed asset 90 degrees clockwise on click
const rotateAsset = (asset) => {
  // record state before rotation so it can be undone
  pushHistory()
  asset.rotation = ((asset.rotation || 0) + 90) % 360
}

// Handle asset click while suppressing clicks that immediately follow a drag.
// This prevents accidental rotations when the user releases after moving an asset.
const onAssetClick = (asset, event) => {
  // If we detected a drag during this interaction, ignore the click.
  if (draggedDuringInteraction.value) return
  // Also ignore very recent drags (short-lived flag set on mouseup)
  if (justDragged.value) return

  // Otherwise perform rotation
  rotateAsset(asset)
}

const handlePresetChange = (event) => {
  const selectedPreset = canvasDimensions.find((preset) => preset.name === event.target.value)
  if (selectedPreset) {
    pushHistory()
    currentCanvasPreset.value = selectedPreset
  }
}

// (Generator type UI removed)

// Randomize pattern according to current rules:
// - 1x tiles snap to cell centers
// - 2x tiles snap to grid intersections
// - Rotation is randomized among 0/90/180/270
// - The previous canvas state is pushed to history so undo works
const randomizePattern = () => {
  try {
    if (!canvasRef.value) return
    const canvasRect = canvasRef.value.getBoundingClientRect()
    const canvasWidth = canvasRect.width
    const canvasHeight = canvasRect.height

    const cols = gridColumns.value
    // Use the reactive gridRows to match the visual grid rather than
    // re-deriving rows from cell width; compute cell dimensions from
    // both canvas width/columns and canvas height/rows so placements
    // match the rendered grid even when cells are not perfect squares.
    const rows = gridRows.value
    const cellW = canvasWidth / cols
    const cellH = canvasHeight / Math.max(1, rows)

    const newPlaced = []

    // grid of placed asset names used to enforce adjacency rules
    const nameGrid = Array.from({ length: rows }, () => Array(cols).fill(null))

    // Check whether placing an asset of 'name' at top-left cell (r,c) with
    // multiplier mult would create runs of more than 2 identical assets in a
    // straight horizontal or vertical line. Returns true if allowed.
    const canPlaceWithAdjacencyLimit = (name, r, c, mult) => {
      // iterate over all cells the asset would occupy
      const cells = []
      for (let dr = 0; dr < mult; dr++) {
        for (let dc = 0; dc < mult; dc++) {
          const rr = r + dr
          const cc = c + dc
          if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) return false
          cells.push([rr, cc])
        }
      }

      // helper to count same-name contiguous in a direction
      const countLine = (startR, startC, dirR, dirC) => {
        let cnt = 0
        let rr = startR + dirR
        let cc = startC + dirC
        while (rr >= 0 && rr < rows && cc >= 0 && cc < cols && nameGrid[rr][cc] === name) {
          cnt++
          rr += dirR
          cc += dirC
        }
        return cnt
      }

      // For each cell the asset would occupy, ensure horizontal and vertical
      // line lengths (including this cell) would not exceed 2
      for (const [rr, cc] of cells) {
        // horizontal: count left + right
        const left = countLine(rr, cc, 0, -1)
        const right = countLine(rr, cc, 0, 1)
        if (1 + left + right > 2) return false
        // vertical: up + down
        const up = countLine(rr, cc, -1, 0)
        const down = countLine(rr, cc, 1, 0)
        if (1 + up + down > 2) return false
      }

      return true
    }

    // helper for overlap test
    const rectsOverlap = (r1, r2) => {
      return !(
        r1.x + r1.w <= r2.x ||
        r2.x + r2.w <= r1.x ||
        r1.y + r1.h <= r2.y ||
        r2.y + r2.h <= r1.y
      )
    }

    const pool = generatorAssets.value
    if (!pool || !pool.length) return

    if (patternMode.value === 'checkerboard') {
      // Create a checkerboard/tiling pattern where cells alternate between 1x and 2x.
      // We iterate cells top-left to bottom-right and place tiles, reserving 2x blocks
      // when they fit. This produces more regular, repeatable patterns like the example.
      // pick a random density for this run so gaps vary between clicks
      // narrower range for more harmonious fills (35%..80%)
      const density = 0.35 + Math.random() * 0.45
      // random parity so repeated clicks produce different checkerboard offsets
      const parity = Math.random() < 0.5 ? 0 : 1
      // Choose a dominant asset for this run to create visual coherence
      const dominantAsset = pool[Math.floor(Math.random() * pool.length)]
      const dominantBias = 0.22 // chance to pick the dominant asset (reduced to avoid repetition)
      const repeatBias = 0.08 // smaller chance to repeat last placed asset
      let lastChosen = null
      let lastChosenCount = 0
      const occupied = Array.from({ length: rows }, () => Array(cols).fill(false))

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          if (occupied[row][col]) continue

          // allow empty cells based on the randomly chosen density for this run
          if (Math.random() > density) {
            // leave this cell empty
            continue
          }

          // prefer 2x on one checker color (parity flips each call)
          const wantTwo = (row + col + parity) % 2 === 0

          // default placement tile coordinates (may be shifted for 2x assets)
          let placeCol = col
          let placeRow = row

          let mult = 1
          if (wantTwo) {
            // prefer 2x when the 2x block fits starting at the current cell
            if (col < cols - 1 && row < rows - 1) {
              if (
                !occupied[row][col] &&
                !occupied[row][col + 1] &&
                !occupied[row + 1][col] &&
                !occupied[row + 1][col + 1]
              ) {
                mult = 2
              }
            }
          }

          // choose asset with bias towards the dominantAsset and occasional repetition
          let a = null
          const r = Math.random()
          if (r < dominantBias) {
            a = dominantAsset
          } else if (lastChosen && r < dominantBias + repeatBias) {
            a = lastChosen
          } else {
            a = pool[Math.floor(Math.random() * pool.length)]
          }

          // avoid long runs of the same asset: if we've already placed the same
          // asset twice recently, force-pick a different one to increase variety
          if (lastChosen && a && a === lastChosen) {
            lastChosenCount++
          } else {
            lastChosenCount = 0
          }
          if (lastChosenCount >= 2) {
            const alternatives = pool.filter((it) => it !== lastChosen)
            if (alternatives.length)
              a = alternatives[Math.floor(Math.random() * alternatives.length)]
            lastChosenCount = 0
          }

          lastChosen = a
          // Generator rule: Star may NEVER be 1x when auto-generating.
          // If it can't fit as a 2x tile, we skip placing a Star here.
          if (a && a.name === 'Star') {
            let found = false
            const tryOffsets = [
              [0, 0],
              [-1, 0],
              [0, -1],
              [-1, -1],
            ]
            for (const off of tryOffsets) {
              const r0 = row + off[1]
              const c0 = col + off[0]
              if (r0 >= 0 && c0 >= 0 && r0 < rows - 1 && c0 < cols - 1) {
                if (
                  !occupied[r0][c0] &&
                  !occupied[r0][c0 + 1] &&
                  !occupied[r0 + 1][c0] &&
                  !occupied[r0 + 1][c0 + 1]
                ) {
                  mult = 2
                  placeRow = r0
                  placeCol = c0
                  found = true
                  break
                }
              }
            }
            if (!found) continue
          }
          const left = placeCol * cellW
          const top = placeRow * cellH

          // compute rendered asset pixel size using the shared helper so
          // assets scale consistently with manual placement
          const assetSizePx = getAssetPixelSize({ ...a, multiplier: mult })
          const dropOffsetX = (mult === 1 ? a.offsetX || 0 : 0) * assetSizePx
          const dropOffsetY = (a.offsetY || 0) * assetSizePx

          // If we selected a 2x placement candidate earlier (for Star),
          // adjust the anchor/left/top so the asset covers the chosen
          // two-by-two tile block and remove the temporary markers.
          if (mult === 2 && a.__placeColCandidate !== undefined) {
            const placeCol = a.__placeColCandidate
            const placeRow = a.__placeRowCandidate
            // center of the 2x block
            anchorX = placeCol * cellW + (cellW * 2) / 2
            anchorY = placeRow * cellH + (cellH * 2) / 2
            left = placeCol * cellW
            top = placeRow * cellH
            try {
              delete a.__placeColCandidate
              delete a.__placeRowCandidate
            } catch (e) {
              a.__placeColCandidate = undefined
              a.__placeRowCandidate = undefined
            }
          }

          // Multiplier-based snapping (matches manual placement)
          const snapAnchor = computeSnapFromPointer(
            left + cellW / 2,
            top + cellH / 2,
            canvasWidth,
            canvasHeight,
            mult,
          )

          let finalX, finalY
          if (mult > 1) {
            finalX = Math.round(snapAnchor.x + dropOffsetX)
            finalY = Math.round(snapAnchor.y + dropOffsetY)
          } else {
            finalX = Math.round(snapAnchor.x - assetSizePx / 2 + dropOffsetX)
            finalY = Math.round(snapAnchor.y - assetSizePx / 2 + dropOffsetY)
          }

          // Allow assets to be partially outside the canvas (clipped at edge),
          // using the same rule as manual dragging: keep at least 1px visible.
          const minX = -Math.floor(assetSizePx) + 1
          const minY = -Math.floor(assetSizePx) + 1
          const maxX = Math.max(1, canvasWidth - 1)
          const maxY = Math.max(1, canvasHeight - 1)
          finalX = Math.max(minX, Math.min(finalX, maxX))
          finalY = Math.max(minY, Math.min(finalY, maxY))

          // check overlap against existing newPlaced (shouldn't happen when we honor occupied)
          const candidateRect = { x: finalX, y: finalY, w: assetSizePx, h: assetSizePx }
          let overlaps = false
          for (const placed of newPlaced) {
            const placedRect = {
              x: placed.x,
              y: placed.y,
              w: Math.round(cellW * (placed.multiplier || 1)),
              h: Math.round(cellW * (placed.multiplier || 1)),
            }
            if (rectsOverlap(candidateRect, placedRect)) {
              overlaps = true
              break
            }
          }
          if (overlaps) continue

          // enforce adjacency rule: no more than 2 identical assets in a line
          if (!canPlaceWithAdjacencyLimit(a.name, placeRow, placeCol, mult)) continue

          // bias rotation toward 0/180 for harmony; occasionally allow 90/270
          const rrot = Math.random()
          let rotation
          if (rrot < 0.8) {
            rotation = [0, 180][Math.floor(Math.random() * 2)]
          } else {
            rotation = [90, 270][Math.floor(Math.random() * 2)]
          }

          newPlaced.push({
            ...a,
            x: finalX,
            y: finalY,
            rotation,
            id: Date.now() + Math.floor(Math.random() * 100000),
            multiplier: mult,
          })

          // mark occupied cells for mult
          if (mult === 2) {
            occupied[placeRow][placeCol] = true
            occupied[placeRow][placeCol + 1] = true
            occupied[placeRow + 1][placeCol] = true
            occupied[placeRow + 1][placeCol + 1] = true
            // mark name grid
            nameGrid[placeRow][placeCol] = a.name
            nameGrid[placeRow][placeCol + 1] = a.name
            nameGrid[placeRow + 1][placeCol] = a.name
            nameGrid[placeRow + 1][placeCol + 1] = a.name
          } else {
            occupied[placeRow][placeCol] = true
            nameGrid[placeRow][placeCol] = a.name
          }
        }
      }
    } else {
      // random mode: keep previous non-overlapping randomized placing
      // random mode: use a slightly randomized density for moderate fill
      const density = 0.22 + Math.random() * 0.4
      for (let col = 0; col < cols; col++) {
        for (let row = 0; row < rows; row++) {
          if (Math.random() > density) continue

          // pick a random asset from palette
          // small chance to favor a recent asset for some clustering
          const a = pool[Math.floor(Math.random() * pool.length)]
          if (!a) continue

          // Base cell origin; may be adjusted later if we pick a 2x candidate.
          let left = col * cellW
          let top = row * cellH

          // Compute a snap anchor based on multiplier (1x center, 2x intersection)
          // after mult is chosen and after any Star candidate adjustments.
          let anchorX = left + cellW / 2
          let anchorY = top + cellH / 2

          // choose multiplier per asset (randomly 1x or 2x).
          // Generator rule: Star may NEVER be 1x when auto-generating.
          let mult = Math.random() < 0.5 ? 1 : 2
          if (a && a.name === 'Star') {
            // try to fit a 2x block at (col,row) or by shifting left/up one
            // cell. We'll test candidate top-lefts and pick the first that
            // fits within bounds and doesn't overlap existing placements.
            const tryOffsets = [
              [0, 0],
              [-1, 0],
              [0, -1],
              [-1, -1],
            ]
            let found = false
            for (const off of tryOffsets) {
              const r0 = row + off[1]
              const c0 = col + off[0]
              if (r0 >= 0 && c0 >= 0 && r0 < rows - 1 && c0 < cols - 1) {
                // compute tentative rect for this 2x placement
                const leftCand = c0 * cellW
                const topCand = r0 * cellH
                const assetSizeCand = getAssetPixelSize({ ...a, multiplier: 2 })
                const candRect = { x: leftCand, y: topCand, w: assetSizeCand, h: assetSizeCand }
                // check overlap against already-selected placements
                let overlaps = false
                for (const placed of newPlaced) {
                  const placedRect = {
                    x: placed.x,
                    y: placed.y,
                    w: Math.round(cellW * (placed.multiplier || 1)),
                    h: Math.round(cellW * (placed.multiplier || 1)),
                  }
                  if (rectsOverlap(candRect, placedRect)) {
                    overlaps = true
                    break
                  }
                }
                if (!overlaps) {
                  mult = 2
                  // shift anchor so we place centered over the 2x block
                  // by updating the snap anchor center below (we'll recompute)
                  // store the chosen top-left in placeCol/placeRow below by
                  // reusing the loop variables via closure (we'll set them now)
                  // to be applied after assetSizePx is computed.
                  // We'll write placeCol/placeRow into variables defined later
                  // via temporary properties on 'a' to carry through.
                  a.__placeRowCandidate = r0
                  a.__placeColCandidate = c0
                  found = true
                  break
                }
              }
            }
            if (!found) continue
          }

          // compute size and offsets using per-asset multiplier
          const assetSizePx = getAssetPixelSize({ ...a, multiplier: mult })
          const dropOffsetX = (mult === 1 ? a.offsetX || 0 : 0) * assetSizePx
          const dropOffsetY = (a.offsetY || 0) * assetSizePx

          // If the random-mode candidate earlier recorded a preferred 2x
          // top-left for Star, apply it here so the final placement snaps
          // to the two-by-two tile block and stays aligned with the grid.
          if (mult === 2 && a.__placeColCandidate !== undefined) {
            const placeCol = a.__placeColCandidate
            const placeRow = a.__placeRowCandidate
            // center of 2x block
            anchorX = placeCol * cellW + (cellW * 2) / 2
            anchorY = placeRow * cellH + (cellH * 2) / 2
            left = placeCol * cellW
            top = placeRow * cellH
            try {
              delete a.__placeColCandidate
              delete a.__placeRowCandidate
            } catch (e) {
              a.__placeColCandidate = undefined
              a.__placeRowCandidate = undefined
            }
          }

          // Multiplier-based snapping (matches manual placement)
          const snapAnchor = computeSnapFromPointer(
            left + cellW / 2,
            top + cellH / 2,
            canvasWidth,
            canvasHeight,
            mult,
          )

          let finalX, finalY
          if (mult > 1) {
            finalX = Math.round(snapAnchor.x + dropOffsetX)
            finalY = Math.round(snapAnchor.y + dropOffsetY)
          } else {
            finalX = Math.round(snapAnchor.x - assetSizePx / 2 + dropOffsetX)
            finalY = Math.round(snapAnchor.y - assetSizePx / 2 + dropOffsetY)
          }

          // Allow assets to be partially outside the canvas (clipped at edge),
          // keep at least 1px visible like manual dragging behavior.
          const minX = -Math.floor(assetSizePx) + 1
          const minY = -Math.floor(assetSizePx) + 1
          const maxX = Math.max(1, canvasWidth - 1)
          const maxY = Math.max(1, canvasHeight - 1)
          finalX = Math.max(minX, Math.min(finalX, maxX))
          finalY = Math.max(minY, Math.min(finalY, maxY))

          // Check for overlap with already selected placements. We disallow any
          // intersection (assets may touch edges but not overlap area).
          const candidateRect = { x: finalX, y: finalY, w: assetSizePx, h: assetSizePx }
          let overlaps = false
          for (const placed of newPlaced) {
            const placedRect = {
              x: placed.x,
              y: placed.y,
              w: Math.round(cellW * (placed.multiplier || 1)),
              h: Math.round(cellW * (placed.multiplier || 1)),
            }
            if (rectsOverlap(candidateRect, placedRect)) {
              overlaps = true
              break
            }
          }
          if (overlaps) {
            // skip placement to avoid overlap
            continue
          }

          // Determine the candidate top-left for adjacency checks (handles any prior candidate markers)
          const candidateTopRow =
            mult === 2 && a.__placeRowCandidate !== undefined ? a.__placeRowCandidate : row
          const candidateLeftCol =
            mult === 2 && a.__placeColCandidate !== undefined ? a.__placeColCandidate : col

          // adjacency rule: no more than 2 identical shapes in a straight line
          if (!canPlaceWithAdjacencyLimit(a.name, candidateTopRow, candidateLeftCol, mult)) {
            // if we set temporary candidates, clean them up so later logic isn't confused
            if (a.__placeRowCandidate !== undefined) {
              try {
                delete a.__placeRowCandidate
                delete a.__placeColCandidate
              } catch (e) {
                a.__placeRowCandidate = undefined
                a.__placeColCandidate = undefined
              }
            }
            continue
          }

          // bias rotation for harmony (mostly 0/180)
          const rrot = Math.random()
          const rotation =
            rrot < 0.8
              ? [0, 180][Math.floor(Math.random() * 2)]
              : [90, 270][Math.floor(Math.random() * 2)]

          newPlaced.push({
            ...a,
            x: finalX,
            y: finalY,
            rotation,
            id: Date.now() + Math.floor(Math.random() * 100000),
            multiplier: mult,
          })
          // mark name grid
          if (mult === 2) {
            const r0 = candidateTopRow
            const c0 = candidateLeftCol
            nameGrid[r0][c0] = a.name
            nameGrid[r0][c0 + 1] = a.name
            nameGrid[r0 + 1][c0] = a.name
            nameGrid[r0 + 1][c0 + 1] = a.name
            // clear temporary markers if any
            if (a.__placeRowCandidate !== undefined) {
              try {
                delete a.__placeRowCandidate
                delete a.__placeColCandidate
              } catch (e) {
                a.__placeRowCandidate = undefined
                a.__placeColCandidate = undefined
              }
            }
          } else {
            nameGrid[candidateTopRow][candidateLeftCol] = a.name
          }
        }
      }
    }

    // record previous state so undo works
    pushHistory()
    placedAssets.value = newPlaced
  } catch (e) {
    console.error('randomizePattern failed', e)
  }
}
</script>

<template>
  <div class="w-full h-screen maingrid">
    <!-- UI Section -->
    <div class="bg-white m-1 sidebar">
      <h1 class="font-object font-bold text-xl ml-3 mb-4 mt-1">Stupid Generator</h1>
      <div class="ml-3 mt-3 toggle-container font-object font-regular">
        <div class="mode-toggle" role="tablist" aria-label="Mode">
          <button
            type="button"
            class="mode-toggle-btn"
            :class="{ active: editorMode === 'sandbox' }"
            @click="setEditorMode('sandbox')"
          >
            Sandbox
          </button>
          <button
            type="button"
            class="mode-toggle-btn"
            :class="{ active: editorMode === 'pattern' }"
            @click="setEditorMode('pattern')"
          >
            Pattern finder
          </button>
        </div>
      </div>

      <div class="ml-3 mt-8">
        <div class="font-object font-medium text-base">Canvas presets</div>
        <select
          @change="handlePresetChange"
          :value="currentCanvasPreset.name"
          class="font-object font-regular p-1 border-2 w-[95%] rounded cursor-pointer savebutton"
        >
          <option v-for="preset in canvasDimensions" :key="preset.name" :value="preset.name">
            {{ preset.name }} ({{ preset.width }} x {{ preset.height }}px)
          </option>
        </select>

        <div v-if="editorMode === 'sandbox'">
          <h2 class="font-object font-medium text-base mt-8">Grid size</h2>
          <div class="slidecontainer gridsize">
            <input type="range" min="2" max="10" v-model="gridSize" class="slider" id="myRange" />
            <p class="font-object text-sm mt-1">{{ gridSize }}</p>
          </div>
        </div>

        <h2 class="font-object font-medium text-base mt-10">Colors</h2>
        <p class="font-object text-xs mb-2 text-gray-500">Click to change colors, and to invert.</p>
        <div class="color-presets">
          <button
            v-for="preset in colorPresets"
            :key="preset.name"
            class="color-button"
            :class="{
              selected:
                preset.bg === selectedBackgroundColor && preset.asset === selectedAssetColor,
            }"
            @click="selectColorPreset(preset)"
            :title="preset.name"
          >
            <div
              class="color-swatch"
              :style="{
                background:
                  'linear-gradient(90deg, ' + preset.bg + ' 50%, ' + preset.asset + ' 50%)',
              }"
            ></div>
          </button>
          <button
            class="invert-button"
            @click="invertColors"
            title="Swap background and asset color"
          >
            ↔
          </button>
        </div>

        <!-- Hidden real file input for uploading SVG assets (always rendered so both modes can open the picker) -->
        <input
          ref="uploadSvgInputRef"
          type="file"
          accept="image/svg+xml,.svg"
          multiple
          class="hidden"
          @change="onUploadSvgAsset"
        />

        <!-- Sandbox-only UI: assets palette + pattern randomizer -->
        <div v-if="editorMode === 'sandbox'">
          <h2 class="font-object font-medium text-base mt-10">Assets</h2>
          <p class="font-object text-xs mb-4 text-gray-500">
            Click to spawn centered. Drag to move.
          </p>
          <p class="font-object text-xs mb-2 text-gray-900">Chose size</p>
          <div class="flex gap-2 mb-4">
            <button
              @click="changeAssetSize(1)"
              :class="[
                'sizebutton px-2 border-2 cursor-pointer',
                { active: assetMultiplier === 1 },
              ]"
            >
              x1
            </button>
            <button
              @click="changeAssetSize(2)"
              :class="[
                'sizebutton px-2 border-2 cursor-pointer',
                { active: assetMultiplier === 2 },
              ]"
            >
              x2
            </button>

            <button
              class="uploadbutton savebutton font-object font-regular px-2 border-2 rounded cursor-pointer"
              @click.prevent="openUploadSvgPicker"
            >
              + Upload asset
            </button>
          </div>
          <div class="assets-container grid grid-cols-4 mb-4">
            <div
              v-for="asset in assets"
              :key="asset.name"
              draggable="true"
              @dragstart="startDrag(asset, $event)"
              @dragend="onDragEnd"
              @click.prevent="onPaletteAssetClick(asset)"
              class="asset-button relative"
              :title="asset.name"
            >
              <img :src="asset.path" :alt="asset.name" class="asset-icon" />
            </div>
          </div>

          <!-- Uploaded SVG assets (same behavior as predefined assets) -->
          <div v-if="uploadedSvgAssets.length" class="assets-container grid grid-cols-4 mb-4">
            <div
              v-for="asset in uploadedSvgAssets"
              :key="asset.name + asset.path"
              draggable="true"
              @dragstart="startDrag(asset, $event)"
              @dragend="onDragEnd"
              @click.prevent="onPaletteAssetClick(asset)"
              class="asset-button uploaded-thumb relative"
              :title="asset.name"
            >
              <img :src="asset.path" :alt="asset.name" class="asset-icon" />
              <button
                class="remove-uploaded"
                @click.stop="removeUploadedSvgAsset(asset)"
                title="Remove"
              >
                ×
              </button>
            </div>
          </div>

          <button
            class="savebutton pattern-randomizer ont-object font-regular p-1 border-2 rounded cursor-pointer w-[95%]"
            @click.prevent="randomizePattern"
          >
            Pattern Randomizer
          </button>
        </div>

        <!-- Pattern finder-only UI -->
        <div v-else class="mt-10">
          <!-- pattern finder content goes here -->
          <h2 class="font-object font-medium text-base mt-10">Upload SVG</h2>
          <p class="font-object text-xs mb-3 text-gray-500">
            Upload svg to be able to drag around.
          </p>
          <button class="svgupload cursor-pointer" @click.prevent="openUploadSvgPicker">
            + Upload SVG
          </button>

          <h2 class="font-object font-medium text-base mt-10">Background controls</h2>

          <div class="mt-3">
            <div class="font-object text-xs mb-1 text-gray-700">
              Scale: {{ patternBackground.scale.toFixed(2) }}
            </div>
            <input
              type="range"
              min="0.1"
              max="3"
              step="0.01"
              v-model.number="patternBackground.scale"
              class="slider w-[95%]"
              @input="
                () => {
                  updatePatternBackgroundScale(patternBackground.scale)
                }
              "
            />
          </div>

          <div class="mt-4">
            <div class="font-object text-xs mb-1 text-gray-700">
              X: {{ Math.round(patternBackground.x) }}
            </div>
            <input
              type="range"
              min="-6000"
              max="6000"
              step="1"
              v-model.number="patternBackground.x"
              class="slider w-[95%]"
              @input="
                () => {
                  const bg = backgroundImages[0]
                  if (bg && bg.renderW && bg.renderH) bg.x = patternBackground.x
                }
              "
            />
          </div>

          <div class="mt-4">
            <div class="font-object text-xs mb-1 text-gray-700">
              Y: {{ Math.round(patternBackground.y) }}
            </div>
            <input
              type="range"
              min="-6000"
              max="6000"
              step="1"
              v-model.number="patternBackground.y"
              class="slider w-[95%]"
              @input="
                () => {
                  const bg = backgroundImages[0]
                  if (bg && bg.renderW && bg.renderH) bg.y = patternBackground.y
                }
              "
            />
          </div>

          <div class="mt-4">
            <div class="font-object text-xs mb-1 text-gray-700">
              Rotation: {{ Math.round(patternBackground.rotation) }}°
            </div>
            <input
              type="range"
              min="-180"
              max="180"
              step="1"
              v-model.number="patternBackground.rotation"
              class="slider w-[95%]"
              @input="
                () => {
                  const bg = backgroundImages[0]
                  if (bg && bg.renderW && bg.renderH) bg.rotation = patternBackground.rotation
                }
              "
            />
          </div>
        </div>
      </div>
      <!-- Uploaded images section (sandbox only) -->
      <div v-if="editorMode === 'sandbox'" class="ml-3 mt-4">
        <h2 class="font-object font-medium text-base mt-10">Upload image</h2>
        <p class="font-object text-xs mb-3 text-gray-500">
          Click to upload, drag to add, <strong>hold alt/option down and drag to move.</strong>
        </p>

        <p class="font-object text-xs mb-2 text-gray-900">Chose size</p>
        <div class="flex gap-2 mb-4">
          <button
            @click="changeBackgroundImageSize(1)"
            :class="[
              'sizebutton px-2 border-2 cursor-pointer',
              { active: backgroundImageMultiplier === 1 },
            ]"
          >
            1
          </button>
          <button
            @click="changeBackgroundImageSize(2)"
            :class="[
              'sizebutton px-2 border-2 cursor-pointer',
              { active: backgroundImageMultiplier === 2 },
            ]"
          >
            2
          </button>
          <button
            @click="changeBackgroundImageSize(3)"
            :class="[
              'sizebutton px-2 border-2 cursor-pointer',
              { active: backgroundImageMultiplier === 3 },
            ]"
          >
            3
          </button>
          <button
            @click="changeBackgroundImageSize(4)"
            :class="[
              'sizebutton px-2 border-2 cursor-pointer',
              { active: backgroundImageMultiplier === 4 },
            ]"
          >
            4
          </button>
        </div>

        <!-- Hidden real file input -->
        <input
          ref="uploadInputRef"
          type="file"
          accept="image/*"
          multiple
          class="hidden"
          @change="onUploadImage"
        />

        <!-- Styled upload button matching other buttons -->
        <button
          class="savebutton uploadimg font-object font-regular p-1 border-2 w-[95%] rounded cursor-pointer mb-3"
          @click.prevent="uploadInputRef.click()"
        >
          + Upload image
        </button>

        <!-- Grid of uploaded image thumbnails -->
        <div v-if="uploadedImages.length" class="assets-container grid grid-cols-4 mb-4">
          <div
            v-for="img in uploadedImages"
            :key="img.name + img.dataUrl"
            class="asset-button uploaded-thumb relative"
            draggable="true"
            @dragstart="startDrag(img, $event)"
            @dragend="onDragEnd"
            @click.prevent="spawnAssetCentered(img)"
            :title="img.name"
          >
            <img :src="img.dataUrl" :alt="img.name" class="asset-icon object-cover rounded" />
            <!-- small remove × button -->
            <button class="remove-uploaded" @click.stop="removeUploadedImage(img)" title="Remove">
              ×
            </button>
          </div>
        </div>
      </div>
      <div class="ml-3 mt-8">
        <h2 class="font-object font-medium text-base mt-10 mb-2">Save as</h2>
        <div class="flex gap-2 mb-4">
          <button class="savebutton px-2 cursor-pointer" @click.prevent="exportAsPDF">PDF</button>
          <button class="savebutton px-2 cursor-pointer" @click.prevent="exportAsSVG">SVG</button>
          <button class="savebutton px-2 cursor-pointer" @click.prevent="exportAsPNG">PNG</button>
          <button class="savebutton px-2 cursor-pointer" @click.prevent="exportAsJPG">JPG</button>
        </div>
      </div>
    </div>

    <!-- Canvas Section -->
    <div class="canvas m-2">
      <div class="canvas-wrapper">
        <div
          ref="canvasRef"
          :style="[canvasStyle, { backgroundColor: selectedBackgroundColor }]"
          :class="{ 'dragging-out': dragActive }"
          class="canvas-preset"
          @dragover="onDragOver"
          @drop="onDrop"
          @pointerdown="onCanvasPointerDown"
          @pointermove="onCanvasPointerMove"
          @pointerup="onCanvasPointerUp"
          @pointercancel="onCanvasPointerUp"
          @mousemove="onCanvasMouseMove"
          @mouseup="onCanvasMouseUp"
          @mouseleave="onCanvasMouseUp"
        >
          <!-- Background images layer (under assets) -->
          <div
            class="background-layer"
            @pointerdown="onAssetsLayerPointerDown($event)"
            @dragover.stop.prevent="onOverlayDragOver"
            @drop.stop.prevent="onOverlayDrop"
          >
            <template v-for="img in backgroundImages" :key="img.id">
              <!-- Pattern finder background SVG: render as a tinted mask so it's always visible -->
              <div
                v-if="img.renderW && img.renderH && (img.dataUrl || img.path)"
                class="placed-asset-shape pattern-bg-shape"
                draggable="false"
                :class="{ dragging: draggedPlacedAsset && draggedPlacedAsset.id === img.id }"
                :data-id="img.id"
                @click="onAssetClick(img, $event)"
                :style="{
                  left: canvasCenterCss.left,
                  top: canvasCenterCss.top,
                  width: img.renderW + 'px',
                  height: img.renderH + 'px',
                  background: selectedAssetColor,
                  WebkitMaskImage: `url(${img.dataUrl || img.path})`,
                  maskImage: `url(${img.dataUrl || img.path})`,
                  WebkitMaskSize: 'contain',
                  maskSize: 'contain',
                  WebkitMaskRepeat: 'no-repeat',
                  maskRepeat: 'no-repeat',
                  WebkitMaskPosition: 'center',
                  maskPosition: 'center',
                  // Keep pivot locked to the visible canvas center.
                  // x/y are translation offsets from that center.
                  transform: `translate(-50%, -50%) translate(${img.x || 0}px, ${img.y || 0}px) rotate(${img.rotation || 0}deg) scale(${img.scale || 1})`,
                  transformOrigin: 'center center',
                  opacity: 1,
                }"
              />

              <!-- Normal uploaded images: render as images (existing behavior) -->
              <img
                v-else
                class="placed-asset-shape placed-uploaded"
                draggable="false"
                :class="{ dragging: draggedPlacedAsset && draggedPlacedAsset.id === img.id }"
                :data-id="img.id"
                :src="img.dataUrl || img.path"
                :alt="img.name"
                @click="onAssetClick(img, $event)"
                :style="{
                  left: (img.x || 0) + 'px',
                  top: (img.y || 0) + 'px',
                  width: getAssetPixelSize(img) + 'px',
                  height: getAssetPixelSize(img) + 'px',
                  transform: `rotate(${img.rotation || 0}deg)`,
                  transformOrigin: 'center center',
                  objectFit: 'contain',
                }"
              />
            </template>
          </div>

          <div v-if="editorMode !== 'pattern'" :style="gridStyle" class="grid-container">
            <div v-for="cell in gridCells" :key="cell" class="grid-cell"></div>
          </div>

          <!-- Placed assets layer (SVG assets only) -->
          <div
            class="assets-layer"
            @pointerdown="onAssetsLayerPointerDown($event)"
            @dragover.stop.prevent="onOverlayDragOver"
            @drop.stop.prevent="onOverlayDrop"
          >
            <div
              v-for="asset in placedAssets"
              :key="asset.id"
              class="placed-asset-shape"
              :class="{ dragging: draggedPlacedAsset && draggedPlacedAsset.id === asset.id }"
              :data-id="asset.id"
              @click="onAssetClick(asset, $event)"
              :style="{
                left: asset.x + 'px',
                top: asset.y + 'px',
                width: getAssetPixelSize(asset) + 'px',
                height: getAssetPixelSize(asset) + 'px',
                background: selectedAssetColor,
                WebkitMaskImage: `url(${asset.path})`,
                maskImage: `url(${asset.path})`,
                WebkitMaskSize: 'contain',
                maskSize: 'contain',
                WebkitMaskRepeat: 'no-repeat',
                maskRepeat: 'no-repeat',
                WebkitMaskPosition: 'center',
                maskPosition: 'center',
                transform: `rotate(${asset.rotation || 0}deg)`,
                transformOrigin: 'center center',
              }"
            />
          </div>
        </div>
        <!-- Trash positioned absolutely inside canvas-wrapper so it doesn't affect layout -->
        <div
          ref="trashRef"
          class="trash"
          :class="{ visible: trashVisible, over: draggedOverTrash }"
          @dragover.prevent="onTrashDragOver"
          @dragleave="onTrashDragLeave"
          @drop="onTrashDrop"
        >
          <img width="20px" src="/Icons/trash.svg" alt="" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped></style>

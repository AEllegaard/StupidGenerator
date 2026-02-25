<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
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

// Assets definition with snap type
const assets = [
  { name: 'Circle', path: '/Assets/Circle.svg', snapType: 'intersection' }, // snaps to grid intersections
  { name: 'Corner', path: '/Assets/Corner.svg', snapType: 'corner', offsetY: -0.001 }, // snaps to cell corners
  { name: 'Quarter Circle', path: '/Assets/Quarter_circle.svg', snapType: 'corner' },
  {
    name: 'Half Circle',
    path: '/Assets/Half_circle.svg',
    snapType: 'edge',
    //offsetX: 0.49,
    offsetY: -0.001,
  }, // snaps to cell edges; offsetX = fraction of asset width
  {
    name: 'Star',
    path: '/Assets/Star.svg',
    snapType: 'intersection',
    offsetX: -0.005,
    offsetY: -0.009,
  },
]

const currentCanvasPreset = ref(canvasDimensions[0])
const gridSize = ref(5)
const placedAssets = ref([]) // Array to store placed assets on canvas
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

onMounted(() => window.addEventListener('keydown', onKeyDown))
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

// Helper: compute snapped anchor (in canvas pixels) for a given pointer position
const computeSnapFromPointer = (pointerX, pointerY, snapType, canvasWidth, canvasHeight) => {
  // Derive on-screen square cell size from the rendered canvas width so the
  // snapping grid matches what the user sees. Avoid using preset-derived
  // gridRows which may be based on different units.
  const cellWidth = canvasWidth / gridColumns.value
  const cellHeight = cellWidth

  let snappedX = pointerX
  let snappedY = pointerY

  if (snapType === 'intersection') {
    snappedX = Math.round(pointerX / cellWidth) * cellWidth
    snappedY = Math.round(pointerY / cellHeight) * cellHeight
  } else if (snapType === 'edge') {
    const leftEdge = Math.floor(pointerX / cellWidth) * cellWidth
    const rightEdge = Math.ceil(pointerX / cellWidth) * cellWidth
    const topEdge = Math.floor(pointerY / cellHeight) * cellHeight
    const bottomEdge = Math.ceil(pointerY / cellHeight) * cellHeight
    const midpoints = [
      { x: (leftEdge + rightEdge) / 2, y: topEdge },
      { x: (leftEdge + rightEdge) / 2, y: bottomEdge },
      { x: leftEdge, y: (topEdge + bottomEdge) / 2 },
      { x: rightEdge, y: (topEdge + bottomEdge) / 2 },
    ]
    let minDistance = Infinity
    let closestMid = midpoints[0]
    midpoints.forEach((pt) => {
      const distance = Math.hypot(pointerX - pt.x, pointerY - pt.y)
      if (distance < minDistance) {
        minDistance = distance
        closestMid = pt
      }
    })
    snappedX = closestMid.x
    snappedY = closestMid.y
  } else {
    const leftEdge = Math.floor(pointerX / cellWidth) * cellWidth
    const rightEdge = Math.ceil(pointerX / cellWidth) * cellWidth
    const topEdge = Math.floor(pointerY / cellHeight) * cellHeight
    const bottomEdge = Math.ceil(pointerY / cellHeight) * cellHeight
    const corners = [
      { x: leftEdge, y: topEdge },
      { x: rightEdge, y: topEdge },
      { x: leftEdge, y: bottomEdge },
      { x: rightEdge, y: bottomEdge },
    ]
    let minDistance = Infinity
    let closestCorner = corners[0]
    corners.forEach((corner) => {
      const distance = Math.hypot(pointerX - corner.x, pointerY - corner.y)
      if (distance < minDistance) {
        minDistance = distance
        closestCorner = corner
      }
    })
    snappedX = closestCorner.x
    snappedY = closestCorner.y
  }

  return { x: snappedX, y: snappedY }
}

// Drag and drop functions
const startDrag = (asset, event) => {
  draggedAsset.value = asset
  event.dataTransfer.effectAllowed = 'copy'
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
  if (!draggedAsset.value || !canvasRef.value) return

  const canvasRect = canvasRef.value.getBoundingClientRect()
  const canvasWidth = canvasRect.width
  const canvasHeight = canvasRect.height

  // Get drop position relative to canvas
  const x = event.clientX - canvasRect.left
  const y = event.clientY - canvasRect.top

  // Calculate cell dimensions in pixels
  const cellWidth = canvasWidth / gridColumns.value
  const cellHeight = canvasHeight / gridRows.value

  let snappedX, snappedY

  if (draggedAsset.value.snapType === 'intersection') {
    // Snap to grid intersections (corners where cells meet)
    snappedX = Math.round(x / cellWidth) * cellWidth
    snappedY = Math.round(y / cellHeight) * cellHeight
  } else if (draggedAsset.value.snapType === 'edge') {
    // Snap to nearest edge midpoint of the current cell
    const leftEdge = Math.floor(x / cellWidth) * cellWidth
    const rightEdge = Math.ceil(x / cellWidth) * cellWidth
    const topEdge = Math.floor(y / cellHeight) * cellHeight
    const bottomEdge = Math.ceil(y / cellHeight) * cellHeight

    const midpoints = [
      { x: (leftEdge + rightEdge) / 2, y: topEdge }, // top middle
      { x: (leftEdge + rightEdge) / 2, y: bottomEdge }, // bottom middle
      { x: leftEdge, y: (topEdge + bottomEdge) / 2 }, // left middle
      { x: rightEdge, y: (topEdge + bottomEdge) / 2 }, // right middle
    ]

    // Find the closest midpoint
    let minDistance = Infinity
    let closestMid = midpoints[0]

    midpoints.forEach((pt) => {
      const distance = Math.hypot(x - pt.x, y - pt.y)
      if (distance < minDistance) {
        minDistance = distance
        closestMid = pt
      }
    })

    snappedX = closestMid.x
    snappedY = closestMid.y
  } else {
    // Snap to cell corners (edge of individual cells)
    // Find which cell corner is closest
    const leftEdge = Math.floor(x / cellWidth) * cellWidth
    const rightEdge = Math.ceil(x / cellWidth) * cellWidth
    const topEdge = Math.floor(y / cellHeight) * cellHeight
    const bottomEdge = Math.ceil(y / cellHeight) * cellHeight

    // Calculate distances to all four corners of the current cell
    const corners = [
      { x: leftEdge, y: topEdge },
      { x: rightEdge, y: topEdge },
      { x: leftEdge, y: bottomEdge },
      { x: rightEdge, y: bottomEdge },
    ]

    // Find the closest corner
    let minDistance = Infinity
    let closestCorner = corners[0]

    corners.forEach((corner) => {
      const distance = Math.hypot(x - corner.x, y - corner.y)
      if (distance < minDistance) {
        minDistance = distance
        closestCorner = corner
      }
    })

    snappedX = closestCorner.x
    snappedY = closestCorner.y
  }

  // Adjust placement for snap types.
  // Use current canvas cell width and the selected multiplier so the new
  // placed asset will scale with the grid when the slider changes.
  const currentMultiplier = assetMultiplier.value || 1
  const currentAssetSize = Math.round(cellWidth * currentMultiplier)
  const dropOffsetX = (draggedAsset.value.offsetX || 0) * currentAssetSize
  const dropOffsetY = (draggedAsset.value.offsetY || 0) * currentAssetSize

  // Compute top-left so the asset is centered on the snap anchor. For 1x
  // assets snap to the containing cell top-left so they occupy exactly one
  // cell; larger assets are centered on the snap anchor.
  let finalX, finalY
  if (currentMultiplier === 1) {
    const col = Math.max(0, Math.min(gridColumns.value - 1, Math.floor(snappedX / cellWidth)))
    const row = Math.max(0, Math.min(gridRows.value - 1, Math.floor(snappedY / cellWidth)))
    finalX = col * cellWidth
    finalY = row * cellWidth
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

  placedAssets.value.push({
    ...draggedAsset.value,
    x: finalX,
    y: finalY,
    rotation: 0,
    id: Date.now(),
    multiplier: currentMultiplier,
  })
  // hide trash after a successful drop on canvas
  trashVisible.value = false
  draggedOverTrash.value = false

  draggedAsset.value = null
}

// Spawn an asset at the visual center of the canvas. This respects the
// asset's snapType by computing a snap anchor at the canvas center and then
// centering the asset on that anchor (plus any per-asset fractional offsets).
const spawnAssetCentered = (asset) => {
  if (!canvasRef.value) return
  try {
    const canvasRect = canvasRef.value.getBoundingClientRect()
    const canvasWidth = canvasRect.width
    const canvasHeight = canvasRect.height

    // Center point in canvas coordinates
    const centerX = canvasWidth / 2
    const centerY = canvasHeight / 2

    // Compute snap anchor using the helper so corner/edge/intersection
    // behavior matches dropping via pointer.
    const snapAnchor = computeSnapFromPointer(
      centerX,
      centerY,
      asset.snapType,
      canvasWidth,
      canvasHeight,
    )

    const currentMultiplier = assetMultiplier.value || 1
    const cellWidth = canvasWidth / gridColumns.value
    const currentAssetSize = Math.round(cellWidth * currentMultiplier)
    const dropOffsetX = (asset.offsetX || 0) * currentAssetSize
    const dropOffsetY = (asset.offsetY || 0) * currentAssetSize

    // Align placement depending on multiplier: 1x assets snap to a cell
    // top-left so they occupy exactly one cell; larger assets are centered
    // on the snap anchor.
    let finalX, finalY
    if (currentMultiplier === 1) {
      const col = Math.max(0, Math.min(gridColumns.value - 1, Math.floor(snapAnchor.x / cellWidth)))
      const row = Math.max(0, Math.min(gridRows.value - 1, Math.floor(snapAnchor.y / cellWidth)))
      finalX = Math.round(col * cellWidth + dropOffsetX)
      finalY = Math.round(row * cellWidth + dropOffsetY)
    } else {
      finalX = Math.round(snapAnchor.x - currentAssetSize / 2 + dropOffsetX)
      finalY = Math.round(snapAnchor.y - currentAssetSize / 2 + dropOffsetY)
    }

    // Clamp so the asset remains at least partially visible inside canvas
    finalX = Math.max(0, Math.min(finalX, canvasWidth - currentAssetSize))
    finalY = Math.max(0, Math.min(finalY, canvasHeight - currentAssetSize))

    pushHistory()
    placedAssets.value.push({
      ...asset,
      x: finalX,
      y: finalY,
      rotation: 0,
      id: Date.now(),
      multiplier: currentMultiplier,
    })
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
const lastSnap = ref({ x: 0, y: 0 })
const draggedDuringInteraction = ref(false)
const justDragged = ref(false)
const trashRef = ref(null)
const trashVisible = ref(false)
const draggedOverTrash = ref(false)
const draggedElement = ref(null) // store the actual DOM element being dragged
const _globalMoveHandler = { fn: null }
const _globalUpHandler = { fn: null }
const moveListenersAdded = ref(false)
const dragActive = ref(false)

// Asset size multiplier: 1 = one grid square wide, 2 = two grid squares wide
const assetMultiplier = ref(2)

const changeAssetSize = (mult) => {
  // Accept only 1 or 2 for now; ignore invalid values
  if (mult !== 1 && mult !== 2) return
  assetMultiplier.value = mult
}

// Pattern generation mode: 'random' (existing), 'checkerboard' (alternating 1x/2x tiles)
// Default to checkerboard so the single Pattern Randomizer button creates
// the tiled motif similar to the provided example.
const patternMode = ref('checkerboard')

const startMovingAsset = (asset, event, el = null) => {
  draggedPlacedAsset.value = asset

  const canvasRect = canvasRef.value.getBoundingClientRect()
  const mouseX = event.clientX - canvasRect.left
  const mouseY = event.clientY - canvasRect.top

  // Prefer computing drag offset from the element's actual bounding rect
  // (accounts for SVG viewBox, internal padding, rotation, mask centering).
  // Fallback to using stored asset.x/asset.y if element rect isn't provided.
  try {
    if (el && el.getBoundingClientRect) {
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
  dragActive.value = true
  // attach global listeners so we can continue dragging outside the canvas
  if (!moveListenersAdded.value) {
    _globalMoveHandler.fn = (e) => onCanvasMouseMove(e)
    _globalUpHandler.fn = (e) => onCanvasMouseUp(e)
    window.addEventListener('mousemove', _globalMoveHandler.fn)
    window.addEventListener('mouseup', _globalUpHandler.fn)
    moveListenersAdded.value = true
  }
}

// Delegated mousedown handler on the assets-layer so every placed asset is draggable
const onAssetsLayerMouseDown = (event) => {
  const el = event.target.closest && event.target.closest('.placed-asset-shape')
  if (!el) return
  const id = el.dataset && el.dataset.id
  if (!id) return
  const found = placedAssets.value.find((a) => String(a.id) === String(id))
  if (!found) return
  // Debug/logging: show coordinates and element rect to diagnose offset issues
  // debug block removed

  // Delegate to startMovingAsset with the original mouse event and the
  // actual element so we can compute a pixel-accurate drag offset.
  startMovingAsset(found, event, el)
  // prevent text selection / default drag behaviour
  event.preventDefault()
}

const onCanvasMouseMove = (event) => {
  if (!draggedPlacedAsset.value || !canvasRef.value) return

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
  const cellHeight = cellWidth

  // Compute the snapped anchor for the pointer position but do NOT apply it
  // to the live display. We save it in lastSnap so snapping can be applied on
  // mouseup (this preserves pointer alignment during drag and prevents
  // visual jumps for assets with odd viewBoxes like the Star).
  let snappedX, snappedY
  if (draggedPlacedAsset.value.snapType === 'intersection') {
    snappedX = Math.round((rawX + dragOffset.value.x) / cellWidth) * cellWidth
    snappedY = Math.round((rawY + dragOffset.value.y) / cellHeight) * cellHeight
  } else if (draggedPlacedAsset.value.snapType === 'edge') {
    const px = rawX + dragOffset.value.x
    const py = rawY + dragOffset.value.y
    const leftEdge = Math.floor(px / cellWidth) * cellWidth
    const rightEdge = Math.ceil(px / cellWidth) * cellWidth
    const topEdge = Math.floor(py / cellHeight) * cellHeight
    const bottomEdge = Math.ceil(py / cellHeight) * cellHeight
    const midpoints = [
      { x: (leftEdge + rightEdge) / 2, y: topEdge },
      { x: (leftEdge + rightEdge) / 2, y: bottomEdge },
      { x: leftEdge, y: (topEdge + bottomEdge) / 2 },
      { x: rightEdge, y: (topEdge + bottomEdge) / 2 },
    ]
    let minDistance = Infinity
    let closestMid = midpoints[0]
    midpoints.forEach((pt) => {
      const distance = Math.hypot(px - pt.x, py - pt.y)
      if (distance < minDistance) {
        minDistance = distance
        closestMid = pt
      }
    })
    snappedX = closestMid.x
    snappedY = closestMid.y
  } else {
    const px = rawX + dragOffset.value.x
    const py = rawY + dragOffset.value.y
    const leftEdge = Math.floor(px / cellWidth) * cellWidth
    const rightEdge = Math.ceil(px / cellWidth) * cellWidth
    const topEdge = Math.floor(py / cellHeight) * cellHeight
    const bottomEdge = Math.ceil(py / cellHeight) * cellHeight
    const corners = [
      { x: leftEdge, y: topEdge },
      { x: rightEdge, y: topEdge },
      { x: leftEdge, y: bottomEdge },
      { x: rightEdge, y: bottomEdge },
    ]
    let minDistance = Infinity
    let closestCorner = corners[0]
    corners.forEach((corner) => {
      const distance = Math.hypot(px - corner.x, py - corner.y)
      if (distance < minDistance) {
        minDistance = distance
        closestCorner = corner
      }
    })
    snappedX = closestCorner.x
    snappedY = closestCorner.y
  }

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

  // Extended debug info (temporary) to help diagnose snapping issues
  // debug information removed

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
  // When finishing a drag, apply offsets (if any) and the 'corner' correction to the final position
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
          const idx = placedAssets.value.findIndex((a) => a.id === idToRemove)
          if (idx !== -1) placedAssets.value.splice(idx, 1)
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
      const dropOffsetX = (asset.offsetX || 0) * currentAssetSize
      const dropOffsetY = (asset.offsetY || 0) * currentAssetSize

      // Recompute the snap anchor from the actual pointer for 'corner' snaps.
      // Some SVGs have internal viewBox/mask offsets that make the element's
      // bounding box differ from the pointer position; using the pointer to
      // recompute the corner anchor avoids landing several cells away.
      const canvasRectNow = canvasRef.value.getBoundingClientRect()
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
      if (asset.snapType === 'corner' && pointerX !== null && pointerY !== null) {
        snapAnchor = computeSnapFromPointer(
          pointerX,
          pointerY,
          asset.snapType,
          canvasRectNow.width,
          canvasRectNow.height,
        )
      }

      // Treat snapAnchor differently for assets sized 1x: align to the
      // containing cell top-left so the 1x asset occupies a single cell.
      const currentMultiplier = asset.multiplier || assetMultiplier.value || 1
      const cellWidthNow = canvasRectNow.width / gridColumns.value
      let snappedTopLeftX, snappedTopLeftY
      if (currentMultiplier === 1) {
        const col = Math.max(
          0,
          Math.min(gridColumns.value - 1, Math.floor(snapAnchor.x / cellWidthNow)),
        )
        const row = Math.max(
          0,
          Math.min(gridRows.value - 1, Math.floor(snapAnchor.y / cellWidthNow)),
        )
        snappedTopLeftX = col * cellWidthNow
        snappedTopLeftY = row * cellWidthNow
      } else {
        // center the asset on the anchor for larger sizes
        snappedTopLeftX = snapAnchor.x - currentAssetSize / 2
        snappedTopLeftY = snapAnchor.y - currentAssetSize / 2
      }
      const candidateX = snappedTopLeftX + dropOffsetX
      const candidateY = snappedTopLeftY + dropOffsetY

      // Decide to snap based on how close the POINTER was to the snap anchor
      // (not on how far the element would move). Use the recomputed snapAnchor
      // when available so corner snaps are based on the pointer location.
      let shouldSnap = false
      let pointerDist = null
      let moveDist = null
      let snapTolerance = null
      if (pointerX !== null && pointerY !== null) {
        const dxp = pointerX - snapAnchor.x
        const dyp = pointerY - snapAnchor.y
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
    } catch (e) {
      console.warn('error removing global move listeners', e)
    }
    _globalMoveHandler.fn = null
    _globalUpHandler.fn = null
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
      return `data:image/svg+xml;charset=utf-8;base64,${base64}`
    }
    // other image types -> blob -> base64
    const blob = await res.blob()
    const base64 = await blobToBase64(blob)
    return `data:${blob.type};base64,${base64}`
  } catch (e) {
    console.warn('fetchAssetDataUrl failed for', path, e)
    // fallback to original path so the exporter may still try to resolve it
    return path
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
  svg += `<svg xmlns="http://www.w3.org/2000/svg" width="${exportW}" height="${exportH}" viewBox="0 0 ${exportW} ${exportH}">\n`
  svg += `<rect x="0" y="0" width="${exportW}" height="${exportH}" fill="${svgEscape(
    selectedBackgroundColor.value,
  )}"/>\n`

  // Build each asset; fetch and inline its data URL first
  for (const a of placedAssets.value) {
    const rx = (a.x || 0) * scale
    const ry = (a.y || 0) * scale
    const rw = getAssetPixelSize(a) * scale
    const rh = rw
    const rotation = a.rotation || 0
    const cx = rx + rw / 2
    const cy = ry + rh / 2

    let href = a.path
    try {
      href = await fetchAssetDataUrl(a.path)
    } catch (e) {
      console.warn('inline fetch failed', a.path, e)
      href = a.path
    }

    svg += `<g transform="rotate(${rotation} ${cx} ${cy})">\n`
    svg += `<image href="${svgEscape(href)}" x="${rx}" y="${ry}" width="${rw}" height="${rh}" preserveAspectRatio="xMidYMid meet" />\n`
    svg += `</g>\n`
  }

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

// Rotate a placed asset 90 degrees clockwise on click
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
// - Places assets according to their snapType (intersection/edge/corner)
// - New assets respect the current assetMultiplier (this matches spawn/drop behavior)
// - Rotation is randomized among 0/90/180/270
// - The previous canvas state is pushed to history so undo works
const randomizePattern = () => {
  try {
    if (!canvasRef.value) return
    const canvasRect = canvasRef.value.getBoundingClientRect()
    const canvasWidth = canvasRect.width
    const canvasHeight = canvasRect.height

    const cols = gridColumns.value
    const rows = gridRows.value
    const cellW = canvasWidth / cols
    const cellH = cellW

    const newPlaced = []

    // helper for overlap test
    const rectsOverlap = (r1, r2) => {
      return !(
        r1.x + r1.w <= r2.x ||
        r2.x + r2.w <= r1.x ||
        r1.y + r1.h <= r2.y ||
        r2.y + r2.h <= r1.y
      )
    }

    if (patternMode.value === 'checkerboard') {
      // Create a checkerboard/tiling pattern where cells alternate between 1x and 2x.
      // We iterate cells top-left to bottom-right and place tiles, reserving 2x blocks
      // when they fit. This produces more regular, repeatable patterns like the example.
      // random parity so repeated clicks produce different checkerboard offsets
      const parity = Math.random() < 0.5 ? 0 : 1
      const occupied = Array.from({ length: rows }, () => Array(cols).fill(false))

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          if (occupied[row][col]) continue

          // prefer 2x on one checker color (parity flips each call)
          const wantTwo = (row + col + parity) % 2 === 0

          let mult = 1
          if (wantTwo && col < cols - 1 && row < rows - 1) {
            // ensure the 2x block's 4 cells are free
            if (
              !occupied[row][col] &&
              !occupied[row][col + 1] &&
              !occupied[row + 1][col] &&
              !occupied[row + 1][col + 1]
            ) {
              mult = 2
            }
          }

          // choose an asset randomly from preferred pools so layout varies each run
          const bigNames = ['Half Circle', 'Quarter Circle', 'Circle']
          const smallNames = ['Quarter Circle', 'Corner', 'Circle']
          let a = null
          if (mult === 2) {
            const candidates = assets.filter((it) => bigNames.includes(it.name))
            if (candidates.length) a = candidates[Math.floor(Math.random() * candidates.length)]
          }
          if (!a) {
            const candidates = assets.filter((it) => smallNames.includes(it.name))
            if (candidates.length) a = candidates[Math.floor(Math.random() * candidates.length)]
          }
          // fallback to any asset
          if (!a) a = assets[Math.floor(Math.random() * assets.length)]
          const left = col * cellW
          const top = row * cellH

          const assetSizePx = Math.round(cellW * mult)
          const dropOffsetX = (a.offsetX || 0) * assetSizePx
          const dropOffsetY = (a.offsetY || 0) * assetSizePx

          let finalX = Math.round(left + dropOffsetX)
          let finalY = Math.round(top + dropOffsetY)

          // For 2x we anchor top-left so tiles align neatly
          finalX = Math.max(0, Math.min(finalX, canvasWidth - assetSizePx))
          finalY = Math.max(0, Math.min(finalY, canvasHeight - assetSizePx))

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

          const rotationOptions = [0, 90, 180, 270]
          const rotation = rotationOptions[Math.floor(Math.random() * rotationOptions.length)]

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
            occupied[row][col] = true
            occupied[row][col + 1] = true
            occupied[row + 1][col] = true
            occupied[row + 1][col + 1] = true
          } else {
            occupied[row][col] = true
          }
        }
      }
    } else {
      // random mode: keep previous non-overlapping randomized placing
      const density = 0.18
      for (let col = 0; col < cols; col++) {
        for (let row = 0; row < rows; row++) {
          if (Math.random() > density) continue

          // pick a random asset from palette
          const a = assets[Math.floor(Math.random() * assets.length)]
          if (!a) continue

          // compute anchor depending on snapType
          const left = col * cellW
          const top = row * cellH
          let anchorX = left
          let anchorY = top

          if (a.snapType === 'intersection') {
            anchorX = left
            anchorY = top
          } else if (a.snapType === 'edge') {
            const side = Math.floor(Math.random() * 4)
            switch (side) {
              case 0: // top middle
                anchorX = left + cellW / 2
                anchorY = top
                break
              case 1: // bottom middle
                anchorX = left + cellW / 2
                anchorY = top + cellH
                break
              case 2: // left middle
                anchorX = left
                anchorY = top + cellH / 2
                break
              default: // right middle
                anchorX = left + cellW
                anchorY = top + cellH / 2
                break
            }
          } else {
            // corner
            const corner = Math.floor(Math.random() * 4)
            switch (corner) {
              case 0:
                anchorX = left
                anchorY = top
                break
              case 1:
                anchorX = left + cellW
                anchorY = top
                break
              case 2:
                anchorX = left
                anchorY = top + cellH
                break
              default:
                anchorX = left + cellW
                anchorY = top + cellH
                break
            }
          }

          // choose multiplier per asset (randomly 1x or 2x)
          const mult = Math.random() < 0.5 ? 1 : 2

          // compute size and offsets using per-asset multiplier
          const assetSizePx = Math.round(cellW * mult)
          const dropOffsetX = (a.offsetX || 0) * assetSizePx
          const dropOffsetY = (a.offsetY || 0) * assetSizePx

          let finalX, finalY
          if (mult === 1) {
            // align to cell top-left for 1x assets
            finalX = Math.round(left + dropOffsetX)
            finalY = Math.round(top + dropOffsetY)
          } else {
            finalX = Math.round(anchorX - assetSizePx / 2 + dropOffsetX)
            finalY = Math.round(anchorY - assetSizePx / 2 + dropOffsetY)
          }

          // clamp inside canvas same as other placement logic
          finalX = Math.max(0, Math.min(finalX, canvasWidth - assetSizePx))
          finalY = Math.max(0, Math.min(finalY, canvasHeight - assetSizePx))

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

          const rotationOptions = [0, 90, 180, 270]
          const rotation = rotationOptions[Math.floor(Math.random() * rotationOptions.length)]

          newPlaced.push({
            ...a,
            x: finalX,
            y: finalY,
            rotation,
            id: Date.now() + Math.floor(Math.random() * 100000),
            multiplier: mult,
          })
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
    <div class="bg-white m-1">
      <h1 class="font-object font-bold text-xl ml-3 mt-1">Stupid Generator</h1>
      <!-- Generator type removed -->
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

        <h2 class="font-object font-medium text-base mt-8">Grid size</h2>
        <div class="slidecontainer gridsize">
          <input type="range" min="2" max="10" v-model="gridSize" class="slider" id="myRange" />
          <p class="font-object text-sm mt-1">{{ gridSize }}</p>
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

        <h2 class="font-object font-medium text-base mt-10">Assets</h2>
        <p class="font-object text-xs mb-4 text-gray-500">Click to spawn centered. Drag to move.</p>
        <p class="font-object text-xs mb-2 text-gray-900">Chose size</p>
        <div class="flex gap-2 mb-4">
          <button
            @click="changeAssetSize(1)"
            :class="['sizebutton px-2 border-2 cursor-pointer', { active: assetMultiplier === 1 }]"
          >
            x1
          </button>
          <button
            @click="changeAssetSize(2)"
            :class="['sizebutton px-2 border-2 cursor-pointer', { active: assetMultiplier === 2 }]"
          >
            x2
          </button>
        </div>
        <div class="assets-container grid grid-cols-4 mb-4">
          <div
            v-for="asset in assets"
            :key="asset.name"
            draggable="true"
            @dragstart="startDrag(asset, $event)"
            @dragend="onDragEnd"
            @click.prevent="spawnAssetCentered(asset)"
            class="asset-button"
            :title="'Snap: ' + asset.snapType"
          >
            <img :src="asset.path" :alt="asset.name" class="asset-icon" />
          </div>
        </div>
        <button
          class="savebutton pattern-randomizer ont-object font-regular p-1 border-2 w-[95%] rounded cursor-pointer"
          @click.prevent="randomizePattern"
        >
          Pattern Randomizer
        </button>
      </div>
      <div class="ml-3 mt-8">
        <h2 class="font-object font-medium text-base mt-10 mb-2">Save as</h2>
        <div class="flex gap-2 mb-4">
          <button class="savebutton px-2" @click.prevent="exportAsPDF">PDF</button>
          <button class="savebutton px-2" @click.prevent="exportAsSVG">SVG</button>
          <button class="savebutton px-2" @click.prevent="exportAsPNG">PNG</button>
          <button class="savebutton px-2" @click.prevent="exportAsJPG">JPG</button>
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
          @mousemove="onCanvasMouseMove"
          @mouseup="onCanvasMouseUp"
          @mouseleave="onCanvasMouseUp"
        >
          <div :style="gridStyle" class="grid-container">
            <div v-for="cell in gridCells" :key="cell" class="grid-cell"></div>
          </div>

          <!-- Placed assets layer -->
          <div class="assets-layer" @mousedown="onAssetsLayerMouseDown($event)">
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

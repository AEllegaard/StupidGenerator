<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

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
  {
    name: 'Half Circle',
    path: '/Assets/Half_circle.svg',
    snapType: 'edge',
    offsetX: 0.49,
    offsetY: -0.001,
  }, // snaps to cell edges; offsetX = fraction of asset width
  { name: 'Quarter Circle', path: '/Assets/Quarter_circle.svg', snapType: 'corner' },
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

// Drag and drop functions
const startDrag = (asset, event) => {
  draggedAsset.value = asset
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData('text/plain', asset.name)
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

  // Adjust placement for snap types:
  // - 'intersection' and 'edge' keep the snap point as the visual center (CSS centers elements)
  // - 'corner' should place the asset so its top-left corner sits in the cell corner.
  // Compute final top-left coordinates for dropped asset using top-left positioning:
  // - corner: top-left = snapped corner
  // - intersection/edge: top-left = snapped point - half asset (to center the asset on the point)
  const dropOffsetX = (draggedAsset.value.offsetX || 0) * assetSize.value
  const dropOffsetY = (draggedAsset.value.offsetY || 0) * assetSize.value

  let finalX = draggedAsset.value.snapType === 'corner' ? snappedX : snappedX - assetSize.value / 2
  let finalY = draggedAsset.value.snapType === 'corner' ? snappedY : snappedY - assetSize.value / 2

  // Apply asset-specific offsets (fractions of asset size)
  finalX += dropOffsetX
  finalY += dropOffsetY

  // Round to integer pixels and clamp inside canvas bounds to avoid sub-pixel
  // placement and small negative values caused by tiny offsets (like -0.001)
  finalX = Math.round(finalX)
  finalY = Math.round(finalY)
  finalX = Math.max(0, Math.min(finalX, canvasWidth - assetSize.value))
  finalY = Math.max(0, Math.min(finalY, canvasHeight - assetSize.value))

  // Add the asset to placed assets
  // Debug info (temporary): show snap calculations in console
  console.debug('onDrop:', {
    name: draggedAsset.value.name,
    snapType: draggedAsset.value.snapType,
    snappedX,
    snappedY,
    finalX,
    finalY,
    assetSize: assetSize.value,
    offsetX: draggedAsset.value.offsetX,
    offsetY: draggedAsset.value.offsetY,
  })
  // record state before adding new asset so Ctrl+Z can undo
  pushHistory()

  placedAssets.value.push({
    ...draggedAsset.value,
    x: finalX,
    y: finalY,
    rotation: 0,
    id: Date.now(),
  })

  draggedAsset.value = null
}

// Move existing assets
const draggedPlacedAsset = ref(null)
const dragOffset = ref({ x: 0, y: 0 })
const lastSnap = ref({ x: 0, y: 0 })
const draggedDuringInteraction = ref(false)
const justDragged = ref(false)

const startMovingAsset = (asset, event) => {
  draggedPlacedAsset.value = asset

  const canvasRect = canvasRef.value.getBoundingClientRect()
  const mouseX = event.clientX - canvasRect.left
  const mouseY = event.clientY - canvasRect.top

  // Compute the asset's un-offset top-left position so dragging doesn't jump.
  // Stored asset.x/y are top-left final positions (including offsets). To get the
  // base top-left (without offsets) we subtract any configured offsets.
  // Use the stored top-left asset.x/asset.y as the base so dragging doesn't jump.
  // asset.x/asset.y already include previously-applied offsets, so we should
  // not subtract offsets here.
  dragOffset.value = {
    x: mouseX - asset.x,
    y: mouseY - asset.y,
  }
  draggedDuringInteraction.value = false
  console.debug('startMovingAsset:', {
    name: asset.name,
    x: asset.x,
    y: asset.y,
    offsetX: asset.offsetX,
    offsetY: asset.offsetY,
    assetSize: assetSize.value,
  })
}

const onCanvasMouseMove = (event) => {
  if (!draggedPlacedAsset.value || !canvasRef.value) return

  // mark that we're moving an asset (used to suppress click->rotate after drag)
  draggedDuringInteraction.value = true

  const canvasRect = canvasRef.value.getBoundingClientRect()
  const canvasWidth = canvasRect.width
  const canvasHeight = canvasRect.height

  // Get mouse position relative to canvas
  const x = event.clientX - canvasRect.left - dragOffset.value.x
  const y = event.clientY - canvasRect.top - dragOffset.value.y

  // Calculate cell dimensions in pixels
  const cellWidth = canvasWidth / gridColumns.value
  const cellHeight = canvasHeight / gridRows.value

  let snappedX, snappedY

  if (draggedPlacedAsset.value.snapType === 'intersection') {
    // Snap to grid intersections
    snappedX = Math.round(x / cellWidth) * cellWidth
    snappedY = Math.round(y / cellHeight) * cellHeight
  } else if (draggedPlacedAsset.value.snapType === 'edge') {
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

  // While dragging we DO NOT apply asset-specific offsets or the 'corner' visual shift.
  // Store the last snapped intersection/corner/edge so we can apply offsets on drop.
  lastSnap.value = { x: snappedX, y: snappedY }

  // Debug info (temporary): show move snap calculations in console (base snap)
  console.debug('onMove:', {
    name: draggedPlacedAsset.value.name,
    snapType: draggedPlacedAsset.value.snapType,
    snappedX,
    snappedY,
    assetSize: assetSize.value,
    offsetX: draggedPlacedAsset.value.offsetX,
    offsetY: draggedPlacedAsset.value.offsetY,
  })

  // Update the asset to the snapped base top-left position (no final offsets yet)
  let displayX =
    draggedPlacedAsset.value.snapType === 'corner' ? snappedX : snappedX - assetSize.value / 2
  let displayY =
    draggedPlacedAsset.value.snapType === 'corner' ? snappedY : snappedY - assetSize.value / 2

  // If this asset has a configured visual offset (e.g. Half Circle offsetX),
  // apply it visually during drag so the movement feels natural. The true
  // offset is still applied on mouseup.
  if (draggedPlacedAsset.value.offsetX)
    displayX += (draggedPlacedAsset.value.offsetX || 0) * assetSize.value
  if (draggedPlacedAsset.value.offsetY)
    displayY += (draggedPlacedAsset.value.offsetY || 0) * assetSize.value

  // Round and clamp display position to avoid sub-pixel values and tiny negatives
  displayX = Math.round(displayX)
  displayY = Math.round(displayY)
  displayX = Math.max(0, Math.min(displayX, canvasWidth - assetSize.value))
  displayY = Math.max(0, Math.min(displayY, canvasHeight - assetSize.value))

  draggedPlacedAsset.value.x = displayX
  draggedPlacedAsset.value.y = displayY
}

const onCanvasMouseUp = () => {
  // When finishing a drag, apply offsets (if any) and the 'corner' correction to the final position
  if (draggedPlacedAsset.value) {
    const asset = draggedPlacedAsset.value
    // Compute top-left final position using top-left coordinate system
    let finalX =
      asset.snapType === 'corner' ? lastSnap.value.x : lastSnap.value.x - assetSize.value / 2
    let finalY =
      asset.snapType === 'corner' ? lastSnap.value.y : lastSnap.value.y - assetSize.value / 2

    finalX += (asset.offsetX || 0) * assetSize.value
    finalY += (asset.offsetY || 0) * assetSize.value

    // Round and clamp to canvas bounds to avoid tiny negative positions
    const canvasRect = canvasRef.value.getBoundingClientRect()
    const canvasWidth = canvasRect.width
    const canvasHeight = canvasRect.height
    finalX = Math.round(finalX)
    finalY = Math.round(finalY)
    finalX = Math.max(0, Math.min(finalX, canvasWidth - assetSize.value))
    finalY = Math.max(0, Math.min(finalY, canvasHeight - assetSize.value))

    // record previous state before finalizing the move so undo can revert
    pushHistory()

    asset.x = finalX
    asset.y = finalY
    // if we moved the asset during this interaction, mark a short-lived flag
    if (draggedDuringInteraction.value) {
      justDragged.value = true
      setTimeout(() => (justDragged.value = false), 250)
    }
    draggedDuringInteraction.value = false
  }

  draggedPlacedAsset.value = null
}

// Calculate asset size based on grid cell size
const assetSize = computed(() => {
  if (!canvasRef.value) return 100 // fallback value

  const canvasRect = canvasRef.value.getBoundingClientRect()
  if (!canvasRect || canvasRect.width === 0) return 100

  const cellWidth = (canvasRect.width / gridColumns.value) * 2

  // Asset size is twice the width of one grid square (2x)
  return cellWidth
})

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
</script>

<template>
  <div class="w-full h-screen maingrid">
    <!-- UI Section -->
    <div class="bg-white m-1">
      <h1 class="font-object font-bold text-lg ml-3 mt-1">Stupid Generator</h1>
      <div class="ml-3 mt-8">
        <div class="font-object font-medium text-base">Canvas presets</div>
        <select
          @change="handlePresetChange"
          :value="currentCanvasPreset.name"
          class="font-object font-regular p-1 border-2 w-[95%] rounded cursor-pointer"
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
                background: `linear-gradient(90deg, ${preset.bg} 50%, ${preset.asset} 50%)`,
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
        <div class="assets-container grid grid-cols-4 w.">
          <div
            v-for="asset in assets"
            :key="asset.name"
            draggable="true"
            @dragstart="startDrag(asset, $event)"
            class="asset-button"
            :title="`Snap: ${asset.snapType}`"
          >
            <img :src="asset.path" :alt="asset.name" class="asset-icon" />
          </div>
        </div>
      </div>
    </div>

    <!-- Canvas Section -->
    <div class="canvas m-2">
      <div class="canvas-wrapper">
        <div
          ref="canvasRef"
          :style="[canvasStyle, { backgroundColor: selectedBackgroundColor }]"
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
          <div class="assets-layer">
            <div
              v-for="asset in placedAssets"
              :key="asset.id"
              class="placed-asset-shape"
              @mousedown="startMovingAsset(asset, $event)"
              @click="onAssetClick(asset, $event)"
              :style="{
                left: `${asset.x}px`,
                top: `${asset.y}px`,
                width: `${assetSize}px`,
                height: `${assetSize}px`,
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
      </div>
    </div>
  </div>
</template>

<style scoped>
.maingrid {
  display: grid;
  grid-template-columns: 0.5fr 2fr;
}

.slidercontainer {
  width: 100%;
}

.slider {
  -webkit-appearance: none;
  appearance: none;
  width: 95%;
  height: 4px;
  background: #1e1c1c;
  opacity: 0.8;
  -webkit-transition: 0.2s; /* 0.2 seconds transition on hover */
  transition: opacity 0.2s;
  border-radius: 10px;
}

.slider:hover {
  opacity: 1; /* Fully shown on mouse-over */
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none; /* Override default look */
  appearance: none;
  width: 15px; /* Set a specific slider handle width */
  height: 15px; /* Slider handle height */
  border-radius: 100%;
  background: #000000; /* Green background */
  cursor: pointer; /* Cursor on hover */
}

.canvas {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f5f5;
}

.canvas-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.canvas-preset {
  background: white;
  border: 2px solid #0000001f;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  position: relative;
  overflow: hidden;
  padding: 0;
}

.grid-container {
  /* Make the grid a non-destructive overlay */
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 5;
  pointer-events: none; /* allow clicks to pass through to assets */
}

.grid-cell {
  background: transparent; /* grid is just an overlay, not part of the canvas content */
  border: 1px solid rgba(0, 0, 0, 0.06); /* very subtle lines */
  transition: background-color 0.2s;
  box-sizing: border-box;
}

.grid-cell:hover {
  background: #e0e0e0;
  cursor: pointer;
}

.assets-container {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  justify-items: center; /* center each button inside its grid cell */
  gap: 12px;
  margin-top: 8px;
  width: 95%;
}

.color-presets {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.color-button {
  width: 44px;
  height: 44px;
  padding: 4px;
  border: 2px solid transparent;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
}

.color-button.selected {
  border-color: #000;
}

.invert-button {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  border: 2px solid #ddd;
  background: white;
  border-radius: 6px;
  cursor: pointer;
}

.invert-button:hover {
  border-color: #000;
}

.color-swatch {
  width: 100%;
  height: 100%;
  border-radius: 4px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06) inset;
}

.asset-button:hover {
  cursor: grab;
}

.asset-button:active {
  cursor: grabbing;
}

.asset-icon {
  width: 40px; /* larger icon */
  height: 40px;
  object-fit: contain;
}

/* Force icons in the asset buttons to render as black.
   This uses a CSS filter so it works even if the SVGs have baked-in colors.
   If your SVGs use `fill="currentColor"` instead, you can remove the filter
   and rely on `color: black` on the button. */
.asset-button .asset-icon {
  filter: grayscale(1) brightness(0);
  opacity: 0.8; /* default 50% opacity */
  transition:
    opacity 150ms ease,
    filter 150ms ease;
}

.asset-button:hover .asset-icon {
  opacity: 1; /* full opacity on hover */
  /* keep icons black on hover as well */
  filter: grayscale(1) brightness(0);
}

.assets-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.placed-asset-shape {
  position: absolute;
  pointer-events: auto;
  cursor: move;
  user-select: none;
  /* will use mask-image to color SVGs */
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
}

.placed-asset-shape:active {
  cursor: grabbing;
}
</style>

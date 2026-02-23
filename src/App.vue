<script setup>
import { ref, computed } from 'vue'

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
  { name: 'Corner', path: '/Assets/Corner.svg', snapType: 'edge' }, // snaps to cell edges
  { name: 'Half Circle', path: '/Assets/Half_circle.svg', snapType: 'edge' },
  { name: 'Quarter Circle', path: '/Assets/Quarter_circle.svg', snapType: 'edge' },
  { name: 'Star', path: '/Assets/Star.svg', snapType: 'intersection' },
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
  }
})

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
      const distance = Math.sqrt(Math.pow(x - corner.x, 2) + Math.pow(y - corner.y, 2))
      if (distance < minDistance) {
        minDistance = distance
        closestCorner = corner
      }
    })

    snappedX = closestCorner.x
    snappedY = closestCorner.y
  }

  // Add the asset to placed assets
  placedAssets.value.push({
    ...draggedAsset.value,
    x: snappedX,
    y: snappedY,
    id: Date.now(),
  })

  draggedAsset.value = null
}

// Move existing assets
const draggedPlacedAsset = ref(null)
const dragOffset = ref({ x: 0, y: 0 })

const startMovingAsset = (asset, event) => {
  draggedPlacedAsset.value = asset

  const canvasRect = canvasRef.value.getBoundingClientRect()
  const mouseX = event.clientX - canvasRect.left
  const mouseY = event.clientY - canvasRect.top

  dragOffset.value = {
    x: mouseX - asset.x,
    y: mouseY - asset.y,
  }
}

const onCanvasMouseMove = (event) => {
  if (!draggedPlacedAsset.value || !canvasRef.value) return

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
      const distance = Math.sqrt(Math.pow(x - corner.x, 2) + Math.pow(y - corner.y, 2))
      if (distance < minDistance) {
        minDistance = distance
        closestCorner = corner
      }
    })

    snappedX = closestCorner.x
    snappedY = closestCorner.y
  }

  // Update the asset position
  draggedPlacedAsset.value.x = snappedX
  draggedPlacedAsset.value.y = snappedY
}

const onCanvasMouseUp = () => {
  draggedPlacedAsset.value = null
}

// Calculate asset size based on grid cell size
const assetSize = computed(() => {
  if (!canvasRef.value) return 30

  const canvasRect = canvasRef.value.getBoundingClientRect()
  const cellWidth = canvasRect.width / gridColumns.value

  // Asset size matches the width of one grid square
  return cellWidth
})

const handlePresetChange = (event) => {
  const selectedPreset = canvasDimensions.find((preset) => preset.name === event.target.value)
  if (selectedPreset) {
    currentCanvasPreset.value = selectedPreset
  }
}
</script>

<template>
  <div class="w-full h-screen maingrid">
    <!-- UI Section -->
    <div class="bg-white m-1">
      <h1 class="font-object font-bold text-lg ml-3 mt-1">Stupid Generator</h1>
      <div class="ml-3 mt-1">
        <div class="font-object font-medium text-base">Canvas presets</div>
        <select
          @change="handlePresetChange"
          :value="currentCanvasPreset.name"
          class="font-object font-regular p-1 border-[2px] w-[95%] rounded cursor-pointer"
        >
          <option v-for="preset in canvasDimensions" :key="preset.name" :value="preset.name">
            {{ preset.name }} ({{ preset.width }} x {{ preset.height }}px)
          </option>
        </select>

        <h2 class="font-object font-medium text-base mt-10">Grid size</h2>
        <div class="slidecontainer gridsize">
          <input type="range" min="2" max="10" v-model="gridSize" class="slider" id="myRange" />
          <p class="font-object text-sm mt-1">{{ gridSize }}</p>
        </div>

        <h2 class="font-object font-medium text-base mt-10">Assets</h2>
        <div class="assets-container">
          <div
            v-for="asset in assets"
            :key="asset.name"
            draggable="true"
            @dragstart="startDrag(asset, $event)"
            class="asset-button"
            :title="`Snap: ${asset.snapType}`"
          >
            <img :src="asset.path" :alt="asset.name" class="asset-icon" />
            <span class="asset-name">{{ asset.name }}</span>
          </div>
        </div>

        <h2 class="font-object font-medium text-base mt-10">Colors</h2>
      </div>
    </div>

    <!-- Canvas Section -->
    <div class="canvas m-2">
      <div class="canvas-wrapper">
        <div
          ref="canvasRef"
          :style="canvasStyle"
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
            <img
              v-for="asset in placedAssets"
              :key="asset.id"
              :src="asset.path"
              :alt="asset.name"
              class="placed-asset"
              :style="{
                left: `${asset.x}px`,
                top: `${asset.y}px`,
                width: `${assetSize}px`,
                height: `${assetSize}px`,
              }"
              @mousedown="startMovingAsset(asset, $event)"
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
  border: 2px solid #000;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  position: relative;
  overflow: hidden;
  padding: 0;
}

.grid-container {
  width: 100%;
  height: 100%;
}

.grid-cell {
  background: white;
  border: 1px solid #ddd;
  transition: background-color 0.2s;
  box-sizing: border-box;
}

.grid-cell:hover {
  background: #e0e0e0;
  cursor: pointer;
}

.assets-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
  width: 95%;
}

.asset-button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: white;
  border: 2px solid #ddd;
  border-radius: 4px;
  cursor: grab;
  transition: all 0.2s;
}

.asset-button:hover {
  border-color: #000;
  background: #f9f9f9;
}

.asset-button:active {
  cursor: grabbing;
}

.asset-icon {
  width: 24px;
  height: 24px;
  object-fit: contain;
}

.asset-name {
  font-family: 'PPObjectSans', sans-serif;
  font-size: 14px;
  color: #333;
}

.assets-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.placed-asset {
  position: absolute;
  transform: translate(-50%, -50%);
  pointer-events: auto;
  cursor: move;
  user-select: none;
  object-fit: contain;
}

.placed-asset:active {
  cursor: grabbing;
}
</style>

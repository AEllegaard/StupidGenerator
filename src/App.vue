<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import * as sandbox from './sandbox'
import * as pf from './patternFinder'
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

const getSnapshot = () => sandbox.getSnapshot(ctx)

const pushHistory = () => sandbox.pushHistory(ctx)

const applySnapshot = (snap) => sandbox.applySnapshot(ctx, snap)

const undo = () => sandbox.undo(ctx)

const redo = () => sandbox.redo(ctx)

// key handler for Ctrl+Z / Cmd+Z
const onKeyDown = (e) => sandbox.onKeyDown(ctx, e)

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
const computeSnapFromPointer = (pointerX, pointerY, snapType, canvasWidth, canvasHeight) =>
  pf.computeSnapFromPointer(
    pointerX,
    pointerY,
    snapType,
    canvasWidth,
    canvasHeight,
    gridColumns.value,
  )

// Drag and drop functions
const startDrag = (asset, event) => sandbox.startDrag(ctx, asset, event)

const onDragEnd = (event) => sandbox.onDragEnd(ctx, event)

const onDragOver = (event) => sandbox.onDragOver(ctx, event)

const onDrop = (event) => sandbox.onDrop(ctx, event)

// Spawn an asset at the visual center of the canvas. This respects the
// asset's snapType by computing a snap anchor at the canvas center and then
// centering the asset on that anchor (plus any per-asset fractional offsets).
const spawnAssetCentered = (asset) => sandbox.spawnAssetCentered(ctx, asset)

// Trash drag/drop handlers (for palette HTML5 drags)
const onTrashDragOver = (e) => sandbox.onTrashDragOver(ctx, e)
const onTrashDragLeave = (e) => sandbox.onTrashDragLeave(ctx, e)
const onTrashDrop = (e) => sandbox.onTrashDrop(ctx, e)

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

// Calculate asset size based on grid cell size
const assetSize = computed(() => {
  if (!canvasRef.value) return 100 // fallback value

  const canvasRect = canvasRef.value.getBoundingClientRect()
  if (!canvasRect || canvasRect.width === 0) return 100

  const cellWidth = (canvasRect.width / gridColumns.value) * assetMultiplier.value

  // Asset size is assetMultiplier * the width of one grid square
  return cellWidth
})

// shared context passed to helper modules
const ctx = {
  canvasDimensions,
  placedAssets,
  selectedBackgroundColor,
  selectedAssetColor,
  gridSize,
  currentCanvasPreset,
  historyStack,
  redoStack,
  maxHistory,
  maxRedo,
  draggedAsset,
  canvasRef,
  gridColumns,
  gridRows,
  draggedPlacedAsset,
  dragOffset,
  lastSnap,
  draggedDuringInteraction,
  justDragged,
  trashRef,
  trashVisible,
  draggedOverTrash,
  draggedElement,
  _globalMoveHandler,
  _globalUpHandler,
  moveListenersAdded,
  dragActive,
  assetMultiplier,
  assetSize,
}

const changeAssetSize = (mult) => sandbox.changeAssetSize(ctx, mult)

const startMovingAsset = (asset, event, el = null) =>
  sandbox.startMovingAsset(ctx, asset, event, el)

// Delegated mousedown handler on the assets-layer so every placed asset is draggable
const onAssetsLayerMouseDown = (event) => sandbox.onAssetsLayerMouseDown(ctx, event)

const onCanvasMouseMove = (event) => sandbox.onCanvasMouseMove(ctx, event)

const onCanvasMouseUp = (event) => sandbox.onCanvasMouseUp(ctx, event)

// Return the current rendered pixel size for a placed asset.
// This uses the asset's stored multiplier (grid units) and the current
// rendered canvas width so placed assets scale when the grid/canvas size
// changes. Falls back to asset.size or global assetSize if necessary.
const getAssetPixelSize = (asset) => pf.getAssetPixelSize(ctx, asset)

// --- Export helpers (delegated to patternFinder)
const exportRasterFromSVG = async (type = 'image/png', quality = 0.92) =>
  pf.exportRasterFromSVG(ctx, type, quality)
const exportAsSVG = async () => pf.exportAsSVG(ctx)
const exportAsPNG = async () => pf.exportAsPNG(ctx)
const exportAsJPG = async () => pf.exportAsJPG(ctx)
const exportAsPDF = async () => pf.exportAsPDF(ctx, jsPDF)

// Rotate a placed asset 90 degrees clockwise on click
const rotateAsset = (asset) => sandbox.rotateAsset(ctx, asset)

// Handle asset click while suppressing clicks that immediately follow a drag.
// Delegate to sandbox to preserve interaction rules.
const onAssetClick = (asset, event) => sandbox.onAssetClick(ctx, asset, event)

const handlePresetChange = (event) => {
  const selectedPreset = canvasDimensions.find((preset) => preset.name === event.target.value)
  if (selectedPreset) {
    pushHistory()
    currentCanvasPreset.value = selectedPreset
  }
}

// Generator toggle state (controlled via Vue bindings)
const generatorChecked = ref(false)
const generatorLabel = computed(() => (generatorChecked.value ? 'Pattern Finder' : 'Sandbox'))
</script>

<template>
  <div class="w-full h-screen maingrid">
    <!-- UI Section -->
    <div class="bg-white m-1">
      <h1 class="font-object font-bold text-xl ml-3 mt-1">Stupid Generator</h1>
      <div class="ml-3 mt-4">
        <div class="font-object font-medium text-base">Generator Type</div>
        <div class="flex gap-4 items-center mt-2">
          <input id="checkboxInput" type="checkbox" v-model="generatorChecked" />
          <label
            for="checkboxInput"
            class="toggleSwitch"
            @click.prevent="generatorChecked = !generatorChecked"
          ></label>
          <p id="generatorType">{{ generatorLabel }}</p>
        </div>
      </div>
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
        <div class="assets-container grid grid-cols-4">
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

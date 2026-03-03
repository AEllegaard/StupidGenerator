<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
// jsPDF is used to generate a downloadable PDF from the exported raster image
import { jsPDF } from 'jspdf'

// --- Responsive / device warning ------------------------------------
// Show a small warning on phone/tablet devices, since the editor is primarily
// designed for desktop (mouse/keyboard).
const DEVICE_WARNING_KEY = 'stupidgenerator_device_warning_dismissed_v1'
const showDeviceWarning = ref(false)

const getIsLikelyMobileOrTablet = () => {
  try {
    const w = window.innerWidth || 0
    const coarse =
      typeof window.matchMedia === 'function' &&
      (window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(hover: none)').matches)

    // Treat coarse-pointer devices as mobile/tablet, and also treat smaller
    // widths as "mobile-ish" even on laptops.
    return coarse || w <= 1024
  } catch (e) {
    return false
  }
}

const updateDeviceWarningVisibility = () => {
  try {
    const dismissed = localStorage.getItem(DEVICE_WARNING_KEY) === '1'
    showDeviceWarning.value = !dismissed && getIsLikelyMobileOrTablet()
  } catch (e) {
    // If storage is blocked, just show based on device
    showDeviceWarning.value = getIsLikelyMobileOrTablet()
  }
}

const dismissDeviceWarning = () => {
  showDeviceWarning.value = false
  try {
    localStorage.setItem(DEVICE_WARNING_KEY, '1')
  } catch (e) {
    // ignore
  }
}

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

          // Reset sliders/transform to defaults when a new background is uploaded.
          patternBackground.value = {
            scale: 1,
            x: 0,
            y: 0,
            rotation: 0,
          }

          // Remove only the previous Pattern finder background SVG (identified by renderW/renderH).
          // Keep other background images and keep placed assets.
          patternBackgroundStash.value = null
          const existing = (backgroundImages.value || []).filter(
            (img) => !(img && img.renderW && img.renderH),
          )

          const nextBg = {
            id: Date.now() + Math.floor(Math.random() * 100000),
            name: file.name || 'Pattern background SVG',
            path: dataUrl,
            dataUrl,
            isUploaded: true,
            // Offsets from canvas center (used by drag + sliders)
            x: 0,
            y: 0,
            rotation: 0,
            // Explicit render size in pixels for pattern-finder background.
            // We render this behind the viewport; anything outside is clipped.
            renderW: 6000,
            renderH: 6000,
            scale: 1,
            multiplier: 0,
          }

          backgroundImages.value = [nextBg, ...existing]

          // Keep stash in sync so switching modes still restores the newest background.
          patternBackgroundStash.value = nextBg
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
  // Position stored in *world units* (pre-scale), so changing scale never
  // shifts the apparent center pivot.
  x: 0,
  y: 0,
  rotation: 0,
})

// --- Pattern finder image background (raster) ------------------------
// A single uploaded raster image that can replace the Pattern finder background.
// It moves ONLY when Alt/Option is held down, and has its own scale slider.
const patternImageBackground = ref(null) // { id, name, dataUrl, x, y, scale, rotation, naturalW, naturalH }
const patternImageScale = ref(1)
const uploadPatternImageInputRef = ref(null)

const openUploadPatternImagePicker = () => {
  const el = uploadPatternImageInputRef.value
  if (el && typeof el.click === 'function') el.click()
}

const onUploadPatternImageBackground = (e) => {
  const files = e?.target?.files
  if (!files || !files.length) return
  const file = files[0]
  const reader = new FileReader()
  reader.onload = (ev) => {
    const dataUrl = ev?.target?.result
    if (!dataUrl) return

    pushHistory()

    // Reset transforms
    patternImageScale.value = 1
    patternImageBackground.value = {
      id: Date.now() + Math.floor(Math.random() * 100000),
      name: file.name || 'Pattern image background',
      dataUrl,
      x: 0,
      y: 0,
      rotation: 0,
      scale: 1,
    }

    // Capture natural dimensions when possible (helps export sizing)
    try {
      const img = new Image()
      img.onload = () => {
        if (!patternImageBackground.value) return
        patternImageBackground.value.naturalW = img.naturalWidth || img.width || null
        patternImageBackground.value.naturalH = img.naturalHeight || img.height || null
      }
      img.src = dataUrl
    } catch (err) {
      // ignore
    }
  }
  reader.readAsDataURL(file)
  // reset so the same file can be re-uploaded if needed
  e.target.value = ''
}

const removePatternImageBackground = () => {
  if (!patternImageBackground.value) return
  pushHistory()
  patternImageBackground.value = null
  patternImageScale.value = 1
}

const updatePatternImageBackgroundScale = (newScale) => {
  const s = Number(newScale || 1) || 1
  patternImageScale.value = s
  if (patternImageBackground.value) patternImageBackground.value.scale = s
}

// Pattern finder: convert between world-units (stored) and screen pixels (rendered).
const patternWorldToScreen = (world, scale) => {
  const s = Number(scale || 1) || 1
  return {
    x: (Number(world?.x || 0) || 0) * s,
    y: (Number(world?.y || 0) || 0) * s,
  }
}

const patternScreenToWorld = (screen, scale) => {
  const s = Number(scale || 1) || 1
  return {
    x: (Number(screen?.x || 0) || 0) / s,
    y: (Number(screen?.y || 0) || 0) / s,
  }
}

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

// --- Canvas preset dropdown (custom, always opens downward) ---------
const presetDropdownOpen = ref(false)
const presetDropdownRef = ref(null)

const closePresetDropdown = () => {
  presetDropdownOpen.value = false
}

const togglePresetDropdown = () => {
  presetDropdownOpen.value = !presetDropdownOpen.value
}

const onSelectCanvasPresetName = (name) => {
  const selectedPreset = canvasDimensions.find((preset) => preset.name === name)
  if (!selectedPreset) return
  pushHistory()
  currentCanvasPreset.value = selectedPreset
  closePresetDropdown()
}
const gridSize = ref(5)
const placedAssets = ref([]) // Array to store placed assets on canvas
// Uploaded images placed on the canvas should always sit UNDER the SVG assets.
// We keep them in a separate list and render them in a layer below.
const backgroundImages = ref([]) // Array to store placed uploaded images (raster) under assets
const draggedAsset = ref(null)
const canvasRef = ref(null)

// Measure available space for the canvas so we can scale responsively.
const canvasColumnRef = ref(null)
const canvasAvailablePx = ref({ w: 0, h: 0 })

const updateCanvasAvailablePx = () => {
  try {
    const el = canvasColumnRef.value
    if (!el || !el.getBoundingClientRect) return
    const r = el.getBoundingClientRect()
    // leave a bit of room for padding + the device warning banner
    canvasAvailablePx.value = {
      w: Math.max(0, r.width - 24),
      h: Math.max(0, r.height - 80),
    }
  } catch (e) {
    // ignore
  }
}

const canvasStyle = computed(() => {
  // Scale canvas to the available column size (responsive), with a sensible
  // fallback for first render.
  const maxWidth = canvasAvailablePx.value.w || 800
  const maxHeight = canvasAvailablePx.value.h || 600

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
const DEFAULT_COLOR_PRESETS = [
  { name: 'Red / Rosa', bg: '#f0604d', asset: '#ff9698' },
  { name: 'Dark green / ultra violet', bg: '#164230', asset: '#322fb0' },
  { name: 'Ultra Violet / Blue', bg: '#4055b2', asset: '#322fb0' },
  { name: 'Dark green / Blue', bg: '#164230', asset: '#4055b2' },
]

const CUSTOM_SWATCHES_KEY = 'stupidgenerator_custom_swatches_v1'
const colorPresets = ref([...DEFAULT_COLOR_PRESETS])

const loadCustomSwatches = () => {
  try {
    const raw = localStorage.getItem(CUSTOM_SWATCHES_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return
    const cleaned = parsed
      .filter((x) => x && typeof x.bg === 'string' && typeof x.asset === 'string')
      .map((x, i) => ({
        name: String(x.name || `Custom ${i + 1}`),
        bg: String(x.bg),
        asset: String(x.asset),
        isCustom: true,
      }))
    if (cleaned.length) colorPresets.value = [...DEFAULT_COLOR_PRESETS, ...cleaned]
  } catch (e) {
    // ignore
  }
}

const persistCustomSwatches = () => {
  try {
    const custom = (colorPresets.value || []).filter((p) => p && p.isCustom)
    localStorage.setItem(CUSTOM_SWATCHES_KEY, JSON.stringify(custom))
  } catch (e) {
    // ignore
  }
}

const selectedBackgroundColor = ref(colorPresets.value[0].bg)
const selectedAssetColor = ref(colorPresets.value[0].asset)

const canInvertColors = computed(() => (colorPresets.value || []).length >= 2)

// Keep predefined presets on the top row; render custom swatches in a row underneath.
const predefinedPresets = computed(() => (colorPresets.value || []).filter((p) => p && !p.isCustom))
const customPresets = computed(() => (colorPresets.value || []).filter((p) => p && p.isCustom))

const formatColor = (v) => {
  const s = String(v || '').trim()
  if (!s) return null
  // Simple hex guard (we only allow hex from the UI pickers anyway)
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return null
  return s
}

const addCustomSwatch = () => {
  const bg = formatColor(selectedBackgroundColor.value)
  const asset = formatColor(selectedAssetColor.value)
  if (!bg || !asset) return

  const customCount = (colorPresets.value || []).filter((p) => p && p.isCustom).length
  const name = `Custom ${customCount + 1}`

  pushHistory()
  colorPresets.value.push({ name, bg, asset, isCustom: true })
  persistCustomSwatches()
}

const removeCustomSwatch = (preset) => {
  if (!preset || !preset.isCustom) return
  const idx = (colorPresets.value || []).indexOf(preset)
  if (idx === -1) return
  pushHistory()
  colorPresets.value.splice(idx, 1)
  persistCustomSwatches()
}

const selectColorPreset = (preset) => {
  pushHistory()
  selectedBackgroundColor.value = preset.bg
  selectedAssetColor.value = preset.asset
}

// Swap background and asset colors
const invertColors = () => {
  if (!canInvertColors.value) return
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
    // User uploads (should survive reload)
    uploadedSvgAssets: JSON.parse(JSON.stringify(uploadedSvgAssets.value || [])),
    uploadedImages: JSON.parse(JSON.stringify(uploadedImages.value || [])),
    placedAssets: JSON.parse(JSON.stringify(placedAssets.value)),
    backgroundImages: JSON.parse(JSON.stringify(backgroundImages.value)),
    // Pattern finder background may be stashed/removed when switching modes.
    patternBackgroundStash: patternBackgroundStash.value
      ? JSON.parse(JSON.stringify(patternBackgroundStash.value))
      : null,
    patternBackground: patternBackground.value
      ? JSON.parse(JSON.stringify(patternBackground.value))
      : null,
    patternImageBackground: patternImageBackground.value
      ? JSON.parse(JSON.stringify(patternImageBackground.value))
      : null,
    patternImageScale: patternImageScale.value,
    selectedBackgroundColor: selectedBackgroundColor.value,
    selectedAssetColor: selectedAssetColor.value,
    gridSize: gridSize.value,
    currentCanvasPresetName: currentCanvasPreset.value?.name,
    editorMode: editorMode.value,
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
  // Restore uploads first so the palette is preserved across reloads.
  // (We reset the actual canvas content later.)
  try {
    if (Array.isArray(snap.uploadedSvgAssets)) {
      uploadedSvgAssets.value = JSON.parse(JSON.stringify(snap.uploadedSvgAssets || []))
    }
  } catch (e) {
    // ignore
  }
  try {
    if (Array.isArray(snap.uploadedImages)) {
      uploadedImages.value = JSON.parse(JSON.stringify(snap.uploadedImages || []))
    }
  } catch (e) {
    // ignore
  }

  // We restore the snapshot first, then apply our “fresh on reload” defaults
  // below.
  placedAssets.value = JSON.parse(JSON.stringify(snap.placedAssets || []))
  backgroundImages.value = JSON.parse(JSON.stringify(snap.backgroundImages || []))

  // Restore pattern background slider state + stash.
  if (snap.patternBackground && typeof snap.patternBackground === 'object') {
    patternBackground.value = {
      ...patternBackground.value,
      ...JSON.parse(JSON.stringify(snap.patternBackground)),
    }
  }

  // Restore Pattern finder image background
  if (snap.patternImageBackground && typeof snap.patternImageBackground === 'object') {
    patternImageBackground.value = JSON.parse(JSON.stringify(snap.patternImageBackground))
  } else {
    patternImageBackground.value = null
  }
  if (snap.patternImageScale != null) {
    patternImageScale.value = Number(snap.patternImageScale) || 1
    if (patternImageBackground.value) patternImageBackground.value.scale = patternImageScale.value
  }
  patternBackgroundStash.value = snap.patternBackgroundStash
    ? JSON.parse(JSON.stringify(snap.patternBackgroundStash))
    : null

  // Ensure the pattern background exists in backgroundImages if it was stashed.
  try {
    const exists = (backgroundImages.value || []).some((img) => img && img.renderW && img.renderH)
    if (!exists && patternBackgroundStash.value) {
      backgroundImages.value = [patternBackgroundStash.value, ...(backgroundImages.value || [])]
    }
  } catch (e) {
    // ignore
  }

  selectedBackgroundColor.value = snap.selectedBackgroundColor || selectedBackgroundColor.value
  selectedAssetColor.value = snap.selectedAssetColor || selectedAssetColor.value
  // Intentionally do NOT restore gridSize or canvas preset on reload.
  // (We reset them below so the app always starts from the same baseline.)

  // Restore editor mode when applying snapshots (undo/redo).
  // For autosave we still want a clean baseline; that's handled by the onMounted
  // restore flow, not by forcing a mode here.
  if (snap.editorMode === 'pattern' || snap.editorMode === 'sandbox') {
    editorMode.value = snap.editorMode
  }

  // NOTE: Don't hard-reset canvas/grid here; applySnapshot is also used by undo/redo.
  // Any "reset on reload" behavior should happen in restoreAutosave/onMounted.

  // IMPORTANT: Don't auto-stash/remove the Pattern background here.
  // That rule belongs to `setEditorMode()` (mode transitions), but `applySnapshot()`
  // is used by undo/redo and autosave restore. Removing the pattern background
  // during undo can make Pattern finder actions (like Random) appear to "stop working".
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

// --- Autosave / Restore (localStorage) ---------------------------------
// Persists the current working state so it survives reloads / closing the tab.
const AUTOSAVE_KEY = 'stupidgenerator_autosave_v1'
const _autosaveRaf = { id: 0, lastStr: '' }

const saveAutosaveNow = () => {
  try {
    const snap = getSnapshot()
    const str = JSON.stringify(snap)
    if (str === _autosaveRaf.lastStr) return
    _autosaveRaf.lastStr = str
    localStorage.setItem(AUTOSAVE_KEY, str)
  } catch (e) {
    console.warn('autosave failed', e)
  }
}

const scheduleAutosave = () => {
  try {
    if (_autosaveRaf.id) cancelAnimationFrame(_autosaveRaf.id)
  } catch (e) {}
  _autosaveRaf.id = requestAnimationFrame(() => {
    _autosaveRaf.id = 0
    saveAutosaveNow()
  })
}

const restoreAutosave = () => {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY)
    if (!raw) return false
    const snap = JSON.parse(raw)
    if (!snap || typeof snap !== 'object') return false
    applySnapshot(snap)
    return true
  } catch (e) {
    console.warn('restore autosave failed', e)
    return false
  }
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
  // Custom preset dropdown: close on outside click / Escape
  window.addEventListener('pointerdown', onDocPointerDownForPreset, { capture: true })
  window.addEventListener('keydown', onDocKeyDownForPreset)

  // Load any user-defined color swatches.
  loadCustomSwatches()

  // Restore last session (if any) before we do any initial randomization.
  const restored = restoreAutosave()

  // Evaluate mobile/tablet warning on startup and on resize/orientation changes.
  updateDeviceWarningVisibility()
  try {
    window.addEventListener('resize', updateDeviceWarningVisibility)
    window.addEventListener('orientationchange', updateDeviceWarningVisibility)
  } catch (e) {
    // ignore
  }

  // Measure available canvas space (responsive scaling)
  await nextTick()
  updateCanvasAvailablePx()
  try {
    window.addEventListener('resize', updateCanvasAvailablePx)
    window.addEventListener('orientationchange', updateCanvasAvailablePx)
  } catch (e) {
    // ignore
  }

  // Wait for DOM updates so canvasRef has correct size, then seed an initial pattern.
  // Only do this if we *didn't* restore an autosave.
  await nextTick()
  if (!restored) {
    // Slight timeout to ensure layout/measurements are stable in all browsers.
    setTimeout(() => {
      try {
        randomizePattern()
      } catch (e) {
        console.warn('initial randomizePattern failed', e)
      }
    }, 50)
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  try {
    window.removeEventListener('pointerdown', onDocPointerDownForPreset, { capture: true })
  } catch (e) {
    // Safari requires the same signature; fall back
    window.removeEventListener('pointerdown', onDocPointerDownForPreset, true)
  }
  window.removeEventListener('keydown', onDocKeyDownForPreset)
  // Best-effort save on exit
  try {
    saveAutosaveNow()
  } catch (e) {}
  try {
    window.removeEventListener('resize', updateDeviceWarningVisibility)
    window.removeEventListener('orientationchange', updateDeviceWarningVisibility)
    window.removeEventListener('resize', updateCanvasAvailablePx)
    window.removeEventListener('orientationchange', updateCanvasAvailablePx)
  } catch (e) {
    // ignore
  }
})

// Autosave whenever the core working state changes.
watch(
  () => [
    placedAssets.value,
    backgroundImages.value,
    patternBackgroundStash.value,
    patternBackground.value,
    selectedBackgroundColor.value,
    selectedAssetColor.value,
    gridSize.value,
    currentCanvasPreset.value?.name,
  ],
  () => {
    scheduleAutosave()
  },
  { deep: true },
)

watch(
  () => [currentCanvasPreset.value?.name, editorMode.value],
  async () => {
    await nextTick()
    updateCanvasAvailablePx()
  },
)

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

// Helper: snap anchor for placement.
// - 1× assets: snap to CENTER of nearest cell
// - 2×+ assets (and uploaded images): snap to nearest GRID INTERSECTION (corner)
const computeSnapFromPointer = (pointerX, pointerY, canvasWidth, canvasHeight, multiplier = 1) => {
  const cellWidth = canvasWidth / gridColumns.value
  const cellHeight = canvasHeight / Math.max(1, gridRows.value)

  // Clamp pointer inside the canvas to keep intersection math stable
  const px = Math.max(0, Math.min(canvasWidth, pointerX))
  const py = Math.max(0, Math.min(canvasHeight, pointerY))

  if ((multiplier || 1) > 1) {
    // Nearest intersection
    const col = Math.round(px / cellWidth)
    const row = Math.round(py / cellHeight)
    const clampedCol = Math.max(0, Math.min(gridColumns.value, col))
    const clampedRow = Math.max(0, Math.min(gridRows.value, row))
    return { x: clampedCol * cellWidth, y: clampedRow * cellHeight }
  }

  // 1×: center of nearest cell
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

  // Snap anchor: 1× -> cell center, 2×+ -> intersection
  const snapAnchor = computeSnapFromPointer(
    x,
    y,
    canvasWidth,
    canvasHeight,
    forcedCurrentMultiplier,
  )
  const snappedX = snapAnchor.x
  const snappedY = snapAnchor.y

  // Render size:
  // - SVG assets: grid-based square (cellWidth * multiplier)
  // - Uploaded images: width is grid-based; height is derived from natural
  //   image ratio (when available) to avoid distortion.
  const currentAssetSize = Math.round(cellWidth * forcedCurrentMultiplier)
  const renderW =
    dragged && dragged.isUploaded
      ? Math.round(dragged.renderW || currentAssetSize)
      : currentAssetSize
  const renderH = (() => {
    if (!(dragged && dragged.isUploaded)) return currentAssetSize
    if (dragged.renderH) return Math.round(dragged.renderH)
    const nw = Number(dragged.naturalW || 0)
    const nh = Number(dragged.naturalH || 0)
    if (nw > 0 && nh > 0) return Math.round(renderW * (nh / nw))
    return currentAssetSize
  })()
  // Only apply horizontal asset-specific offset for 1x assets — larger
  // multipliers may amplify the offset too much (Half Circle padding fix).
  const dropOffsetX = (currentMultiplier === 1 ? dragged.offsetX || 0 : 0) * currentAssetSize
  const dropOffsetY = (dragged.offsetY || 0) * currentAssetSize

  // Compute top-left.
  // - Uploaded images: always snap top-left to intersections.
  // - SVG assets:
  //   * 1x: anchor is cell center -> center the asset
  //   * >1x: anchor is intersection -> top-left on that intersection
  let finalX, finalY
  if (dragged && dragged.isUploaded) {
    finalX = snappedX
    finalY = snappedY
  } else if (forcedCurrentMultiplier > 1) {
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
  finalX = Math.max(0, Math.min(finalX, canvasWidth - renderW))
  finalY = Math.max(0, Math.min(finalY, canvasHeight - renderH))

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
    // persist computed render dimensions for consistent drag/export behavior
    ...(dragged && dragged.isUploaded ? { renderW, renderH } : {}),
  }
  // Uploaded raster images always go to the background layer
  if (newItem.isUploaded) backgroundImages.value.push(newItem)
  else {
    // Store the chosen asset tint at placement time so exports are stable.
    newItem.color = newItem.color || selectedAssetColor.value
    placedAssets.value.push(newItem)
  }
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

    // Snap anchor: 1× -> cell center, 2×+ -> intersection
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

    let finalX, finalY
    if (asset && asset.isUploaded) {
      // Uploaded images: snap top-left to intersections
      finalX = Math.round(snapAnchor.x + dropOffsetX)
      finalY = Math.round(snapAnchor.y + dropOffsetY)
    } else if (currentMultiplier > 1) {
      // Grid-aligned block
      finalX = Math.round(snapAnchor.x + dropOffsetX)
      finalY = Math.round(snapAnchor.y + dropOffsetY)
    } else {
      // 1× SVG: anchor is cell center -> center asset
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
    else {
      // Store the chosen asset tint at placement time so exports are stable.
      newItem.color = newItem.color || selectedAssetColor.value
      placedAssets.value.push(newItem)
    }
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

  // With world-units storage, scaling shouldn't change the stored position.
  // We only update the scale and then re-derive screen pixels in the render.
  const nextX = Number(bg.x || 0) || 0
  const nextY = Number(bg.y || 0) || 0

  bg.scale = nextScale
  bg.x = nextX
  bg.y = nextY

  // keep UI model in sync
  patternBackground.value.scale = nextScale
  // bg.x/bg.y are world units
  patternBackground.value.x = nextX
  patternBackground.value.y = nextY
}

// Pattern finder: which controls Random should affect
const randomizePatternControls = ref({
  scale: true,
  x: true,
  y: true,
  rotation: true,
})

// Pattern finder: randomize the uploaded background SVG position.
// Keeps everything in WORLD units (patternBackground.x/y and bg.x/y).
const randomizePatternBackgroundPosition = () => {
  const bg = (backgroundImages.value || []).find((img) => img && img.renderW && img.renderH)
  if (!bg) return
  pushHistory()

  // Reasonable range (world units). We keep it within the slider bounds.
  const range = 2000
  const nextX = Math.round((Math.random() * 2 - 1) * range)
  const nextY = Math.round((Math.random() * 2 - 1) * range)

  // Scale: match slider bounds (0.1–3). Bias slightly towards 1 for nicer results.
  const minScale = 0.1
  const maxScale = 3
  const r = Math.random()
  const biased = r * r // more values near 0
  const nextScale = Number((minScale + (maxScale - minScale) * (1 - biased)).toFixed(2))

  // Rotation: snap to 90° steps like the slider.
  const rotations = [0, 90, 180, 270]
  const nextRot = rotations[Math.floor(Math.random() * rotations.length)]

  if (randomizePatternControls.value.x) {
    bg.x = nextX
    patternBackground.value.x = nextX
  }
  if (randomizePatternControls.value.y) {
    bg.y = nextY
    patternBackground.value.y = nextY
  }
  if (randomizePatternControls.value.rotation) {
    bg.rotation = nextRot
    patternBackground.value.rotation = nextRot
  }
  if (randomizePatternControls.value.scale) {
    // Use the dedicated helper so scale stays consistent with the pivot model.
    updatePatternBackgroundScale(nextScale)
  }
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

  // Pattern finder raster image background: translation is stored in screen px
  // offsets from canvas center. Make dragging stable by capturing the pointer
  // offset from the current image rect.
  if (editorMode.value === 'pattern' && asset && patternImageBackground.value === asset) {
    try {
      const canvasRect = canvasRef.value.getBoundingClientRect()
      const ptrX = event.clientX - canvasRect.left
      const ptrY = event.clientY - canvasRect.top
      const nw = Number(asset.naturalW || 0) || 1
      const nh = Number(asset.naturalH || 0) || 1
      const cover = Math.max(canvasRect.width / nw, canvasRect.height / nh)
      const s = Number(asset.scale || 1) || 1
      const w = nw * cover * s
      const h = nh * cover * s
      const left = canvasRect.width / 2 - w / 2 + (asset.x || 0)
      const top = canvasRect.height / 2 - h / 2 + (asset.y || 0)
      dragOffset.value = { x: ptrX - left, y: ptrY - top }
      draggedElement.value = el
    } catch (e) {
      // fallback to default logic below
    }
  }

  // Pattern finder background uses a fixed pivot at canvas center (50%/50%).
  // While dragging, we must NOT let the pivot move; instead we update asset.x/y
  // (translation) such that the point the user grabbed stays under the pointer.
  if (editorMode.value === 'pattern' && asset && asset.renderW && asset.renderH) {
    try {
      const canvasRect = canvasRef.value.getBoundingClientRect()

      // Pointer position in canvas-local coords
      const ptrX = event.clientX - canvasRect.left
      const ptrY = event.clientY - canvasRect.top

      // Current translation offsets are stored in WORLD units
      const txWorld = Number(asset.x || 0) || 0
      const tyWorld = Number(asset.y || 0) || 0

      const rot = Number(asset.rotation || 0)
      const scale = Number(asset.scale || 1) || 1

      // Convert stored world pos -> screen px for pointer math
      const tScreen = patternWorldToScreen({ x: txWorld, y: tyWorld }, scale)
      const tx = tScreen.x
      const ty = tScreen.y

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
        // Store drag start in WORLD units so we can round-trip cleanly.
        startX: txWorld,
        startY: tyWorld,
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
      const scale = Number(asset.scale || 1) || 1
      const tScreen = patternWorldToScreen({ x: asset.x || 0, y: asset.y || 0 }, scale)
      // With the 50%/50% anchor model the visual top-left is center - half size + offsets
      const left = rect.width / 2 - w / 2 + (tScreen.x || 0)
      const top = rect.height / 2 - h / 2 + (tScreen.y || 0)
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

  // Pattern finder raster image background: centered cover image
  // Only draggable with Alt/Option (handled by pointerdown caller).
  if (editorMode.value === 'pattern' && patternImageBackground.value) {
    try {
      const rect = canvasRef.value.getBoundingClientRect()
      const bg = patternImageBackground.value
      // cover sizing
      const nw = Number(bg.naturalW || 0) || 1
      const nh = Number(bg.naturalH || 0) || 1
      const cover = Math.max(rect.width / nw, rect.height / nh)
      const s = Number(bg.scale || 1) || 1
      const w = nw * cover * s
      const h = nh * cover * s
      const left = rect.width / 2 - w / 2 + (bg.x || 0)
      const top = rect.height / 2 - h / 2 + (bg.y || 0)
      if (canvasX >= left && canvasX <= left + w && canvasY >= top && canvasY <= top + h) {
        return { ...bg, isPatternImageBackground: true }
      }
    } catch (e) {
      // ignore
    }
  }

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

  // Pattern finder raster image background should ONLY move with Alt/Option.
  if (editorMode.value === 'pattern' && patternImageBackground.value && !event.altKey) return

  const canvasRect = canvasRef.value.getBoundingClientRect()
  const x = event.clientX - canvasRect.left
  const y = event.clientY - canvasRect.top

  const hit = findTopmostBackgroundImageAt(x, y)
  if (!hit) return

  // Pattern finder raster image background: set as dragged object.
  if (hit && hit.isPatternImageBackground) {
    // Use the actual reactive object as the dragged asset.
    const real = patternImageBackground.value
    if (!real) return
    const el = canvasRef.value.querySelector(`.pattern-image-bg`) || null
    startMovingAsset(real, event, el)
    event.preventDefault()
    return
  }

  // Find the actual element so offset uses its rendered box (rotation etc.).
  const el = canvasRef.value.querySelector(`.placed-asset-shape[data-id="${hit.id}"]`)
  startMovingAsset(hit, event, el)
  event.preventDefault()
}

const onCanvasMouseMove = (event) => {
  if (!draggedPlacedAsset.value || !canvasRef.value) return

  // Pattern finder raster image background: move freely (no grid snapping),
  // only when Alt/Option is held down (enforced by pointerdown guard).
  if (editorMode.value === 'pattern' && patternImageBackground.value === draggedPlacedAsset.value) {
    draggedDuringInteraction.value = true
    const canvasRect = canvasRef.value.getBoundingClientRect()
    const mouseX = event.clientX - canvasRect.left
    const mouseY = event.clientY - canvasRect.top

    const bg = draggedPlacedAsset.value
    const nw = Number(bg.naturalW || 0) || 1
    const nh = Number(bg.naturalH || 0) || 1
    const cover = Math.max(canvasRect.width / nw, canvasRect.height / nh)
    const s = Number(bg.scale || 1) || 1
    const w = nw * cover * s
    const h = nh * cover * s

    const left = mouseX - (dragOffset.value.x || 0)
    const top = mouseY - (dragOffset.value.y || 0)

    // Store offsets from canvas center
    const nextX = Math.round(left - (canvasRect.width / 2 - w / 2))
    const nextY = Math.round(top - (canvasRect.height / 2 - h / 2))
    bg.x = nextX
    bg.y = nextY
    return
  }

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
    // Translation is computed in SCREEN px first, then converted back to WORLD.
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

    const scale = Number(draggedPlacedAsset.value.scale || 1) || 1
    const world = patternScreenToWorld({ x: displayX, y: displayY }, scale)
    const worldX = world.x
    const worldY = world.y

    draggedPlacedAsset.value.x = worldX
    draggedPlacedAsset.value.y = worldY
    patternBackground.value.x = worldX
    patternBackground.value.y = worldY

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
    // For uploaded images, use renderW/renderH (which represent N grid squares).
    const canvasRect = canvasRef.value.getBoundingClientRect()
    const canvasWidth = canvasRect.width
    const canvasHeight = canvasRect.height
    const renderW =
      asset && asset.isUploaded ? Math.round(asset.renderW || currentAssetSize) : currentAssetSize
    const renderH =
      asset && asset.isUploaded ? Math.round(asset.renderH || currentAssetSize) : currentAssetSize
    const minX = -Math.floor(renderW) + 1
    const minY = -Math.floor(renderH) + 1
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
const _gridResizeRaf = { id: 0 }
watch(
  () => [
    gridColumns.value,
    gridRows.value,
    gridSize.value,
    currentCanvasPreset.value.width,
    currentCanvasPreset.value.height,
  ],
  (next, prev) => {
    // Only relevant in Sandbox; Pattern finder uses a different coordinate model.
    if (editorMode.value !== 'sandbox') return
    if (!canvasRef.value) return

    // Debounce to the next animation frame so we don't apply intermediate states
    // while the range input is being dragged.
    try {
      if (_gridResizeRaf.id) cancelAnimationFrame(_gridResizeRaf.id)
    } catch (e) {}

    _gridResizeRaf.id = requestAnimationFrame(() => {
      _gridResizeRaf.id = 0
      try {
        if (!canvasRef.value) return
        const canvasRect = canvasRef.value.getBoundingClientRect()
        const canvasWidth = canvasRect.width
        const canvasHeight = canvasRect.height

        const colsNow = gridColumns.value
        const rowsNow = gridRows.value
        const cellWNow = canvasWidth / Math.max(1, colsNow)
        const cellHNow = canvasHeight / Math.max(1, rowsNow)

        // Previous grid (fallback to current if unavailable)
        const prevCols = Array.isArray(prev) ? Number(prev[0]) || colsNow : colsNow
        const prevRows = Array.isArray(prev) ? Number(prev[1]) || rowsNow : rowsNow
        const cellWPrev = canvasWidth / Math.max(1, prevCols)
        const cellHPrev = canvasHeight / Math.max(1, prevRows)

        // Mutate positions in-place (preserves object identity).
        const repositionInPlace = (list) => {
          let moved = false
          for (const asset of list || []) {
            if (!asset) continue
            // Skip special Pattern finder background if it ever exists here
            if (asset.renderW && asset.renderH) continue

            const mult = asset.multiplier || 1
            const sizePrev = Math.round(cellWPrev * mult)

            // Determine which cell the asset belongs to based on its CENTER.
            const centerXPrev = (Number(asset.x || 0) || 0) + sizePrev / 2
            const centerYPrev = (Number(asset.y || 0) || 0) + sizePrev / 2

            const col = Math.max(0, Math.min(prevCols - 1, Math.floor(centerXPrev / cellWPrev)))
            const row = Math.max(0, Math.min(prevRows - 1, Math.floor(centerYPrev / cellHPrev)))

            const sizeNow = Math.round(cellWNow * mult)

            // New anchor in the new grid
            const anchorX = mult > 1 ? col * cellWNow : (col + 0.5) * cellWNow
            const anchorY = mult > 1 ? row * cellHNow : (row + 0.5) * cellHNow

            const nextX = Math.round(mult > 1 ? anchorX : anchorX - sizeNow / 2)
            const nextY = Math.round(mult > 1 ? anchorY : anchorY - sizeNow / 2)

            if (asset.x !== nextX || asset.y !== nextY) {
              asset.x = nextX
              asset.y = nextY
              moved = true
            }
          }
          return moved
        }

        const isInsideGrid = (asset) => {
          if (!asset) return false
          if (asset.renderW && asset.renderH) return true
          const mult = asset.multiplier || 1
          const w = Math.round(cellWNow * mult)
          const h = Math.round(cellHNow * mult)
          const left = Number(asset.x || 0) || 0
          const top = Number(asset.y || 0) || 0
          return left >= 0 && top >= 0 && left + w <= canvasWidth && top + h <= canvasHeight
        }

        const beforePlaced = placedAssets.value.length
        const beforeBg = backgroundImages.value.length

        const movedPlaced = repositionInPlace(placedAssets.value)
        const movedBg = repositionInPlace(backgroundImages.value)

        const prunedPlaced = (placedAssets.value || []).filter(isInsideGrid)
        const prunedBg = (backgroundImages.value || []).filter(isInsideGrid)

        const removed = prunedPlaced.length !== beforePlaced || prunedBg.length !== beforeBg

        // Only commit if something truly changed.
        if (movedPlaced || movedBg || removed) {
          pushHistory()
          placedAssets.value = prunedPlaced
          backgroundImages.value = prunedBg
        }
      } catch (e) {
        console.warn('error repositioning assets after grid change', e)
      }
    })
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

  // Pattern finder raster image background (placed behind everything)
  if (patternImageBackground.value && patternImageBackground.value.dataUrl) {
    try {
      const bg = patternImageBackground.value
      const nw = Number(bg.naturalW || 0) || 1
      const nh = Number(bg.naturalH || 0) || 1
      const cover = Math.max(exportW / nw, exportH / nh)
      const s = Number(bg.scale || 1) || 1
      const w = nw * cover * s
      const h = nh * cover * s
      const x = exportW / 2 - w / 2 + (Number(bg.x || 0) || 0)
      const y = exportH / 2 - h / 2 + (Number(bg.y || 0) || 0)
      const rot = Number(bg.rotation || 0) || 0
      const cx = x + w / 2
      const cy = y + h / 2
      svg += `<g transform="rotate(${rot} ${cx} ${cy})">\n`
      svg += `<image href="${svgEscape(bg.dataUrl)}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" />\n`
      svg += `</g>\n`
    } catch (e) {
      // ignore
    }
  }

  // Background images (uploaded) are rendered first so they sit under assets.
  // NOTE: Pattern finder background SVG is stored in backgroundImages too, but
  // it uses a different coordinate model (center anchored + scale).
  for (const a of backgroundImages.value) {
    const href = a.dataUrl || a.path
    if (!href) continue

    // Pattern finder big uploaded SVG background
    if (a.renderW && a.renderH) {
      const renderW = Number(a.renderW) || 0
      const renderH = Number(a.renderH) || 0
      const sBg = Number(a.scale || 1) || 1
      const rotation = Number(a.rotation || 0) || 0

      // bg.x/bg.y are WORLD units; on screen we translate by (x*scale, y*scale)
      const screenTx = (Number(a.x || 0) || 0) * sBg
      const screenTy = (Number(a.y || 0) || 0) * sBg

      // Convert screen px -> export px
      const tx = screenTx * scale
      const ty = screenTy * scale

      const rw = renderW * scale
      const rh = renderH * scale

      // Canvas center in export coords
      const cx = exportW / 2
      const cy = exportH / 2

      // Top-left if the image was centered at canvas center
      const baseX = cx - rw / 2
      const baseY = cy - rh / 2

      // Apply: translate to center, then bg translation, then rotate+scale about center.
      // Export must match on-screen tint, so we inline+recolor the SVG markup.
      svg += `<g transform="translate(${cx} ${cy}) translate(${tx} ${ty}) rotate(${rotation}) scale(${sBg}) translate(${-rw / 2} ${-rh / 2})">\n`

      try {
        const fetched = await fetchAssetDataUrl(href)
        if (fetched && fetched.type === 'svg' && typeof fetched.text === 'string') {
          const parts = extractSVGParts(fetched.text)
          const tintedInner = tintSVGWithDOM(fetched.text, selectedAssetColor.value)
          svg += `<svg x="0" y="0" width="${rw}" height="${rh}" viewBox="${parts.minX} ${parts.minY} ${parts.vbW} ${parts.vbH}" preserveAspectRatio="xMidYMid meet">\n`
          svg += `${tintedInner}\n`
          svg += `</svg>\n`
        } else {
          // Fallback: embed as image if we couldn't inline.
          const imgHref = fetched && fetched.dataUrl ? fetched.dataUrl : href
          svg += `<image href="${svgEscape(imgHref)}" x="0" y="0" width="${rw}" height="${rh}" preserveAspectRatio="xMidYMid meet" />\n`
        }
      } catch (e) {
        svg += `<image href="${svgEscape(href)}" x="0" y="0" width="${rw}" height="${rh}" preserveAspectRatio="xMidYMid meet" />\n`
      }

      svg += `</g>\n`
      continue
    }

    // Normal uploaded images: top-left anchored; preserve aspect ratio when possible
    const rx = (a.x || 0) * scale
    const ry = (a.y || 0) * scale
    const rwBase = a.renderW || getAssetPixelSize(a)
    const rhBase = (() => {
      if (a.renderH) return a.renderH
      const nw = Number(a.naturalW || 0)
      const nh = Number(a.naturalH || 0)
      if (nw > 0 && nh > 0) return rwBase * (nh / nw)
      return rwBase
    })()
    const rw = rwBase * scale
    const rh = rhBase * scale
    const rotation = a.rotation || 0
    const cx = rx + rw / 2
    const cy = ry + rh / 2
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
      // Tint using DOM parser to reliably replace fills/styles.
      // Use the per-asset color if present; fall back to the currently selected UI color.
      const tintColor = a && a.color ? a.color : selectedAssetColor.value
      const tintedInner = tintSVGWithDOM(fetched.text, tintColor)

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

// Export scale (supersampling): higher = sharper edges + better raster quality.
// 1 = native preset resolution, 2/3 = larger raster (user can downscale later).
const exportScale = ref(2)

const exportRasterFromSVG = async (type = 'image/png', quality = 0.92, scaleFactor = null) => {
  // Build an inlined SVG (assets embedded) and rasterize it to a data URL.
  const svgString = await getExportSVGStringAsync()
  if (!svgString) return null
  const exportW = currentCanvasPreset.value.width
  const exportH = currentCanvasPreset.value.height
  const sf = Number(scaleFactor || exportScale.value || 1) || 1
  const outW = Math.max(1, Math.round(exportW * sf))
  const outH = Math.max(1, Math.round(exportH * sf))
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
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')
    // Prefer highest-quality resampling when shapes/images are rasterized.
    try {
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
    } catch (e) {
      // ignore (older browsers)
    }
    // White background for JPG (SVG may be transparent)
    if (type === 'image/jpeg') {
      ctx.fillStyle = selectedBackgroundColor.value || '#ffffff'
      ctx.fillRect(0, 0, outW, outH)
    }
    ctx.drawImage(img, 0, 0, outW, outH)
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

// Close preset dropdown on outside click / Escape
const onDocPointerDownForPreset = (e) => {
  try {
    if (!presetDropdownOpen.value) return
    const root = presetDropdownRef.value
    if (!root) return
    const t = e?.target
    if (t && root.contains && root.contains(t)) return
    closePresetDropdown()
  } catch (err) {
    closePresetDropdown()
  }
}

const onDocKeyDownForPreset = (e) => {
  if (!presetDropdownOpen.value) return
  if (e && (e.key === 'Escape' || e.key === 'Esc')) {
    e.preventDefault()
    closePresetDropdown()
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
      const dataUrl = ev.target.result

      // Capture the image's natural dimensions so we can preserve aspect ratio
      // when rendering and exporting.
      try {
        const img = new Image()
        img.onload = () => {
          uploadedImages.value.push({
            name: file.name,
            path: dataUrl,
            dataUrl,
            isUploaded: true,
            naturalW: img.naturalWidth || img.width || null,
            naturalH: img.naturalHeight || img.height || null,
          })
        }
        img.onerror = () => {
          uploadedImages.value.push({
            name: file.name,
            path: dataUrl,
            dataUrl,
            isUploaded: true,
          })
        }
        img.src = dataUrl
      } catch (e) {
        uploadedImages.value.push({
          name: file.name,
          path: dataUrl,
          dataUrl,
          isUploaded: true,
        })
      }
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
        <div ref="presetDropdownRef" class="preset-dropdown w-[95%]">
          <button
            type="button"
            class="select preset-dropdown__button font-object font-regular cursor-pointer"
            :aria-expanded="presetDropdownOpen ? 'true' : 'false'"
            aria-haspopup="listbox"
            @click.prevent="togglePresetDropdown"
          >
            {{ currentCanvasPreset.name }} ({{ currentCanvasPreset.width }} x
            {{ currentCanvasPreset.height }}px)
          </button>

          <div v-if="presetDropdownOpen" class="preset-dropdown__menu" role="listbox">
            <button
              v-for="preset in canvasDimensions"
              :key="preset.name"
              type="button"
              class="preset-dropdown__option"
              :class="{ selected: preset.name === currentCanvasPreset.name }"
              role="option"
              :aria-selected="preset.name === currentCanvasPreset.name ? 'true' : 'false'"
              @click.prevent="onSelectCanvasPresetName(preset.name)"
            >
              {{ preset.name }} ({{ preset.width }} x {{ preset.height }}px)
            </button>
          </div>
        </div>

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
            v-for="preset in predefinedPresets"
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
            :disabled="!canInvertColors"
            :class="{ disabled: !canInvertColors }"
            @click="invertColors"
            title="Swap background and asset color"
          >
            ↔
          </button>
        </div>

        <div v-if="customPresets.length" class="color-presets color-presets--custom">
          <button
            v-for="preset in customPresets"
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

            <button
              type="button"
              class="custom-swatch-remove"
              @click.stop="removeCustomSwatch(preset)"
              title="Remove swatch"
            >
              ×
            </button>
          </button>
        </div>

        <div class="custom-swatch-controls">
          <div class="custom-swatch-row my-2">
            <label class="custom-swatch-label font-object">BG</label>
            <input type="color" v-model="selectedBackgroundColor" class="custom-swatch-input" />
            <label class="custom-swatch-label font-object">Asset</label>
            <input type="color" v-model="selectedAssetColor" class="custom-swatch-input" />

            <button
              type="button"
              class="btn btn--sm ml-2 custom-swatch-add font-object font-regular p-1 border-2 rounded cursor-pointer"
              @click="addCustomSwatch"
            >
              + Add swatch
            </button>
          </div>
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
          <button
            class="btn btn--sm ont-object font-regular p-1 border-2 rounded cursor-pointer w-[95%] mb-4"
            @click.prevent="randomizePattern"
          >
            Pattern Randomizer
          </button>
          <p class="font-object text-xs mb-2 text-gray-900">Chose size</p>
          <div class="flex gap-2 mb-4 w-[95%] items-center">
            <button
              @click="changeAssetSize(1)"
              :class="[
                'btn btn--sm px-2 border-2 cursor-pointer',
                { 'is-active': assetMultiplier === 1 },
              ]"
            >
              x1
            </button>
            <button
              @click="changeAssetSize(2)"
              :class="[
                'btn btn--sm px-2 border-2 cursor-pointer',
                { 'is-active': assetMultiplier === 2 },
              ]"
            >
              x2
            </button>

            <button
              class="btn btn--sm font-object font-regular px-2 border-2 rounded cursor-pointer flex-1"
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
        </div>

        <!-- Pattern finder-only UI -->
        <div v-else class="mt-10">
          <!-- pattern finder content goes here -->
          <h2 class="font-object font-medium text-base mt-10">Upload SVG</h2>
          <p class="font-object text-xs mb-3 text-gray-500">
            Upload svg to be able to drag around.
          </p>
          <button class="btn btn--sm cursor-pointer w-[95%]" @click.prevent="openUploadSvgPicker">
            + Upload SVG
          </button>

          <h2 class="font-object font-medium text-base mt-10">Upload image background</h2>
          <p class="font-object text-xs mb-3 text-gray-500">
            Upload an image that replaces the background. Click to upload, then
            <strong>hold alt/option down and drag to move.</strong>
          </p>

          <div class="flex gap-2 w-[95%] mb-2">
            <button
              class="btn btn--sm cursor-pointer flex-1"
              @click.prevent="openUploadPatternImagePicker"
            >
              + Upload image
            </button>
            <button
              v-if="patternImageBackground"
              class="btn btn--sm cursor-pointer px-2"
              @click.prevent="removePatternImageBackground"
              title="Remove"
            >
              ×
            </button>
          </div>

          <input
            ref="uploadPatternImageInputRef"
            type="file"
            accept="image/*"
            class="hidden"
            @change="onUploadPatternImageBackground"
          />

          <div v-if="patternImageBackground" class="slidercontainer w-[95%] mb-2">
            <p class="font-object text-xs mb-1 text-gray-900">Scale</p>
            <input
              class="slider"
              type="range"
              min="0.25"
              max="3"
              step="0.01"
              :value="patternImageScale"
              @input="updatePatternImageBackgroundScale($event.target.value)"
            />
          </div>

          <h2 class="font-object font-medium text-base mt-10">Controls</h2>
          <p class="font-object text-xs mb-2 text-gray-500">
            Enable/disable pattern randomization options.
          </p>

          <button
            class="btn btn--sm ont-object font-regular p-1 border-2 rounded cursor-pointer w-[95%] mt-1 mb-2"
            @click.prevent="randomizePatternBackgroundPosition"
          >
            Random
          </button>

          <div class="flex gap-2 w-[95%] mt-2">
            <button
              type="button"
              @click.prevent="randomizePatternControls.scale = !randomizePatternControls.scale"
              :class="[
                'btn btn--sm px-2 border-2 cursor-pointer flex-1',
                { 'is-active': randomizePatternControls.scale },
              ]"
              :style="{ opacity: randomizePatternControls.scale ? 1 : 0.35 }"
            >
              Scale
            </button>
            <button
              type="button"
              @click.prevent="randomizePatternControls.x = !randomizePatternControls.x"
              :class="[
                'btn btn--sm px-2 border-2 cursor-pointer flex-1',
                { 'is-active': randomizePatternControls.x },
              ]"
              :style="{ opacity: randomizePatternControls.x ? 1 : 0.35 }"
            >
              X
            </button>
            <button
              type="button"
              @click.prevent="randomizePatternControls.y = !randomizePatternControls.y"
              :class="[
                'btn btn--sm px-2 border-2 cursor-pointer flex-1',
                { 'is-active': randomizePatternControls.y },
              ]"
              :style="{ opacity: randomizePatternControls.y ? 1 : 0.35 }"
            >
              Y
            </button>
            <button
              type="button"
              @click.prevent="
                randomizePatternControls.rotation = !randomizePatternControls.rotation
              "
              :class="[
                'btn btn--sm px-2 border-2 cursor-pointer flex-1',
                { 'is-active': randomizePatternControls.rotation },
              ]"
              :style="{ opacity: randomizePatternControls.rotation ? 1 : 0.35 }"
            >
              Rot
            </button>
          </div>

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
              min="0"
              max="270"
              step="90"
              v-model.number="patternBackground.rotation"
              class="slider w-[95%]"
              @input="
                () => {
                  const bg = backgroundImages[0]
                  // Snap to 90° steps
                  const snapped =
                    (((Math.round((patternBackground.rotation || 0) / 90) * 90) % 360) + 360) % 360
                  patternBackground.rotation = snapped
                  if (bg && bg.renderW && bg.renderH) bg.rotation = snapped
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
        <div class="flex gap-2 mb-4 items-center w-[95%]">
          <button
            @click="changeBackgroundImageSize(1)"
            :class="[
              'btn btn--sm px-2 border-2 cursor-pointer',
              { 'is-active': backgroundImageMultiplier === 1 },
            ]"
          >
            1
          </button>
          <button
            @click="changeBackgroundImageSize(2)"
            :class="[
              'btn btn--sm px-2 border-2 cursor-pointer',
              { 'is-active': backgroundImageMultiplier === 2 },
            ]"
          >
            2
          </button>
          <button
            @click="changeBackgroundImageSize(3)"
            :class="[
              'btn btn--sm px-2 border-2 cursor-pointer',
              { 'is-active': backgroundImageMultiplier === 3 },
            ]"
          >
            3
          </button>
          <button
            @click="changeBackgroundImageSize(4)"
            :class="[
              'btn btn--sm px-2 border-2 cursor-pointer',
              { 'is-active': backgroundImageMultiplier === 4 },
            ]"
          >
            4
          </button>

          <button
            class="btn btn--sm font-object font-regular px-2 border-2 rounded cursor-pointer flex-1"
            @click.prevent="uploadInputRef.click()"
          >
            + Upload image
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
        <div class="mb-2">
          <label class="font-object text-xs block mb-1">Export quality (scale)</label>
          <select v-model.number="exportScale" class="select w-full">
            <option :value="2">Sharp</option>
            <option :value="3">Very sharp</option>
          </select>
        </div>
        <div class="flex gap-2 mb-4">
          <button class="btn btn--sm px-2 cursor-pointer" @click.prevent="exportAsPDF">PDF</button>
          <button class="btn btn--sm px-2 cursor-pointer" @click.prevent="exportAsSVG">SVG</button>
          <button class="btn btn--sm px-2 cursor-pointer" @click.prevent="exportAsPNG">PNG</button>
          <button class="btn btn--sm px-2 cursor-pointer" @click.prevent="exportAsJPG">JPG</button>
        </div>
      </div>
    </div>

    <!-- Canvas Section -->
    <div ref="canvasColumnRef" class="canvas m-2">
      <div v-if="showDeviceWarning" class="device-warning" role="alert">
        <div class="device-warning__text font-object">
          <span class="device-warning__icon" aria-hidden="true">!</span>
          <span>
            This page is not meant for mobile devices or tablets. Please use a desktop for the best
            experience.
          </span>
        </div>
        <button
          type="button"
          class="device-warning__close"
          @click="dismissDeviceWarning"
          aria-label="Luk"
        >
          ×
        </button>
      </div>

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
          <!-- Pattern finder raster image background (full-cover). Drag ONLY with Alt/Option. -->
          <img
            v-if="
              editorMode === 'pattern' && patternImageBackground && patternImageBackground.dataUrl
            "
            class="pattern-image-bg"
            draggable="false"
            :src="patternImageBackground.dataUrl"
            :alt="patternImageBackground.name || 'Pattern image background'"
            :style="
              (() => {
                try {
                  const bg = patternImageBackground
                  const nw = Number(bg.naturalW || 0) || 1
                  const nh = Number(bg.naturalH || 0) || 1
                  const rect = canvasRef
                    ? canvasRef.getBoundingClientRect()
                    : { width: 1, height: 1 }
                  const cover = Math.max(rect.width / nw, rect.height / nh)
                  const s = Number(bg.scale || 1) || 1
                  const w = nw * cover * s
                  const h = nh * cover * s
                  return {
                    position: 'absolute',
                    left: rect.width / 2 - w / 2 + (bg.x || 0) + 'px',
                    top: rect.height / 2 - h / 2 + (bg.y || 0) + 'px',
                    width: w + 'px',
                    height: h + 'px',
                    objectFit: 'cover',
                    zIndex: 0,
                    pointerEvents: 'none',
                    transform: `rotate(${bg.rotation || 0}deg)`,
                    transformOrigin: 'center center',
                  }
                } catch (e) {
                  return {
                    position: 'absolute',
                    inset: '0',
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    zIndex: 0,
                    pointerEvents: 'none',
                  }
                }
              })()
            "
          />

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
                class="placed-asset-shape pattern-bg-wrapper"
                draggable="false"
                :class="{ dragging: draggedPlacedAsset && draggedPlacedAsset.id === img.id }"
                :data-id="img.id"
                @click="onAssetClick(img, $event)"
                :style="{
                  left: canvasCenterCss.left,
                  top: canvasCenterCss.top,
                  width: img.renderW + 'px',
                  height: img.renderH + 'px',
                  // Wrapper is centered on the visible canvas.
                  // x/y are pure translation offsets from that center.
                  transform: `translate(-50%, -50%) translate(${(img.x || 0) * (img.scale || 1)}px, ${(img.y || 0) * (img.scale || 1)}px)`,
                  transformOrigin: 'center center',
                  opacity: 1,
                }"
              >
                <div
                  class="pattern-bg-shape"
                  :style="{
                    width: '100%',
                    height: '100%',
                    background: selectedAssetColor,
                    WebkitMaskImage: `url(${img.dataUrl || img.path})`,
                    maskImage: `url(${img.dataUrl || img.path})`,
                    WebkitMaskSize: 'contain',
                    maskSize: 'contain',
                    WebkitMaskRepeat: 'no-repeat',
                    maskRepeat: 'no-repeat',
                    WebkitMaskPosition: 'center',
                    maskPosition: 'center',
                    // Inner node rotates/scales around its own center.
                    transform: `rotate(${img.rotation || 0}deg) scale(${img.scale || 1})`,
                    transformOrigin: 'center center',
                  }"
                />
              </div>

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
                  height: 'auto',
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
                background: asset.color || selectedAssetColor,
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

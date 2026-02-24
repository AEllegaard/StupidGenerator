import * as pf from './patternFinder.js'

// Snapshot and history helpers
export function getSnapshot(ctx) {
  return {
    placedAssets: JSON.parse(JSON.stringify(ctx.placedAssets.value)),
    selectedBackgroundColor: ctx.selectedBackgroundColor.value,
    selectedAssetColor: ctx.selectedAssetColor.value,
    gridSize: ctx.gridSize.value,
    currentCanvasPresetName: ctx.currentCanvasPreset.value?.name,
  }
}

export function pushHistory(ctx) {
  try {
    const snap = getSnapshot(ctx)
    const last = ctx.historyStack.value[ctx.historyStack.value.length - 1]
    if (last && JSON.stringify(last) === JSON.stringify(snap)) return
    ctx.historyStack.value.push(snap)
    ctx.redoStack.value = []
    if (ctx.historyStack.value.length > ctx.maxHistory) ctx.historyStack.value.shift()
  } catch (e) {
    console.error('pushHistory error', e)
  }
}

export function applySnapshot(ctx, snap) {
  if (!snap) return
  ctx.placedAssets.value = JSON.parse(JSON.stringify(snap.placedAssets || []))
  ctx.selectedBackgroundColor.value =
    snap.selectedBackgroundColor || ctx.selectedBackgroundColor.value
  ctx.selectedAssetColor.value = snap.selectedAssetColor || ctx.selectedAssetColor.value
  ctx.gridSize.value = snap.gridSize || ctx.gridSize.value
  if (snap.currentCanvasPresetName) {
    const p = ctx.canvasDimensions.find((c) => c.name === snap.currentCanvasPresetName)
    if (p) ctx.currentCanvasPreset.value = p
  }
}

export function undo(ctx) {
  if (ctx.historyStack.value.length === 0) return
  try {
    ctx.redoStack.value.push(getSnapshot(ctx))
    if (ctx.redoStack.value.length > ctx.maxRedo) ctx.redoStack.value.shift()
  } catch (e) {
    console.error('undo push to redo error', e)
  }
  const snap = ctx.historyStack.value.pop()
  applySnapshot(ctx, snap)
}

export function redo(ctx) {
  if (ctx.redoStack.value.length === 0) return
  try {
    ctx.historyStack.value.push(getSnapshot(ctx))
    if (ctx.historyStack.value.length > ctx.maxHistory) ctx.historyStack.value.shift()
  } catch (e) {
    console.error('redo push to history error', e)
  }
  const snap = ctx.redoStack.value.pop()
  applySnapshot(ctx, snap)
}

export function onKeyDown(ctx, e) {
  const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')
  const isRedo = (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z')
  if (isUndo) {
    e.preventDefault()
    undo(ctx)
  } else if (isRedo) {
    e.preventDefault()
    redo(ctx)
  }
}

// Palette drag/drop
export function startDrag(ctx, asset, event) {
  ctx.draggedAsset.value = asset
  try {
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData('text/plain', asset.name)
  } catch (e) {
    // ignore when not available
  }
  ctx.trashVisible.value = true
  ctx.draggedOverTrash.value = false
}

export function onDragEnd(ctx, event) {
  ctx.trashVisible.value = false
  ctx.draggedOverTrash.value = false
  ctx.draggedAsset.value = null
}

export function onDragOver(ctx, event) {
  event.preventDefault()
  try {
    event.dataTransfer.dropEffect = 'copy'
  } catch (e) {}
}

export function onTrashDragOver(ctx, e) {
  e.preventDefault()
}
export function onTrashDragLeave(ctx, e) {}
export function onTrashDrop(ctx, e) {
  e.preventDefault()
  ctx.draggedAsset.value = null
  ctx.trashVisible.value = false
  ctx.draggedOverTrash.value = false
}

// Handle drop from palette onto canvas
export function onDrop(ctx, event) {
  event.preventDefault()
  if (!ctx.draggedAsset.value || !ctx.canvasRef.value) return

  const canvasRect = ctx.canvasRef.value.getBoundingClientRect()
  const canvasWidth = canvasRect.width
  const canvasHeight = canvasRect.height

  // Get drop position relative to canvas
  const x = event.clientX - canvasRect.left
  const y = event.clientY - canvasRect.top

  // Calculate cell dimensions in pixels
  const cellWidth = canvasWidth / ctx.gridColumns.value
  const cellHeight = canvasHeight / ctx.gridRows.value

  let snappedX, snappedY

  if (ctx.draggedAsset.value.snapType === 'intersection') {
    snappedX = Math.round(x / cellWidth) * cellWidth
    snappedY = Math.round(y / cellHeight) * cellHeight
  } else if (ctx.draggedAsset.value.snapType === 'edge') {
    const leftEdge = Math.floor(x / cellWidth) * cellWidth
    const rightEdge = Math.ceil(x / cellWidth) * cellWidth
    const topEdge = Math.floor(y / cellHeight) * cellHeight
    const bottomEdge = Math.ceil(y / cellHeight) * cellHeight

    const midpoints = [
      { x: (leftEdge + rightEdge) / 2, y: topEdge },
      { x: (leftEdge + rightEdge) / 2, y: bottomEdge },
      { x: leftEdge, y: (topEdge + bottomEdge) / 2 },
      { x: rightEdge, y: (topEdge + bottomEdge) / 2 },
    ]

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
    const leftEdge = Math.floor(x / cellWidth) * cellWidth
    const rightEdge = Math.ceil(x / cellWidth) * cellWidth
    const topEdge = Math.floor(y / cellHeight) * cellHeight
    const bottomEdge = Math.ceil(y / cellHeight) * cellHeight

    const corners = [
      { x: leftEdge, y: topEdge },
      { x: rightEdge, y: topEdge },
      { x: leftEdge, y: bottomEdge },
      { x: rightEdge, y: bottomEdge },
    ]

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

  const currentMultiplier = ctx.assetMultiplier.value || 1
  const currentAssetSize = Math.round(cellWidth * currentMultiplier)
  const dropOffsetX = (ctx.draggedAsset.value.offsetX || 0) * currentAssetSize
  const dropOffsetY = (ctx.draggedAsset.value.offsetY || 0) * currentAssetSize

  let finalX, finalY
  if (currentMultiplier === 1) {
    const col = Math.max(0, Math.min(ctx.gridColumns.value - 1, Math.floor(snappedX / cellWidth)))
    const row = Math.max(0, Math.min(ctx.gridRows.value - 1, Math.floor(snappedY / cellWidth)))
    finalX = col * cellWidth
    finalY = row * cellWidth
  } else {
    finalX = snappedX - currentAssetSize / 2
    finalY = snappedY - currentAssetSize / 2
  }

  finalX += dropOffsetX
  finalY += dropOffsetY

  finalX = Math.round(finalX)
  finalY = Math.round(finalY)
  finalX = Math.max(0, Math.min(finalX, canvasWidth - currentAssetSize))
  finalY = Math.max(0, Math.min(finalY, canvasHeight - currentAssetSize))

  pushHistory(ctx)

  ctx.placedAssets.value.push({
    ...ctx.draggedAsset.value,
    x: finalX,
    y: finalY,
    rotation: 0,
    id: Date.now(),
    multiplier: currentMultiplier,
  })

  ctx.trashVisible.value = false
  ctx.draggedOverTrash.value = false
  ctx.draggedAsset.value = null
}

// Spawn centered (uses patternFinder helpers)
export function spawnAssetCentered(ctx, asset) {
  if (!ctx.canvasRef.value) return
  try {
    const canvasRect = ctx.canvasRef.value.getBoundingClientRect()
    const canvasWidth = canvasRect.width
    const canvasHeight = canvasRect.height
    const centerX = canvasWidth / 2
    const centerY = canvasHeight / 2
    const snapAnchor = pf.computeSnapFromPointer(
      centerX,
      centerY,
      asset.snapType,
      canvasWidth,
      canvasHeight,
      ctx.gridColumns.value,
    )
    const currentMultiplier = ctx.assetMultiplier.value || 1
    const cellWidth = canvasWidth / ctx.gridColumns.value
    const currentAssetSize = Math.round(cellWidth * currentMultiplier)
    const dropOffsetX = (asset.offsetX || 0) * currentAssetSize
    const dropOffsetY = (asset.offsetY || 0) * currentAssetSize
    let finalX, finalY
    if (currentMultiplier === 1) {
      const col = Math.max(
        0,
        Math.min(ctx.gridColumns.value - 1, Math.floor(snapAnchor.x / cellWidth)),
      )
      const row = Math.max(
        0,
        Math.min(ctx.gridRows.value - 1, Math.floor(snapAnchor.y / cellWidth)),
      )
      finalX = Math.round(col * cellWidth + dropOffsetX)
      finalY = Math.round(row * cellWidth + dropOffsetY)
    } else {
      finalX = Math.round(snapAnchor.x - currentAssetSize / 2 + dropOffsetX)
      finalY = Math.round(snapAnchor.y - currentAssetSize / 2 + dropOffsetY)
    }
    finalX = Math.max(0, Math.min(finalX, canvasWidth - currentAssetSize))
    finalY = Math.max(0, Math.min(finalY, canvasHeight - currentAssetSize))
    pushHistory(ctx)
    ctx.placedAssets.value.push({
      ...asset,
      x: finalX,
      y: finalY,
      rotation: 0,
      id: Date.now(),
      multiplier: currentMultiplier,
    })
  } catch (e) {
    // ignore
  }
}

// Move existing assets
export function startMovingAsset(ctx, asset, event, el = null) {
  ctx.draggedPlacedAsset.value = asset
  const canvasRect = ctx.canvasRef.value.getBoundingClientRect()
  const mouseX = event.clientX - canvasRect.left
  const mouseY = event.clientY - canvasRect.top
  try {
    if (el && el.getBoundingClientRect) {
      const elRect = el.getBoundingClientRect()
      const elLeftRel = elRect.left - canvasRect.left
      const elTopRel = elRect.top - canvasRect.top
      ctx.dragOffset.value = { x: mouseX - elLeftRel, y: mouseY - elTopRel }
      ctx.draggedElement.value = el
    } else {
      ctx.dragOffset.value = { x: mouseX - asset.x, y: mouseY - asset.y }
    }
  } catch (e) {
    ctx.dragOffset.value = { x: mouseX - asset.x, y: mouseY - asset.y }
  }
  ctx.draggedDuringInteraction.value = false
  ctx.trashVisible.value = true
  ctx.draggedOverTrash.value = false
  ctx.dragActive.value = true
  if (!ctx.moveListenersAdded.value) {
    ctx._globalMoveHandler.fn = (e) => onCanvasMouseMove(ctx, e)
    ctx._globalUpHandler.fn = (e) => onCanvasMouseUp(ctx, e)
    window.addEventListener('mousemove', ctx._globalMoveHandler.fn)
    window.addEventListener('mouseup', ctx._globalUpHandler.fn)
    ctx.moveListenersAdded.value = true
  }
}

export function onAssetsLayerMouseDown(ctx, event) {
  const el = event.target.closest && event.target.closest('.placed-asset-shape')
  if (!el) return
  const id = el.dataset && el.dataset.id
  if (!id) return
  const found = ctx.placedAssets.value.find((a) => String(a.id) === String(id))
  if (!found) return
  startMovingAsset(ctx, found, event, el)
  event.preventDefault()
}

export function onCanvasMouseMove(ctx, event) {
  if (!ctx.draggedPlacedAsset.value || !ctx.canvasRef.value) return
  ctx.draggedDuringInteraction.value = true
  const canvasRect = ctx.canvasRef.value.getBoundingClientRect()
  const canvasWidth = canvasRect.width
  const canvasHeight = canvasRect.height
  const rawX = event.clientX - canvasRect.left - ctx.dragOffset.value.x
  const rawY = event.clientY - canvasRect.top - ctx.dragOffset.value.y
  const cellWidth = canvasWidth / ctx.gridColumns.value
  const cellHeight = cellWidth

  let snappedX, snappedY
  if (ctx.draggedPlacedAsset.value.snapType === 'intersection') {
    snappedX = Math.round((rawX + ctx.dragOffset.value.x) / cellWidth) * cellWidth
    snappedY = Math.round((rawY + ctx.dragOffset.value.y) / cellHeight) * cellHeight
  } else if (ctx.draggedPlacedAsset.value.snapType === 'edge') {
    const px = rawX + ctx.dragOffset.value.x
    const py = rawY + ctx.dragOffset.value.y
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
    const px = rawX + ctx.dragOffset.value.x
    const py = rawY + ctx.dragOffset.value.y
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

  const clampedSnappedX = Math.max(0, Math.min(snappedX, canvasWidth))
  const clampedSnappedY = Math.max(0, Math.min(snappedY, canvasHeight))
  ctx.lastSnap.value = { x: clampedSnappedX, y: clampedSnappedY }

  const currentDraggingAssetSize = pf.getAssetPixelSize(ctx, ctx.draggedPlacedAsset.value)

  let displayX = rawX
  let displayY = rawY
  if (ctx.draggedPlacedAsset.value.offsetX)
    displayX += (ctx.draggedPlacedAsset.value.offsetX || 0) * currentDraggingAssetSize
  if (ctx.draggedPlacedAsset.value.offsetY)
    displayY += (ctx.draggedPlacedAsset.value.offsetY || 0) * currentDraggingAssetSize
  displayX = Math.round(displayX)
  displayY = Math.round(displayY)

  ctx.draggedPlacedAsset.value.x = displayX
  ctx.draggedPlacedAsset.value.y = displayY

  if (ctx.trashRef.value) {
    const trashRect = ctx.trashRef.value.getBoundingClientRect()
    let assetRect
    try {
      if (ctx.draggedElement.value && ctx.draggedElement.value.getBoundingClientRect) {
        const elRect = ctx.draggedElement.value.getBoundingClientRect()
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
    ctx.draggedOverTrash.value = intersects
  }
}

export function onCanvasMouseUp(ctx, event) {
  if (ctx.draggedPlacedAsset.value) {
    if (event && ctx.trashRef.value) {
      try {
        const tRect = ctx.trashRef.value.getBoundingClientRect()
        const px = event.clientX
        const py = event.clientY
        const pointerOverTrash =
          px >= tRect.left && px <= tRect.right && py >= tRect.top && py <= tRect.bottom
        ctx.draggedOverTrash.value = pointerOverTrash
        if (pointerOverTrash) {
          pushHistory(ctx)
          const idToRemove = ctx.draggedPlacedAsset.value.id
          const idx = ctx.placedAssets.value.findIndex((a) => a.id === idToRemove)
          if (idx !== -1) ctx.placedAssets.value.splice(idx, 1)
          ctx.draggedPlacedAsset.value = null
          ctx.draggedOverTrash.value = false
          ctx.trashVisible.value = false
          return
        }
      } catch (e) {}
    }
    const asset = ctx.draggedPlacedAsset.value
    let finalX, finalY
    const displayX = asset.x
    const displayY = asset.y
    const currentAssetSize = pf.getAssetPixelSize(ctx, asset)
    if (ctx.lastSnap.value && typeof ctx.lastSnap.value.x === 'number') {
      const dropOffsetX = (asset.offsetX || 0) * currentAssetSize
      const dropOffsetY = (asset.offsetY || 0) * currentAssetSize
      const canvasRectNow = ctx.canvasRef.value.getBoundingClientRect()
      let pointerX = event ? event.clientX - canvasRectNow.left : null
      let pointerY = event ? event.clientY - canvasRectNow.top : null
      if (pointerX !== null && pointerY !== null) {
        pointerX = Math.max(0, Math.min(pointerX, canvasRectNow.width))
        pointerY = Math.max(0, Math.min(pointerY, canvasRectNow.height))
      }
      let snapAnchor = ctx.lastSnap.value
      if (asset.snapType === 'corner' && pointerX !== null && pointerY !== null) {
        snapAnchor = pf.computeSnapFromPointer(
          pointerX,
          pointerY,
          asset.snapType,
          canvasRectNow.width,
          canvasRectNow.height,
          ctx.gridColumns.value,
        )
      }
      const currentMultiplier = asset.multiplier || ctx.assetMultiplier.value || 1
      const cellWidthNow = canvasRectNow.width / ctx.gridColumns.value
      let snappedTopLeftX, snappedTopLeftY
      if (currentMultiplier === 1) {
        const col = Math.max(
          0,
          Math.min(ctx.gridColumns.value - 1, Math.floor(snapAnchor.x / cellWidthNow)),
        )
        const row = Math.max(
          0,
          Math.min(ctx.gridRows.value - 1, Math.floor(snapAnchor.y / cellWidthNow)),
        )
        snappedTopLeftX = col * cellWidthNow
        snappedTopLeftY = row * cellWidthNow
      } else {
        snappedTopLeftX = snapAnchor.x - currentAssetSize / 2
        snappedTopLeftY = snapAnchor.y - currentAssetSize / 2
      }
      const candidateX = snappedTopLeftX + dropOffsetX
      const candidateY = snappedTopLeftY + dropOffsetY
      let shouldSnap = false
      if (pointerX !== null && pointerY !== null) {
        const dxp = pointerX - snapAnchor.x
        const dyp = pointerY - snapAnchor.y
        const pointerDist = Math.hypot(dxp, dyp)
        const cellWidthNow2 = canvasRectNow.width / ctx.gridColumns.value
        const snapTolerance = Math.max(
          8,
          Math.min(currentAssetSize * 0.8, Math.max(cellWidthNow2 || 0, currentAssetSize * 0.5)),
        )
        shouldSnap = pointerDist <= snapTolerance
      } else {
        const dx = candidateX - displayX
        const dy = candidateY - displayY
        const moveDist = Math.hypot(dx, dy)
        const snapTolerance = Math.max(8, currentAssetSize * 0.6)
        shouldSnap = moveDist <= snapTolerance
      }
      if (shouldSnap) {
        finalX = Math.round(candidateX)
        finalY = Math.round(candidateY)
      } else {
        finalX = Math.round(displayX)
        finalY = Math.round(displayY)
      }
    } else {
      finalX = Math.round(displayX)
      finalY = Math.round(displayY)
    }
    const canvasRect = ctx.canvasRef.value.getBoundingClientRect()
    const canvasWidth = canvasRect.width
    const canvasHeight = canvasRect.height
    const minX = -Math.floor(currentAssetSize) + 1
    const minY = -Math.floor(currentAssetSize) + 1
    const maxX = Math.max(1, canvasWidth - 1)
    const maxY = Math.max(1, canvasHeight - 1)
    finalX = Math.max(minX, Math.min(finalX, maxX))
    finalY = Math.max(minY, Math.min(finalY, maxY))
    pushHistory(ctx)
    asset.x = finalX
    asset.y = finalY
    ctx.dragActive.value = false
    if (ctx.draggedDuringInteraction.value) {
      ctx.justDragged.value = true
      setTimeout(() => (ctx.justDragged.value = false), 250)
    }
    ctx.draggedDuringInteraction.value = false
  }
  ctx.draggedPlacedAsset.value = null
  ctx.trashVisible.value = false
  ctx.draggedOverTrash.value = false
  ctx.draggedElement.value = null
  if (ctx.moveListenersAdded.value) {
    try {
      if (ctx._globalMoveHandler.fn)
        window.removeEventListener('mousemove', ctx._globalMoveHandler.fn)
      if (ctx._globalUpHandler.fn) window.removeEventListener('mouseup', ctx._globalUpHandler.fn)
    } catch (e) {}
    ctx._globalMoveHandler.fn = null
    ctx._globalUpHandler.fn = null
    ctx.moveListenersAdded.value = false
  }
}

export function changeAssetSize(ctx, mult) {
  if (mult !== 1 && mult !== 2) return
  ctx.assetMultiplier.value = mult
}

export function rotateAsset(ctx, asset) {
  pushHistory(ctx)
  asset.rotation = ((asset.rotation || 0) + 90) % 360
}

export function onAssetClick(ctx, asset, event) {
  if (ctx.draggedDuringInteraction.value) return
  if (ctx.justDragged.value) return
  rotateAsset(ctx, asset)
}

// helper utilities for snapping, sizing and export (inlining assets)
export const svgEscape = (str) =>
  String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

// compute snapped anchor based on pointer and grid columns
export function computeSnapFromPointer(
  pointerX,
  pointerY,
  snapType,
  canvasWidth,
  canvasHeight,
  gridColumns,
) {
  const cellWidth = canvasWidth / gridColumns
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

// compute placed asset pixel size using canvasRef and gridColumns
export function getAssetPixelSize(ctx, asset) {
  try {
    if (!ctx.canvasRef.value) return asset.size || (ctx.assetSize && ctx.assetSize.value)
    const canvasRect = ctx.canvasRef.value.getBoundingClientRect()
    if (!canvasRect || canvasRect.width === 0)
      return asset.size || (ctx.assetSize && ctx.assetSize.value)
    const cellWidthNow = canvasRect.width / ctx.gridColumns.value
    if (asset.multiplier || asset.multiplier === 0) {
      const mult = asset.multiplier || 1
      return Math.round(cellWidthNow * mult)
    }
    if (asset.size) return asset.size
    return ctx.assetSize
      ? ctx.assetSize.value
      : Math.round(cellWidthNow * (ctx.assetMultiplier?.value || 1))
  } catch (e) {
    return asset.size || (ctx.assetSize && ctx.assetSize.value)
  }
}

// blob -> base64
export const blobToBase64 = (blob) =>
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

// fetch asset and return data URL
export const fetchAssetDataUrl = async (path) => {
  try {
    const res = await fetch(path, { cache: 'no-store' })
    if (!res.ok) throw new Error('fetch failed: ' + res.status)
    const contentType = res.headers.get('content-type') || ''
    if (contentType.includes('svg') || path.toLowerCase().endsWith('.svg')) {
      const text = await res.text()
      const base64 = btoa(unescape(encodeURIComponent(text)))
      return `data:image/svg+xml;charset=utf-8;base64,${base64}`
    }
    const blob = await res.blob()
    const base64 = await blobToBase64(blob)
    return `data:${blob.type};base64,${base64}`
  } catch (e) {
    console.warn('fetchAssetDataUrl failed for', path, e)
    return path
  }
}

// build an inlined SVG from context (placedAssets, canvasRef, preset, colors)
export const getExportSVGStringAsync = async (ctx) => {
  if (!ctx.canvasRef.value) return null
  const canvasRect = ctx.canvasRef.value.getBoundingClientRect()
  const renderedW = canvasRect.width
  const renderedH = canvasRect.height
  const exportW = ctx.currentCanvasPreset.value.width
  const exportH = ctx.currentCanvasPreset.value.height
  const scale = exportW / renderedW

  let svg = `<?xml version="1.0" encoding="utf-8"?>\n`
  svg += `<svg xmlns="http://www.w3.org/2000/svg" width="${exportW}" height="${exportH}" viewBox="0 0 ${exportW} ${exportH}">\n`
  svg += `<rect x="0" y="0" width="${exportW}" height="${exportH}" fill="${svgEscape(
    ctx.selectedBackgroundColor.value,
  )}"/>\n`

  for (const a of ctx.placedAssets.value) {
    const rx = (a.x || 0) * scale
    const ry = (a.y || 0) * scale
    const rw = getAssetPixelSize(ctx, a) * scale
    const rh = rw
    const rotation = a.rotation || 0
    const cx = rx + rw / 2
    const cy = ry + rh / 2

    let href = a.path
    try {
      href = await fetchAssetDataUrl(a.path)
    } catch (e) {
      href = a.path
    }

    svg += `<g transform="rotate(${rotation} ${cx} ${cy})">\n`
    svg += `<image href="${svgEscape(href)}" x="${rx}" y="${ry}" width="${rw}" height="${rh}" preserveAspectRatio="xMidYMid meet" />\n`
    svg += `</g>\n`
  }

  svg += `</svg>`
  return svg
}

// rasterize and return data URL
export const exportRasterFromSVG = async (ctx, type = 'image/png', quality = 0.92) => {
  const svgString = await getExportSVGStringAsync(ctx)
  if (!svgString) return null
  const exportW = ctx.currentCanvasPreset.value.width
  const exportH = ctx.currentCanvasPreset.value.height
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
    const ctx2 = canvas.getContext('2d')
    if (type === 'image/jpeg') {
      ctx2.fillStyle = ctx.selectedBackgroundColor.value || '#ffffff'
      ctx2.fillRect(0, 0, exportW, exportH)
    }
    ctx2.drawImage(img, 0, 0, exportW, exportH)
    const dataUrl = canvas.toDataURL(type, quality)
    URL.revokeObjectURL(url)
    return dataUrl
  } catch (e) {
    URL.revokeObjectURL(url)
    console.error('exportRasterFromSVG failed', e)
    return null
  }
}

// download helpers
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

export const exportAsSVG = async (ctx) => {
  const svgString = await getExportSVGStringAsync(ctx)
  if (!svgString) return
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
  downloadBlob(blob, `${ctx.currentCanvasPreset.value.name || 'canvas'}.svg`)
}

export const exportAsPNG = async (ctx) => {
  const dataUrl = await exportRasterFromSVG(ctx, 'image/png')
  if (!dataUrl) return
  const res = await fetch(dataUrl)
  const blob = await res.blob()
  downloadBlob(blob, `${ctx.currentCanvasPreset.value.name || 'canvas'}.png`)
}

export const exportAsJPG = async (ctx) => {
  const dataUrl = await exportRasterFromSVG(ctx, 'image/jpeg', 0.92)
  if (!dataUrl) return
  const res = await fetch(dataUrl)
  const blob = await res.blob()
  downloadBlob(blob, `${ctx.currentCanvasPreset.value.name || 'canvas'}.jpg`)
}

// jsPDF is optional; if not available callers should fallback
export const exportAsPDF = async (ctx, jsPDF) => {
  const dataUrl = await exportRasterFromSVG(ctx, 'image/jpeg', 0.92)
  if (!dataUrl) return
  if (jsPDF) {
    try {
      const exportW = ctx.currentCanvasPreset.value.width
      const exportH = ctx.currentCanvasPreset.value.height
      const orientation = exportW >= exportH ? 'landscape' : 'portrait'
      const pdf = new jsPDF({ orientation, unit: 'px', format: [exportW, exportH] })
      pdf.addImage(dataUrl, 'JPEG', 0, 0, exportW, exportH)
      pdf.save(`${ctx.currentCanvasPreset.value.name || 'canvas'}.pdf`)
      return
    } catch (e) {
      console.error('exportAsPDF(jsPDF) failed', e)
    }
  }
  const w = window.open('', '_blank')
  if (!w) return
  w.document.write('<!doctype html><html><head><title>Print</title></head><body style="margin:0">')
  w.document.write('<img src="' + dataUrl + '" style="width:100%;height:auto;display:block"/>')
  w.document.write('</body></html>')
  w.document.close()
}

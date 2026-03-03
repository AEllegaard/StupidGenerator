import { createApp } from 'vue'
import App from './App.vue'
import router from './router'

const app = createApp(App)

app.use(router)

app.mount('#app')

// Block browser zoom (trackpad pinch/ctrl+wheel + touch pinch).
// Note: This is intentionally global to satisfy "bloker alle former for zoom".
try {
  // 1) Desktop: ctrl/cmd + wheel (often used for browser zoom)
  window.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault()
    },
    { passive: false },
  )

  // 2) iOS Safari gesture events
  window.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false })
  window.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false })
  window.addEventListener('gestureend', (e) => e.preventDefault(), { passive: false })

  // 3) Touch pinch (2+ fingers)
  window.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches && e.touches.length > 1) e.preventDefault()
    },
    { passive: false },
  )
  window.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches && e.touches.length > 1) e.preventDefault()
    },
    { passive: false },
  )
} catch (e) {
  // ignore
}

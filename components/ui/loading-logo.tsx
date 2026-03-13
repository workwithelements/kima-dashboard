"use client"

/**
 * Animated Elements X-mark for loading screens.
 * Morphs between a rounded blob and the logo X shape,
 * with a slow rotation for visual interest.
 * Shows a random fun phrase that cycles every few seconds.
 *
 * Easter egg: double-click the icon to play a Pac-Man style game
 * where you control the X logo to eat the phrases.
 * The game launches imperatively into document.body so it survives
 * the loading component unmounting when the page finishes loading.
 */

import { useEffect, useState } from "react"
import { LOGO_X_PATH } from "./logo"

/** Blob shape — nearly circular, start/end of morph cycle */
const BLOB_PATH =
  "M82,18 C92,18 92,35 92,50 C92,65 92,82 82,82 C82,92 65,92 50,92 C35,92 18,92 18,82 C8,82 8,65 8,50 C8,35 8,18 18,18 C18,8 35,8 50,8 C65,8 82,8 82,18Z"

const PHRASES = [
  "making it slicker",
  "adding some colour",
  "laying the elements",
  "is it even incremental?",
  "reading the room",
  "polishing the pixels",
  "trusting the process",
  "definitely not fixing something",
  "jumping on a quick call",
  "making it work harder",
  "making it pop",
  "do you fundamentally understand?",
  "making the logo bigger",
]

export default function LoadingLogo({
  className = "",
  size = "default",
  showLabel = true,
}: {
  className?: string
  size?: "small" | "default" | "large"
  showLabel?: boolean
}) {
  const sizes: Record<string, string> = {
    small: "h-8 w-8",
    default: "h-12 w-12",
    large: "h-16 w-16",
  }

  const [phrase, setPhrase] = useState(() =>
    PHRASES[Math.floor(Math.random() * PHRASES.length)]
  )

  useEffect(() => {
    const interval = setInterval(() => {
      setPhrase((prev) => {
        let next = prev
        while (next === prev) {
          next = PHRASES[Math.floor(Math.random() * PHRASES.length)]
        }
        return next
      })
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      <svg
        viewBox="0 0 100 100"
        className={`${sizes[size]} cursor-pointer`}
        onDoubleClick={() => launchPhraseEaterGame()}
      >
        <style>{`
          @keyframes logo-morph {
            0%, 100% { d: path("${BLOB_PATH}"); }
            50% { d: path("${LOGO_X_PATH}"); }
          }
          @keyframes logo-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(90deg); }
          }
          .loading-x {
            animation: logo-morph 2s ease-in-out infinite,
                       logo-spin 8s linear infinite;
            transform-origin: 50px 50px;
          }
        `}</style>
        <path className="loading-x" d={BLOB_PATH} fill="currentColor" />
      </svg>
      {showLabel && (
        <p className="text-xs text-neutral-500 transition-opacity duration-300">
          {phrase}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Easter egg: imperative Pac-Man-style phrase eater game
// Renders directly into document.body so it survives React unmounts.
// ---------------------------------------------------------------------------

const BRAND_COLORS = ["#CDFF00", "#FF69B4", "#1A1A4E", "#FFFFFF", "#A3E635", "#F472B6"]

/** Guard against multiple instances */
let gameActive = false

function launchPhraseEaterGame() {
  if (gameActive) return
  gameActive = true

  // Create container + canvas directly on the DOM
  const container = document.createElement("div")
  container.style.cssText =
    "position:fixed;inset:0;z-index:99999;background:#0a0a0a;"
  const canvas = document.createElement("canvas")
  canvas.style.cssText = "width:100%;height:100%;display:block;"
  container.appendChild(canvas)
  document.body.appendChild(container)

  const ctx = canvas.getContext("2d")!
  const SPEED = 4
  const PLAYER_SIZE = 24
  const EAT_RADIUS = 36

  // Size canvas
  function resize() {
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
  }
  resize()

  // Game state
  const player = {
    x: canvas.width / 2,
    y: canvas.height / 2,
    angle: 0,
    mouthOpen: 0.3,
    mouthDir: 1,
  }

  const phrases = PHRASES.map((text) => {
    const w = canvas.width, h = canvas.height
    let x: number, y: number
    do {
      x = 80 + Math.random() * (w - 160)
      y = 60 + Math.random() * (h - 120)
    } while (Math.abs(x - w / 2) < 100 && Math.abs(y - h / 2) < 100)

    return {
      x, y, text,
      color: BRAND_COLORS[Math.floor(Math.random() * BRAND_COLORS.length)],
      eaten: false,
      vx: (Math.random() - 0.5) * 0.6,
      vy: (Math.random() - 0.5) * 0.6,
    }
  })

  let score = 0
  const total = PHRASES.length
  let won = false
  let wonTimer = 0
  const keys = new Set<string>()

  // Cleanup function
  function destroy() {
    cancelAnimationFrame(animId)
    window.removeEventListener("resize", resize)
    window.removeEventListener("keydown", onKeyDown)
    window.removeEventListener("keyup", onKeyUp)
    document.body.removeChild(container)
    gameActive = false
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      destroy()
      return
    }
    keys.add(e.key)
  }
  function onKeyUp(e: KeyboardEvent) {
    keys.delete(e.key)
  }

  window.addEventListener("resize", resize)
  window.addEventListener("keydown", onKeyDown)
  window.addEventListener("keyup", onKeyUp)

  function drawPlayer(px: number, py: number, angle: number, mouth: number) {
    ctx.save()
    ctx.translate(px, py)
    ctx.rotate(angle)

    const mouthAngle = mouth * Math.PI * 0.25
    ctx.beginPath()
    ctx.arc(0, 0, PLAYER_SIZE, mouthAngle, Math.PI * 2 - mouthAngle)
    ctx.lineTo(0, 0)
    ctx.closePath()
    ctx.fillStyle = "#CDFF00"
    ctx.fill()

    // X mark inside
    const inner = PLAYER_SIZE * 0.5
    ctx.strokeStyle = "#0a0a0a"
    ctx.lineWidth = 3
    ctx.lineCap = "round"
    ctx.beginPath()
    ctx.moveTo(-inner * 0.6, -inner * 0.6)
    ctx.lineTo(inner * 0.6, inner * 0.6)
    ctx.moveTo(inner * 0.6, -inner * 0.6)
    ctx.lineTo(-inner * 0.6, inner * 0.6)
    ctx.stroke()

    ctx.restore()
  }

  let animId: number

  function loop() {
    const w = canvas.width
    const h = canvas.height

    // Movement
    let dx = 0, dy = 0
    if (keys.has("ArrowLeft") || keys.has("a")) dx -= 1
    if (keys.has("ArrowRight") || keys.has("d")) dx += 1
    if (keys.has("ArrowUp") || keys.has("w")) dy -= 1
    if (keys.has("ArrowDown") || keys.has("s")) dy += 1

    if (dx || dy) {
      const mag = Math.sqrt(dx * dx + dy * dy)
      player.x += (dx / mag) * SPEED
      player.y += (dy / mag) * SPEED
      player.angle = Math.atan2(dy, dx)
    }

    player.x = Math.max(PLAYER_SIZE, Math.min(w - PLAYER_SIZE, player.x))
    player.y = Math.max(PLAYER_SIZE, Math.min(h - PLAYER_SIZE, player.y))

    // Mouth animation
    player.mouthOpen += 0.05 * player.mouthDir
    if (player.mouthOpen > 0.4) player.mouthDir = -1
    if (player.mouthOpen < 0.05) player.mouthDir = 1

    // Move phrases
    for (const p of phrases) {
      if (p.eaten) continue
      p.x += p.vx
      p.y += p.vy
      if (p.x < 60 || p.x > w - 60) p.vx *= -1
      if (p.y < 30 || p.y > h - 30) p.vy *= -1
      p.x = Math.max(60, Math.min(w - 60, p.x))
      p.y = Math.max(30, Math.min(h - 30, p.y))
    }

    // Eat check
    for (const p of phrases) {
      if (p.eaten) continue
      const dist = Math.sqrt((player.x - p.x) ** 2 + (player.y - p.y) ** 2)
      if (dist < EAT_RADIUS) {
        p.eaten = true
        score++
        if (score >= total) {
          won = true
          wonTimer = 0
        }
      }
    }

    // Win auto-close
    if (won) {
      wonTimer++
      if (wonTimer > 180) {
        destroy()
        return
      }
    }

    // Draw background
    ctx.fillStyle = "#0a0a0a"
    ctx.fillRect(0, 0, w, h)

    // Grid dots
    ctx.fillStyle = "#1a1a1a"
    for (let gx = 20; gx < w; gx += 40) {
      for (let gy = 20; gy < h; gy += 40) {
        ctx.fillRect(gx, gy, 2, 2)
      }
    }

    // Phrases
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    for (const p of phrases) {
      if (p.eaten) continue
      ctx.font = "bold 14px Inter, system-ui, sans-serif"
      ctx.fillStyle = p.color
      ctx.globalAlpha = 0.9
      ctx.fillText(p.text, p.x, p.y)
      ctx.globalAlpha = 1
    }

    // Player
    drawPlayer(player.x, player.y, player.angle, player.mouthOpen)

    // HUD
    ctx.font = "bold 13px Inter, system-ui, sans-serif"
    ctx.fillStyle = "#737373"
    ctx.textAlign = "left"
    ctx.fillText(`${score} / ${total}`, 16, 28)
    ctx.textAlign = "right"
    ctx.fillStyle = "#525252"
    ctx.font = "11px Inter, system-ui, sans-serif"
    ctx.fillText("ESC to exit", w - 16, 28)

    // Win screen
    if (won) {
      ctx.fillStyle = `rgba(205, 255, 0, ${Math.min(wonTimer / 60, 0.15)})`
      ctx.fillRect(0, 0, w, h)
      ctx.textAlign = "center"
      ctx.font = "bold 28px Inter, system-ui, sans-serif"
      ctx.fillStyle = "#CDFF00"
      ctx.fillText("all eaten", w / 2, h / 2 - 10)
      ctx.font = "14px Inter, system-ui, sans-serif"
      ctx.fillStyle = "#737373"
      ctx.fillText("you clearly have too much time", w / 2, h / 2 + 24)
    }

    animId = requestAnimationFrame(loop)
  }

  animId = requestAnimationFrame(loop)
}

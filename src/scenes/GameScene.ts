import Phaser from 'phaser'
import { ElevatorSim, DEFAULT_CONFIG } from '../sim/sim'
import type { SimConfig, SimStats } from '../sim/sim'
import type { ElevatorState } from '../sim/types'
import { Algorithms, CustomAlgorithmBuilder } from '../sim/algorithms'
import type { AlgorithmKind } from '../sim/algorithms'

export class GameScene extends Phaser.Scene {
  static KEY = 'GameScene'

  private gfx!: Phaser.GameObjects.Graphics
  private sim!: ElevatorSim
  private config: SimConfig = { ...DEFAULT_CONFIG }
  private algorithmKind: AlgorithmKind = 'nearest'
  private customBuilder: CustomAlgorithmBuilder | null = null
  private paused = false

  // drawing config
  private floorHeight = 60
  private leftMargin = 80
  private topMargin = 40
  private shaftGap = 20
  private elevatorWidth = 40

  private viewWidth = 0
  private viewHeight = 0
  private boundsPadding = { x: 140, y: 140 }

  private minZoom = 0.2
  private maxZoom = 4
  private activePointers = new Map<number, Phaser.Math.Vector2>()
  private panPointerId: number | null = null
  private panStart = new Phaser.Math.Vector2()
  private panScrollStart = new Phaser.Math.Vector2()
  private isPanning = false
  private pinchStartDistance: number | null = null
  private pinchStartZoom = 1

  constructor() {
    super(GameScene.KEY)
  }

  create() {
    this.gfx = this.add.graphics()
    this.viewWidth = this.scale.width
    this.viewHeight = this.scale.height
    this.input.addPointer(2)
    this.setupCameraControls()
    this.resetSim(true)

    // Listen for UI events via game registry
    this.game.events.on('sim:apply', (cfg: Partial<SimConfig> & { algorithm: AlgorithmKind }) => {
      this.config = { ...this.config, ...cfg }
      this.algorithmKind = cfg.algorithm
      this.resetSim(true)
    })

    this.game.events.on('sim:togglePause', () => {
      this.paused = !this.paused
    })

    this.game.events.on('sim:customAlgorithm', (code: string) => {
      this.customBuilder = new CustomAlgorithmBuilder(code)
      this.algorithmKind = 'custom'
      this.resetSim(true)
    })

    this.game.events.on('sim:manualCall', ({ floor, dir }: { floor: number; dir: 1 | -1 }) => {
      if (!this.sim) return
      this.sim.spawnDirected(floor, dir)
    })
  }

  private resetSim(fitCamera = true) {
    this.cancelGestures()
    let algorithm
    if (this.algorithmKind === 'custom' && this.customBuilder) {
      algorithm = this.customBuilder.build()
    } else {
      algorithm = Algorithms[this.algorithmKind as Exclude<AlgorithmKind, 'custom'>]
    }
    this.sim = new ElevatorSim({ ...this.config, algorithm })
    this.floorHeight = 60
    this.refreshCameraBounds(fitCamera)
  }

  update(_time: number, deltaMs: number) {
    if (this.scale.width !== this.viewWidth || this.scale.height !== this.viewHeight) {
      this.viewWidth = this.scale.width
      this.viewHeight = this.scale.height
      this.refreshCameraBounds(false)
    }
    this.resizeForFloors()
    if (!this.paused) {
      this.sim.update(deltaMs / 1000)
    }
    this.draw()
    // Emit stats for UI
    const stats: SimStats = this.sim.getStats()
    this.game.events.emit('sim:stats', stats)

    // Emit fleet and calls snapshot
    const fleet = this.sim.elevators.map(e => ({
      id: e.id,
      floor: Math.round(e.position),
      dir: e.direction,
      occ: e.passengers.length,
      cap: e.capacity,
      doorsOpen: e.doorsOpen,
      targets: [...e.targets],
    }))
    const calls = this.sim.floorsState.map((fs, floor) => ({ floor, up: fs.upQueue.length, down: fs.downQueue.length }))
    this.game.events.emit('sim:fleet', { elevators: fleet, calls })
  }

  private calcLayout() {
    const floorsPx = this.floorHeight * (this.sim.floors - 1)
    const usableHeight = this.scale.height - this.topMargin * 2
    if (floorsPx > usableHeight) {
      this.floorHeight = Math.max(28, Math.floor(usableHeight / (this.sim.floors - 1)))
    }
  }

  private resizeForFloors() {
    const prev = this.floorHeight
    this.calcLayout()
    if (this.floorHeight !== prev) {
      this.refreshCameraBounds(false)
    }
  }

  private setupCameraControls() {
    this.input.on('pointerdown', this.handlePointerDown, this)
    this.input.on('pointerup', this.handlePointerUp, this)
    this.input.on('pointerupoutside', this.handlePointerUp, this)
    this.input.on('pointermove', this.handlePointerMove, this)
    this.input.on('gameout', this.cancelGestures, this)
    this.input.on('wheel', this.handleWheel, this)
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer) {
    if (!pointer.isDown) return
    const rawEvent = pointer.event as { button?: number } | undefined
    if (rawEvent && typeof rawEvent.button === 'number' && rawEvent.button !== 0) return
    if (this.activePointers.size >= 2) return

    this.activePointers.set(pointer.id, new Phaser.Math.Vector2(pointer.x, pointer.y))
    if (this.activePointers.size === 1) {
      this.beginPan(pointer)
    } else if (this.activePointers.size === 2) {
      this.beginPinch()
    }
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer) {
    if (this.activePointers.has(pointer.id)) {
      this.activePointers.delete(pointer.id)
    }

    if (pointer.id === this.panPointerId) {
      this.isPanning = false
      this.panPointerId = null
      this.setDraggingCursor(false)
    }

    if (this.activePointers.size < 2) {
      this.pinchStartDistance = null
    }

    if (this.activePointers.size === 1) {
      const remaining = this.activePointers.keys().next()
      const remainingId = typeof remaining.value === 'number' ? remaining.value : null
      if (remainingId !== null) {
        const remainingPointer = this.findPointerById(remainingId)
        if (remainingPointer?.isDown) {
          this.beginPan(remainingPointer)
        }
      }
    }

    if (this.activePointers.size === 0) {
      this.cancelGestures()
    }
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer) {
    const stored = this.activePointers.get(pointer.id)
    if (stored) {
      stored.set(pointer.x, pointer.y)
    }

    if (this.activePointers.size === 2) {
      if (this.pinchStartDistance === null) {
        this.beginPinch()
      }
      const points = Array.from(this.activePointers.values())
      if (points.length >= 2 && this.pinchStartDistance && this.pinchStartDistance > 0) {
        const newDistance = Phaser.Math.Distance.Between(points[0].x, points[0].y, points[1].x, points[1].y)
        const scale = Phaser.Math.Clamp(newDistance / this.pinchStartDistance, 0.05, 20)
        const focus = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }
        this.applyZoom(this.pinchStartZoom * scale, focus)
      }
      return
    }

    if (this.isPanning && pointer.id === this.panPointerId && pointer.isDown) {
      const cam = this.cameras.main
      const dx = pointer.x - this.panStart.x
      const dy = pointer.y - this.panStart.y
      cam.scrollX = this.panScrollStart.x - dx / cam.zoom
      cam.scrollY = this.panScrollStart.y - dy / cam.zoom
      this.constrainCamera()
    }
  }

  private handleWheel(pointer: Phaser.Input.Pointer, _gameObjects: Phaser.GameObjects.GameObject[], _deltaX: number, deltaY: number, _deltaZ: number) {
    const evt = pointer.event as { preventDefault?: () => void } | undefined
    evt?.preventDefault?.()

    const cam = this.cameras.main
    const zoomFactor = deltaY > 0 ? 0.9 : 1.1
    this.applyZoom(cam.zoom * zoomFactor, pointer)
  }

  private beginPan(pointer: Phaser.Input.Pointer) {
    const cam = this.cameras.main
    this.isPanning = true
    this.panPointerId = pointer.id
    this.panStart.set(pointer.x, pointer.y)
    this.panScrollStart.set(cam.scrollX, cam.scrollY)
    this.pinchStartDistance = null
    this.setDraggingCursor(true)
  }

  private beginPinch() {
    const points = Array.from(this.activePointers.values())
    if (points.length < 2) return

    this.isPanning = false
    this.panPointerId = null
    this.setDraggingCursor(false)
    this.pinchStartDistance = Phaser.Math.Distance.Between(points[0].x, points[0].y, points[1].x, points[1].y)
    this.pinchStartZoom = this.cameras.main.zoom
  }

  private applyZoom(targetZoom: number, focus?: { x: number; y: number }) {
    const cam = this.cameras.main
    const newZoom = Phaser.Math.Clamp(targetZoom, this.minZoom, this.maxZoom)
    const focusPoint = focus ?? { x: this.scale.width / 2, y: this.scale.height / 2 }
    const before = cam.getWorldPoint(focusPoint.x, focusPoint.y, new Phaser.Math.Vector2())
    cam.setZoom(newZoom)
    const after = cam.getWorldPoint(focusPoint.x, focusPoint.y, new Phaser.Math.Vector2())
    cam.scrollX += before.x - after.x
    cam.scrollY += before.y - after.y
    this.constrainCamera()
  }

  private constrainCamera() {
    const cam = this.cameras.main
    const bounds = cam.getBounds(new Phaser.Geom.Rectangle())
    if (bounds.width === 0 && bounds.height === 0) {
      return
    }

    const viewWidth = cam.width / cam.zoom
    const viewHeight = cam.height / cam.zoom

    if (bounds.width <= viewWidth) {
      cam.scrollX = bounds.centerX - viewWidth / 2
    } else {
      const maxX = bounds.right - viewWidth
      cam.scrollX = Phaser.Math.Clamp(cam.scrollX, bounds.x, maxX)
    }

    if (bounds.height <= viewHeight) {
      cam.scrollY = bounds.centerY - viewHeight / 2
    } else {
      const maxY = bounds.bottom - viewHeight
      cam.scrollY = Phaser.Math.Clamp(cam.scrollY, bounds.y, maxY)
    }
  }

  private refreshCameraBounds(fitCamera: boolean) {
    if (!this.sim) return

    const width = this.scale.width
    const { buildingTop, buildingBottom, buildingHeight } = this.getBuildingMetrics()
    const minY = buildingTop - this.boundsPadding.y
    const maxY = buildingBottom + this.boundsPadding.y
    const boundsHeight = maxY - minY
    const cam = this.cameras.main
    cam.setBounds(-this.boundsPadding.x, minY, width + this.boundsPadding.x * 2, boundsHeight)
    if (fitCamera && buildingHeight > 0) {
      const fitZoom = Phaser.Math.Clamp(Math.min(1, this.scale.height / buildingHeight), this.minZoom, this.maxZoom)
      cam.setZoom(fitZoom)
      cam.centerOn(width / 2, buildingTop + buildingHeight / 2)
    }
    this.constrainCamera()
  }

  private getBuildingMetrics() {
    const width = this.scale.width
    const buildingLeft = this.leftMargin
    const buildingRight = width - 40
    const buildingBottom = this.scale.height - this.topMargin
    const highestFloorY = buildingBottom - (this.sim.floors - 1) * this.floorHeight
    const buildingTop = Math.min(this.topMargin, highestFloorY)
    const buildingHeight = buildingBottom - buildingTop
    return { buildingLeft, buildingRight, buildingTop, buildingBottom, buildingHeight }
  }

  private cancelGestures() {
    this.isPanning = false
    this.panPointerId = null
    this.pinchStartDistance = null
    this.activePointers.clear()
    this.setDraggingCursor(false)
  }

  private findPointerById(id: number) {
    return this.input.manager.pointers.find(p => p && p.id === id)
  }

  private setDraggingCursor(active: boolean) {
    const canvas = this.game.canvas as HTMLCanvasElement | undefined
    if (!canvas) return
    if (active) canvas.classList.add('grabbing')
    else canvas.classList.remove('grabbing')
  }

  private draw() {
    this.gfx.clear()

    // Building bounds
    const { buildingLeft, buildingRight, buildingTop, buildingBottom } = this.getBuildingMetrics()

    // Draw floors
    this.gfx.lineStyle(1, 0x384253, 1)
    for (let f = 0; f < this.sim.floors; f++) {
      const y = buildingBottom - f * this.floorHeight
      this.gfx.beginPath()
      this.gfx.moveTo(buildingLeft, y)
      this.gfx.lineTo(buildingRight, y)
      this.gfx.closePath()
      this.gfx.strokePath()

      // labels
      this.gfx.fillStyle(0xa5b0bf, 1)
      this.gfx.fillRect(buildingLeft - 60, y - 10, 52, 20)
      this.addText(`${f}`, buildingLeft - 54, y - 8, 0x0f1216)
    }

    // Draw shafts and elevators
    const shafts = this.sim.elevators.length
    const usableWidth = buildingRight - buildingLeft
    const shaftWidth = Math.min(this.elevatorWidth, Math.floor((usableWidth - (shafts + 1) * this.shaftGap) / shafts))

    for (let i = 0; i < shafts; i++) {
      const x = buildingLeft + this.shaftGap + i * (shaftWidth + this.shaftGap)
      // shaft
      this.gfx.fillStyle(0x11151b, 1)
      this.gfx.fillRect(x, buildingTop, shaftWidth, buildingBottom - buildingTop)
      this.gfx.lineStyle(1, 0x2a2f3a, 1)
      this.gfx.strokeRect(x, buildingTop, shaftWidth, buildingBottom - buildingTop)

      // elevator id label
      this.addText(`#${i}`, x + 6, buildingTop - 18, 0xa5b0bf)

      const elev = this.sim.elevators[i]
      const elevY = buildingBottom - elev.position * this.floorHeight - shaftWidth // square cab
      const doorColor = elev.doorsOpen ? 0x58d68d : 0x59c1ff

      // cab
      this.gfx.fillStyle(0x223040, 1)
      this.gfx.fillRect(x + 2, elevY, shaftWidth - 4, shaftWidth - 4)
      this.gfx.lineStyle(2, doorColor, 1)
      this.gfx.strokeRect(x + 2, elevY, shaftWidth - 4, shaftWidth - 4)

      // direction indicator
      if (elev.direction !== 0) {
        const triY = elevY + 6
        const midX = x + shaftWidth / 2
        const up = elev.direction > 0
        this.gfx.fillStyle(up ? 0x58d68d : 0xff6b6b, 1)
        if (up) this.gfx.fillTriangle(midX, triY, midX - 6, triY + 10, midX + 6, triY + 10)
        else this.gfx.fillTriangle(midX, triY + 10, midX - 6, triY, midX + 6, triY)
      }

      // occupancy text
      this.addText(`${elev.passengers.length}/${elev.capacity}`, x + 6, elevY + 4, 0xffffff)

      // passenger count bar
      const capPct = elev.passengers.length / elev.capacity
      const barH = 4
      const barY = elevY + shaftWidth - 6
      this.gfx.fillStyle(0x2a2f3a, 1)
      this.gfx.fillRect(x + 2, barY, shaftWidth - 4, barH)
      this.gfx.fillStyle(0xffd166, 1)
      this.gfx.fillRect(x + 2, barY, Math.max(0, (shaftWidth - 4) * capPct), barH)

      // targets markers
      const destFloor = this.getNextDestination(elev)
      for (const t of elev.targets) {
        const ty = buildingBottom - t * this.floorHeight - 2
        const color = destFloor !== null && t === destFloor ? 0x58d68d : 0xff6b6b
        this.gfx.lineStyle(1, color, 1)
        this.gfx.beginPath(); this.gfx.moveTo(x + 2, ty); this.gfx.lineTo(x + shaftWidth - 2, ty); this.gfx.strokePath()
      }
    }

    // Draw waiting passengers dots
    for (let f = 0; f < this.sim.floors; f++) {
      const y = buildingBottom - f * this.floorHeight
      const upQ = this.sim.floorsState[f].upQueue.length
      const dnQ = this.sim.floorsState[f].downQueue.length
      const maxDots = 10
      const dotSize = 3

      this.gfx.fillStyle(0x58d68d, 1)
      for (let i = 0; i < Math.min(upQ, maxDots); i++) {
        this.gfx.fillCircle(buildingLeft - 20 - i * (dotSize + 2), y - 12, dotSize)
      }
      this.gfx.fillStyle(0xff6b6b, 1)
      for (let i = 0; i < Math.min(dnQ, maxDots); i++) {
        this.gfx.fillCircle(buildingLeft - 20 - i * (dotSize + 2), y + 12, dotSize)
      }

      // counts and arrows for clarity
      this.addText(`↑${upQ}`, buildingLeft - 100, y - 16, 0x58d68d)
      this.addText(`↓${dnQ}`, buildingLeft - 100, y + 4, 0xff6b6b)
    }
  }

  private addText(text: string, x: number, y: number, color: number) {
    const t = this.add.text(x, y, text, { fontFamily: 'monospace', fontSize: '12px', color: `#${color.toString(16)}` })
    t.setDepth(1000)
    // Destroy next frame to avoid piling up. We draw labels anew each frame.
    this.time.delayedCall(0, () => t.destroy())
  }

  private getNextDestination(elev: ElevatorState): number | null {
    if (elev.targets.size === 0) return null

    const pos = elev.position
    if (elev.direction > 0) {
      let best: number | null = null
      for (const t of elev.targets) {
        if (t >= pos - 1e-6 && (best === null || t < best)) best = t
      }
      if (best !== null) return best
    } else if (elev.direction < 0) {
      let best: number | null = null
      for (const t of elev.targets) {
        if (t <= pos + 1e-6 && (best === null || t > best)) best = t
      }
      if (best !== null) return best
    }

    let nearest: number | null = null
    let nearestDist = Number.POSITIVE_INFINITY
    for (const t of elev.targets) {
      const dist = Math.abs(t - pos)
      if (dist < nearestDist) {
        nearestDist = dist
        nearest = t
      }
    }
    return nearest
  }
}

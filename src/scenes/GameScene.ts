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
  private dragPointerId: number | null = null
  private dragStart = new Phaser.Math.Vector2()
  private cameraStart = new Phaser.Math.Vector2()
  private pinchZooming = false
  private pinchStartDist = 0
  private pinchStartZoom = 1
  private cameraBounds = new Phaser.Geom.Rectangle(0, 0, 0, 0)
  private readonly minZoom = 0.45
  private readonly maxZoom = 3

  constructor() {
    super(GameScene.KEY)
  }

  create() {
    this.gfx = this.add.graphics()
    this.resetSim()
    this.input.addPointer(2)
    this.setupCameraControls()
    this.cameras.main.setZoom(1)
    this.cameras.main.setScroll(0, 0)

    // Listen for UI events via game registry
    this.game.events.on('sim:apply', (cfg: Partial<SimConfig> & { algorithm: AlgorithmKind }) => {
      this.config = { ...this.config, ...cfg }
      this.algorithmKind = cfg.algorithm
      this.resetSim()
    })

    this.game.events.on('sim:togglePause', () => {
      this.paused = !this.paused
    })

    this.game.events.on('sim:customAlgorithm', (code: string) => {
      this.customBuilder = new CustomAlgorithmBuilder(code)
      this.algorithmKind = 'custom'
      this.resetSim()
    })

    this.game.events.on('sim:manualCall', ({ floor, dir }: { floor: number; dir: 1 | -1 }) => {
      if (!this.sim) return
      this.sim.spawnDirected(floor, dir)
    })
  }

  private setupCameraControls() {
    const mouse = this.input.mouse
    if (mouse) {
      mouse.preventDefaultWheel = true
    }

    this.input.on('pointerdown', this.handlePointerDown, this)
    this.input.on('pointerup', this.handlePointerUp, this)
    this.input.on('pointerupoutside', this.handlePointerUp, this)
    this.input.on('pointermove', this.handlePointerMove, this)
    this.input.on('wheel', this.handleWheel, this)
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer) {
    if (pointer.button !== 0) return

    const pointer1 = this.input.pointer1
    const pointer2 = this.input.pointer2

    if (pointer1.isDown && pointer2 && pointer2.isDown) {
      this.dragPointerId = null
      return
    }

    if (pointer1.isDown && pointer.id !== pointer1.id) {
      this.dragPointerId = null
      return
    }

    this.dragPointerId = pointer.id
    this.dragStart.set(pointer.x, pointer.y)
    this.cameraStart.set(this.cameras.main.scrollX, this.cameras.main.scrollY)
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer) {
    if (pointer.id === this.dragPointerId) {
      this.dragPointerId = null
    }

    const pointer1 = this.input.pointer1
    const pointer2 = this.input.pointer2
    if (!(pointer1.isDown && pointer2 && pointer2.isDown)) {
      this.pinchZooming = false
    }
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer) {
    const cam = this.cameras.main
    const pointer1 = this.input.pointer1
    const pointer2 = this.input.pointer2

    if (pointer1.isDown && pointer2 && pointer2.isDown) {
      const dist = Phaser.Math.Distance.Between(pointer1.x, pointer1.y, pointer2.x, pointer2.y)
      const centerX = (pointer1.x + pointer2.x) / 2
      const centerY = (pointer1.y + pointer2.y) / 2
      if (!this.pinchZooming) {
        this.pinchZooming = true
        this.pinchStartDist = dist
        this.pinchStartZoom = cam.zoom
        this.dragPointerId = null
      } else if (this.pinchStartDist > 0) {
        const newZoom = this.pinchStartZoom * (dist / this.pinchStartDist)
        this.applyZoom(newZoom, centerX, centerY)
      }
      return
    }

    this.pinchZooming = false

    if (this.dragPointerId === pointer.id && pointer.isDown) {
      const dx = (pointer.x - this.dragStart.x) / cam.zoom
      const dy = (pointer.y - this.dragStart.y) / cam.zoom
      cam.scrollX = this.cameraStart.x - dx
      cam.scrollY = this.cameraStart.y - dy
      this.clampCamera()
    }
  }

  private handleWheel(
    _pointer: Phaser.Input.Pointer,
    _gameObjects: Phaser.GameObjects.GameObject[],
    deltaX: number,
    deltaY: number,
  ) {
    const pointer = this.input.activePointer
    const nativeEvent = pointer.event as WheelEvent | undefined
    nativeEvent?.preventDefault()
    const primaryDelta = Math.abs(deltaY) > Math.abs(deltaX) ? deltaY : deltaX
    if (primaryDelta === 0) return
    const factor = primaryDelta > 0 ? 0.9 : 1.1
    const newZoom = this.cameras.main.zoom * factor
    this.applyZoom(newZoom, pointer.x, pointer.y)
  }

  private applyZoom(zoom: number, focusX?: number, focusY?: number) {
    const cam = this.cameras.main
    const clamped = Phaser.Math.Clamp(zoom, this.minZoom, this.maxZoom)
    if (focusX === undefined || focusY === undefined) {
      cam.setZoom(clamped)
    } else {
      const worldPoint = cam.getWorldPoint(focusX, focusY)
      cam.setZoom(clamped)
      const newWorldPoint = cam.getWorldPoint(focusX, focusY)
      cam.scrollX += worldPoint.x - newWorldPoint.x
      cam.scrollY += worldPoint.y - newWorldPoint.y
    }
    this.clampCamera()
  }

  private clampCamera() {
    const cam = this.cameras.main
    const bounds = this.cameraBounds
    if (bounds.width === 0 || bounds.height === 0) return

    const viewWidth = cam.width / cam.zoom
    const viewHeight = cam.height / cam.zoom

    if (bounds.width <= viewWidth) {
      cam.scrollX = bounds.x + (bounds.width - viewWidth) / 2
    } else {
      cam.scrollX = Phaser.Math.Clamp(cam.scrollX, bounds.left, bounds.right - viewWidth)
    }

    if (bounds.height <= viewHeight) {
      cam.scrollY = bounds.y + (bounds.height - viewHeight) / 2
    } else {
      cam.scrollY = Phaser.Math.Clamp(cam.scrollY, bounds.top, bounds.bottom - viewHeight)
    }
  }

  private resetSim() {
    let algorithm
    if (this.algorithmKind === 'custom' && this.customBuilder) {
      algorithm = this.customBuilder.build()
    } else {
      algorithm = Algorithms[this.algorithmKind as Exclude<AlgorithmKind, 'custom'>]
    }
    this.sim = new ElevatorSim({ ...this.config, algorithm })
  }

  update(_time: number, deltaMs: number) {
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
    this.calcLayout()
  }

  private draw() {
    const width = this.scale.width
    const height = this.scale.height
    this.gfx.clear()

    // Building bounds
    const buildingLeft = this.leftMargin
    const buildingRight = width - 40
    const buildingTop = this.topMargin
    const buildingBottom = height - this.topMargin

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

    const lastShaftX = shafts > 0 ? buildingLeft + this.shaftGap + (shafts - 1) * (shaftWidth + this.shaftGap) : buildingLeft
    const contentRight = shafts > 0 ? lastShaftX + shaftWidth + this.shaftGap : buildingRight
    const leftExtent = Math.min(buildingLeft - 160, -120)
    const rightExtent = Math.max(contentRight + 160, width + 160)
    const topExtent = Math.min(buildingTop - 220, -160)
    const bottomExtent = Math.max(buildingBottom + 220, height + 220)

    this.cameraBounds.setTo(leftExtent, topExtent, rightExtent - leftExtent, bottomExtent - topExtent)
    this.cameras.main.setBounds(this.cameraBounds.x, this.cameraBounds.y, this.cameraBounds.width, this.cameraBounds.height)
    this.clampCamera()
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

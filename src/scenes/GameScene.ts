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
  private pinchPrimary: Phaser.Input.Pointer | null = null
  private pinchSecondary: Phaser.Input.Pointer | null = null
  private pinchStartDistance = 0
  private pinchStartZoom = 1
  private minZoom = 0.5
  private maxZoom = 2.5
  private tmpVec = new Phaser.Math.Vector2()
  private tmpVec2 = new Phaser.Math.Vector2()

  constructor() {
    super(GameScene.KEY)
  }

  create() {
    this.gfx = this.add.graphics()
    this.resetSim()

    this.cameras.main.setZoom(1)
    this.input.addPointer(2)
    this.input.mouse?.disableContextMenu()
    this.input.on('pointerdown', this.handlePointerDown, this)
    this.input.on('pointerup', this.handlePointerUp, this)
    this.input.on('pointerupoutside', this.handlePointerUp, this)
    this.input.on('pointermove', this.handlePointerMove, this)
    this.input.on('wheel', this.handleWheel, this)

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off('pointerdown', this.handlePointerDown, this)
      this.input.off('pointerup', this.handlePointerUp, this)
      this.input.off('pointerupoutside', this.handlePointerUp, this)
      this.input.off('pointermove', this.handlePointerMove, this)
      this.input.off('wheel', this.handleWheel, this)
    })

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
    this.updateCameraBounds()
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
  }

  private startDrag(pointer: Phaser.Input.Pointer) {
    this.dragPointerId = pointer.id
    this.dragStart.set(pointer.x, pointer.y)
    this.cameraStart.set(this.cameras.main.scrollX, this.cameras.main.scrollY)
  }

  private beginPinch() {
    if (this.pinchPrimary && this.pinchSecondary) {
      this.dragPointerId = null
      this.pinchStartZoom = this.cameras.main.zoom
      const dist = Phaser.Math.Distance.Between(
        this.pinchPrimary.x,
        this.pinchPrimary.y,
        this.pinchSecondary.x,
        this.pinchSecondary.y,
      )
      this.pinchStartDistance = Math.max(0.0001, dist)
    }
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer) {
    const pointerType = this.resolvePointerType(pointer)
    if (pointerType === 'mouse') {
      if (pointer.button === 0) {
        this.startDrag(pointer)
      }
      return
    }

    if (!this.pinchPrimary) {
      this.pinchPrimary = pointer
      this.startDrag(pointer)
    } else if (!this.pinchSecondary && pointer.id !== this.pinchPrimary.id) {
      this.pinchSecondary = pointer
      this.beginPinch()
    }
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer) {
    if (pointer.id === this.dragPointerId) {
      this.dragPointerId = null
    }

    if (this.pinchPrimary && pointer.id === this.pinchPrimary.id) {
      this.pinchPrimary = this.pinchSecondary
      this.pinchSecondary = null
      if (this.pinchPrimary && this.pinchPrimary.isDown) {
        this.startDrag(this.pinchPrimary)
      }
    } else if (this.pinchSecondary && pointer.id === this.pinchSecondary.id) {
      this.pinchSecondary = null
      if (this.pinchPrimary && this.pinchPrimary.isDown) {
        this.startDrag(this.pinchPrimary)
      }
    }

    if (!this.pinchSecondary) {
      this.pinchStartDistance = 0
    }
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer) {
    if (this.pinchPrimary && this.pinchSecondary) {
      if (pointer.id === this.pinchPrimary.id || pointer.id === this.pinchSecondary.id) {
        const dist = Phaser.Math.Distance.Between(
          this.pinchPrimary.x,
          this.pinchPrimary.y,
          this.pinchSecondary.x,
          this.pinchSecondary.y,
        )
        if (dist > 0.0001) {
          const base = Math.max(0.0001, this.pinchStartDistance)
          const ratio = dist / base
          const targetZoom = this.pinchStartZoom * ratio
          const centerX = (this.pinchPrimary.x + this.pinchSecondary.x) / 2
          const centerY = (this.pinchPrimary.y + this.pinchSecondary.y) / 2
          this.setZoomAroundPoint(targetZoom, centerX, centerY)
          this.pinchStartZoom = this.cameras.main.zoom
          this.pinchStartDistance = dist
        }
      }
      return
    }

    if (this.dragPointerId === pointer.id && pointer.isDown) {
      const cam = this.cameras.main
      const dx = pointer.x - this.dragStart.x
      const dy = pointer.y - this.dragStart.y
      cam.scrollX = this.cameraStart.x - dx / cam.zoom
      cam.scrollY = this.cameraStart.y - dy / cam.zoom
    }
  }

  private handleWheel(
    pointer: Phaser.Input.Pointer,
    _gameObjects: Phaser.GameObjects.GameObject[],
    _deltaX: number,
    deltaY: number,
    _deltaZ: number,
    event: WheelEvent,
  ) {
    event.preventDefault()
    const cam = this.cameras.main
    const targetZoom = cam.zoom * Math.exp(-deltaY * 0.0015)
    this.setZoomAroundPoint(targetZoom, pointer.x, pointer.y)
  }

  private setZoomAroundPoint(targetZoom: number, screenX: number, screenY: number) {
    const cam = this.cameras.main
    const clamped = Phaser.Math.Clamp(targetZoom, this.minZoom, this.maxZoom)
    if (clamped === cam.zoom) return

    cam.getWorldPoint(screenX, screenY, this.tmpVec)
    cam.setZoom(clamped)
    cam.getWorldPoint(screenX, screenY, this.tmpVec2)
    cam.scrollX += this.tmpVec.x - this.tmpVec2.x
    cam.scrollY += this.tmpVec.y - this.tmpVec2.y
  }

  private resolvePointerType(pointer: Phaser.Input.Pointer): 'mouse' | 'touch' | 'pen' {
    const raw = (pointer as any).pointerType ?? (pointer.event as any)?.pointerType
    if (raw === 'mouse') return 'mouse'
    if (raw === 'pen') return 'pen'
    if (raw === 'touch') return 'touch'
    if ((pointer as any).isMouse || pointer.event instanceof MouseEvent) return 'mouse'
    return 'touch'
  }

  private updateCameraBounds() {
    const width = this.scale.width
    const height = this.scale.height
    const marginX = Math.max(200, width * 0.5)
    const marginY = Math.max(200, height * 0.5)
    this.cameras.main.setBounds(-marginX, -marginY, width + marginX * 2, height + marginY * 2)
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

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
  private worldWidth = 800
  private worldHeight = 600
  private minZoom = 0.6
  private maxZoom = 2.5
  private dragState: { active: boolean; pointerId: number; lastX: number; lastY: number } = {
    active: false,
    pointerId: -1,
    lastX: 0,
    lastY: 0,
  }
  private pinchState: {
    pointer1Id: number
    pointer2Id: number
    startDistance: number
    startZoom: number
    lastCenterX: number
    lastCenterY: number
  } | null = null

  constructor() {
    super(GameScene.KEY)
  }

  create() {
    this.gfx = this.add.graphics()
    this.setupCamera()
    this.resetSim()

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

  private setupCamera() {
    const camera = this.cameras.main
    camera.setZoom(1)
    camera.setBounds(0, 0, this.worldWidth, this.worldHeight)
    this.input.addPointer(2)
    this.input.mouse?.disableContextMenu()

    this.input.on('pointerdown', this.handlePointerDown, this)
    this.input.on('pointerup', this.handlePointerUp, this)
    this.input.on('pointerupoutside', this.handlePointerUp, this)
    this.input.on('pointermove', this.handlePointerMove, this)
    this.input.on('wheel', this.handleWheel, this)
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer) {
    const pointerType = this.getPointerType(pointer)
    if (pointerType === 'mouse') {
      if (pointer.leftButtonDown()) this.beginDrag(pointer)
      return
    }

    if (pointerType === 'touch') {
      const touches = this.getTouchPointers()
      if (touches.length === 2) {
        this.beginPinch(touches[0], touches[1])
      } else if (touches.length === 1) {
        this.beginDrag(pointer)
      }
    }
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer) {
    if (this.pinchState) {
      this.updatePinch()
      return
    }

    if (this.dragState.active && pointer.id === this.dragState.pointerId) {
      this.updateDrag(pointer)
    }
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer) {
    if (this.dragState.active && this.dragState.pointerId === pointer.id) {
      this.dragState.active = false
    }

    if (this.pinchState && (pointer.id === this.pinchState.pointer1Id || pointer.id === this.pinchState.pointer2Id)) {
      this.pinchState = null
      const touches = this.getTouchPointers()
      if (touches.length === 1) this.beginDrag(touches[0])
    }
  }

  private handleWheel(
    pointer: Phaser.Input.Pointer,
    _gameObjects: unknown[],
    _deltaX: number,
    deltaY: number,
    _deltaZ: number,
    event: WheelEvent,
  ) {
    event?.preventDefault()
    const camera = this.cameras.main
    const zoomFactor = Phaser.Math.Clamp(1 - deltaY * 0.001, 0.5, 1.5)
    const newZoom = camera.zoom * zoomFactor
    this.setCameraZoom(newZoom, pointer.worldX, pointer.worldY)
  }

  private beginDrag(pointer: Phaser.Input.Pointer) {
    if (this.pinchState) return
    this.dragState = { active: true, pointerId: pointer.id, lastX: pointer.x, lastY: pointer.y }
  }

  private updateDrag(pointer: Phaser.Input.Pointer) {
    const camera = this.cameras.main
    const dx = pointer.x - this.dragState.lastX
    const dy = pointer.y - this.dragState.lastY
    camera.scrollX -= dx / camera.zoom
    camera.scrollY -= dy / camera.zoom
    this.dragState.lastX = pointer.x
    this.dragState.lastY = pointer.y
    this.clampCamera()
  }

  private beginPinch(p1: Phaser.Input.Pointer, p2: Phaser.Input.Pointer) {
    this.dragState.active = false
    const distance = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y)
    const centerX = (p1.x + p2.x) / 2
    const centerY = (p1.y + p2.y) / 2
    this.pinchState = {
      pointer1Id: p1.id,
      pointer2Id: p2.id,
      startDistance: distance || 1,
      startZoom: this.cameras.main.zoom,
      lastCenterX: centerX,
      lastCenterY: centerY,
    }
  }

  private updatePinch() {
    if (!this.pinchState) return
    const p1 = this.getPointerById(this.pinchState.pointer1Id)
    const p2 = this.getPointerById(this.pinchState.pointer2Id)
    if (!p1 || !p2 || !p1.isDown || !p2.isDown) {
      this.pinchState = null
      return
    }

    const camera = this.cameras.main
    const centerX = (p1.x + p2.x) / 2
    const centerY = (p1.y + p2.y) / 2
    const dx = centerX - this.pinchState.lastCenterX
    const dy = centerY - this.pinchState.lastCenterY
    camera.scrollX -= dx / camera.zoom
    camera.scrollY -= dy / camera.zoom
    this.pinchState.lastCenterX = centerX
    this.pinchState.lastCenterY = centerY

    const distance = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y)
    const ratio = distance / Math.max(0.0001, this.pinchState.startDistance)
    const zoomTarget = this.pinchState.startZoom * ratio
    const centerWorldX = (p1.worldX + p2.worldX) / 2
    const centerWorldY = (p1.worldY + p2.worldY) / 2
    this.setCameraZoom(zoomTarget, centerWorldX, centerWorldY)
    this.pinchState.startZoom = this.cameras.main.zoom
    this.pinchState.startDistance = distance
    this.clampCamera()
  }

  private getTouchPointers() {
    return this.getPointerList().filter(p => p.isDown && this.getPointerType(p) === 'touch')
  }

  private getPointerById(id: number) {
    return this.getPointerList().find(p => p.id === id) ?? null
  }

  private getPointerList() {
    const input = this.input
    const pointers = [
      input.pointer1,
      input.pointer2,
      input.pointer3,
      input.pointer4,
      input.pointer5,
      input.pointer6,
      input.pointer7,
      input.pointer8,
      input.pointer9,
      input.pointer10,
    ]
    const seen = new Set<number>()
    const out: Phaser.Input.Pointer[] = []
    for (const pointer of pointers) {
      if (!seen.has(pointer.id)) {
        seen.add(pointer.id)
        out.push(pointer)
      }
    }
    return out
  }

  private getPointerType(pointer: Phaser.Input.Pointer) {
    const raw = (pointer as any).pointerType ?? (pointer as any).event?.pointerType
    if (typeof raw === 'string') return raw
    return (pointer as any).wasTouch ? 'touch' : 'mouse'
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
    const viewportWidth = this.scale.width
    const viewportHeight = this.scale.height
    const shafts = this.sim.elevators.length
    const shaftCount = Math.max(1, shafts)
    const floorsHeight = this.floorHeight * (this.sim.floors - 1)
    const buildingLeft = this.leftMargin
    const buildingTop = this.topMargin

    const baseShaftSpan = shaftCount * (this.elevatorWidth + this.shaftGap) + this.shaftGap
    const targetUsableWidth = Math.max(viewportWidth - (buildingLeft + 160), baseShaftSpan)
    let shaftWidth = Math.floor((targetUsableWidth - (shaftCount + 1) * this.shaftGap) / shaftCount)
    shaftWidth = Math.min(this.elevatorWidth, Math.max(24, shaftWidth))
    const buildingWidth = this.shaftGap + shaftCount * (shaftWidth + this.shaftGap)
    const buildingRight = buildingLeft + buildingWidth
    const buildingBottom = buildingTop + floorsHeight
    const worldWidth = Math.max(viewportWidth, buildingRight + this.leftMargin + 160)
    const worldHeight = Math.max(viewportHeight, buildingBottom + this.topMargin + 160)

    this.updateWorldBounds(worldWidth, worldHeight)

    this.gfx.clear()
    this.gfx.fillStyle(0x0f1216, 1)
    this.gfx.fillRect(0, 0, worldWidth, worldHeight)

    this.gfx.lineStyle(1, 0x384253, 1)
    for (let f = 0; f < this.sim.floors; f++) {
      const y = buildingBottom - f * this.floorHeight
      this.gfx.beginPath()
      this.gfx.moveTo(buildingLeft, y)
      this.gfx.lineTo(buildingRight, y)
      this.gfx.closePath()
      this.gfx.strokePath()

      this.gfx.fillStyle(0xa5b0bf, 1)
      this.gfx.fillRect(buildingLeft - 60, y - 10, 52, 20)
      this.addText(`${f}`, buildingLeft - 54, y - 8, 0x0f1216)
    }

    for (let i = 0; i < shafts; i++) {
      const x = buildingLeft + this.shaftGap + i * (shaftWidth + this.shaftGap)
      const shaftHeight = Math.max(0, buildingBottom - buildingTop)
      this.gfx.fillStyle(0x11151b, 1)
      this.gfx.fillRect(x, buildingTop, shaftWidth, shaftHeight)
      this.gfx.lineStyle(1, 0x2a2f3a, 1)
      this.gfx.strokeRect(x, buildingTop, shaftWidth, shaftHeight)

      this.addText(`#${i}`, x + 6, buildingTop - 18, 0xa5b0bf)

      const elev = this.sim.elevators[i]
      const elevY = buildingBottom - elev.position * this.floorHeight - shaftWidth
      const doorColor = elev.doorsOpen ? 0x58d68d : 0x59c1ff

      this.gfx.fillStyle(0x223040, 1)
      this.gfx.fillRect(x + 2, elevY, shaftWidth - 4, shaftWidth - 4)
      this.gfx.lineStyle(2, doorColor, 1)
      this.gfx.strokeRect(x + 2, elevY, shaftWidth - 4, shaftWidth - 4)

      if (elev.direction !== 0) {
        const triY = elevY + 6
        const midX = x + shaftWidth / 2
        const up = elev.direction > 0
        this.gfx.fillStyle(up ? 0x58d68d : 0xff6b6b, 1)
        if (up) this.gfx.fillTriangle(midX, triY, midX - 6, triY + 10, midX + 6, triY + 10)
        else this.gfx.fillTriangle(midX, triY + 10, midX - 6, triY, midX + 6, triY)
      }

      this.addText(`${elev.passengers.length}/${elev.capacity}`, x + 6, elevY + 4, 0xffffff)

      const capPct = elev.passengers.length / elev.capacity
      const barH = 4
      const barY = elevY + shaftWidth - 6
      this.gfx.fillStyle(0x2a2f3a, 1)
      this.gfx.fillRect(x + 2, barY, shaftWidth - 4, barH)
      this.gfx.fillStyle(0xffd166, 1)
      this.gfx.fillRect(x + 2, barY, Math.max(0, (shaftWidth - 4) * capPct), barH)

      const destFloor = this.getNextDestination(elev)
      for (const t of elev.targets) {
        const ty = buildingBottom - t * this.floorHeight - 2
        const color = destFloor !== null && t === destFloor ? 0x58d68d : 0xff6b6b
        this.gfx.lineStyle(1, color, 1)
        this.gfx.beginPath()
        this.gfx.moveTo(x + 2, ty)
        this.gfx.lineTo(x + shaftWidth - 2, ty)
        this.gfx.strokePath()
      }
    }

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

      this.addText(`↑${upQ}`, buildingLeft - 100, y - 16, 0x58d68d)
      this.addText(`↓${dnQ}`, buildingLeft - 100, y + 4, 0xff6b6b)
    }
  }

  private setCameraZoom(zoom: number, centerX: number, centerY: number) {
    const camera = this.cameras.main
    const clamped = Phaser.Math.Clamp(zoom, this.minZoom, this.maxZoom)
    const prevZoom = camera.zoom
    if (Math.abs(clamped - prevZoom) < 1e-6) {
      camera.setZoom(clamped)
      this.clampCamera()
      return
    }

    const offsetX = centerX - camera.scrollX
    const offsetY = centerY - camera.scrollY
    camera.setZoom(clamped)
    camera.scrollX = centerX - offsetX * (prevZoom / clamped)
    camera.scrollY = centerY - offsetY * (prevZoom / clamped)
    this.clampCamera()
  }

  private clampCamera() {
    const camera = this.cameras.main
    const viewWidth = camera.width / camera.zoom
    const viewHeight = camera.height / camera.zoom
    const maxScrollX = Math.max(0, this.worldWidth - viewWidth)
    const maxScrollY = Math.max(0, this.worldHeight - viewHeight)
    camera.scrollX = Phaser.Math.Clamp(camera.scrollX, 0, maxScrollX)
    camera.scrollY = Phaser.Math.Clamp(camera.scrollY, 0, maxScrollY)
  }

  private updateWorldBounds(width: number, height: number) {
    if (width !== this.worldWidth || height !== this.worldHeight) {
      this.worldWidth = width
      this.worldHeight = height
      this.cameras.main.setBounds(0, 0, width, height)
    }
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

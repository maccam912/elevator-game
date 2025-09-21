import type { Algorithm, AlgorithmState, Direction, ElevatorState, FloorState, Passenger, SimConfig, SimStats } from './types'

export const DEFAULT_CONFIG: SimConfig = {
  floors: 10,
  elevators: 3,
  capacity: 8,
  speedFloorsPerSec: 1.5,
  accelerationFloorsPerSec2: 1.5,
  stopDurationSec: 1.0,
  spawnRatePerMin: 40,
  algorithm: { name: 'Nearest', decide: () => [] },
  groundBias: 3.0,
  toLobbyPct: 70,
}

export class ElevatorSim {
  readonly floors: number
  readonly elevators: ElevatorState[]
  readonly floorsState: FloorState[]
  private capacity: number
  private speed: number
  private acceleration: number
  private stopDuration: number
  private spawnRate: number
  private algorithm: Algorithm
  private groundBias: number
  private toLobbyPct: number

  private time = 0
  private lastPassengerId = 1
  private spawnAccumulator = 0

  private completedCount = 0
  private totalWait = 0
  private maxWait = 0

  private hallUp = new Set<number>()
  private hallDown = new Set<number>()

  constructor(cfg: SimConfig) {
    this.floors = cfg.floors
    this.capacity = cfg.capacity
    this.speed = cfg.speedFloorsPerSec
    this.acceleration = Math.max(0.1, cfg.accelerationFloorsPerSec2 ?? cfg.speedFloorsPerSec)
    this.stopDuration = cfg.stopDurationSec
    this.spawnRate = cfg.spawnRatePerMin
    this.algorithm = cfg.algorithm
    this.groundBias = cfg.groundBias ?? 3.0
    this.toLobbyPct = cfg.toLobbyPct ?? 70

    this.elevators = Array.from({ length: cfg.elevators }, (_, i) => ({
      id: i,
      position: 0,
      direction: 0 as Direction,
      velocity: 0,
      capacity: this.capacity,
      passengers: [],
      doorsOpen: false,
      targets: new Set<number>(),
    }))

    this.floorsState = Array.from({ length: this.floors }, () => ({ upQueue: [], downQueue: [] }))
  }

  update(dt: number) {
    this.time += dt

    // Spawn passengers
    this.spawnAccumulator += dt
    const spawnInterval = this.spawnRate > 0 ? 60 / this.spawnRate : Number.POSITIVE_INFINITY
    while (this.spawnAccumulator >= spawnInterval) {
      this.spawnAccumulator -= spawnInterval
      this.spawnPassenger()
    }

    // Run algorithm periodically (each tick is fine for simplicity)
    this.applyAlgorithm()

    // Move elevators and handle stops
    for (const e of this.elevators) {
      this.updateElevator(e, dt)
    }
  }

  getStats(): SimStats {
    const elapsed = Math.max(1e-6, this.time)
    const throughput = this.completedCount / elapsed * 60
    const avgWait = this.completedCount > 0 ? this.totalWait / this.completedCount : 0
    return {
      elapsedSec: elapsed,
      completed: this.completedCount,
      throughputPerMin: throughput,
      avgWaitSec: avgWait,
      maxWaitSec: this.maxWait,
    }
  }

  private spawnPassenger() {
    if (this.floors < 2) return
    // Choose start floor with ground bias
    const weights = new Array(this.floors).fill(1)
    if (this.floors > 0) weights[0] = Math.max(1, this.groundBias)
    const totalW = weights.reduce((a,b)=>a+b,0)
    let r = Math.random() * totalW
    let start = 0
    for (let i=0;i<weights.length;i++){ r -= weights[i]; if (r<=0){ start = i; break } }

    // Destination preference: from upper floors, usually go to lobby
    let dest: number
    if (start > 0) {
      const toLobby = Math.random()*100 < this.toLobbyPct
      if (toLobby) dest = 0
      else {
        do { dest = 1 + Math.floor(Math.random() * (this.floors - 1)) } while (dest === start)
      }
    } else {
      // from lobby, go to any upper floor
      dest = 1 + Math.floor(Math.random() * (this.floors - 1))
    }
    const p: Passenger = { id: this.lastPassengerId++, start, dest, spawnTime: this.time }
    const goingUp = dest > start
    const floorState = this.floorsState[start]
    if (goingUp) floorState.upQueue.push(p); else floorState.downQueue.push(p)
    ;(goingUp ? this.hallUp : this.hallDown).add(start)
  }

  // Manual/directed spawn for UI: dir > 0 => up, dir < 0 => down
  spawnDirected(start: number, dir: Direction) {
    if (start < 0 || start >= this.floors) return
    let dest = start
    if (dir > 0) {
      if (start >= this.floors - 1) return
      dest = start + 1 + Math.floor(Math.random() * (this.floors - 1 - start))
    } else if (dir < 0) {
      if (start <= 0) return
      dest = Math.floor(Math.random() * start)
    }
    const p: Passenger = { id: this.lastPassengerId++, start, dest, spawnTime: this.time }
    if (dest > start) {
      this.floorsState[start].upQueue.push(p)
      this.hallUp.add(start)
    } else {
      this.floorsState[start].downQueue.push(p)
      this.hallDown.add(start)
    }
  }

  private applyAlgorithm() {
    const state: AlgorithmState = {
      time: this.time,
      elevators: this.elevators.map(e => ({ ...e, targets: new Set(e.targets) })),
      floors: this.floors,
      calls: { up: [...this.hallUp].sort((a,b)=>a-b), down: [...this.hallDown].sort((a,b)=>a-b) },
    }
    const decisions = this.algorithm.decide(state)
    for (const d of decisions) {
      const e = this.elevators[d.elevator]
      if (!e) continue
      for (const floor of d.addTargets) {
        if (floor >= 0 && floor < this.floors) e.targets.add(floor)
      }
      // Set direction if idle, favoring directional service
      if (e.direction === 0 && e.targets.size > 0) {
        const next = nearestTargetDirectional(e)
        e.direction = next > e.position ? 1 : (next < e.position ? -1 : 0)
      }
    }
  }

  private updateElevator(e: ElevatorState, dt: number) {
    const runtime = e as ElevatorState & { doorTimer?: number }
    const arrivalThreshold = 0.02
    const stopBuffer = 0.01

    if (e.doorsOpen) {
      e.velocity = 0
      runtime.doorTimer = (runtime.doorTimer ?? this.stopDuration) - dt
      if (runtime.doorTimer <= 0) {
        e.doorsOpen = false
        runtime.doorTimer = undefined
        // decide next direction with directional commitment
        if (e.targets.size === 0 && e.passengers.length === 0) {
          e.direction = 0
        } else {
          const keep = hasTargetsInDirection(e, e.direction)
          if (e.direction !== 0 && keep) {
            // continue same direction
          } else {
            const opp: Direction = (e.direction === 1 ? -1 : 1)
            if (hasTargetsInDirection(e, opp)) e.direction = opp
            else e.direction = 0
          }
        }
      }
      return
    }

    if (e.direction === 0) {
      e.velocity = 0
      // remain idle unless targets exist
      if (e.targets.size > 0) {
        const next = nearestTarget(e)
        e.direction = next > e.position ? 1 : (next < e.position ? -1 : 0)
      }
      return
    }

    const dir = e.direction
    const prevPos = e.position
    let velocity = e.velocity

    // If moving opposite of desired direction, slow to stop first
    if (velocity * dir < 0) {
      const speed = Math.abs(velocity)
      const delta = Math.min(speed, this.acceleration * dt)
      const newSpeed = speed - delta
      const sign = Math.sign(velocity)
      const avgSpeed = (speed + newSpeed) / 2
      e.position = prevPos + sign * avgSpeed * dt
      e.velocity = newSpeed > 1e-4 ? sign * newSpeed : 0
      return
    }

    const targetFloor = nextTargetInDirection(e, dir)

    if (targetFloor === null) {
      // No upcoming stop: bleed off velocity
      if (Math.abs(velocity) > 0) {
        const speed = Math.abs(velocity)
        const delta = Math.min(speed, this.acceleration * dt)
        const newSpeed = speed - delta
        const sign = Math.sign(velocity) || dir
        const avgSpeed = (speed + newSpeed) / 2
        e.position = prevPos + sign * avgSpeed * dt
        e.velocity = newSpeed > 1e-4 ? sign * newSpeed : 0
      } else {
        e.velocity = 0
      }
      if (e.position < 0) { e.position = 0; e.velocity = 0 }
      if (e.position > this.floors - 1) { e.position = this.floors - 1; e.velocity = 0 }
      return
    }

    const prevDist = (targetFloor - prevPos) * dir
    if (prevDist <= arrivalThreshold && Math.abs(velocity) < 0.05) {
      e.position = targetFloor
      e.velocity = 0
      this.handleStopAtFloor(e, targetFloor)
      return
    }

    const distanceAhead = Math.max(0, prevDist)
    let targetSpeed = Math.sqrt(Math.max(0, 2 * this.acceleration * Math.max(0, distanceAhead - stopBuffer)))
    if (!Number.isFinite(targetSpeed)) targetSpeed = 0
    targetSpeed = Math.min(this.speed, targetSpeed)

    let speed = Math.abs(velocity)
    const maxDelta = this.acceleration * dt
    if (speed < targetSpeed) speed = Math.min(targetSpeed, speed + maxDelta)
    else if (speed > targetSpeed) speed = Math.max(targetSpeed, speed - maxDelta)

    const newVelocity = dir * speed
    const avgVelocity = (velocity + newVelocity) / 2
    e.position = prevPos + avgVelocity * dt
    e.velocity = Math.abs(newVelocity) > 1e-4 ? newVelocity : 0

    if (e.position < 0) { e.position = 0; e.velocity = 0 }
    if (e.position > this.floors - 1) { e.position = this.floors - 1; e.velocity = 0 }

    const newDist = (targetFloor - e.position) * dir
    if (newDist <= arrivalThreshold || (prevDist > 0 && newDist < 0)) {
      e.position = targetFloor
      e.velocity = 0
      this.handleStopAtFloor(e, targetFloor)
    }
  }

  private handleStopAtFloor(e: ElevatorState, floor: number) {
    // open doors
    e.doorsOpen = true
    e.velocity = 0
    // unload
    const remaining: Passenger[] = []
    for (const p of e.passengers) {
      if (p.dest === floor) {
        p.alightTime = this.time
        const wait = (p.boardTime ?? p.spawnTime) - p.spawnTime
        this.totalWait += wait
        if (wait > this.maxWait) this.maxWait = wait
        this.completedCount++
      } else remaining.push(p)
    }
    e.passengers = remaining
    e.targets.delete(floor)

    // load in current moving direction first, then opposite if space
    const arrivingDir: Direction = e.direction
    let boardedInDir = 0
    if (arrivingDir !== 0) boardedInDir = this.boardFromFloor(e, floor, arrivingDir)
    // Only consider opposite boarding if capacity remains
    if (e.passengers.length < e.capacity) this.boardFromFloor(e, floor, (arrivingDir === 0 ? 1 : (arrivingDir * -1 as Direction)))

    // Direction commitment: if we boarded someone while arriving, keep that direction
    if (arrivingDir !== 0 && boardedInDir > 0) {
      e.direction = arrivingDir
    } else if (e.direction === 0) {
      // was idle: decide by majority of in-cab destinations relative to current floor
      const loadDir = determineLoadDirection(e, floor)
      e.direction = loadDir
    }

    // clear hall call if empty for that direction
    const fs = this.floorsState[floor]
    if (fs.upQueue.length === 0) this.hallUp.delete(floor)
    if (fs.downQueue.length === 0) this.hallDown.delete(floor)
  }

  private boardFromFloor(e: ElevatorState, floor: number, dir: Direction) {
    if (dir === 0) return 0
    const fs = this.floorsState[floor]
    const queue = dir > 0 ? fs.upQueue : fs.downQueue
    let boarded = 0
    while (queue.length && e.passengers.length < e.capacity) {
      const p = queue.shift()!
      p.boardTime = this.time
      e.passengers.push(p)
      // add destination as target
      e.targets.add(p.dest)
      boarded++
    }
    return boarded
  }
}

function nextTargetInDirection(e: ElevatorState, dir: Direction): number | null {
  if (dir === 0) return null
  const pos = e.position
  const eps = 1e-3
  let best: number | null = null
  if (dir > 0) {
    for (const t of e.targets) {
      if (t + eps < pos) continue
      if (best === null || t < best) best = t
    }
  } else {
    for (const t of e.targets) {
      if (t - eps > pos) continue
      if (best === null || t > best) best = t
    }
  }
  return best
}

function nearestTarget(e: ElevatorState): number {
  if (e.targets.size === 0) return Math.round(e.position)
  let best = Math.round(e.position)
  let bestDist = Number.POSITIVE_INFINITY
  for (const t of e.targets) {
    const d = Math.abs(t - e.position)
    if (d < bestDist) { bestDist = d; best = t }
  }
  return best
}

function nearestTargetDirectional(e: ElevatorState): number {
  const pos = e.position
  let bestUp = Number.POSITIVE_INFINITY
  let bestDn = Number.POSITIVE_INFINITY
  for (const t of e.targets) {
    if (t > pos) bestUp = Math.min(bestUp, t)
    if (t < pos) bestDn = Math.max(bestDn, t)
  }
  if (bestUp !== Number.POSITIVE_INFINITY) return bestUp
  if (bestDn !== Number.POSITIVE_INFINITY) return bestDn
  return Math.round(pos)
}

function hasTargetsInDirection(e: ElevatorState, dir: Direction): boolean {
  if (dir === 0) return e.targets.size > 0 || e.passengers.length > 0
  for (const t of e.targets) {
    if (dir > 0 && t > e.position) return true
    if (dir < 0 && t < e.position) return true
  }
  // also consider in-cab passengers' destinations
  for (const p of e.passengers) {
    if (dir > 0 && p.dest > e.position) return true
    if (dir < 0 && p.dest < e.position) return true
  }
  return false
}

function determineLoadDirection(e: ElevatorState, floor: number): Direction {
  if (e.passengers.length) {
    // choose direction with nearest passenger destination dominance
    let up = 0, down = 0
    for (const p of e.passengers) { if (p.dest > floor) up++; else if (p.dest < floor) down++; }
    if (up > down) return 1; if (down > up) return -1
  }
  // Otherwise keep current movement direction
  return e.direction
}

export type { SimConfig, SimStats } from './types'

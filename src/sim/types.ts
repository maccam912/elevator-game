export type Direction = -1 | 0 | 1

export interface Passenger {
  id: number
  start: number
  dest: number
  spawnTime: number
  boardTime?: number
  alightTime?: number
}

export interface ElevatorState {
  id: number
  position: number // floor index (float while moving)
  direction: Direction
  velocity: number // floors per second (signed)
  capacity: number
  passengers: Passenger[]
  doorsOpen: boolean
  targets: Set<number>
}

export interface FloorState {
  upQueue: Passenger[]
  downQueue: Passenger[]
}

export interface AlgorithmState {
  time: number
  elevators: ElevatorState[]
  floors: number
  calls: { up: number[]; down: number[] }
}

export interface AlgorithmDecision {
  elevator: number
  addTargets: number[]
}

export interface Algorithm {
  name: string
  decide(state: AlgorithmState): AlgorithmDecision[]
  reset?(): void
}

export interface SimConfig {
  floors: number
  elevators: number
  capacity: number
  speedFloorsPerSec: number
  accelerationFloorsPerSec2?: number
  stopDurationSec: number
  spawnRatePerMin: number
  algorithm: Algorithm
  // Crowd model
  groundBias: number // weight multiplier for floor 0 spawning
  toLobbyPct: number // for non-ground, probability (0..100) to choose dest=0
}

export interface SimStats {
  elapsedSec: number
  completed: number
  throughputPerMin: number
  avgWaitSec: number
  maxWaitSec: number
}

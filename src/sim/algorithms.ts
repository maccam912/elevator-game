import type { Algorithm, AlgorithmDecision, AlgorithmState } from './types'

export type AlgorithmKind = 'nearest' | 'exclusiveNearest' | 'collective' | 'zoned' | 'idleLobby' | 'custom'

function estimateArrival(state: AlgorithmState, elevIndex: number, floor: number): number {
  const e = state.elevators[elevIndex]
  const dist = Math.abs(e.position - floor)
  const movingAway = (e.direction > 0 && floor < e.position) || (e.direction < 0 && floor > e.position)
  const idle = e.direction === 0
  const base = dist
  const penalty = movingAway ? 3 : 0
  const idleBonus = idle ? -0.3 : 0
  return base + penalty + idleBonus
}

function createClaimTracker(state: AlgorithmState) {
  const claimed = new Set<number>()
  for (const e of state.elevators) {
    for (const t of e.targets) claimed.add(t)
  }
  return {
    has(floor: number) {
      return claimed.has(floor)
    },
    add(floor: number) {
      claimed.add(floor)
    },
  }
}

const NearestCar: Algorithm = {
  name: 'Nearest Car',
  decide(state: AlgorithmState) {
    // For each hall call, pick the closest elevator. Allows multiple calls per elevator.
    const decisions: AlgorithmDecision[] = []
    const tracker = createClaimTracker(state)
    const allCalls: number[] = [...state.calls.up, ...state.calls.down]
    for (const floor of allCalls) {
      if (tracker.has(floor)) continue
      let best = 0, bestCost = Number.POSITIVE_INFINITY
      for (let i = 0; i < state.elevators.length; i++) {
        const cost = estimateArrival(state, i, floor)
        if (cost < bestCost) { bestCost = cost; best = i }
      }
      tracker.add(floor)
      decisions.push({ elevator: best, addTargets: [floor] })
    }
    return decisions
  }
}

// Ensures only one elevator is assigned per hall call and tries to balance
// by not assigning multiple calls to the same car if others are available.
const ExclusiveNearest: Algorithm = {
  name: 'Exclusive Nearest',
  decide(state: AlgorithmState) {
    const decisions: AlgorithmDecision[] = []
    const calls: number[] = [...state.calls.up, ...state.calls.down]

    // Track how many calls each elevator has been assigned in this tick
    const assignedCount = Array(state.elevators.length).fill(0)
    const tracker = createClaimTracker(state)

    // Greedy assignment: for each call, prefer cars with lowest cost; break ties by fewer assigned.
    for (const floor of calls) {
      if (tracker.has(floor)) continue
      let best = 0
      let bestScore = Number.POSITIVE_INFINITY
      for (let i = 0; i < state.elevators.length; i++) {
        const eta = estimateArrival(state, i, floor)
        const score = eta + assignedCount[i] * 0.5
        if (score < bestScore) { bestScore = score; best = i }
      }
      assignedCount[best]++
      tracker.add(floor)
      decisions.push({ elevator: best, addTargets: [floor] })
    }
    return decisions
  }
}

const CollectiveSimple: Algorithm = {
  name: 'Collective (Simple)',
  decide(state: AlgorithmState) {
    const decisions: AlgorithmDecision[] = []
    const tracker = createClaimTracker(state)
    // Each elevator: if idle, pick nearest hall call; else let it serve along direction
    const calls = [...state.calls.up, ...state.calls.down]
    for (let i = 0; i < state.elevators.length; i++) {
      const e = state.elevators[i]
      if (e.direction === 0) {
        // idle: pick nearest unserved call
        let bestFloor = -1
        let bestDist = Number.POSITIVE_INFINITY
        for (const c of calls) {
          if (tracker.has(c)) continue
          const d = Math.abs(c - e.position)
          if (d < bestDist) { bestDist = d; bestFloor = c }
        }
        if (bestFloor >= 0) {
          decisions.push({ elevator: i, addTargets: [bestFloor] })
          tracker.add(bestFloor)
        }
      } else {
        // moving: ensure we stop at any calls we pass
        const dir = e.direction > 0 ? 1 : -1
        const along = (f: number) => dir > 0 ? f >= e.position : f <= e.position
        const passCalls = (dir > 0 ? state.calls.up : state.calls.down)
          .filter(along)
          .filter(f => !tracker.has(f))
        if (passCalls.length) {
          decisions.push({ elevator: i, addTargets: passCalls })
          passCalls.forEach(f => tracker.add(f))
        }
      }
    }
    return decisions
  }
}

// Split building into contiguous zones; dispatch calls to their zone owner car.
const Zoned: Algorithm = {
  name: 'Zoned',
  decide(state: AlgorithmState) {
    const decisions: AlgorithmDecision[] = []
    const n = state.elevators.length
    const floors = state.floors
    const zoneSize = Math.ceil(floors / n)
    const tracker = createClaimTracker(state)
    function owner(floor: number) {
      const idx = Math.min(n - 1, Math.floor(floor / zoneSize))
      return idx
    }
    const calls: number[] = [...state.calls.up, ...state.calls.down]
    for (const floor of calls) {
      if (tracker.has(floor)) continue
      const idx = owner(floor)
      tracker.add(floor)
      decisions.push({ elevator: idx, addTargets: [floor] })
    }
    return decisions
  }
}

const IdleToLobby: Algorithm = {
  name: 'Idle To Lobby',
  decide(state: AlgorithmState) {
    const out: AlgorithmDecision[] = []
    const lobby = 0
    for (let i = 0; i < state.elevators.length; i++) {
      const e = state.elevators[i]
      if (
        e.direction === 0 &&
        e.position !== lobby &&
        state.calls.up.length === 0 &&
        state.calls.down.length === 0 &&
        !e.targets.has(lobby)
      ) {
        out.push({ elevator: i, addTargets: [lobby] })
      }
    }
    // fallback to nearest car for active calls
    out.push(...NearestCar.decide(state))
    return out
  }
}

export const Algorithms: Record<Exclude<AlgorithmKind, 'custom'>, Algorithm> = {
  nearest: NearestCar,
  exclusiveNearest: ExclusiveNearest,
  collective: CollectiveSimple,
  zoned: Zoned,
  idleLobby: IdleToLobby,
}

export class CustomAlgorithmBuilder {
  private code: string
  constructor(code: string) { this.code = code }
  build(): Algorithm {
    let fn: (state: AlgorithmState) => AlgorithmDecision[]
    try {
      // eslint-disable-next-line no-new-func
      const moduleFactory = new Function('return (function(){\n' + this.code + '\n; return typeof decide==="function"?decide:()=>[]; })()')
      fn = moduleFactory()
    } catch (e) {
      console.warn('Failed to compile custom algorithm:', e)
      fn = () => []
    }
    return { name: 'Custom', decide: (s) => {
      try { return fn(s) ?? [] } catch { return [] }
    } }
  }
}

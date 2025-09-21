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

const NearestCar: Algorithm = {
  name: 'Nearest Car',
  decide(state: AlgorithmState) {
    // For each hall call, pick the closest elevator. Allows multiple calls per elevator.
    const decisions: AlgorithmDecision[] = []
    const allCalls: number[] = [...state.calls.up, ...state.calls.down]
    for (const floor of allCalls) {
      const claimed = state.hallClaims[floor]
      const owner = typeof claimed === 'number' && claimed >= 0 && claimed < state.elevators.length ? claimed : null
      let best = -1
      let bestCost = Number.POSITIVE_INFINITY
      for (let i = 0; i < state.elevators.length; i++) {
        if (owner !== null && owner !== i) continue
        const cost = estimateArrival(state, i, floor)
        if (cost < bestCost) { bestCost = cost; best = i }
      }
      if (best >= 0) decisions.push({ elevator: best, addTargets: [floor] })
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

    // Greedy assignment: for each call, prefer cars with lowest cost; break ties by fewer assigned.
    for (const floor of calls) {
      const claimed = state.hallClaims[floor]
      const owner = typeof claimed === 'number' && claimed >= 0 && claimed < state.elevators.length ? claimed : null
      let best = -1
      let bestScore = Number.POSITIVE_INFINITY
      for (let i = 0; i < state.elevators.length; i++) {
        if (owner !== null && owner !== i) continue
        const eta = estimateArrival(state, i, floor)
        const score = eta + assignedCount[i] * 0.5
        if (score < bestScore) { bestScore = score; best = i }
      }
      if (owner !== null && owner !== best) continue
      if (best < 0 || bestScore === Number.POSITIVE_INFINITY) continue
      assignedCount[best]++
      decisions.push({ elevator: best, addTargets: [floor] })
    }
    return decisions
  }
}

const CollectiveSimple: Algorithm = {
  name: 'Collective (Simple)',
  decide(state: AlgorithmState) {
    const decisions: AlgorithmDecision[] = []
    // Each elevator: if idle, pick nearest hall call; else let it serve along direction
    const calls = [...state.calls.up, ...state.calls.down]
    for (let i = 0; i < state.elevators.length; i++) {
      const e = state.elevators[i]
      if (e.direction === 0) {
        // idle: pick nearest unserved call
        let bestFloor = -1
        let bestDist = Number.POSITIVE_INFINITY
        for (const c of calls) {
          const claimed = state.hallClaims[c]
          const owner = typeof claimed === 'number' && claimed >= 0 && claimed < state.elevators.length ? claimed : null
          if (owner !== null && owner !== i) continue
          const d = Math.abs(c - e.position)
          if (d < bestDist) { bestDist = d; bestFloor = c }
        }
        if (bestFloor >= 0) decisions.push({ elevator: i, addTargets: [bestFloor] })
      } else {
        // moving: ensure we stop at any calls we pass
        const dir = e.direction > 0 ? 1 : -1
        const along = (f: number) => dir > 0 ? f >= e.position : f <= e.position
        const passCalls = (dir > 0 ? state.calls.up : state.calls.down)
          .filter(f => along(f))
          .filter(f => {
            const claimed = state.hallClaims[f]
            const owner = typeof claimed === 'number' && claimed >= 0 && claimed < state.elevators.length ? claimed : null
            return owner === null || owner === i
          })
        if (passCalls.length) decisions.push({ elevator: i, addTargets: passCalls })
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
    function owner(floor: number) {
      const idx = Math.min(n - 1, Math.floor(floor / zoneSize))
      return idx
    }
    const calls: number[] = [...state.calls.up, ...state.calls.down]
    for (const floor of calls) {
      const idx = owner(floor)
      const claimed = state.hallClaims[floor]
      const assigned = typeof claimed === 'number' && claimed >= 0 && claimed < state.elevators.length ? claimed : null
      if (assigned !== null && assigned !== idx) continue
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
      if (e.direction === 0 && e.position !== lobby && state.calls.up.length === 0 && state.calls.down.length === 0) {
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

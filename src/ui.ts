import Phaser from 'phaser'

function getEl<T extends HTMLElement>(id: string) { return document.getElementById(id) as T }

export function setupUI(game: Phaser.Game) {
  const floorsInput = getEl<HTMLInputElement>('floors')
  const elevatorsInput = getEl<HTMLInputElement>('elevators')
  const spawnRate = getEl<HTMLInputElement>('spawnRate')
  const spawnLabel = getEl<HTMLDivElement>('spawnRateLabel')
  const algorithmSelect = getEl<HTMLSelectElement>('algorithm')
  const applyBtn = getEl<HTMLButtonElement>('apply')
  const pauseBtn = getEl<HTMLButtonElement>('pause')

  const groundBias = getEl<HTMLInputElement>('groundBias')
  const groundBiasLabel = getEl<HTMLDivElement>('groundBiasLabel')
  const toLobbyPct = getEl<HTMLInputElement>('toLobbyPct')
  const toLobbyPctLabel = getEl<HTMLDivElement>('toLobbyPctLabel')

  const customSection = getEl<HTMLDivElement>('customEditorSection')
  const customCode = getEl<HTMLTextAreaElement>('customCode')
  const loadCustom = getEl<HTMLButtonElement>('loadCustom')

  // Manual call
  const manualFloor = getEl<HTMLInputElement>('manualFloor')
  const manualDir = getEl<HTMLSelectElement>('manualDir')
  const manualCall = getEl<HTMLButtonElement>('manualCall')

  const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.tab-button'))
  const screens = Array.from(document.querySelectorAll<HTMLDivElement>('.screen'))
  if (tabButtons.length && screens.length) {
    let activeScreen = tabButtons.find(btn => btn.classList.contains('active'))?.dataset.screen ?? tabButtons[0]?.dataset.screen ?? ''
    const tabMedia = window.matchMedia('(max-width: 900px)')

    const applyTabState = () => {
      if (!activeScreen) return
      screens.forEach(screen => {
        const isActive = screen.dataset.screen === activeScreen
        screen.classList.toggle('active', isActive)
        if (tabMedia.matches) {
          screen.setAttribute('aria-hidden', isActive ? 'false' : 'true')
        } else {
          screen.setAttribute('aria-hidden', 'false')
        }
      })

      tabButtons.forEach(btn => {
        const isActive = btn.dataset.screen === activeScreen
        btn.classList.toggle('active', isActive)
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false')
        if (tabMedia.matches) {
          btn.setAttribute('tabindex', isActive ? '0' : '-1')
        } else {
          btn.setAttribute('tabindex', '0')
        }
      })
    }

    const setActiveScreen = (target: string) => {
      if (!target || target === activeScreen) return
      activeScreen = target
      applyTabState()
    }

    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => setActiveScreen(btn.dataset.screen ?? ''))
    })

    const handleTabMediaChange = () => applyTabState()
    if (typeof tabMedia.addEventListener === 'function') {
      tabMedia.addEventListener('change', handleTabMediaChange)
    } else {
      tabMedia.addListener(handleTabMediaChange)
    }

    applyTabState()
  }

  const defaultCustom = `// Example custom algorithm
// state: { time, elevators:[{ position, direction, capacity, passengers:[{dest}] }], floors, calls:{up:[],down:[]} }
function decide(state){
  const out = []
  // naive: nearest car for each pending call
  const calls = [...state.calls.up, ...state.calls.down]
  for (const floor of calls){
    let best = 0, bestCost = 1e9
    for (let i=0;i<state.elevators.length;i++){
      const e = state.elevators[i]
      const dist = Math.abs(e.position - floor) + (e.direction===0? -0.3 : 0) + ((e.direction>0 && floor<e.position)||(e.direction<0 && floor>e.position)?3:0)
      if (dist < bestCost){ bestCost = dist; best = i }
    }
    out.push({ elevator: best, addTargets:[floor] })
  }
  return out
}`
  customCode.value = defaultCustom

  spawnRate.addEventListener('input', () => {
    spawnLabel.textContent = `${spawnRate.value} ppl/min`
  })

  function updateBiasLabel(){
    const v = parseFloat(groundBias.value || '3')
    groundBiasLabel.textContent = `x${v.toFixed(1)}`
  }
  groundBias.addEventListener('input', updateBiasLabel)
  updateBiasLabel()

  function updateLobbyLabel(){ toLobbyPctLabel.textContent = `${toLobbyPct.value}%` }
  toLobbyPct.addEventListener('input', updateLobbyLabel)
  updateLobbyLabel()

  algorithmSelect.addEventListener('change', () => {
    customSection.style.display = algorithmSelect.value === 'custom' ? 'block' : 'none'
  })

  applyBtn.addEventListener('click', () => {
    const floors = clamp(parseInt(floorsInput.value || '10', 10), 2, 50)
    const elevators = clamp(parseInt(elevatorsInput.value || '3', 10), 1, 16)
    const spawn = clamp(parseInt(spawnRate.value || '40', 10), 0, 500)
    const algorithm = algorithmSelect.value as any

    const bias = Math.max(1, Math.min(6, parseFloat(groundBias.value || '3')))
    const toLobby = clamp(parseInt(toLobbyPct.value || '70', 10), 0, 100)

    game.events.emit('sim:apply', { floors, elevators, spawnRatePerMin: spawn, algorithm, groundBias: bias, toLobbyPct: toLobby })
  })

  pauseBtn.addEventListener('click', () => {
    game.events.emit('sim:togglePause')
    // simple label toggle
    pauseBtn.textContent = (pauseBtn.textContent === 'Pause') ? 'Resume' : 'Pause'
  })

  loadCustom.addEventListener('click', () => {
    const code = customCode.value || ''
    game.events.emit('sim:customAlgorithm', code)
  })

  manualCall.addEventListener('click', () => {
    const f = clamp(parseInt(manualFloor.value || '0', 10), 0, clamp(parseInt(floorsInput.value || '10', 10),2,50)-1)
    const dir = manualDir.value === 'down' ? -1 : 1
    game.events.emit('sim:manualCall', { floor: f, dir })
  })

  // Stats updates
  const completed = getEl<HTMLDivElement>('statCompleted')
  const throughput = getEl<HTMLDivElement>('statThroughput')
  const avgWait = getEl<HTMLDivElement>('statAvgWait')
  const maxWait = getEl<HTMLDivElement>('statMaxWait')
  const fleetList = getEl<HTMLDivElement>('fleetList')
  const floorCalls = getEl<HTMLDivElement>('floorCalls')

  game.events.on('sim:stats', (s: { completed: number; throughputPerMin: number; avgWaitSec: number; maxWaitSec: number }) => {
    completed.textContent = `${s.completed}`
    throughput.textContent = `${s.throughputPerMin.toFixed(1)}`
    avgWait.textContent = `${s.avgWaitSec.toFixed(1)}`
    maxWait.textContent = `${s.maxWaitSec.toFixed(1)}`
  })

  type FleetEvt = { elevators: Array<{ id:number; floor:number; dir:-1|0|1; occ:number; cap:number; doorsOpen:boolean; targets:number[] }>, calls: Array<{ floor:number; up:number; down:number }> }
  game.events.on('sim:fleet', (state: FleetEvt) => {
    // Fleet list rows
    fleetList.innerHTML = state.elevators.map(e => {
      const dirSymbol = e.dir>0?'↑':(e.dir<0?'↓':'•')
      const dirClass = e.dir>0?'dir-up':(e.dir<0?'dir-down':'dir-idle')
      const pct = Math.round((e.occ / Math.max(1,e.cap))*100)
      const targets = e.targets.sort((a,b)=>a-b).join(', ')
      return `<div class="fleet-row">
        <div class="chip">#${e.id}</div>
        <div>
          <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
          <div class="small" style="margin-top:4px;">${e.occ}/${e.cap} passengers</div>
        </div>
        <div class="${dirClass}" style="text-align:center; font-weight:600;">${dirSymbol} F${e.floor}</div>
        <div class="small">Targets: ${targets || '—'}</div>
      </div>`
    }).join('')

    // Floor call list (only non-zero for compactness)
    const nonZero = state.calls.filter(c => c.up>0 || c.down>0).sort((a,b)=>b.floor-a.floor)
    floorCalls.innerHTML = nonZero.map(c => `
      <div class="call-row">
        <div>Floor ${c.floor}</div>
        <div>
          <span class="badge up">↑ ${c.up}</span>
          <span class="badge down" style="margin-left:6px;">↓ ${c.down}</span>
        </div>
      </div>
    `).join('')
  })

  // kick initial apply
  applyBtn.click()
}

function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)) }

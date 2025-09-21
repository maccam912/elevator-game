import './style.css'
import Phaser from 'phaser'
import { GameScene } from './scenes/GameScene'
import { setupUI } from './ui'

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = `
  <div id="gamePanel" data-panel="game" class="active">
    <div id="gameParent"></div>
  </div>
  <aside id="sidebar">
    <div id="setupPanel" class="sidebar-group active" data-panel="setup">
      <h1 class="title main-title">Elevator Simulator</h1>
      <div class="section">
        <div class="grid-two">
          <div>
            <label for="floors">Floors</label>
            <input id="floors" type="number" min="2" max="50" value="10"/>
          </div>
          <div>
            <label for="elevators">Elevators</label>
            <input id="elevators" type="number" min="1" max="16" value="3"/>
          </div>
        </div>
        <div class="row">
          <label for="spawnRate">Spawn Rate (ppl/min)</label>
          <input id="spawnRate" type="range" min="0" max="200" value="40"/>
        </div>
        <div class="row">
          <label aria-hidden="true"></label>
          <div class="small" id="spawnRateLabel">40 ppl/min</div>
        </div>
        <div class="row">
          <label for="algorithm">Algorithm</label>
          <select id="algorithm">
            <option value="nearest">Nearest Car</option>
            <option value="exclusiveNearest">Single Responder (Nearest)</option>
            <option value="collective">Collective (Simple)</option>
            <option value="zoned">Zoned (Sectorized)</option>
            <option value="idleLobby">Idle To Lobby</option>
            <option value="custom">Custom (Editor)</option>
          </select>
        </div>
        <div class="row actions-row">
          <button id="apply" class="primary">Apply & Restart</button>
          <button id="pause">Pause</button>
        </div>
      </div>

      <div class="section">
        <h1 class="title">Crowd Model</h1>
        <div class="row">
          <label for="groundBias">Ground Floor Bias</label>
          <input id="groundBias" type="range" min="1" max="6" step="0.5" value="3"/>
        </div>
        <div class="row">
          <label aria-hidden="true"></label>
          <div id="groundBiasLabel" class="small">x3.0</div>
        </div>
        <div class="row">
          <label for="toLobbyPct">To Lobby Preference</label>
          <input id="toLobbyPct" type="range" min="0" max="100" value="70"/>
        </div>
        <div class="row">
          <label aria-hidden="true"></label>
          <div id="toLobbyPctLabel" class="small">70%</div>
        </div>
      </div>

      <div class="section">
        <h1 class="title">Manual Call</h1>
        <div class="grid-two">
          <div>
            <label for="manualFloor">Floor</label>
            <input id="manualFloor" type="number" min="0" max="49" value="0"/>
          </div>
          <div>
            <label for="manualDir">Direction</label>
            <select id="manualDir">
              <option value="up">Up</option>
              <option value="down">Down</option>
            </select>
          </div>
        </div>
        <div class="row actions-row">
          <button id="manualCall" class="primary">Call Elevator</button>
        </div>
      </div>

      <div class="section" id="customEditorSection" style="display:none;">
        <div class="small" style="margin-bottom:6px;">
          Provide a JS function named <code>decide</code> taking a state object and returning decisions.
        </div>
        <textarea id="customCode" class="code-editor" spellcheck="false"></textarea>
        <div class="row actions-row">
          <button id="loadCustom" class="primary">Load Custom Algorithm</button>
        </div>
      </div>
    </div>

    <div id="insightsPanel" class="sidebar-group" data-panel="insights">
      <div class="section">
        <h1 class="title">Simulation Stats</h1>
        <div class="stats">
          <div class="stat"><div class="label">Completed</div><div id="statCompleted" class="value">0</div></div>
          <div class="stat"><div class="label">Throughput (min)</div><div id="statThroughput" class="value">0</div></div>
          <div class="stat"><div class="label">Avg Wait (s)</div><div id="statAvgWait" class="value">0</div></div>
          <div class="stat"><div class="label">Max Wait (s)</div><div id="statMaxWait" class="value">0</div></div>
        </div>
      </div>

      <div class="section">
        <h1 class="title">Fleet</h1>
        <div id="fleetList" class="fleet-list"></div>
      </div>

      <div class="section">
        <h1 class="title">Floor Calls</h1>
        <div id="floorCalls" class="floor-calls"></div>
      </div>
    </div>
  </aside>
  <nav id="mobileTabBar" class="mobile-tabs" aria-label="Simulator navigation" role="tablist">
    <button class="mobile-tab active" data-tab="game" role="tab" aria-selected="true" aria-controls="gamePanel">Game</button>
    <button class="mobile-tab" data-tab="setup" role="tab" aria-selected="false" aria-controls="setupPanel">Controls</button>
    <button class="mobile-tab" data-tab="insights" role="tab" aria-selected="false" aria-controls="insightsPanel">Insights</button>
  </nav>
`

const panels = Array.from(document.querySelectorAll<HTMLElement>('[data-panel]'))
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-tab]'))
const sidebar = document.getElementById('sidebar')!
const mobileQuery = window.matchMedia('(max-width: 900px)')

function activateTab(panelId: string) {
  panels.forEach(panel => {
    panel.classList.toggle('active', panel.dataset.panel === panelId)
  })

  tabs.forEach(tab => {
    const isActive = tab.dataset.tab === panelId
    tab.classList.toggle('active', isActive)
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false')
  })

  if (mobileQuery.matches) {
    if (panelId === 'game') {
      sidebar.classList.remove('mobile-visible')
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event('resize'))
      })
    } else {
      sidebar.classList.add('mobile-visible')
    }
  }
}

function handleViewportChange() {
  if (!mobileQuery.matches) {
    sidebar.classList.remove('mobile-visible')
    panels.forEach(panel => {
      panel.classList.add('active')
    })
    return
  }

  const activeTabId = tabs.find(tab => tab.classList.contains('active'))?.dataset.tab ?? 'game'
  activateTab(activeTabId)
}

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab
    if (target) {
      activateTab(target)
    }
  })
})

activateTab('game')
handleViewportChange()

if (typeof mobileQuery.addEventListener === 'function') {
  mobileQuery.addEventListener('change', handleViewportChange)
} else {
  mobileQuery.addListener(handleViewportChange)
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'gameParent',
  backgroundColor: '#0f1216',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  width: 800,
  height: 600,
  fps: { target: 60 },
  render: { pixelArt: false, antialias: true },
  scene: [GameScene],
})

setupUI(game)

import './style.css'
import Phaser from 'phaser'
import { GameScene } from './scenes/GameScene'
import { setupUI } from './ui'

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = `
  <div class="app-shell" data-active-view="simulation">
    <header class="app-header">
      <div class="brand">
        <span class="brand-title">Elevator Simulator</span>
        <span class="brand-subtitle">Operations Lab</span>
      </div>
      <nav class="nav-bar" role="tablist" aria-label="Simulator views">
        <button class="nav-link active" data-view="simulation" role="tab" aria-selected="true" aria-controls="view-simulation" id="tab-simulation" tabindex="0">Simulation</button>
        <button class="nav-link" data-view="controls" role="tab" aria-selected="false" aria-controls="view-controls" id="tab-controls" tabindex="-1">Operations</button>
        <button class="nav-link" data-view="crowd" role="tab" aria-selected="false" aria-controls="view-crowd" id="tab-crowd" tabindex="-1">Crowd</button>
        <button class="nav-link" data-view="stats" role="tab" aria-selected="false" aria-controls="view-stats" id="tab-stats" tabindex="-1">Status</button>
      </nav>
    </header>
    <main id="view-root">
      <section id="view-simulation" class="simulation-layer" role="tabpanel" data-view="simulation" aria-labelledby="tab-simulation" aria-hidden="false">
        <div id="gameParent"></div>
      </section>
      <section id="view-controls" class="view-panel" data-view="controls" role="tabpanel" aria-labelledby="tab-controls" aria-hidden="true" tabindex="-1">
        <div class="panel-scroll">
          <div class="panel-card">
            <h2 class="title">Run Configuration</h2>
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
              <label></label>
              <div class="small" id="spawnRateLabel">40 ppl/min</div>
            </div>
            <div class="row">
              <label for="algorithm">Algorithm</label>
              <select id="algorithm">
                <option value="nearest">Nearest Car</option>
                <option value="nearestNonBusy">Nearest Non-Busy Car</option>
                <option value="exclusiveNearest">Single Responder (Nearest)</option>
                <option value="collective">Collective (Simple)</option>
                <option value="zoned">Zoned (Sectorized)</option>
                <option value="idleLobby">Idle To Lobby</option>
                <option value="custom">Custom (Editor)</option>
              </select>
            </div>
            <div class="row button-row">
              <button id="apply" class="primary">Apply &amp; Restart</button>
              <button id="pause">Pause</button>
            </div>
          </div>

          <div class="panel-card">
            <h2 class="title">Manual Call</h2>
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
            <div class="row button-row">
              <button id="manualCall" class="primary">Call Elevator</button>
            </div>
          </div>

          <div class="panel-card" id="customEditorSection" style="display:none;">
            <h2 class="title">Custom Algorithm</h2>
            <div class="small" style="margin-bottom:6px;">
              Provide a JS function named <code>decide</code> taking a state object and returning decisions.
            </div>
            <textarea id="customCode" class="code-editor" spellcheck="false"></textarea>
            <div class="row button-row">
              <button id="loadCustom" class="primary">Load Custom Algorithm</button>
            </div>
          </div>
        </div>
      </section>
      <section id="view-crowd" class="view-panel" data-view="crowd" role="tabpanel" aria-labelledby="tab-crowd" aria-hidden="true" tabindex="-1">
        <div class="panel-scroll">
          <div class="panel-card">
            <h2 class="title">Crowd Model</h2>
            <div class="row">
              <label for="groundBias">Ground Floor Bias</label>
              <input id="groundBias" type="range" min="1" max="6" step="0.5" value="3"/>
            </div>
            <div class="row">
              <label></label>
              <div id="groundBiasLabel" class="small">x3.0</div>
            </div>
            <div class="row">
              <label for="toLobbyPct">To Lobby Preference</label>
              <input id="toLobbyPct" type="range" min="0" max="100" value="70"/>
            </div>
            <div class="row">
              <label></label>
              <div id="toLobbyPctLabel" class="small">70%</div>
            </div>
          </div>
        </div>
      </section>
      <section id="view-stats" class="view-panel" data-view="stats" role="tabpanel" aria-labelledby="tab-stats" aria-hidden="true" tabindex="-1">
        <div class="panel-scroll">
          <div class="panel-card">
            <h2 class="title">Overview</h2>
            <div class="stats">
              <div class="stat"><div class="label">Completed</div><div id="statCompleted" class="value">0</div></div>
              <div class="stat"><div class="label">Throughput (min)</div><div id="statThroughput" class="value">0</div></div>
              <div class="stat"><div class="label">Avg Wait (s)</div><div id="statAvgWait" class="value">0</div></div>
              <div class="stat"><div class="label">Max Wait (s)</div><div id="statMaxWait" class="value">0</div></div>
            </div>
          </div>
          <div class="panel-card">
            <h2 class="title">Fleet</h2>
            <div id="fleetList" class="fleet-list"></div>
          </div>
          <div class="panel-card">
            <h2 class="title">Floor Calls</h2>
            <div id="floorCalls" class="floor-calls"></div>
          </div>
        </div>
      </section>
    </main>
  </div>
`

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

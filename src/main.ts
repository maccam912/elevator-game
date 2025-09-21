import './style.css'
import Phaser from 'phaser'
import { GameScene } from './scenes/GameScene'
import { setupUI } from './ui'

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = `
  <div id="gameParent"></div>
  <div id="sidebar">
    <div class="sidebar-header">
      <h1 class="title sidebar-title">Elevator Simulator</h1>
      <div class="tab-bar" role="tablist" aria-label="Sidebar panels">
        <button type="button" class="tab active" data-tab-button="controls" aria-selected="true" tabindex="0">Controls</button>
        <button type="button" class="tab" data-tab-button="stats" aria-selected="false" tabindex="-1">Stats</button>
        <button type="button" class="tab" data-tab-button="custom" aria-selected="false" tabindex="-1">Custom</button>
      </div>
    </div>
    <div class="sidebar-body">
      <div class="section" data-tab-section="controls">
        <h2 class="title">Simulation</h2>
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
            <option value="exclusiveNearest">Single Responder (Nearest)</option>
            <option value="collective">Collective (Simple)</option>
            <option value="zoned">Zoned (Sectorized)</option>
            <option value="idleLobby">Idle To Lobby</option>
            <option value="custom">Custom (Editor)</option>
          </select>
        </div>
        <div class="row button-row">
          <button id="apply" class="primary" type="button">Apply & Restart</button>
          <button id="pause" type="button">Pause</button>
        </div>
      </div>

      <div class="section" data-tab-section="controls">
        <h2 class="title">Crowd Model</h2>
        <div class="row">
          <label for="groundBias">Ground Floor Bias</label>
          <input id="groundBias" type="range" min="1" max="6" step="0.5" value="3"/>
        </div>
        <div class="row"><label></label><div id="groundBiasLabel" class="small">x3.0</div></div>
        <div class="row">
          <label for="toLobbyPct">To Lobby Preference</label>
          <input id="toLobbyPct" type="range" min="0" max="100" value="70"/>
        </div>
        <div class="row"><label></label><div id="toLobbyPctLabel" class="small">70%</div></div>
      </div>

      <div class="section" data-tab-section="controls">
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
        <div class="row">
          <button id="manualCall" class="primary" type="button">Call Elevator</button>
        </div>
      </div>

      <div class="section" data-tab-section="custom">
        <h2 class="title">Custom Algorithm</h2>
        <div id="customPlaceholder" class="custom-placeholder small">
          Select "Custom (Editor)" from the algorithm list to enable the editor.
        </div>
        <div id="customEditorSection" class="custom-editor">
          <div class="small" style="margin-bottom:6px;">
            Provide a JS function named <code>decide</code> taking a state object and returning decisions.
          </div>
          <textarea id="customCode" class="code-editor" spellcheck="false"></textarea>
          <div class="row">
            <button id="loadCustom" class="primary" type="button">Load Custom Algorithm</button>
          </div>
        </div>
      </div>

      <div class="section" data-tab-section="stats">
        <h2 class="title">Performance</h2>
        <div class="stats">
          <div class="stat"><div class="label">Completed</div><div id="statCompleted" class="value">0</div></div>
          <div class="stat"><div class="label">Throughput (min)</div><div id="statThroughput" class="value">0</div></div>
          <div class="stat"><div class="label">Avg Wait (s)</div><div id="statAvgWait" class="value">0</div></div>
          <div class="stat"><div class="label">Max Wait (s)</div><div id="statMaxWait" class="value">0</div></div>
        </div>
      </div>

      <div class="section" data-tab-section="stats">
        <h2 class="title">Fleet</h2>
        <div id="fleetList" class="fleet-list"></div>
      </div>

      <div class="section" data-tab-section="stats">
        <h2 class="title">Floor Calls</h2>
        <div id="floorCalls" class="floor-calls"></div>
      </div>
    </div>
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

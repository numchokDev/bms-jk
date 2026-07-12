// Web App state
let ws = null;
let activeFaults = {};
let runningSecondsOffset = 0;
let uptimeInterval = null;

// UI elements (Safely queried)
const elConnectionStatus = document.getElementById('connection-status');
const elModeBadge = document.getElementById('mode-badge');

const elVoltageNeedle = document.getElementById('voltage-needle');
const elCurrentNeedle = document.getElementById('current-needle');
const elBatteryFill = document.getElementById('battery-fill');
const elSocVal = document.getElementById('soc-val');
const elFetActionLabel = document.getElementById('fet-action-label');
const elPackVoltage = document.getElementById('pack-voltage');
const elPackPowerGauge = document.getElementById('pack-power-gauge');
const elPackPower = document.getElementById('pack-power');
const elPackBalCap = document.getElementById('pack-bal-cap');

const elValUserdata = document.getElementById('val-userdata');
const elValSwversion = document.getElementById('val-swversion');
const elValRatecap = document.getElementById('val-ratecap');
const elValCyclecap = document.getElementById('val-cyclecap');
const elValCycles = document.getElementById('val-cycles');
const elValUptime = document.getElementById('val-uptime');
const elValAveVolt = document.getElementById('val-ave-volt');

const elTempNtc0 = document.getElementById('temp-ntc0');
const elTempNtc1 = document.getElementById('temp-ntc1');
const elTempNtc2 = document.getElementById('temp-ntc2');

const elFetCharging = document.getElementById('status-charge');
const elFetDischarging = document.getElementById('status-discharge');
const elFetBalancing = document.getElementById('status-balance');

const elCellDelta = document.getElementById('cell-delta');
const elCellMin = document.getElementById('cell-min');
const elCellMax = document.getElementById('cell-max');
const elCellsGrid = document.getElementById('cells-grid');
const elResistanceGrid = document.getElementById('resistance-grid');
const elWarningTbody = document.getElementById('warning-tbody');

const elSimulationSwitch = document.getElementById('simulation-switch');
const elPortSelect = document.getElementById('port-select');
const elBaudSelect = document.getElementById('baud-select');
const elDiagContainer = document.getElementById('diag-container');
const elValBalanceCurr = document.getElementById('val-balance-curr');
const elValTimeEmerg = document.getElementById('val-time-emerg');
const elValLogsCount = document.getElementById('val-logscount');
const elValSleepTime = document.getElementById('val-sleeptime');
const elCurrentWrapper = document.getElementById('current-wrapper');

// Warning alarms mapping
const warningNameMap = {
  lowCapacity: "ความจุแบตเตอรี่ต่ำเกินไป (Low Capacity)",
  bmsOvertemp: "บอร์ด BMS อุณหภูมิสูงเกินกำหนด (BMS Overtemp)",
  packOvervolt: "แรงดันไฟฟ้ารวมสูงเกินระบบ (Pack Overvoltage)",
  packUndervolt: "แรงดันไฟฟ้ารวมต่ำเกินระบบ (Pack Undervoltage)",
  packOvertemp: "เซลล์แบตเตอรี่ร้อนเกินไป (Pack Overtemp)",
  chargeOvercurrent: "กระแสชาร์จสูงเกินกำหนด (Charge Overcurrent)",
  dischargeOvercurrent: "กระแสจ่ายไฟสูงเกินกำหนด (Discharge Overcurrent)",
  cellCurrentDifference: "กระแสระหว่างเซลล์ต่างกันมากเกินไป (Cell Current Diff)",
  packOvertemp2: "อุณหภูมิเซ็นเซอร์ 2 สูงเกินไป (Pack Overtemp 2)",
  packUndertemp: "อุณหภูมิเซ็นเซอร์ต่ำเกินไป (Pack Undertemp)",
  singleCellOvervolt: "แรงดันเซลล์ใดเซลล์หนึ่งสูงเกินไป (Single Cell Overvoltage)",
  singleCellUndervolt: "แรงดันเซลล์ใดเซลล์หนึ่งต่ำเกินไป (Single Cell Undervoltage)"
};

// Fetch available serial ports from API
async function loadAvailablePorts() {
  try {
    const res = await fetch('/api/ports');
    const data = await res.json();
    if (elPortSelect) {
      elPortSelect.innerHTML = '';
      data.ports.forEach(port => {
        const opt = document.createElement('option');
        opt.value = port;
        opt.textContent = port === 'SIMULATOR' ? 'บอร์ดจำลอง (SIMULATOR)' : port;
        elPortSelect.appendChild(opt);
      });
    }
  } catch (e) {
    console.error("Failed to load ports:", e);
  }
}

// Connect WebSocket
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  console.log(`Connecting to WebSocket: ${wsUrl}`);
  
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    console.log("WebSocket connected.");
    updateConnectionUI(true, "เชื่อมต่อเซิร์ฟเวอร์เรียบร้อย");
  };
  
  ws.onmessage = (event) => {
    try {
      const state = JSON.parse(event.data);
      if (state.type === 'SERIAL_ERROR') {
        alert(`เกิดข้อผิดพลาดในการเชื่อมต่อ BMS: ${state.error}`);
        return;
      }
      updateDashboard(state);
    } catch (e) {
      console.error("Error handling ws message:", e);
    }
  };
  
  ws.onclose = () => {
    console.log("WebSocket disconnected. Reconnecting in 3s...");
    updateConnectionUI(false, "ขาดการเชื่อมต่อกับเซิร์ฟเวอร์");
    setTimeout(connectWebSocket, 3000);
  };
  
  ws.onerror = (err) => {
    console.error("WebSocket error:", err);
    updateConnectionUI(false, "เกิดข้อผิดพลาดในการเชื่อมต่อ");
  };
}

function updateConnectionUI(online, text) {
  if (!elConnectionStatus) return;
  const dot = elConnectionStatus.querySelector('.status-indicator');
  const txt = elConnectionStatus.querySelector('.status-text');
  
  if (dot && txt) {
    if (online) {
      dot.className = 'status-indicator online';
      txt.textContent = text || 'เชื่อมต่อสำเร็จ';
    } else {
      dot.className = 'status-indicator offline';
      txt.textContent = text || 'ไม่ได้เชื่อมต่อ';
    }
  }
}

// Format Running Time as 236D20H32M52S
function updateRunningTimeDisplay(totalMinutes) {
  if (uptimeInterval) clearInterval(uptimeInterval);
  
  runningSecondsOffset = 0;
  
  const renderTime = () => {
    const totalSeconds = totalMinutes * 60 + runningSecondsOffset;
    
    const days = Math.floor(totalSeconds / (24 * 3600));
    const hours = Math.floor((totalSeconds % (24 * 3600)) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    if (elValUptime) {
      elValUptime.textContent = `${days}D${hours}H${minutes}M${seconds}S`;
    }
    runningSecondsOffset++;
  };
  
  renderTime();
  uptimeInterval = setInterval(renderTime, 1000);
}

// Update dashboard with real BMS data
function updateDashboard(state) {
  const data = state.data;
  
  // 1. Connection Header & settings
  if (elModeBadge) {
    if (state.simulation) {
      elModeBadge.textContent = 'โหมดจำลอง';
      elModeBadge.className = 'mode-badge';
      if (elSimulationSwitch) elSimulationSwitch.checked = true;
      if (elDiagContainer) elDiagContainer.style.display = 'block';
    } else {
      elModeBadge.textContent = `พอร์ตจริง [${state.port}]`;
      elModeBadge.className = 'mode-badge real';
      if (elSimulationSwitch) elSimulationSwitch.checked = false;
      if (elDiagContainer) elDiagContainer.style.display = 'none';
    }
  }

  if (elPortSelect && state.port && elPortSelect.value !== state.port && state.port !== 'SIMULATOR') {
    elPortSelect.value = state.port;
  }

  if (elBaudSelect && state.baudRate && elBaudSelect.value !== String(state.baudRate)) {
    elBaudSelect.value = String(state.baudRate);
  }

  if (!data) return;

  // 2. SoC & Battery Indicator
  const soc = data.packSOC || 0;
  if (elSocVal) elSocVal.textContent = `${soc}%`;
  if (elBatteryFill) {
    elBatteryFill.style.width = `${soc}%`;
    if (soc > 50) {
      elBatteryFill.style.backgroundColor = 'var(--color-green)';
    } else if (soc > 20) {
      elBatteryFill.style.backgroundColor = 'var(--color-amber)';
    } else {
      elBatteryFill.style.backgroundColor = 'var(--color-rose)';
    }
  }

  // 3. Dial Gauges Needle Rotation
  const voltage = data.packV || 0;
  if (elVoltageNeedle) {
    const voltRotation = Math.max(-90, Math.min(90, -90 + (voltage / 200) * 180));
    elVoltageNeedle.setAttribute('transform', `rotate(${voltRotation} 50 50)`);
  }

  const current = data.packA || 0;
  const powerVal = data.packW !== undefined ? data.packW : (voltage * current);
  if (elCurrentNeedle) {
    // Range: -5000W to 5000W
    const powerRotation = Math.max(-90, Math.min(90, -90 + ((powerVal + 5000) / 10000) * 180));
    elCurrentNeedle.setAttribute('transform', `rotate(${powerRotation} 50 50)`);
  }

  // 4. Digital Readouts
  if (elPackVoltage) elPackVoltage.textContent = voltage.toFixed(1);
  if (elPackPowerGauge) {
    const power = data.packW !== undefined ? data.packW : (voltage * current);
    elPackPowerGauge.textContent = power.toFixed(1);
  }
  
  if (elFetActionLabel) {
    if (current > 0.1) {
      elFetActionLabel.textContent = 'CHARGING';
      elFetActionLabel.style.color = 'var(--color-green)';
    } else if (current < -0.1) {
      elFetActionLabel.textContent = 'DISCHARGING';
      elFetActionLabel.style.color = 'var(--color-rose)';
    } else {
      elFetActionLabel.textContent = 'STANDBY';
      elFetActionLabel.style.color = 'var(--text-secondary)';
    }
  }

  if (elCurrentWrapper) {
    if (current > 0.1) {
      elCurrentWrapper.className = 'metric-value charging';
    } else if (current < -0.1) {
      elCurrentWrapper.className = 'metric-value discharging';
    } else {
      elCurrentWrapper.className = 'metric-value';
    }
  }

  // Power, Capacity, Remain Cap
  if (elPackPower) elPackPower.textContent = `${(data.packW || 0).toFixed(1)}W`;

  if (elPackBalCap) elPackBalCap.textContent = `${(data.packBalCap || 0).toFixed(1)}AH`;

  // Quick info list
  if (elValUserdata) elValUserdata.textContent = data.userData ? `[${data.userData}]` : '';
  if (elValSwversion) elValSwversion.textContent = data.bmsSWVersion || 'N/A';
  if (elValRatecap) elValRatecap.textContent = `${(data.packRateCap || 0).toFixed(1)}AH`;
  if (elValCyclecap) elValCyclecap.textContent = `${(data.packCycleCap || 0).toFixed(1)}AH`;
  if (elValCycles) elValCycles.textContent = data.packNumberCycles !== undefined ? data.packNumberCycles : '0';
  
  // Uptime ticker
  updateRunningTimeDisplay(data.bmsOnMinutes || 0);

  // 5. Temperatures
  if (elTempNtc0) elTempNtc0.textContent = (data.tempSensorValues && data.tempSensorValues.NTC0 !== undefined) ? `${data.tempSensorValues.NTC0.toFixed(1)}°C` : '0.0°C';
  if (elTempNtc1) elTempNtc1.textContent = (data.tempSensorValues && data.tempSensorValues.NTC1 !== undefined) ? `${data.tempSensorValues.NTC1.toFixed(1)}°C` : '0.0°C';
  if (elTempNtc2) elTempNtc2.textContent = (data.tempSensorValues && data.tempSensorValues.NTC2 !== undefined) ? `${data.tempSensorValues.NTC2.toFixed(1)}°C` : '0.0°C';

  // 6. FET Status
  const fet = data.FETStatus || {};
  updateFetBox(elFetCharging, fet.charging);
  updateFetBox(elFetDischarging, fet.discharging);
  updateFetBox(elFetBalancing, fet.balancing);

  // Other diagnostics parameters
  if (elValBalanceCurr) elValBalanceCurr.textContent = fet.balancing ? '0.600A' : '0.000A';
  if (elValTimeEmerg) elValTimeEmerg.textContent = '0';
  if (elValLogsCount) elValLogsCount.textContent = '66192';
  if (elValSleepTime) elValSleepTime.textContent = '86400S';

  // 7. Cells grid voltages & resistances (ONLY show active ones)
  const cells = data.cellData || {};
  
  // Find cell indices with valid values (checks up to 32 cells)
  const activeCellIndices = [];
  for (let i = 0; i < 32; i++) {
    const v = cells[`cell${i}V`];
    if (v !== undefined && v !== null && v > 0) {
      activeCellIndices.push(i);
    }
  }

  const activeCellsCount = activeCellIndices.length;

  if (activeCellsCount > 0) {
    let minV = Infinity;
    let maxV = -Infinity;
    let minIdx = -1;
    let maxIdx = -1;
    let sumV = 0;

    // Find min / max and sum for average
    activeCellIndices.forEach(i => {
      const v = cells[`cell${i}V`];
      sumV += v;
      if (v < minV) { minV = v; minIdx = i; }
      if (v > maxV) { maxV = v; maxIdx = i; }
    });

    const averageV = sumV / activeCellsCount;
    if (elValAveVolt) elValAveVolt.textContent = `${averageV.toFixed(3)}V`;

    const deltaV = (minV !== Infinity && maxV !== -Infinity) ? (maxV - minV) : 0;
    if (elCellDelta) elCellDelta.textContent = `${deltaV.toFixed(3)}V`;
    if (elCellMin) elCellMin.textContent = minIdx !== -1 ? `${minV.toFixed(3)} V (#${minIdx + 1})` : '--';
    if (elCellMax) elCellMax.textContent = maxIdx !== -1 ? `${maxV.toFixed(3)} V (#${maxIdx + 1})` : '--';

    // Populate DOM cell grids if rebuilt
    if (elCellsGrid && elResistanceGrid) {
      const currentCellsInDOM = elCellsGrid.querySelectorAll('.cell-slot').length;
      let rebuildGrid = (currentCellsInDOM !== activeCellsCount);
      
      if (!rebuildGrid) {
        for (let idx = 0; idx < activeCellsCount; idx++) {
          const cellId = activeCellIndices[idx];
          if (!document.getElementById(`cell-volt-slot-${cellId}`)) {
            rebuildGrid = true;
            break;
          }
        }
      }

      if (rebuildGrid) {
        elCellsGrid.innerHTML = '';
        elResistanceGrid.innerHTML = '';
        
        activeCellIndices.forEach(i => {
          // Voltage slot
          const voltSlot = document.createElement('div');
          voltSlot.className = 'cell-slot';
          voltSlot.id = `cell-volt-slot-${i}`;
          voltSlot.innerHTML = `
            <span class="cell-idx">${String(i + 1).padStart(2, '0')}</span>
            <span class="cell-volts-text" id="cell-v-val-${i}">0.000 V</span>
          `;
          elCellsGrid.appendChild(voltSlot);

          // Resistance slot (Mocked to 0.000 Ω like in screenshot, or real if reported)
          const resSlot = document.createElement('div');
          resSlot.className = 'cell-slot';
          resSlot.id = `cell-res-slot-${i}`;
          resSlot.innerHTML = `
            <span class="cell-idx">${String(i + 1).padStart(2, '0')}</span>
            <span class="cell-res-text green" id="cell-r-val-${i}">0.000 Ω</span>
          `;
          elResistanceGrid.appendChild(resSlot);
        });
      }

      // Update cell and resistance values in DOM
      activeCellIndices.forEach(i => {
        const v = cells[`cell${i}V`];
        const r = cells[`cell${i}R`];
        const voltSlot = document.getElementById(`cell-volt-slot-${i}`);
        const valEl = document.getElementById(`cell-v-val-${i}`);
        const resEl = document.getElementById(`cell-r-val-${i}`);
        
        if (v !== undefined && voltSlot && valEl) {
          valEl.textContent = `${v.toFixed(3)} V`;
          
          // Highlights min/max
          voltSlot.className = 'cell-slot';
          valEl.className = 'cell-volts-text';
          
          if (i === minIdx) {
            voltSlot.classList.add('min');
            valEl.classList.add('rose');
          } else if (i === maxIdx) {
            voltSlot.classList.add('max');
            valEl.classList.add('cyan');
          } else {
            valEl.classList.add('green');
          }
        }

        if (r !== undefined && resEl) {
          resEl.textContent = `${r.toFixed(3)} mΩ`;
        }
      });

    }

  } else {
    if (elCellsGrid) elCellsGrid.innerHTML = '<div class="loading-text">ไม่พบข้อมูลเซลล์ที่เชื่อมต่อ</div>';
    if (elResistanceGrid) elResistanceGrid.innerHTML = '<div class="loading-text">ไม่พบข้อมูลความต้านทานขั้วสาย</div>';
    if (elValAveVolt) elValAveVolt.textContent = '0.000V';
    if (elCellDelta) elCellDelta.textContent = '0.000V';
    if (elCellMin) elCellMin.textContent = '--';
    if (elCellMax) elCellMax.textContent = '--';
  }

  // 8. Warning List table updates
  const alarms = data.protectionStatus || {};

  if (elWarningTbody) {
    let alarmIndex = 1;
    elWarningTbody.innerHTML = '';

    for (let alarmName in alarms) {
      if (alarms[alarmName] === true) {
        const warningText = warningNameMap[alarmName] || `เกิดปัญหา: ${alarmName}`;
        const tr = document.createElement('tr');
        tr.className = 'active-alarm';
        tr.innerHTML = `
          <td style="text-align: center;">${alarmIndex}</td>
          <td>${warningText}</td>
        `;
        elWarningTbody.appendChild(tr);
        alarmIndex++;
      }
    }

    // If cell count is simulated and wrong, add setting warning just like the screenshot!
    if (state.simulation && activeCellsCount !== 16) {
      const tr = document.createElement('tr');
      tr.className = 'active-alarm';
      tr.innerHTML = `
        <td style="text-align: center;">${alarmIndex}</td>
        <td>Cell Count is Not Equal to Settings (จำนวนเซลล์จริงไม่ตรงกับค่าที่ตั้งไว้)</td>
      `;
      elWarningTbody.appendChild(tr);
      alarmIndex++;
    }

    // If battery is 100%, show battery fully charged warning
    if (soc === 100) {
      const tr = document.createElement('tr');
      tr.className = 'active-alarm';
      tr.innerHTML = `
        <td style="text-align: center;">${alarmIndex}</td>
        <td>Battery is Fully Charged (ชาร์จประจุไฟเต็มสมบูรณ์แล้ว)</td>
      `;
      elWarningTbody.appendChild(tr);
      alarmIndex++;
    }

    if (alarmIndex === 1) {
      elWarningTbody.innerHTML = `
        <tr class="no-warning">
          <td colspan="2" style="text-align: center; color: var(--color-green); font-weight: 600;">สถานะปกติ ไม่มีข้อผิดพลาด</td>
        </tr>
      `;
    }
  }

  // Update simulator control buttons
  updateDiagButtons(alarms);
}

function updateFetBox(valEl, active) {
  if (!valEl) return;
  if (active) {
    valEl.textContent = 'ON';
    valEl.className = 'val state-val on';
  } else {
    valEl.textContent = 'OFF';
    valEl.className = 'val state-val off';
  }
}

function updateDiagButtons(alarms) {
  activeFaults = alarms;
  
  const map = {
    'singleCellOvervolt': 'btn-fault-overvolt',
    'singleCellUndervolt': 'btn-fault-undervolt',
    'chargeOvercurrent': 'btn-fault-overcurrent',
    'bmsOvertemp': 'btn-fault-overtemp'
  };

  for (let alarm in map) {
    const btn = document.getElementById(map[alarm]);
    if (btn) {
      if (alarms[alarm] === true) {
        btn.classList.add('active');
        btn.textContent = `ล้างค่า ${btn.textContent.replace('ยิง ', '').replace('ล้างค่า ', '')}`;
      } else {
        btn.classList.remove('active');
        btn.textContent = `ยิง ${btn.textContent.replace('ยิง ', '').replace('ล้างค่า ', '')}`;
      }
    }
  }
}

// Send command to inject/clear fault
function injectFault(faultName) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'TRIGGER_SIM_FAULT',
      fault: faultName
    }));
  }
}

// Listen for settings change
if (elSimulationSwitch) {
  elSimulationSwitch.addEventListener('change', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'TOGGLE_SIMULATION',
        value: elSimulationSwitch.checked
      }));
    }
  });
}

if (elPortSelect) {
  elPortSelect.addEventListener('change', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'CHANGE_PORT',
        value: elPortSelect.value
      }));
    }
  });
}

if (elBaudSelect) {
  elBaudSelect.addEventListener('change', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'CHANGE_BAUDRATE',
        value: parseInt(elBaudSelect.value, 10)
      }));
    }
  });
}

// Tab Switching Logic
const tabButtons = document.querySelectorAll('.tab-btn');
const leftPanel = document.querySelector('.left-panel');
const rightPanel = document.querySelector('.right-panel');
const dashboardLayout = document.querySelector('.dashboard-layout');

// DOM elements to toggle
const elGauges = document.querySelector('.major-status-container');
const elWarnings = document.querySelector('.warning-panel');
const elStatus = document.querySelector('.battery-status-container');
const elCells = document.querySelector('.cells-voltage-container');
const elResistance = document.querySelector('.cells-resistance-container');
const elDiagnostics = document.querySelector('.diagnostics-container');
const elLoggingPanel = document.getElementById('logging-panel');

if (tabButtons.length > 0 && dashboardLayout && leftPanel && rightPanel) {
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Remove active class from all tabs
      tabButtons.forEach(t => t.classList.remove('active'));
      // Add active class to clicked tab
      btn.classList.add('active');

      const tabId = btn.id;
      
      // Reset default grid styles
      dashboardLayout.style.display = 'grid';
      dashboardLayout.style.gridTemplateColumns = '360px 1fr';
      leftPanel.style.display = 'flex';
      rightPanel.style.display = 'flex';
      
      // Reset all panels display
      if (elGauges) elGauges.style.display = 'flex';
      if (elWarnings) elWarnings.style.display = 'flex';
      if (elStatus) elStatus.style.display = 'block';
      if (elCells) elCells.style.display = 'block';
      if (elResistance) elResistance.style.display = 'block';
      if (elDiagnostics) elDiagnostics.style.display = 'block';
      if (elLoggingPanel) elLoggingPanel.style.display = 'none';

      if (tabId === 'tab-settings') {
        dashboardLayout.style.display = 'block';
        leftPanel.style.display = 'none';
        if (elStatus) elStatus.style.display = 'none';
        if (elCells) elCells.style.display = 'none';
        if (elResistance) elResistance.style.display = 'none';
      } 
      else if (tabId === 'tab-control') {
        dashboardLayout.style.display = 'block';
        leftPanel.style.display = 'none';
        if (elCells) elCells.style.display = 'none';
        if (elResistance) elResistance.style.display = 'none';
      }
      else if (tabId === 'tab-logging') {
        // Logging Tab: ซ่อน dashboard แสดง logging panel แทน
        dashboardLayout.style.display = 'none';
        if (elLoggingPanel) elLoggingPanel.style.display = 'block';
        loadLoggingData();
      }
      else if (tabId === 'tab-detaillogs') {
        if (elGauges) elGauges.style.display = 'none';
        if (elCells) elCells.style.display = 'none';
        if (elResistance) elResistance.style.display = 'none';
        if (elDiagnostics) elDiagnostics.style.display = 'none';
      }
      else if (tabId === 'tab-about') {
        dashboardLayout.style.display = 'block';
        rightPanel.style.display = 'none';
      }
      else if (tabId === 'tab-parallel') {
        dashboardLayout.style.display = 'block';
        leftPanel.style.display = 'none';
        if (elDiagnostics) elDiagnostics.style.display = 'none';
      }
    });
  });
}

// ============================================================
// LOGGING DATA FUNCTIONS
// ============================================================

async function loadLoggingData() {
  try {
    const rangeSelect = document.getElementById('log-range-select');
    const days = rangeSelect ? rangeSelect.value : '30';

    const elDaysShown = document.getElementById('log-days-shown');
    if (elDaysShown) {
      elDaysShown.textContent = days === 'all' ? 'ทั้งหมด' : `${days}`;
    }

    // ดึงข้อมูลสรุปรายวันตามช่วงเวลาที่เลือก
    const res = await fetch(`/api/logs/daily?days=${days}`);
    const data = await res.json();

    // คำนวณพลังงานสะสมจากผลรวมของแต่ละวันตามช่วงเวลาที่เลือกจริง
    let totalRangeChargeKWh = 0;
    let totalRangeDischargeKWh = 0;
    if (data.daily && data.daily.length > 0) {
      data.daily.forEach(row => {
        totalRangeChargeKWh += row.chargeKWh || 0;
        totalRangeDischargeKWh += row.dischargeKWh || 0;
      });
    }

    // แสดงผลข้อมูลในการ์ดสะสม
    const elCharge = document.getElementById('log-session-charge');
    const elDischarge = document.getElementById('log-session-discharge');
    const elRecords = document.getElementById('log-total-records');
    if (elCharge) elCharge.textContent = `${totalRangeChargeKWh.toFixed(3)} kWh`;
    if (elDischarge) elDischarge.textContent = `${totalRangeDischargeKWh.toFixed(3)} kWh`;
    if (elRecords) elRecords.textContent = `${data.totalRecordsInDB?.toLocaleString() || '--'} รายการ`;

    // แสดง Daily Summary Table
    const tbody = document.getElementById('log-daily-tbody');
    if (tbody) {
      if (!data.daily || data.daily.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-secondary);">ยังไม่มีข้อมูลในฐานข้อมูล</td></tr>';
      } else {
        tbody.innerHTML = data.daily.slice().reverse().map(row => {
          const chargeColor = row.chargeKWh > 0 ? 'var(--color-green)' : 'var(--text-secondary)';
          const dischargeColor = row.dischargeKWh > 0 ? 'var(--color-rose)' : 'var(--text-secondary)';
          return `<tr>
            <td class="font-mono">${row.date}</td>
            <td style="color:${chargeColor};font-weight:600;">${row.chargeKWh.toFixed(3)}</td>
            <td style="color:${dischargeColor};font-weight:600;">${row.dischargeKWh.toFixed(3)}</td>
            <td>${row.avgSOC}%</td>
            <td>${row.minSOC}%</td>
            <td>${row.maxSOC}%</td>
            <td>${row.avgTempNTC0 !== null ? row.avgTempNTC0 + '°C' : 'N/A'}</td>
            <td>${row.maxTempNTC0 !== null ? row.maxTempNTC0 + '°C' : 'N/A'}</td>
            <td class="font-mono">${row.recordCount.toLocaleString()}</td>
          </tr>`;
        }).join('');
      }
    }

    // ดึง Raw Logs ล่าสุด 100 รายการ
    const resLogs = await fetch('/api/logs?limit=100');
    const logsData = await resLogs.json();
    const recentTbody = document.getElementById('log-recent-tbody');
    const recentCount = document.getElementById('log-recent-count');

    if (recentCount) {
      recentCount.textContent = `แสดง ${logsData.count || 0} รายการล่าสุด`;
    }

    if (recentTbody && logsData.logs) {
      if (logsData.logs.length === 0) {
        recentTbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-secondary);">ยังไม่มีข้อมูล</td></tr>';
      } else {
        recentTbody.innerHTML = logsData.logs.slice().reverse().map(log => {
          const timeStr = new Date(log.timestamp).toLocaleTimeString('th-TH', { hour12: false });
          const dateStr = new Date(log.timestamp).toLocaleDateString('th-TH');
          const wColor = log.packW > 0.1 ? 'var(--color-green)' : (log.packW < -0.1 ? 'var(--color-rose)' : 'var(--text-secondary)');
          const currentVal = log.packA || 0;
          const statusText = currentVal > 0.1 ? '⚡ชาร์จ' : (currentVal < -0.1 ? '🔋จ่ายไฟ' : '⏸STANDBY');
          const statusColor = currentVal > 0.1 ? 'var(--color-green)' : (currentVal < -0.1 ? 'var(--color-rose)' : 'var(--text-secondary)');
          return `<tr>
            <td class="font-mono" style="font-size:0.78rem;">${dateStr} ${timeStr}</td>
            <td>${log.packSOC}%</td>
            <td class="font-mono">${(log.packV || 0).toFixed(2)}</td>
            <td class="font-mono" style="color:${wColor};">${(log.packW || 0).toFixed(1)}</td>
            <td class="font-mono">${(log.packA || 0).toFixed(2)}</td>
            <td>${log.tempNTC0 !== null ? log.tempNTC0 + '°C' : '--'}</td>
            <td>${log.tempNTC1 !== null ? log.tempNTC1 + '°C' : '--'}</td>
            <td style="color:${statusColor};font-size:0.8rem;">${statusText}</td>
          </tr>`;
        }).join('');
      }
    }
  } catch (err) {
    console.error('[Logging] Failed to load data:', err);
    const tbody = document.getElementById('log-daily-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--color-rose);">เกิดข้อผิดพลาด: ${err.message}</td></tr>`;
  }
}

function changeLogRange() {
  loadLoggingData();
}

// App Startup
loadAvailablePorts().then(() => {
  connectWebSocket();
});


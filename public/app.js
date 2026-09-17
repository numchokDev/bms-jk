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

  if (!data || !state.connected) {
    if (elSocVal) elSocVal.textContent = `--%`;
    if (elBatteryFill) elBatteryFill.style.width = `0%`;
    if (elVoltageNeedle) elVoltageNeedle.setAttribute('transform', `rotate(-90 50 50)`);
    if (elCurrentNeedle) elCurrentNeedle.setAttribute('transform', `rotate(-90 50 50)`);
    if (elPackVoltage) elPackVoltage.textContent = '--';
    if (elPackPowerGauge) elPackPowerGauge.textContent = '--';
    if (elPackPower) elPackPower.textContent = '-- W';
    if (elPackBalCap) elPackBalCap.textContent = '-- AH';
    if (elFetActionLabel) {
      elFetActionLabel.textContent = 'OFFLINE';
      elFetActionLabel.style.color = 'var(--text-secondary)';
    }
    if (elCurrentWrapper) elCurrentWrapper.className = 'metric-value';
    if (elTempNtc0) elTempNtc0.textContent = '--°C';
    if (elTempNtc1) elTempNtc1.textContent = '--°C';
    if (elTempNtc2) elTempNtc2.textContent = '--°C';
    updateFetBox(elFetCharging, false);
    updateFetBox(elFetDischarging, false);
    updateFetBox(elFetBalancing, false);
    const cellGrid = document.getElementById('cells-grid');
    if (cellGrid) cellGrid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text-secondary);padding:16px;">ไม่สามารถเชื่อมต่อกับ BMS ได้</div>';
    return;
  }

  // 2. SoC & Battery Indicator (Normalized & Clamped 0-100%)
  let rawSoc = data.packSOC !== undefined ? data.packSOC : 0;
  if (rawSoc > 100 && rawSoc <= 1000) rawSoc = Math.round(rawSoc / 10);
  const soc = Math.max(0, Math.min(100, Math.round(rawSoc)));
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
            <span class="cell-res-text green" id="cell-r-val-${i}">0.000 mΩ</span>
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
const elLoggingPanel = document.getElementById('logging-panel') || document.getElementById('tab-content-logging');
const elAnalyticsPanel = document.getElementById('tab-content-analytics');
const elSohPanel = document.getElementById('tab-content-soh');

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
      if (elAnalyticsPanel) elAnalyticsPanel.style.display = 'none';
      if (elSohPanel) elSohPanel.style.display = 'none';

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
      else if (tabId === 'tab-analytics') {
        // Analytics Tab: ซ่อน dashboard แสดง analytics panel แทน
        dashboardLayout.style.display = 'none';
        if (elLoggingPanel) elLoggingPanel.style.display = 'none';
        if (elAnalyticsPanel) {
          elAnalyticsPanel.style.display = 'block';
          if (!analyticsChart) {
            initAnalyticsChart();
          }
          requestAnimationFrame(() => {
            if (analyticsChart) analyticsChart.resize();
            loadAnalyticsData(currentAnalyticsRange);
          });
        }
      }
      else if (tabId === 'tab-soh') {
        // SOH Tab: ซ่อน dashboard แสดง SOH panel แทน
        dashboardLayout.style.display = 'none';
        if (elLoggingPanel) elLoggingPanel.style.display = 'none';
        if (elAnalyticsPanel) elAnalyticsPanel.style.display = 'none';
        if (elSohPanel) {
          elSohPanel.style.display = 'block';
          loadSohEfficiencyData();
        }
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
        tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;color:var(--text-secondary);">ยังไม่มีข้อมูลในฐานข้อมูล</td></tr>';
      } else {
        tbody.innerHTML = data.daily.slice().reverse().map(row => {
          const chargeColor = row.chargeKWh > 0 ? 'var(--color-green)' : 'var(--text-secondary)';
          const dischargeColor = row.dischargeKWh > 0 ? 'var(--color-rose)' : 'var(--text-secondary)';
          // Cell voltage diff color coding
          const diffVal = row.cellVoltDiffMax;
          let diffColor = 'var(--color-green)';
          if (diffVal != null && diffVal > 0.100) {
            diffColor = 'var(--color-rose)';
          } else if (diffVal != null && diffVal > 0.050) {
            diffColor = 'var(--color-amber)';
          }
          return `<tr>
            <td class="font-mono">${row.date}</td>
            <td style="color:${chargeColor};font-weight:600;">${row.chargeKWh.toFixed(3)}</td>
            <td style="color:${dischargeColor};font-weight:600;">${row.dischargeKWh.toFixed(3)}</td>
            <td>${row.avgSOC}%</td>
            <td>${row.minSOC}%</td>
            <td>${row.maxSOC}%</td>
            <td class="font-mono" style="color:var(--color-cyan);">${row.cellVoltMin != null ? row.cellVoltMin.toFixed(3) + ' V' + (row.cellVoltMinIdx != null ? ' (เซลล์ ' + (row.cellVoltMinIdx + 1) + ')' : '') : 'N/A'}</td>
            <td class="font-mono" style="color:var(--color-cyan);">${row.cellVoltMax != null ? row.cellVoltMax.toFixed(3) + ' V' + (row.cellVoltMaxIdx != null ? ' (เซลล์ ' + (row.cellVoltMaxIdx + 1) + ')' : '') : 'N/A'}</td>
            <td class="font-mono" style="color:${diffColor};font-weight:600;">${row.cellVoltDiffMax != null ? row.cellVoltDiffMax.toFixed(3) + ' V' : 'N/A'}</td>
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
        recentTbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--text-secondary);">ยังไม่มีข้อมูล</td></tr>';
      } else {
        recentTbody.innerHTML = logsData.logs.map(log => {
          const timeStr = new Date(log.timestamp).toLocaleTimeString('th-TH', { hour12: false });
          const dateStr = new Date(log.timestamp).toLocaleDateString('th-TH');
          const wColor = log.packW > 0.1 ? 'var(--color-green)' : (log.packW < -0.1 ? 'var(--color-rose)' : 'var(--text-secondary)');
          const currentVal = log.packA || 0;
          const statusText = currentVal > 0.1 ? '⚡ชาร์จ' : (currentVal < -0.1 ? '🔋จ่ายไฟ' : '⏸STANDBY');
          const statusColor = currentVal > 0.1 ? 'var(--color-green)' : (currentVal < -0.1 ? 'var(--color-rose)' : 'var(--text-secondary)');
          // Cell diff color coding
          const logDiff = log.cellVoltDiff;
          let logDiffColor = 'var(--color-green)';
          if (logDiff !== null && logDiff !== undefined && logDiff > 0.100) {
            logDiffColor = 'var(--color-rose)';
          } else if (logDiff !== null && logDiff !== undefined && logDiff > 0.050) {
            logDiffColor = 'var(--color-amber)';
          }
          return `<tr>
            <td class="font-mono" style="font-size:0.78rem;">${dateStr} ${timeStr}</td>
            <td>${log.packSOC}%</td>
            <td class="font-mono">${(log.packV || 0).toFixed(2)}</td>
            <td class="font-mono" style="color:${wColor};">${(log.packW || 0).toFixed(1)}</td>
            <td class="font-mono">${(log.packA || 0).toFixed(2)}</td>
            <td class="font-mono" style="color:var(--color-cyan);">${log.cellVoltMin != null ? log.cellVoltMin.toFixed(3) + ' V' + (log.cellVoltMinIdx != null ? ' (เซลล์ ' + (log.cellVoltMinIdx + 1) + ')' : '') : '--'}</td>
            <td class="font-mono" style="color:var(--color-cyan);">${log.cellVoltMax != null ? log.cellVoltMax.toFixed(3) + ' V' + (log.cellVoltMaxIdx != null ? ' (เซลล์ ' + (log.cellVoltMaxIdx + 1) + ')' : '') : '--'}</td>
            <td class="font-mono" style="color:${logDiffColor};font-weight:600;">${log.cellVoltDiff != null ? log.cellVoltDiff.toFixed(3) + ' V' : '--'}</td>
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
    if (tbody) tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;color:var(--color-rose);">เกิดข้อผิดพลาด: ${err.message}</td></tr>`;
  }
}

function changeLogRange() {
  loadLoggingData();
}

// ============================================================
// HISTORICAL CHARTS & ANALYTICS MODULE
// ============================================================
let analyticsChart = null;
let currentAnalyticsRange = '24h';
let analyticsData = [];

// 16 curated high-contrast vibrant colors for cells
const cellColors = [
  '#00e5ff', '#00ff88', '#ffea00', '#ff2a6d', '#05d9e8', '#ff9f1c', '#9b5de5', '#f15bb5',
  '#00bbf9', '#00f5d4', '#fee440', '#e63946', '#8338ec', '#3a86ff', '#fb5607', '#ff006e'
];

function initAnalyticsUI() {
  // Render 16 Cell Toggle Chips + System Metrics Chips
  const chipsGrid = document.getElementById('cell-chips-grid');
  if (chipsGrid) {
    chipsGrid.innerHTML = '';
    for (let i = 0; i < 16; i++) {
      const chip = document.createElement('div');
      chip.className = 'cell-chip active';
      chip.dataset.cellIdx = i;
      chip.style.setProperty('--chip-color', cellColors[i]);
      chip.style.setProperty('--chip-shadow', cellColors[i] + '40');
      chip.innerHTML = `<span class="chip-color-dot"></span><span>Cell ${i + 1}</span>`;
      chip.addEventListener('click', () => toggleCellVisibility(i));
      chipsGrid.appendChild(chip);
    }

    // System Metrics Chips (16: Diff, 17: SOC, 18: Pack V, 19: Current)
    const metricsConfig = [
      { idx: 16, label: '⚡ Cell Diff', color: '#ffea00' },
      { idx: 17, label: '🔋 Battery SOC (%)', color: '#00ff88' },
      { idx: 18, label: '⚡ Total Pack Volt', color: '#3a86ff' },
      { idx: 19, label: '🔌 Current (A)', color: '#ff2a6d' }
    ];

    metricsConfig.forEach(m => {
      const chip = document.createElement('div');
      chip.className = 'cell-chip active';
      chip.dataset.cellIdx = m.idx;
      chip.style.setProperty('--chip-color', m.color);
      chip.style.setProperty('--chip-shadow', m.color + '40');
      chip.innerHTML = `<span class="chip-color-dot" style="background:${m.color};"></span><span>${m.label}</span>`;
      chip.addEventListener('click', () => toggleCellVisibility(m.idx));
      chipsGrid.appendChild(chip);
    });
  }

  // Range Selector Buttons
  const rangeBtns = document.querySelectorAll('.range-btn-group .range-btn');
  rangeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      rangeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentAnalyticsRange = btn.dataset.range || '24h';
      loadAnalyticsData(currentAnalyticsRange);
    });
  });

  // Quick Action Buttons
  const btnAll = document.getElementById('btn-select-all');
  const btnNone = document.getElementById('btn-deselect-all');
  const btnMinMax = document.getElementById('btn-select-minmax');
  const btnC1C4 = document.getElementById('btn-select-c1c4');
  const btnPack = document.getElementById('btn-select-pack');

  if (btnAll) btnAll.addEventListener('click', () => setAllCellsVisibility(true));
  if (btnNone) btnNone.addEventListener('click', () => setAllCellsVisibility(false));
  if (btnMinMax) btnMinMax.addEventListener('click', selectMinMaxCellsOnly);
  if (btnC1C4) btnC1C4.addEventListener('click', () => setSelectedCellsOnly([0, 3])); // Cell 1 & Cell 4
  if (btnPack) btnPack.addEventListener('click', () => setSelectedCellsOnly([17, 18, 19])); // Pack SOC, Pack V, Current A
}

function initAnalyticsChart() {
  const canvas = document.getElementById('analytics-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  const ctx = canvas.getContext('2d');

  // Build 16 cell datasets
  const datasets = [];
  for (let i = 0; i < 16; i++) {
    datasets.push({
      label: `Cell ${i + 1}`,
      data: [],
      borderColor: cellColors[i],
      backgroundColor: cellColors[i] + '15',
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 5,
      tension: 0.25,
      hidden: false
    });
  }

  // 17th: Cell Diff curve (y1)
  datasets.push({
    label: '⚡ Cell Diff (ความต่าง)',
    data: [],
    borderColor: '#ffea00',
    backgroundColor: 'rgba(255, 234, 0, 0.08)',
    borderWidth: 2,
    borderDash: [4, 4],
    pointRadius: 0,
    pointHoverRadius: 6,
    tension: 0.2,
    yAxisID: 'y1',
    hidden: false
  });

  // 18th: Pack SOC % curve (y2)
  datasets.push({
    label: '🔋 Battery SOC (%)',
    data: [],
    borderColor: '#00ff88',
    backgroundColor: 'rgba(0, 255, 136, 0.08)',
    borderWidth: 2.5,
    borderDash: [2, 2],
    pointRadius: 0,
    pointHoverRadius: 6,
    tension: 0.25,
    yAxisID: 'y2',
    hidden: false
  });

  // 19th: Total Pack Voltage V curve (y3)
  datasets.push({
    label: '⚡ Total Pack Volt (V)',
    data: [],
    borderColor: '#3a86ff',
    backgroundColor: 'rgba(58, 134, 255, 0.08)',
    borderWidth: 2.5,
    borderDash: [6, 3],
    pointRadius: 0,
    pointHoverRadius: 6,
    tension: 0.25,
    yAxisID: 'y3',
    hidden: false
  });

  // 20th: Current A curve (y4)
  datasets.push({
    label: '🔌 Current (A)',
    data: [],
    borderColor: '#ff2a6d',
    backgroundColor: 'rgba(255, 42, 109, 0.08)',
    borderWidth: 2,
    borderDash: [3, 3],
    pointRadius: 0,
    pointHoverRadius: 6,
    tension: 0.25,
    yAxisID: 'y4',
    hidden: false
  });

  analyticsChart = new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: 'rgba(5, 20, 30, 0.95)',
          titleColor: '#00e5ff',
          bodyColor: '#e0f2fe',
          borderColor: 'rgba(0, 229, 255, 0.3)',
          borderWidth: 1,
          padding: 12,
          boxPadding: 4,
          usePointStyle: true,
          callbacks: {
            label: function(context) {
              const val = context.parsed.y;
              if (val == null) return ` ${context.dataset.label}: N/A`;
              if (context.datasetIndex === 17) {
                return ` 🔋 Pack SOC: ${Math.round(val)}%`;
              } else if (context.datasetIndex === 18) {
                return ` ⚡ Pack Voltage: ${val.toFixed(2)} V`;
              } else if (context.datasetIndex === 19) {
                const status = val > 0.1 ? '⚡ชาร์จ' : (val < -0.1 ? '🔋จ่ายไฟ' : '⏸STANDBY');
                return ` 🔌 Current: ${val > 0 ? '+' : ''}${val.toFixed(2)} A (${status})`;
              }
              return ` ${context.dataset.label}: ${val.toFixed(3)} V`;
            },
            footer: function(tooltipItems) {
              if (!tooltipItems || tooltipItems.length === 0) return '';
              let minV = Infinity, maxV = -Infinity;
              let minName = '', maxName = '';
              let socVal = null, packVVal = null, currVal = null;

              tooltipItems.forEach(item => {
                if (item.datasetIndex < 16 && item.parsed.y != null) {
                  const v = item.parsed.y;
                  if (v < minV) { minV = v; minName = item.dataset.label; }
                  if (v > maxV) { maxV = v; maxName = item.dataset.label; }
                } else if (item.datasetIndex === 17) {
                  socVal = item.parsed.y;
                } else if (item.datasetIndex === 18) {
                  packVVal = item.parsed.y;
                } else if (item.datasetIndex === 19) {
                  currVal = item.parsed.y;
                }
              });

              let text = '\n─────────────────────────────';
              if (socVal != null || packVVal != null || currVal != null) {
                const status = currVal > 0.1 ? '⚡ชาร์จ' : (currVal < -0.1 ? '🔋จ่ายไฟ' : 'STANDBY');
                text += `\n🔋 SOC: ${socVal != null ? Math.round(socVal) + '%' : '--'} | Pack V: ${packVVal != null ? packVVal.toFixed(2) + 'V' : '--'} | Current: ${currVal != null ? (currVal > 0 ? '+' : '') + currVal.toFixed(2) + 'A (' + status + ')' : '--'}`;
              }
              if (minV !== Infinity && maxV !== -Infinity) {
                const diff = Math.round((maxV - minV) * 1000) / 1000;
                text += `\n⚡ ค่า Diff ณ จุดนี้: ${diff.toFixed(3)} V (${maxName} - ${minName})`;
              }
              return text;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#80a0b0', maxRotation: 0, autoSkip: true, maxTicksLimit: 12 }
        },
        y: {
          position: 'left',
          grid: { color: 'rgba(255, 255, 255, 0.08)' },
          ticks: {
            color: '#00e5ff',
            callback: function(value) { return value.toFixed(2) + ' V'; }
          },
          suggestedMin: 3.0,
          suggestedMax: 3.65
        },
        y1: {
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: {
            color: '#ffea00',
            callback: function(value) { return value.toFixed(3) + ' V'; }
          },
          suggestedMin: 0.00,
          suggestedMax: 0.15
        },
        y2: {
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: {
            color: '#00ff88',
            callback: function(value) { return value + '%'; }
          },
          min: 0,
          max: 100
        },
        y3: {
          position: 'left',
          grid: { drawOnChartArea: false },
          ticks: {
            color: '#3a86ff',
            callback: function(value) { return value.toFixed(1) + ' V'; }
          },
          suggestedMin: 40,
          suggestedMax: 60
        },
        y4: {
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: {
            color: '#ff2a6d',
            callback: function(value) { return value.toFixed(1) + ' A'; }
          },
          suggestedMin: -100,
          suggestedMax: 100
        }
      }
    }
  });
}

async function loadAnalyticsData(range = '24h') {
  try {
    const res = await fetch(`/api/logs/analytics?range=${range}`);
    const json = await res.json();
    analyticsData = json.logs || [];

    if (analyticsData.length === 0) {
      if (analyticsChart) {
        analyticsChart.data.labels = [];
        analyticsChart.data.datasets.forEach(ds => ds.data = []);
        analyticsChart.update();
      }
      return;
    }

    // Format timestamps for x-axis
    const labels = analyticsData.map(log => {
      const d = new Date(log.timestamp);
      if (range === '7d') {
        return d.toLocaleDateString('th-TH', { month: 'numeric', day: 'numeric' }) + ' ' + d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
      } else {
        return d.toLocaleTimeString('th-TH', { hour12: false });
      }
    });

    // Populate datasets for 16 cells + Diff + SOC + PackV + Current
    const cellDataArrays = Array.from({ length: 16 }, () => []);
    const diffArray = [];
    const socArray = [];
    const packVArray = [];
    const currentArray = [];

    let overallMin = Infinity, overallMax = -Infinity;
    let maxDiff = -Infinity;

    analyticsData.forEach(log => {
      const cellVolts = log.cellVoltages;
      let recordMin = Infinity, recordMax = -Infinity;

      if (Array.isArray(cellVolts) && cellVolts.length > 0) {
        for (let i = 0; i < 16; i++) {
          const v = cellVolts[i];
          const isValid = typeof v === 'number' && v > 0.5 && v < 6.0;
          const val = isValid ? v : null;
          cellDataArrays[i].push(val);

          if (isValid) {
            if (v < overallMin) overallMin = v;
            if (v > overallMax) overallMax = v;
            if (v < recordMin) recordMin = v;
            if (v > recordMax) recordMax = v;
          }
        }
      } else {
        for (let i = 0; i < 16; i++) cellDataArrays[i].push(null);
      }

      let dVal = log.cellVoltDiff;
      if (dVal == null || dVal >= 3.0) {
        if (recordMin !== Infinity && recordMax !== -Infinity) {
          dVal = Math.round((recordMax - recordMin) * 1000) / 1000;
        }
      }

      const validDiff = (dVal != null && dVal >= 0 && dVal < 3.0) ? dVal : null;
      diffArray.push(validDiff);
      if (validDiff != null && validDiff > maxDiff) maxDiff = validDiff;

      socArray.push(log.packSOC != null ? log.packSOC : null);
      packVArray.push(log.packV != null && log.packV > 10 ? log.packV : null);
      currentArray.push(log.packA != null ? log.packA : null);
    });

    // Update Chart.js data
    if (!analyticsChart) {
      initAnalyticsChart();
    }

    if (analyticsChart) {
      analyticsChart.data.labels = labels;
      for (let i = 0; i < 16; i++) {
        analyticsChart.data.datasets[i].data = cellDataArrays[i];
      }
      analyticsChart.data.datasets[16].data = diffArray;
      analyticsChart.data.datasets[17].data = socArray;
      analyticsChart.data.datasets[18].data = packVArray;
      analyticsChart.data.datasets[19].data = currentArray;

      // Auto adjust Y-axis scale based on data
      if (overallMin !== Infinity && overallMax !== -Infinity) {
        analyticsChart.options.scales.y.suggestedMin = Math.max(0, Math.floor((overallMin - 0.05) * 100) / 100);
        analyticsChart.options.scales.y.suggestedMax = Math.ceil((overallMax + 0.05) * 100) / 100;
      }
      if (maxDiff !== -Infinity) {
        analyticsChart.options.scales.y1.suggestedMax = Math.ceil((maxDiff + 0.02) * 100) / 100;
      }

      analyticsChart.update('none'); // smooth update
    }

    // Update live badge in header
    const diffBadgeVal = document.getElementById('chart-max-diff-val');
    if (diffBadgeVal) {
      diffBadgeVal.textContent = maxDiff !== -Infinity ? `${maxDiff.toFixed(3)} V` : '-- V';
    }

  } catch (err) {
    console.error('[Analytics] Error loading data:', err);
  }
}

function updateAnalyticsStats(stats) {
  const elMaxVolt = document.getElementById('analytics-max-volt');
  const elMaxCell = document.getElementById('analytics-max-cell');
  const elMinVolt = document.getElementById('analytics-min-volt');
  const elMinCell = document.getElementById('analytics-min-cell');
  const elMaxDiff = document.getElementById('analytics-max-diff');
  const elDiffStatus = document.getElementById('analytics-diff-status');

  if (!stats) {
    if (elMaxVolt) elMaxVolt.textContent = '-- V';
    if (elMaxCell) elMaxCell.textContent = '--';
    if (elMinVolt) elMinVolt.textContent = '-- V';
    if (elMinCell) elMinCell.textContent = '--';
    if (elMaxDiff) elMaxDiff.textContent = '-- V';
    if (elDiffStatus) elDiffStatus.textContent = '--';
    return;
  }

  if (elMaxVolt) elMaxVolt.textContent = stats.overallMax != null ? `${stats.overallMax.toFixed(3)} V` : '-- V';
  if (elMaxCell) elMaxCell.textContent = stats.maxCellIdx >= 0 ? `พบที่ เซลล์ ${stats.maxCellIdx + 1}` : '--';

  if (elMinVolt) elMinVolt.textContent = stats.overallMin != null ? `${stats.overallMin.toFixed(3)} V` : '-- V';
  if (elMinCell) elMinCell.textContent = stats.minCellIdx >= 0 ? `พบที่ เซลล์ ${stats.minCellIdx + 1}` : '--';

  if (elMaxDiff) elMaxDiff.textContent = stats.maxDiff != null ? `${stats.maxDiff.toFixed(3)} V` : '-- V';
  if (elDiffStatus) {
    const d = stats.maxDiff;
    if (d == null) elDiffStatus.textContent = '--';
    else if (d <= 0.05) elDiffStatus.textContent = '🟢 สมดุลดีมาก';
    else if (d <= 0.10) elDiffStatus.textContent = '🟡 ควรเฝ้าระวัง';
    else elDiffStatus.textContent = '🔴 ต่างกันสูง';
  }
}

function toggleCellVisibility(cellIdx) {
  if (!analyticsChart) return;
  const dataset = analyticsChart.data.datasets[cellIdx];
  if (!dataset) return;

  dataset.hidden = !dataset.hidden;
  analyticsChart.update();

  // Update chip UI
  const chip = document.querySelector(`.cell-chip[data-cell-idx="${cellIdx}"]`);
  if (chip) {
    if (dataset.hidden) chip.classList.remove('active');
    else chip.classList.add('active');
  }
}

function setAllCellsVisibility(visible) {
  if (!analyticsChart) return;
  analyticsChart.data.datasets.forEach((ds, idx) => {
    ds.hidden = !visible;
    const chip = document.querySelector(`.cell-chip[data-cell-idx="${idx}"]`);
    if (chip) {
      if (visible) chip.classList.add('active');
      else chip.classList.remove('active');
    }
  });
  analyticsChart.update();
}

function setSelectedCellsOnly(selectedIndices) {
  if (!analyticsChart) return;
  const set = new Set(selectedIndices);
  analyticsChart.data.datasets.forEach((ds, idx) => {
    const isVisible = set.has(idx);
    ds.hidden = !isVisible;
    const chip = document.querySelector(`.cell-chip[data-cell-idx="${idx}"]`);
    if (chip) {
      if (isVisible) chip.classList.add('active');
      else chip.classList.remove('active');
    }
  });
  analyticsChart.update();
}

function selectMinMaxCellsOnly() {
  if (!analyticsData || analyticsData.length === 0) return;
  let minV = Infinity, maxV = -Infinity;
  let minIdx = 0, maxIdx = 0;
  analyticsData.forEach(log => {
    if (Array.isArray(log.cellVoltages)) {
      log.cellVoltages.forEach((v, idx) => {
        if (typeof v === 'number' && v > 0.5 && v < 6.0) {
          if (v < minV) { minV = v; minIdx = idx; }
          if (v > maxV) { maxV = v; maxIdx = idx; }
        }
      });
    }
  });
  setSelectedCellsOnly([minIdx, maxIdx]);
}

// ============================================================
// SOH & ROUND-TRIP EFFICIENCY DATA FUNCTIONS
// ============================================================
async function loadSohEfficiencyData() {
  try {
    const res = await fetch('/api/logs/soh-efficiency');
    const data = await res.json();
    if (!data.success) return;

    // SOH Card metrics
    const elSohPercent = document.getElementById('soh-percent-val');
    const elSohStatus = document.getElementById('soh-status-badge');
    const elSohCap = document.getElementById('soh-capacity-val');
    const elSohDeg = document.getElementById('soh-degradation-val');
    const elSohCycles = document.getElementById('soh-cycles-val');
    const elSohLifespan = document.getElementById('soh-lifespan-val');

    if (elSohPercent) elSohPercent.textContent = `${data.sohPercent}%`;
    if (elSohStatus) {
      if (data.sohPercent >= 90) elSohStatus.textContent = '🟢 สถานะดีเยี่ยม (Excellent)';
      else if (data.sohPercent >= 80) elSohStatus.textContent = '🟡 สถานะปกติ (Normal)';
      else elSohStatus.textContent = '🔴 เริ่มเสื่อมถอย (Degraded)';
    }
    if (elSohCap) elSohCap.textContent = `${data.actualCapacityAh.toFixed(1)} Ah / ${data.nominalCapacityAh.toFixed(1)} Ah`;
    if (elSohDeg) elSohDeg.textContent = `${data.degradationRatePerMonth.toFixed(2)}% / เดือน`;
    if (elSohCycles) elSohCycles.textContent = `${data.cycleCount} รอบ`;
    if (elSohLifespan) elSohLifespan.textContent = `~${data.remainingLifespanYears.toFixed(1)} ปี`;

    // Efficiency metrics
    const elEnergyIn = document.getElementById('eff-energy-in');
    const elEnergyOut = document.getElementById('eff-energy-out');
    const elEffPercent = document.getElementById('eff-percent');
    const elHeatVal = document.getElementById('loss-heat-val');
    const elHeatBar = document.getElementById('loss-heat-bar');
    const elResVal = document.getElementById('loss-resistance-val');
    const elResBar = document.getElementById('loss-resistance-bar');

    if (elEnergyIn) elEnergyIn.textContent = `${data.totalChargeKWh.toFixed(2)} kWh`;
    if (elEnergyOut) elEnergyOut.textContent = `${data.totalDischargeKWh.toFixed(2)} kWh`;
    if (elEffPercent) elEffPercent.textContent = `${data.efficiencyPercent.toFixed(1)}%`;
    if (elHeatVal) elHeatVal.textContent = `~${data.heatLossPercent.toFixed(1)}%`;
    if (elResVal) elResVal.textContent = `~${data.resistanceLossPercent.toFixed(1)}%`;

    if (elHeatBar && data.lossPercent > 0) elHeatBar.style.width = `${(data.heatLossPercent / data.lossPercent) * 100}%`;
    if (elResBar && data.lossPercent > 0) elResBar.style.width = `${(data.resistanceLossPercent / data.lossPercent) * 100}%`;

    // Daily Table
    const tbody = document.getElementById('soh-daily-tbody');
    if (tbody) {
      if (!data.dailyTable || data.dailyTable.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 20px;">ยังไม่มีข้อมูลประวัติรายวัน</td></tr>`;
      } else {
        tbody.innerHTML = data.dailyTable.map(row => `
          <tr>
            <td><strong>${row.date}</strong></td>
            <td><span class="text-green">${row.chargeKWh.toFixed(3)} kWh</span></td>
            <td><span class="text-blue">${row.dischargeKWh.toFixed(3)} kWh</span></td>
            <td><strong class="text-gold">${row.efficiency.toFixed(1)}%</strong></td>
            <td><span style="color:#f87171;">-${row.lossKWh.toFixed(3)} kWh</span></td>
            <td><span class="prot-badge ok" style="padding: 2px 8px; font-size:0.75rem;">ปกติ</span></td>
          </tr>
        `).join('');
      }
    }
  } catch (e) {
    console.error("Failed to load SOH and efficiency data:", e);
  }
}

// App Startup
loadAvailablePorts().then(() => {
  connectWebSocket();
  initAnalyticsUI();
  initAnalyticsChart();
});



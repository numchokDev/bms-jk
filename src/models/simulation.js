const { state, getCurrentState } = require('../state');

function createInitialSimulatedState() {
  const cells = {};
  for (let i = 0; i < 16; i++) {
    cells[`cell${i}mV`] = 3315 + Math.floor(Math.random() * 15);
    cells[`cell${i}V`] = cells[`cell${i}mV`] / 1000;
    cells[`cell${i}R`] = 0.18 + (Math.random() * 0.04); // 0.18 - 0.22 mΩ
  }
  return {
    packV: 53.12,
    packA: 12.5, // 12.5A charging
    packW: 664.0,
    packSOC: 82,
    packRateCap: 200,
    packBalCap: 164,
    packCycleCap: 480,
    packNumberOfCells: 16,
    packNumberCycles: 45,
    tempSensorCount: 3,
    tempSensorValues: {
      NTC0: 31, // BMS Temp
      NTC1: 29, // Cell Temp 1
      NTC2: 30  // Cell Temp 2
    },
    bmsSWVersion: "BMS-V14.36",
    bmsOnMinutes: 14400, // 10 days
    balancerSwitch: 1,
    userData: "Home Powerwall 48V",
    cellData: cells,
    protectionStatus: {
      lowCapacity: false,
      bmsOvertemp: false,
      packOvervolt: false,
      packUndervolt: false,
      packOvertemp: false,
      chargeOvercurrent: false,
      dischargeOvercurrent: false,
      cellCurrentDifference: false,
      packOvertemp2: false,
      packUndertemp: false,
      singleCellOvervolt: false,
      singleCellUndervolt: false
    },
    FETStatus: {
      charging: true,
      discharging: true,
      balancing: false
    }
  };
}

// Initialize simulated state
state.simulatedState = createInitialSimulatedState();

// Start simulation tick
function startSimulation(broadcastFn) {
  let simTime = 0;
  setInterval(() => {
    if (!state.isSimulationMode) return;

    simTime += 0.1;
    // Slowly oscillate SoC between 78 and 85
    const baseSoc = 81.5 + Math.sin(simTime / 20) * 3.5;
    state.simulatedState.packSOC = Math.round(baseSoc);

    // Oscillate current between charging and discharging
    const currentSin = Math.sin(simTime / 5) * 20 + 2; // oscillates -18A to 22A
    state.simulatedState.packA = Math.round(currentSin * 10) / 10;

    // Update cell voltages based on charge/discharge
    let cellSum = 0;
    const isCharging = state.simulatedState.packA > 0;
    const isDischarging = state.simulatedState.packA < 0;

    // Balancing simulation: if balancing is active
    state.simulatedState.FETStatus.balancing = isCharging && (state.simulatedState.packSOC > 80);

    for (let i = 0; i < state.simulatedState.packNumberOfCells; i++) {
      // base cell voltage based on SoC
      let cellBase = 3280 + (state.simulatedState.packSOC - 80) * 4;
      // Small variations per cell
      let cellVar = Math.sin(simTime + i) * 3;
      // Charge/discharge effect
      if (isCharging) cellBase += 20 + (i % 3) * 1.5;
      if (isDischarging) cellBase -= 25 - (i % 2) * 1.5;

      // Balancing reduces the highest cell voltage slightly
      if (state.simulatedState.FETStatus.balancing && i === 5) { // let cell 5 be highest
        cellBase -= 4;
      }

      const mV = Math.round(cellBase + cellVar);
      state.simulatedState.cellData[`cell${i}mV`] = mV;
      state.simulatedState.cellData[`cell${i}V`] = mV / 1000;
      cellSum += mV / 1000;
    }

    state.simulatedState.packV = Math.round(cellSum * 100) / 100;
    state.simulatedState.packW = Math.round(state.simulatedState.packV * state.simulatedState.packA * 10) / 10;

    // Simulated temperatures fluctuate slightly
    state.simulatedState.tempSensorValues.NTC0 = Math.round(31 + Math.sin(simTime / 10) * 1);
    state.simulatedState.tempSensorValues.NTC1 = Math.round(29 + Math.cos(simTime / 12) * 0.8);
    state.simulatedState.tempSensorValues.NTC2 = Math.round(30 + Math.sin(simTime / 8) * 0.5);

    state.simulatedState.FETStatus.charging = state.simulatedState.packSOC < 99 && !state.simulatedState.protectionStatus.singleCellOvervolt;
    state.simulatedState.FETStatus.discharging = state.simulatedState.packSOC > 5 && !state.simulatedState.protectionStatus.singleCellUndervolt;
    state.simulatedState.bmsOnMinutes += 1;

    if (broadcastFn) {
      broadcastFn(getCurrentState());
    }
  }, 1000);
}

module.exports = {
  createInitialSimulatedState,
  startSimulation
};

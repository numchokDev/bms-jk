const { state, getCurrentState } = require('../state');
const { sendModbusRequest, regsToInt32, modbusTemp } = require('./modbus');
const { broadcast } = require('../controllers/wsController');
const dbService = require('./dbService');

async function pollBmsModbus() {
  if (!state.serialConn || !state.serialConn.isOpen) return;

  try {
    // 1. Read cell voltages: 0x1200 x 20 regs
    const cellRegs = await sendModbusRequest(0x1200, 20);

    // 2. Read pack stats: 0x1240 x 24 regs
    const statRegs = await sendModbusRequest(0x1240, 24);

    // 3. Read real-time data: 0x1280 x 20 regs
    const rtRegs1 = await sendModbusRequest(0x1280, 20);

    // 4. Real-time data: 0x1290 x 20 regs
    const rtRegs2 = await sendModbusRequest(0x1290, 20);

    // 5. Status block: 0x12A0 x 20 regs
    const statusRegs = await sendModbusRequest(0x12A0, 20);

    // 6. Status block 2: 0x12B0 x 20 regs
    const statusRegs2 = await sendModbusRequest(0x12B0, 20);

    // ---- Parse cell voltages & wire resistances ----
    const cellData = {};
    let numCells = 0;
    if (cellRegs) {
      numCells = (statRegs && statRegs[3] > 0 && statRegs[3] <= 32) ? statRegs[3] : 16;
      for (let i = 0; i < numCells && i < 20; i++) {
        const mV = cellRegs[i];
        if (mV > 2000 && mV < 5000) { // valid cell voltage range 2V-5V
          cellData[`cell${i}mV`] = mV;
          cellData[`cell${i}V`] = mV / 1000.0;
          if (statRegs && statRegs.length > (5 + i)) {
            const rawR = statRegs[5 + i];
            cellData[`cell${i}R`] = rawR / 1000.0;
          }
        }
      }
    }

    // ---- Pack voltage, current & power from 0x1290 (Gaps-free sequence) ----
    let packV = 0, packA = 0, packW = 0;
    if (rtRegs2) {
      // 0x1290:0x1291 -> Total Voltage (U32, mV)
      const packVmV = regsToInt32(rtRegs2[0], rtRegs2[1]);
      packV = Math.abs(packVmV) / 1000.0;

      // 0x1294:0x1295 -> Battery Power (S32, mW)
      const packWmW = regsToInt32(rtRegs2[2], rtRegs2[3]);
      packW = packWmW / 1000.0;

      // 0x1298:0x1299 -> Battery Current (S32, mA)
      const packAmA = regsToInt32(rtRegs2[4], rtRegs2[5]);
      packA = packAmA / 1000.0;
    }

    // ---- Temperatures (NTC0, NTC1, NTC2) ----
    let tempNTC0 = 0, tempNTC1 = 0, tempNTC2 = 0;
    if (rtRegs1) {
      tempNTC0 = modbusTemp(rtRegs1[14]);
      tempNTC1 = modbusTemp(rtRegs1[15]);
      tempNTC2 = modbusTemp(rtRegs1[16] || 0); // NTC2 values packed next to NTC1
    }

    // ---- SOC ----
    const packSOC = rtRegs2 ? (rtRegs2[11] || 0) : 0;

    // ---- Capacity ----
    let packRateCap = 100;
    let packBalCap = 0;
    if (statusRegs) {
      const rawFullCap = regsToInt32(statusRegs[6], statusRegs[7]);
      if (rawFullCap > 0) {
        packRateCap = Math.round(rawFullCap / 100) / 10; // mAh -> Ah
      }

      const rawRemCap = regsToInt32(statusRegs[4], statusRegs[5]);
      if (rawRemCap > 0) {
        packBalCap = Math.round(rawRemCap / 100) / 10;
      } else {
        packBalCap = Math.round((packRateCap * packSOC) / 100);
      }
    }

    // ---- Cycle count from 0x12B0:0x12B1 ----
    let packNumberCycles = 0;
    if (statusRegs2) {
      packNumberCycles = regsToInt32(statusRegs2[0], statusRegs2[1]);
    }

    // ---- Cumulative cycle capacity from 0x12B4:0x12B5 ----
    let packCycleCap = 0;
    if (statusRegs2) {
      const rawCycleCapmAh = regsToInt32(statusRegs2[2], statusRegs2[3]);
      packCycleCap = rawCycleCapmAh / 1000.0; // mAh -> Ah
    }

    // ---- FET Status ----
    let FETStatus = { charging: false, discharging: false, balancing: false };
    if (statusRegs2) {
      const fetRaw = statusRegs2[8];
      FETStatus.charging = ((fetRaw >> 8) & 0xFF) === 0x01;
      FETStatus.discharging = (fetRaw & 0xFF) === 0x01;
      FETStatus.balancing = (statusRegs2[9] || 0) > 0;
    }

    // ---- Protection status ----
    const protectionStatus = {
      lowCapacity: packSOC < 10, bmsOvertemp: tempNTC0 > 65,
      packOvervolt: false, packUndervolt: false, packOvertemp: false,
      chargeOvercurrent: false, dischargeOvercurrent: false,
      cellCurrentDifference: false, packOvertemp2: false,
      packUndertemp: tempNTC0 < 0, singleCellOvervolt: false,
      singleCellUndervolt: false
    };

    const packNumberOfCells = numCells || 16;

    const parsedData = {
      packV,
      packA,
      packW,
      packSOC,
      packRateCap,
      packBalCap,
      packCycleCap,
      packNumberOfCells,
      packNumberCycles,
      tempSensorCount: 3,
      tempSensorValues: {
        NTC0: tempNTC0,
        NTC1: tempNTC1,
        NTC2: tempNTC2
      },
      bmsSWVersion: null,
      bmsOnMinutes: null,
      userData: null,
      balancerSwitch: FETStatus.balancing ? 1 : 0,
      cellData,
      FETStatus,
      protectionStatus
    };

    if (packV > 0 || packSOC > 0) {
      state.bmsData = parsedData;
      const now = Date.now();
      if (!state.bmsFirstDataTime) state.bmsFirstDataTime = now;
      state.bmsLastDataTime = now;
      broadcast(getCurrentState());

      // บันทึกข้อมูลลงฐานข้อมูล (ข้ามหากไม่มีข้อมูลจริง)
      dbService.insertLog(parsedData, 'real');

      console.log(`BMS: ${packV.toFixed(2)}V | ${packA.toFixed(2)}A | SOC:${packSOC}% | Cells:${packNumberOfCells} | Temp:${tempNTC0}°C`);
    } else {
      console.warn('Modbus poll: no valid voltage or SOC data received');
    }

  } catch (e) {
    console.error('Modbus poll error:', e.message);
  }
}

function startPollingLoop() {
  stopPollingLoop();
  console.log('Starting Modbus RTU polling loop every 2 seconds');
  pollBmsModbus();
  state.pollIntervalTimer = setInterval(pollBmsModbus, 2000);
}

function stopPollingLoop() {
  if (state.pollIntervalTimer) {
    clearInterval(state.pollIntervalTimer);
    state.pollIntervalTimer = null;
  }
}

module.exports = {
  pollBmsModbus,
  startPollingLoop,
  stopPollingLoop
};

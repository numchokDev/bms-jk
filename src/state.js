const { serverStartTime, formatUptime } = require('./utils/uptime');
const config = require('./config');

const state = {
  bmsData: null,
  serialConn: null,
  serialParser: null,
  pollIntervalTimer: null,
  reconnectTimer: null,
  isSimulationMode: false,
  serialPortPath: config.SERIAL_PORT,
  baudRate: config.BAUD_RATE,
  bmsFirstDataTime: null,
  bmsLastDataTime: null,
  simulatedState: null, // will be initialized by simulation.js
  lastCachedAt: null,
  isRestoredFromDb: false
};

/**
 * คำนวณรหัสสถานะการทำงาน (Status Code) ของระบบจากข้อมูล Telemetry ล่าสุด
 */
function getStatusCode(data) {
  if (!data) return { code: 'OFFLINE', label: 'ออฟไลน์ / รอการเชื่อมต่อ', level: 'secondary' };

  // ตรวจสอบสถานะการป้องกัน (Protection Status)
  const prot = data.protectionStatus || {};
  const hasFault = Object.values(prot).some(v => v === true);
  if (hasFault) {
    return { code: 'PROTECTION_FAULT', label: 'แจ้งเตือนระบบป้องกันทำงาน', level: 'danger' };
  }

  const packA = data.packA || 0;
  if (packA > 0.05) {
    return { code: 'CHARGING', label: 'กำลังชาร์จประจุ (Charging)', level: 'success' };
  } else if (packA < -0.05) {
    return { code: 'DISCHARGING', label: 'กำลังจ่ายพลังงาน (Discharging)', level: 'primary' };
  }

  return { code: 'STANDBY', label: 'สแตนด์บาย (Standby)', level: 'info' };
}

/**
 * คืนค่าสถานะปัจจุบันทั้งหมดจาก RAM (In-Memory) เพื่อส่งออกทาง WebSocket ทันที
 */
function getCurrentState() {
  const isSerialConnected = state.serialConn && state.serialConn.isOpen;
  const now = Date.now();
  const currentData = state.isSimulationMode ? state.simulatedState : state.bmsData;
  const statusInfo = getStatusCode(currentData);

  return {
    connected: state.isSimulationMode ? true : isSerialConnected,
    simulation: state.isSimulationMode,
    port: state.isSimulationMode ? 'SIMULATOR' : state.serialPortPath,
    baudRate: state.baudRate,
    statusCode: statusInfo.code,
    statusLabel: statusInfo.label,
    statusLevel: statusInfo.level,
    error: state.isSimulationMode ? null : (state.serialConn ? null : "Serial port not initialized"),
    data: currentData,
    isRestoredFromDb: state.isRestoredFromDb,
    uptime: {
      serverStartedAt:   new Date(serverStartTime).toISOString(),
      serverUptimeMs:    now - serverStartTime,
      serverUptimeStr:   formatUptime(now - serverStartTime),
      bmsFirstDataAt:    state.bmsFirstDataTime ? new Date(state.bmsFirstDataTime).toISOString() : null,
      bmsLastDataAt:     state.bmsLastDataTime  ? new Date(state.bmsLastDataTime).toISOString()  : null,
      bmsRealtimeMs:     state.bmsFirstDataTime ? (now - state.bmsFirstDataTime) : null,
      bmsRealtimeStr:    state.bmsFirstDataTime ? formatUptime(now - state.bmsFirstDataTime) : null
    }
  };
}

/**
 * Re-cache สถานะ BMS ล่าสุดจาก DB เมื่อเปิดเซิร์ฟเวอร์ใหม่
 */
function restoreBmsStateFromDb(doc) {
  if (!doc) return;
  if (state.bmsData && !state.isRestoredFromDb) return; // ถ้ามีข้อมูลสดเข้ามาแล้ว ไม่ต้องทับ

  state.bmsData = {
    packV: doc.packV || 0,
    packA: doc.packA || 0,
    packW: doc.packW || 0,
    packSOC: doc.packSOC || 0,
    packRateCap: doc.packRateCap || 100,
    packBalCap: doc.packBalCap || 0,
    packCycleCap: doc.packCycleCap || 0,
    packNumberOfCells: doc.packNumberOfCells || 16,
    packNumberCycles: doc.packNumberCycles || 0,
    tempSensorCount: 3,
    tempSensorValues: {
      NTC0: doc.tempNTC0 ?? 25,
      NTC1: doc.tempNTC1 ?? 25,
      NTC2: doc.tempNTC2 ?? 25
    },
    bmsSWVersion: doc.bmsSWVersion || null,
    balancerSwitch: doc.balancerSwitch || 0,
    cellData: doc.cellData || {},
    FETStatus: doc.FETStatus || { charging: true, discharging: true, balancing: false },
    protectionStatus: doc.protectionStatus || {}
  };

  state.isRestoredFromDb = true;
  state.lastCachedAt = Date.now();
  if (doc.timestamp) {
    const ts = new Date(doc.timestamp).getTime();
    state.bmsLastDataTime = ts;
    state.bmsFirstDataTime = ts;
  }
}

module.exports = {
  state,
  getStatusCode,
  getCurrentState,
  restoreBmsStateFromDb
};

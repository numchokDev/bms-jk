const { serverStartTime, formatUptime } = require('./utils/uptime');

const state = {
  bmsData: null,
  serialConn: null,
  serialParser: null,
  pollIntervalTimer: null,
  reconnectTimer: null,
  isSimulationMode: false,
  serialPortPath: 'COM3',
  baudRate: 115200,
  bmsFirstDataTime: null,
  bmsLastDataTime: null,
  simulatedState: null // will be initialized by simulation.js
};

function getCurrentState() {
  const isSerialConnected = state.serialConn && state.serialConn.isOpen;
  const now = Date.now();
  return {
    connected: state.isSimulationMode ? true : isSerialConnected,
    simulation: state.isSimulationMode,
    port: state.isSimulationMode ? 'SIMULATOR' : state.serialPortPath,
    baudRate: state.baudRate,
    error: state.isSimulationMode ? null : (state.serialConn ? null : "Serial port not initialized"),
    data: state.isSimulationMode ? state.simulatedState : state.bmsData,
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

module.exports = {
  state,
  getCurrentState
};

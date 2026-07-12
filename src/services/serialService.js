let SerialPortLib = null;
let InterByteTimeoutParser = null;
try {
  SerialPortLib = require('serialport').SerialPort;
  InterByteTimeoutParser = require('@serialport/parser-inter-byte-timeout').InterByteTimeoutParser;
  console.log("SerialPort library loaded successfully.");
} catch (err) {
  console.warn("WARNING: Could not load 'serialport' or parser library. Running in SIMULATION MODE only.", err.message);
}

const { state, getCurrentState } = require('../state');
const { broadcast } = require('../controllers/wsController');
const { startPollingLoop, stopPollingLoop } = require('./pollService');

// Initialize Serial Connection (Modbus RTU)
function initSerialConnection() {
  closeSerialConnection();

  if (!SerialPortLib) {
    console.warn('SerialPort library not available. Defaulting back to Simulator.');
    state.isSimulationMode = true;
    return;
  }

  console.log(`Connecting to JK BMS (Modbus RTU) on ${state.serialPortPath} at ${state.baudRate} baud...`);

  state.serialConn = new SerialPortLib({
    path: state.serialPortPath,
    baudRate: state.baudRate,
    autoOpen: false
  });

  state.serialConn.on('error', (err) => {
    console.error(`Serial Port Error [${state.serialPortPath}]:`, err.message);
    broadcast({ type: 'SERIAL_ERROR', error: err.message });
  });

  state.serialConn.on('open', () => {
    console.log(`Serial Port ${state.serialPortPath} opened successfully (Modbus RTU).`);
    broadcast(getCurrentState());
  });

  state.serialConn.on('close', () => {
    console.log(`Serial Port ${state.serialPortPath} closed.`);
    broadcast(getCurrentState());
  });

  state.serialConn.open((err) => {
    if (err) {
      console.error(`Failed to open serial port ${state.serialPortPath}:`, err.message);
      broadcast({
        connected: false, simulation: false, port: state.serialPortPath,
        error: `ไม่สามารถเปิดพอร์ต ${state.serialPortPath} ได้: ${err.message}`, data: null
      });
      if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
      state.reconnectTimer = setTimeout(() => {
        if (!state.isSimulationMode) initSerialConnection();
      }, 5000);
      return;
    }
    startPollingLoop();
  });
}

function closeSerialConnection() {
  if (state.reconnectTimer) { clearTimeout(state.reconnectTimer); state.reconnectTimer = null; }
  stopPollingLoop();
  if (state.serialConn && state.serialConn.isOpen) {
    state.serialConn.close(() => console.log('Serial port connection closed.'));
  }
  state.serialConn = null;
  state.serialParser = null;
}

// ค้นหาพอร์ตที่มีการเชื่อมต่อกับบอร์ด JK BMS จริงโดยอัตโนมัติ (Auto-Discovery)
async function autoDiscoverBmsPort() {
  if (!SerialPortLib) {
    console.log("[Auto-Detect] SerialPort library not available. Defaulting to SIMULATION mode.");
    state.isSimulationMode = true;
    return false;
  }

  const { buildModbusRequest, parseModbusResponse } = require('./modbus');
  const { MODBUS_SLAVE_ID } = require('../config');

  try {
    const list = await SerialPortLib.list();
    const ports = list.map(p => p.path).filter(path => {
      // คัดกรองชื่อพอร์ตที่เป็นไปได้สำหรับ Windows (COMx) และ Unix (/dev/ttyUSBx, ACMx)
      return path.startsWith('COM') || path.includes('ttyUSB') || path.includes('ttyACM') || path.includes('ttyS') || path.includes('cu.usb');
    });

    console.log("[Auto-Detect] Discovered available serial ports:", ports);

    if (ports.length === 0) {
      console.log("[Auto-Detect] No serial ports found. Defaulting to SIMULATION mode.");
      state.isSimulationMode = true;
      return false;
    }

    // ตรวจสอบสัญญาณตอบกลับจาก BMS ทีละพอร์ตแบบขนานหรือทีละตัว
    for (const portPath of ports) {
      console.log(`[Auto-Detect] Testing port ${portPath}...`);
      const success = await new Promise((resolve) => {
        const testPort = new SerialPortLib({
          path: portPath,
          baudRate: 115200,
          autoOpen: false
        });

        let timeoutHandle = null;
        let dataListener = null;
        let resolved = false;

        function cleanUpTest() {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          if (dataListener) testPort.removeListener('data', dataListener);
          if (testPort.isOpen) {
            testPort.close(() => { /* closed */ });
          }
        }

        testPort.open((err) => {
          if (err) {
            resolve(false);
            return;
          }

          const request = buildModbusRequest(MODBUS_SLAVE_ID, 0x1290, 2);
          const expectedLen = 9; // 1 slave + 1 func + 1 byteCount + 4 data + 2 crc
          let responseData = Buffer.alloc(0);

          dataListener = (data) => {
            responseData = Buffer.concat([responseData, data]);
            if (responseData.length >= expectedLen) {
              const regs = parseModbusResponse(responseData.slice(0, expectedLen), MODBUS_SLAVE_ID);
              if (regs && regs.length >= 2) {
                resolved = true;
                cleanUpTest();
                resolve(true);
              }
            }
          };

          testPort.on('data', dataListener);

          testPort.write(request, (writeErr) => {
            if (writeErr) {
              cleanUpTest();
              resolve(false);
            }
          });

          timeoutHandle = setTimeout(() => {
            if (!resolved) {
              cleanUpTest();
              resolve(false);
            }
          }, 600);
        });
      });

      if (success) {
        console.log(`[Auto-Detect] ✅ Success! Found responsive JK BMS on ${portPath}. Connecting...`);
        state.serialPortPath = portPath;
        state.isSimulationMode = false;
        initSerialConnection();
        return true;
      }
    }

    console.log("[Auto-Detect] ❌ No responsive JK BMS found. Defaulting to SIMULATION mode.");
    state.isSimulationMode = true;
    return false;
  } catch (err) {
    console.error("[Auto-Detect] Discovery failed:", err.message);
    state.isSimulationMode = true;
    return false;
  }
}

module.exports = {
  SerialPortLib,
  initSerialConnection,
  closeSerialConnection,
  autoDiscoverBmsPort
};

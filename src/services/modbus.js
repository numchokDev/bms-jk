const { state } = require('../state');
const { MODBUS_SLAVE_ID, MODBUS_TIMEOUT_MS } = require('../config');

function crc16Modbus(buffer) {
  let crc = 0xFFFF;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 0x0001) { crc = (crc >> 1) ^ 0xA001; }
      else { crc >>= 1; }
    }
  }
  return crc;
}

function buildModbusRequest(slaveId, startReg, count) {
  const buf = Buffer.alloc(6);
  buf[0] = slaveId;
  buf[1] = 0x03;
  buf.writeUInt16BE(startReg, 2);
  buf.writeUInt16BE(count, 4);
  const crc = crc16Modbus(buf);
  const full = Buffer.alloc(8);
  buf.copy(full);
  full.writeUInt16LE(crc, 6);
  return full;
}

function parseModbusResponse(buf, expectedSlaveId) {
  if (!buf || buf.length < 5) return null;
  if (buf[0] !== expectedSlaveId) return null;
  if (buf[1] === 0x83) { console.warn('Modbus exception:', buf[2]); return null; }
  if (buf[1] !== 0x03) return null;
  const byteCount = buf[2];
  if (buf.length < 3 + byteCount + 2) return null;
  const data = buf.slice(3, 3 + byteCount);
  const crcReceived = buf.readUInt16LE(3 + byteCount);
  const crcCalc = crc16Modbus(buf.slice(0, 3 + byteCount));
  if (crcReceived !== crcCalc) { console.warn('Modbus CRC mismatch'); return null; }
  const regs = [];
  for (let i = 0; i < data.length; i += 2) {
    regs.push(data.readUInt16BE(i));
  }
  return regs;
}

function modbusTemp(raw) {
  return raw / 10.0;
}

function regsToInt32(hi, lo) {
  const u32 = ((hi & 0xFFFF) * 65536) + (lo & 0xFFFF);
  return u32 > 0x7FFFFFFF ? u32 - 0x100000000 : u32;
}

function sendModbusRequest(regBase, count) {
  return new Promise((resolve) => {
    if (!state.serialConn || !state.serialConn.isOpen) { resolve(null); return; }

    let responseData = Buffer.alloc(0);
    const expectedLen = 5 + count * 2; // 1(slave) + 1(func) + 1(byteCount) + count*2 + 2(crc)

    const dataListener = (data) => {
      responseData = Buffer.concat([responseData, data]);
      if (responseData.length >= expectedLen) {
        cleanup();
        const regs = parseModbusResponse(responseData.slice(0, expectedLen), MODBUS_SLAVE_ID);
        resolve(regs);
      }
    };

    const timeoutHandle = setTimeout(() => {
      cleanup();
      resolve(null);
    }, MODBUS_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timeoutHandle);
      if (state.serialConn) {
        state.serialConn.removeListener('data', dataListener);
      }
    }

    state.serialConn.on('data', dataListener);

    const req = buildModbusRequest(MODBUS_SLAVE_ID, regBase, count);
    state.serialConn.write(req, (err) => {
      if (err) {
        cleanup();
        console.error('Modbus write error:', err.message);
        resolve(null);
      }
    });
  });
}

module.exports = {
  crc16Modbus,
  buildModbusRequest,
  parseModbusResponse,
  modbusTemp,
  regsToInt32,
  sendModbusRequest
};

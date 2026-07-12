// Config constants
module.exports = {
  PORT: process.env.PORT || 3000,
  DEFAULT_PORT_PATH: 'COM3',
  DEFAULT_BAUD_RATE: 115200,
  MODBUS_SLAVE_ID: 1,
  POLL_INTERVAL_MS: 2000,
  MODBUS_TIMEOUT_MS: 400,

  // Register addresses
  REG_CELL_VOLTAGE: 0x1200,  // Cell voltages (x20 regs)
  REG_PACK_STATS: 0x1240,    // Pack stats + wire resistance
  REG_RT_BLOCK1: 0x1280,     // Realtime block 1 (temps)
  REG_RT_BLOCK2: 0x1290,     // Realtime block 2 (volt, current, SOC)
  REG_STATUS1: 0x12A0,       // Status block 1 (capacity)
  REG_STATUS2: 0x12B0,       // Status block 2 (cycles, FET)
};

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const portStr = process.env.PORT;
const baudRateStr = process.env.BAUD_RATE;
const slaveIdStr = process.env.MODBUS_SLAVE_ID;
const pollIntervalStr = process.env.POLL_INTERVAL_MS;
const timeoutStr = process.env.MODBUS_TIMEOUT_MS;
const retentionDaysStr = process.env.LOG_RETENTION_DAYS;

module.exports = {
  PORT: portStr ? parseInt(portStr, 10) : 3000,
  SERIAL_PORT: process.env.SERIAL_PORT || process.env.DEFAULT_PORT_PATH || 'COM3',
  DEFAULT_PORT_PATH: process.env.SERIAL_PORT || process.env.DEFAULT_PORT_PATH || 'COM3',
  BAUD_RATE: baudRateStr ? parseInt(baudRateStr, 10) : 115200,
  DEFAULT_BAUD_RATE: baudRateStr ? parseInt(baudRateStr, 10) : 115200,
  MODBUS_SLAVE_ID: slaveIdStr ? parseInt(slaveIdStr, 10) : 1,
  POLL_INTERVAL_MS: pollIntervalStr ? parseInt(pollIntervalStr, 10) : 15000,
  MODBUS_TIMEOUT_MS: timeoutStr ? parseInt(timeoutStr, 10) : 400,
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'bms_log.db'),
  LOG_RETENTION_DAYS: retentionDaysStr ? parseInt(retentionDaysStr, 10) : 30,

  // Battery & Health Configuration
  BATTERY_NOMINAL_CAP_AH: process.env.BATTERY_NOMINAL_CAP_AH ? parseFloat(process.env.BATTERY_NOMINAL_CAP_AH) : 100,
  BATTERY_MAX_CYCLES: process.env.BATTERY_MAX_CYCLES ? parseInt(process.env.BATTERY_MAX_CYCLES, 10) : 3000,
  BATTERY_EOL_SOH: process.env.BATTERY_EOL_SOH ? parseFloat(process.env.BATTERY_EOL_SOH) : 70,
  BATTERY_CYCLES_PER_MONTH: process.env.BATTERY_CYCLES_PER_MONTH ? parseFloat(process.env.BATTERY_CYCLES_PER_MONTH) : 15,

  // Electricity Tariff Configuration (THB / kWh)
  ELECTRICITY_RATE_THB: process.env.ELECTRICITY_RATE_THB ? parseFloat(process.env.ELECTRICITY_RATE_THB) : 4.5,
  ELECTRICITY_CHARGE_RATE_THB: process.env.ELECTRICITY_CHARGE_RATE_THB ? parseFloat(process.env.ELECTRICITY_CHARGE_RATE_THB) : (process.env.ELECTRICITY_RATE_THB ? parseFloat(process.env.ELECTRICITY_RATE_THB) : 4.5),
  ELECTRICITY_DISCHARGE_RATE_THB: process.env.ELECTRICITY_DISCHARGE_RATE_THB ? parseFloat(process.env.ELECTRICITY_DISCHARGE_RATE_THB) : (process.env.ELECTRICITY_RATE_THB ? parseFloat(process.env.ELECTRICITY_RATE_THB) : 4.5),

  // Register addresses
  REG_CELL_VOLTAGE: 0x1200,  // Cell voltages (x20 regs)
  REG_PACK_STATS: 0x1240,    // Pack stats + wire resistance
  REG_RT_BLOCK1: 0x1280,     // Realtime block 1 (temps)
  REG_RT_BLOCK2: 0x1290,     // Realtime block 2 (volt, current, SOC)
  REG_STATUS1: 0x12A0,       // Status block 1 (capacity)
  REG_STATUS2: 0x12B0,       // Status block 2 (cycles, FET)
};


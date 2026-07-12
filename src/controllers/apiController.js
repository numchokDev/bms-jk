const express = require('express');
const router = express.Router();
const { state, getCurrentState } = require('../state');
const { broadcast } = require('./wsController');

/**
 * GET /api/ports
 */
router.get('/ports', async (req, res) => {
  const { SerialPortLib } = require('../services/serialService');
  if (!SerialPortLib) {
    return res.json({ ports: ['SIMULATOR', 'COM1', 'COM2', 'COM3'] });
  }
  try {
    const list = await SerialPortLib.list();
    const ports = list.map(p => p.path);
    if (ports.length === 0) ports.push('COM1'); // Default fallback
    res.json({ ports });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/bms-status
 */
router.get('/bms-status', (req, res) => {
  const latestState = getCurrentState();

  const schema = {
    _note: "ค่าที่เป็น null หมายความว่ายังไม่สามารถอ่านจาก BMS ได้ (register ยังไม่ทราบหรือยังไม่มีข้อมูล)",
    _source: "JK-PB Series BMS — Modbus RTU 115200 baud",
    fields: {
      packV:            { desc: "แรงดันรวม Pack",            unit: "V",   register: "0x1290:0x1291", type: "U32 mV x 10 -> V" },
      packA:            { desc: "กระแสไฟ (+ = ชาร์จ, - = จ่ายไฟ)", unit: "A",   register: "0x1292:0x1293", type: "S32 mA x 10 -> A" },
      packW:            { desc: "กำลังไฟฟ้า (คำนวณ packV x packA)", unit: "W",   register: "-",              type: "computed" },
      packSOC:          { desc: "ระดับการชาร์จ State of Charge",    unit: "%",   register: "0x129B",         type: "U16" },
      packRateCap:      { desc: "ความจุพิกัด (Nominal Capacity)",   unit: "Ah",  register: "0x12A6:0x12A7", type: "U32 mAh -> Ah" },
      packBalCap:       { desc: "ความจุคงเหลือ (Remaining Capacity)", unit: "Ah", register: "0x12A4:0x12A5", type: "U32 mAh -> Ah" },
      packCycleCap:     { desc: "ความจุสะสมทั้งหมดตลอดอายุการใช้งาน", unit: "Ah", register: "0x12B6:0x12B7", type: "U32 mAh -> Ah" },
      packNumberOfCells:{ desc: "จำนวนเซลล์แบตเตอรี่",             unit: "cells",register: "0x1243",         type: "U16" },
      packNumberCycles: { desc: "จำนวนรอบการชาร์จสะสม",             unit: "cycles",register:"0x12B2:0x12B3", type: "U32" },
      "tempSensorValues.NTC0": { desc: "อุณหภูมิบอร์ด BMS",           unit: "°C",  register: "0x128E", type: "U16 x 0.1" },
      "tempSensorValues.NTC1": { desc: "อุณหภูมิแบตเตอรี่ เซ็นเซอร์ 1", unit: "°C", register: "0x128F", type: "U16 x 0.1" },
      "tempSensorValues.NTC2": { desc: "อุณหภูมิแบตเตอรี่ เซ็นเซอร์ 2", unit: "°C", register: "0x1296", type: "U16 x 0.1" },
      "FETStatus.charging":    { desc: "FET ชาร์จเปิด (true=ON)",    unit: "bool", register: "0x12B8 high byte", type: "0x01=ON" },
      "FETStatus.discharging": { desc: "FET จ่ายไฟเปิด (true=ON)",   unit: "bool", register: "0x12B8 low byte",  type: "0x01=ON" },
      "FETStatus.balancing":   { desc: "Balancer กำลังทำงาน",        unit: "bool", register: "0x12B9",           type: ">0=active" },
      "cellData.cellNmV": { desc: "แรงดันเซลล์ N (mV)",                unit: "mV",  register: "0x1200+N",  type: "U16" },
      "cellData.cellNV":  { desc: "แรงดันเซลล์ N (V)",                 unit: "V",   register: "-",          type: "cellNmV / 1000" },
      "cellData.cellNR":  { desc: "ความต้านทานสาย wire resistance เซลล์ N", unit: "mΩ", register: "0x1245+N", type: "U16 / 1000" },
      bmsSWVersion: { desc: "เวอร์ชัน firmware BMS",          unit: "-",  register: "UNKNOWN", type: "null if unread" },
      bmsOnMinutes: { desc: "เวลาทำงานสะสม",                  unit: "min", register: "UNKNOWN", type: "null if unread" },
      userData:     { desc: "ชื่อ/label ที่กำหนดโดยผู้ใช้",    unit: "-",  register: "UNKNOWN", type: "null if unread" },
      "uptime.serverStartedAt":  { desc: "เวลาที่ server เริ่มทำงาน (ISO 8601)", unit: "datetime" },
      "uptime.serverUptimeMs":   { desc: "เวลา server ทำงานสะสม",               unit: "ms" },
      "uptime.serverUptimeStr":  { desc: "เวลา server ทำงานสะสม (อ่านง่าย)",   unit: "XdXhXmXs" },
      "uptime.bmsFirstDataAt":   { desc: "เวลาที่รับข้อมูล BMS ครั้งแรก",      unit: "datetime", note: "null ถ้ายังไม่เคยรับข้อมูล" },
      "uptime.bmsLastDataAt":    { desc: "เวลาที่รับข้อมูล BMS ล่าสุด",        unit: "datetime", note: "null ถ้ายังไม่เคยรับข้อมูล" },
      "uptime.bmsRealtimeMs":    { desc: "เวลาที่ BMS ส่ง realtime ต่อเนื่อง", unit: "ms",      note: "null ถ้ายังไม่เคยรับข้อมูล" },
      "uptime.bmsRealtimeStr":   { desc: "เวลา realtime BMS (อ่านง่าย)",        unit: "XdXhXmXs",note: "null ถ้ายังไม่เคยรับข้อมูล" }
    }
  };

  res.json({
    timestamp: new Date().toISOString(),
    ...latestState,
    _schema: schema
  });
});

/**
 * PUT /api/config
 */
router.put('/config', (req, res) => {
  const { port, baudRate: baud, simulation } = req.body || {};
  let changed = false;

  const { initSerialConnection, closeSerialConnection } = require('../services/serialService');

  if (typeof simulation === 'boolean' && simulation !== state.isSimulationMode) {
    state.isSimulationMode = simulation;
    if (!state.isSimulationMode) initSerialConnection();
    else closeSerialConnection();
    changed = true;
  }

  if (port && port !== state.serialPortPath) {
    state.serialPortPath = port;
    if (!state.isSimulationMode) initSerialConnection();
    changed = true;
  }

  if (baud && baud !== state.baudRate) {
    state.baudRate = baud;
    if (!state.isSimulationMode) initSerialConnection();
    changed = true;
  }

  if (changed) broadcast(getCurrentState());

  res.json({
    ok: true,
    applied: { port: state.serialPortPath, baudRate: state.baudRate, simulation: state.isSimulationMode }
  });
});

module.exports = router;

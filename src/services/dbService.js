const Datastore = require('@seald-io/nedb');
const path = require('path');
const fs = require('fs');

// สร้างโฟลเดอร์ data/ หากยังไม่มี
const dataDir = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// กำหนดไฟล์ฐานข้อมูล
const db = new Datastore({
  filename: path.join(dataDir, 'bms_log.db'),
  autoload: true,
  timestampData: false
});

// สร้าง Index สำหรับการค้นหาตามเวลา (สำคัญมากเพื่อ performance)
db.ensureIndex({ fieldName: 'timestamp' });

let totalChargeWh = 0;    // พลังงานชาร์จสะสม (Wh)
let totalDischargeWh = 0; // พลังงานจ่ายไฟสะสม (Wh)
const POLL_INTERVAL_S = 2; // รอบ polling ทุก 2 วินาที

// โหลดค่าพลังงานสะสมล่าสุดจากฐานข้อมูลเพื่อไม่ให้ค่ารีเซ็ตเป็น 0 ตอนเริ่มเซิร์ฟเวอร์ใหม่
db.find({})
  .sort({ timestamp: -1 })
  .limit(1)
  .exec((err, docs) => {
    if (!err && docs && docs.length > 0) {
      totalChargeWh = docs[0].energyChargeWh || 0;
      totalDischargeWh = docs[0].energyDischargeWh || 0;
      console.log(`[DB] Restored accumulative energy values from DB: Charge=${totalChargeWh} Wh, Discharge=${totalDischargeWh} Wh`);
    } else {
      console.log("[DB] No previous energy history found. Starting accumulation from 0.");
    }
  });

/**
 * บันทึกข้อมูล BMS 1 record
 * ข้ามถ้าไม่มีข้อมูลจริง (packV = 0 และ packSOC = 0)
 */
function insertLog(data, source) {
  if (!data) return;

  const packV = data.packV || 0;
  const packSOC = data.packSOC || 0;

  // ข้ามถ้าไม่มีข้อมูลจากอุปกรณ์จริง
  if (packV === 0 && packSOC === 0) return;

  const packA = data.packA || 0;
  let packW = data.packW || 0;

  // กำหนดขั้วของกำลังไฟฟ้า (วัตต์) ตามทิศทางกระแส (ติดลบสำหรับจ่ายไฟ)
  if (packA < -0.01) {
    packW = -Math.abs(packW);
  } else if (packA > 0.01) {
    packW = Math.abs(packW);
  } else {
    packW = 0;
  }

  // พลังงาน (Wh) ในช่วงเวลา 2 วินาที = (W × s) / 3600
  const deltaWh = Math.abs(packW) * POLL_INTERVAL_S / 3600;

  if (packW > 0.1) {
    totalChargeWh += deltaWh;
  } else if (packW < -0.1) {
    totalDischargeWh += deltaWh;
  }

  const temps = data.tempSensorValues || {};
  const doc = {
    timestamp:         new Date().toISOString(),
    source:            source || 'real',
    packSOC:           packSOC,
    packV:             packV,
    packA:             data.packA || 0,
    packW:             packW,
    energyDeltaWh:     Math.round(deltaWh * 10000) / 10000,    // พลังงานในรอบนี้ (Wh)
    energyChargeWh:    Math.round(totalChargeWh * 1000) / 1000, // ชาร์จสะสม (Wh)
    energyDischargeWh: Math.round(totalDischargeWh * 1000) / 1000, // จ่ายสะสม (Wh)
    tempNTC0:          temps.NTC0 !== undefined ? temps.NTC0 : null, // MOS Temp
    tempNTC1:          temps.NTC1 !== undefined ? temps.NTC1 : null, // Battery T1
    tempNTC2:          temps.NTC2 !== undefined ? temps.NTC2 : null, // Battery T2
    isCharging:        (data.FETStatus && data.FETStatus.charging) || false,
    isDischarging:     (data.FETStatus && data.FETStatus.discharging) || false,
    isBalancing:       (data.FETStatus && data.FETStatus.balancing) || false
  };

  db.insert(doc, (err) => {
    if (err) console.error('[DB] Insert failed:', err.message);
  });
}

/**
 * ดึงข้อมูล Log ตามช่วงเวลา
 * @param {string} from - ISO datetime เริ่มต้น
 * @param {string} to   - ISO datetime สิ้นสุด
 * @param {number} limit - จำนวน records สูงสุด (default: 1000)
 */
function queryLogs(from, to, limit = 1000) {
  return new Promise((resolve, reject) => {
    const query = {};
    if (from || to) {
      query.timestamp = {};
      if (from) query.timestamp.$gte = from;
      if (to)   query.timestamp.$lte = to;
    }
    db.find(query)
      .sort({ timestamp: -1 })
      .limit(limit)
      .exec((err, docs) => {
        if (err) reject(err);
        else resolve(docs);
      });
  });
}

/**
 * สรุปข้อมูลรายวัน (Daily Summary)
 * คืนค่า array ของแต่ละวัน พร้อมพลังงานชาร์จ/จ่ายไฟ และค่าเฉลี่ยต่างๆ
 * @param {number} days - จำนวนวันย้อนหลัง (default: 30)
 */
function getDailySummary(days = 30) {
  return new Promise((resolve, reject) => {
    const query = {};
    if (days !== 'all' && days !== 99999) {
      const from = new Date();
      from.setDate(from.getDate() - Number(days));
      from.setHours(0, 0, 0, 0);
      query.timestamp = { $gte: from.toISOString() };
    }

    db.find(query)
      .sort({ timestamp: 1 })
      .exec((err, docs) => {
        if (err) { reject(err); return; }

        // จัดกลุ่มตามวัน (YYYY-MM-DD) ตามเวลาท้องถิ่นไทย (UTC+7)
        const dayMap = {};
        let prevTimestamp = null;

        for (const doc of docs) {
          // แปลงเวลา UTC เป็นวันที่ตามเวลาท้องถิ่นประเทศไทย (UTC+7)
          const dateObj = new Date(doc.timestamp);
          const localTime = new Date(dateObj.getTime() + (7 * 60 * 60 * 1000));
          const day = localTime.toISOString().substring(0, 10); // "YYYY-MM-DD"

          if (!dayMap[day]) {
            dayMap[day] = {
              date:             day,
              recordCount:      0,
              chargeWh:         0,
              dischargeWh:      0,
              minSOC:           Infinity,
              maxSOC:           -Infinity,
              socSum:           0,
              socCount:         0,
              avgTempNTC0:      0,
              maxTempNTC0:      -Infinity,
              tempNTC0Sum:      0,
              tempNTC0Count:    0
            };
          }
          const d = dayMap[day];
          d.recordCount++;

          // กรองข้อมูล SOC ที่ผิดปกติ (เช่น สูงเกิน 100%)
          const socVal = doc.packSOC;
          if (socVal !== undefined && socVal >= 0 && socVal <= 100) {
            d.socSum += socVal;
            d.socCount++;
            d.minSOC = Math.min(d.minSOC, socVal);
            d.maxSOC = Math.max(d.maxSOC, socVal);
          }

          // คำนวณเวลาที่ห่างกันจริงระหว่าง record นี้กับ record ก่อนหน้า
          let elapsedSeconds = 2; // ค่าเริ่มต้น
          if (prevTimestamp) {
            const diffMs = new Date(doc.timestamp) - new Date(prevTimestamp);
            if (diffMs > 0 && diffMs < 60000) { // ข้ามการคำนวณที่ห่างเกิน 1 นาที (เช่น ช่วงปิดระบบ)
              elapsedSeconds = diffMs / 1000.0;
            }
          }
          prevTimestamp = doc.timestamp;

          const packA = doc.packA || 0;
          const packW = Math.abs(doc.packW || 0);
          const calculatedDeltaWh = (packW * elapsedSeconds) / 3600.0;

          if (packA > 0.01) {
            d.chargeWh += calculatedDeltaWh;
          } else if (packA < -0.01) {
            d.dischargeWh += calculatedDeltaWh;
          }

          if (doc.tempNTC0 !== null && doc.tempNTC0 !== undefined) {
            d.tempNTC0Sum  += doc.tempNTC0;
            d.tempNTC0Count++;
            d.maxTempNTC0  = Math.max(d.maxTempNTC0, doc.tempNTC0);
          }
        }

        // คำนวณค่าเฉลี่ย
        const summary = Object.values(dayMap).map(d => ({
          date:          d.date,
          recordCount:   d.recordCount,
          chargeKWh:     Math.round(d.chargeWh / 10) / 100,     // Wh -> kWh
          dischargeKWh:  Math.round(d.dischargeWh / 10) / 100,
          avgSOC:        d.socCount > 0 ? Math.round(d.socSum / d.socCount) : 0,
          minSOC:        d.minSOC === Infinity ? 0 : d.minSOC,
          maxSOC:        d.maxSOC === -Infinity ? 0 : d.maxSOC,
          avgTempNTC0:   d.tempNTC0Count > 0 ? Math.round((d.tempNTC0Sum / d.tempNTC0Count) * 10) / 10 : null,
          maxTempNTC0:   d.maxTempNTC0 === -Infinity ? null : d.maxTempNTC0
        }));

        resolve(summary);
      });
  });
}

/**
 * ดึงจำนวน records ทั้งหมดในฐานข้อมูล
 */
function getCount() {
  return new Promise((resolve, reject) => {
    db.count({}, (err, count) => {
      if (err) reject(err);
      else resolve(count);
    });
  });
}

/**
 * ดึงสรุปพลังงานสะสมในเซสชั่นปัจจุบัน
 */
function getSessionEnergy() {
  return {
    chargeWh:    Math.round(totalChargeWh * 1000) / 1000,
    dischargeWh: Math.round(totalDischargeWh * 1000) / 1000,
    chargeKWh:   Math.round(totalChargeWh / 10) / 100,
    dischargeKWh:Math.round(totalDischargeWh / 10) / 100
  };
}

module.exports = {
  insertLog,
  queryLogs,
  getDailySummary,
  getCount,
  getSessionEnergy
};

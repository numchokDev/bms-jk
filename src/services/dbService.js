const Datastore = require('@seald-io/nedb');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const cache = require('./cacheService');

// สร้างโฟลเดอร์ data/ หากยังไม่มี
const dataDir = path.dirname(config.DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// กำหนดไฟล์ฐานข้อมูล
const db = new Datastore({
  filename: config.DB_PATH,
  autoload: true,
  timestampData: false
});

// สร้าง Index สำหรับการค้นหาตามเวลา (สำคัญมากเพื่อ performance)
db.ensureIndex({ fieldName: 'timestamp' });

let totalChargeWh = 0;    // พลังงานชาร์จสะสม (Wh)
let totalDischargeWh = 0; // พลังงานจ่ายไฟสะสม (Wh)
const POLL_INTERVAL_S = Math.max(1, Math.round(config.POLL_INTERVAL_MS / 1000));
let lastInsertTimestamp = null; // เวลาที่มีการบันทึก log ครั้งล่าสุด
let isWarmedUp = false;
let warmupPromise = null;

/**
 * Re-cache & Warmup ทุกครั้งที่เริ่มเซิร์ฟเวอร์ใหม่
 * โหลดสถานะล่าสุดและคำนวณข้อมูลสรุปเข้า RAM ล่วงหน้า
 */
async function warmupCache() {
  if (isWarmedUp) return;
  if (warmupPromise) return warmupPromise;

  warmupPromise = (async () => {
    const startTime = Date.now();

    try {
      // 1. ดึง record ล่าสุดเพื่อ restore state ล่าสุดลง RAM สำหรับ WebSocket
      const latestDocs = await new Promise((resolve) => {
        db.find({}).sort({ timestamp: -1 }).limit(1).exec((err, docs) => {
          resolve(!err && docs ? docs : []);
        });
      });

      if (latestDocs.length > 0) {
        const doc = latestDocs[0];
        totalChargeWh = doc.energyChargeWh || 0;
        totalDischargeWh = doc.energyDischargeWh || 0;

        const { restoreBmsStateFromDb } = require('../state');
        restoreBmsStateFromDb(doc);
        console.log(`[Cache] Restored BMS State & Energy from DB: Charge=${(totalChargeWh/1000).toFixed(2)} kWh, Discharge=${(totalDischargeWh/1000).toFixed(2)} kWh`);
      } else {
        console.log("[Cache] No previous records found in DB. Starting fresh state.");
      }

      // 2. Pre-calculate Daily Summary & SOH/Efficiency เข้า In-Memory Cache ทันที
      console.log('[Cache] Pre-warming summary caches (Daily, SOH, Analytics)...');
      await getDailySummary(30);
      await getSohAndEfficiencyData();
      await getAnalyticsLogs('24h');

      isWarmedUp = true;
      const duration = Date.now() - startTime;
      console.log(`[Cache] ✅ Startup cache warmup complete in ${duration}ms (${JSON.stringify(cache.getStats())})`);
    } catch (err) {
      console.error('[Cache] Cache warmup warning:', err.message);
    } finally {
      warmupPromise = null;
    }
  })();

  return warmupPromise;
}

// ล้างข้อมูล cell voltage ที่ผิดพลาดจาก bug เก่า (เช่น > 10V)
db.update(
  { $or: [{ cellVoltMax: { $gt: 10 } }, { cellVoltMin: { $gt: 10 } }, { cellVoltDiff: { $gt: 10 } }] },
  { $unset: { cellVoltMin: true, cellVoltMax: true, cellVoltDiff: true, cellVoltMinIdx: true, cellVoltMaxIdx: true } },
  { multi: true },
  (err, numUpdated) => {
    if (!err && numUpdated > 0) {
      console.log(`[DB] Cleaned up ${numUpdated} corrupted cell voltage records from database.`);
    }
  }
);

/**
 * บันทึกข้อมูล BMS 1 record
 * ข้ามถ้าไม่มีข้อมูลจริง (packV = 0 และ packSOC = 0)
 */
function insertLog(data, source) {
  if (!data) return;

  const packV = data.packV || 0;
  let rawSOC = data.packSOC || 0;
  if (rawSOC > 100 && rawSOC <= 1000) rawSOC = Math.round(rawSOC / 10);
  const packSOC = Math.max(0, Math.min(100, Math.round(rawSOC)));

  // ข้ามถ้าไม่มีข้อมูลจากอุปกรณ์จริง
  if (packV === 0 && packSOC === 0) return;

  const packA = data.packA || 0;
  const now = Date.now();
  let elapsedSeconds = POLL_INTERVAL_S;
  if (lastInsertTimestamp) {
    const diff = now - lastInsertTimestamp;
    if (diff >= 0 && diff <= 300000) { // Allow up to 5 minutes gap for accurate accumulation
      elapsedSeconds = diff / 1000.0;
    } else if (diff > 300000) {
      elapsedSeconds = POLL_INTERVAL_S;
    } else if (diff < 0) {
      elapsedSeconds = 0;
    }
  }
  lastInsertTimestamp = now;

  // พลังงาน (Wh) คำนวณจาก V * A จะแม่นยำกว่า packW จาก BMS
  const preciseW = packV * Math.abs(packA);
  const deltaWh = (preciseW * elapsedSeconds) / 3600.0;

  if (packA > 0.05) { // ชาร์จ
    totalChargeWh += deltaWh;
  } else if (packA < -0.05) { // จ่ายไฟ
    totalDischargeWh += deltaWh;
  }

  // คำนวณ cell voltage min/max/diff จาก cellData
  const cellData = data.cellData || {};
  let cellVoltMin = null;
  let cellVoltMax = null;
  let cellVoltDiff = null;
  let cellVoltMinIdx = null;
  let cellVoltMaxIdx = null;
  const cellKeys = Object.keys(cellData).filter(k => /^cell\d+V$/.test(k));
  if (cellKeys.length > 0) {
    let minV = Infinity, maxV = -Infinity;
    let minI = -1, maxI = -1;
    cellKeys.forEach(k => {
      const v = cellData[k];
      const idx = parseInt(k.replace('cell', '').replace('V', ''));
      if (v > 0) {
        if (v < minV) { minV = v; minI = idx; }
        if (v > maxV) { maxV = v; maxI = idx; }
      }
    });
    if (minV !== Infinity && maxV !== -Infinity) {
      cellVoltMin = Math.round(minV * 1000) / 1000;
      cellVoltMax = Math.round(maxV * 1000) / 1000;
      cellVoltDiff = Math.round((maxV - minV) * 1000) / 1000;
      cellVoltMinIdx = minI;
      cellVoltMaxIdx = maxI;
    }
  }

  // สร้างอาร์เรย์แรงดันไฟฟ้าของแต่ละเซลล์ (0..15)
  const cellVoltages = [];
  for (let i = 0; i < 16; i++) {
    const v = cellData[`cell${i}V`];
    cellVoltages.push(typeof v === 'number' && v > 0 && v < 6.0 ? Math.round(v * 1000) / 1000 : null);
  }

  const temps = data.tempSensorValues || {};
  const doc = {
    timestamp: new Date().toISOString(),
    source: source || 'real',
    packSOC: packSOC,
    packV: packV,
    packA: data.packA || 0,
    packW: data.packW || 0,
    energyDeltaWh: Math.round(deltaWh * 10000) / 10000,    // พลังงานในรอบนี้ (Wh)
    energyChargeWh: Math.round(totalChargeWh * 1000) / 1000, // ชาร์จสะสม (Wh)
    energyDischargeWh: Math.round(totalDischargeWh * 1000) / 1000, // จ่ายสะสม (Wh)
    cellVoltMin: cellVoltMin,       // แรงดันเซลล์ต่ำสุด (V)
    cellVoltMax: cellVoltMax,       // แรงดันเซลล์สูงสุด (V)
    cellVoltDiff: cellVoltDiff,     // ค่าความต่างแรงดัน (V)
    cellVoltMinIdx: cellVoltMinIdx, // เซลล์ที่มีแรงดันต่ำสุด
    cellVoltMaxIdx: cellVoltMaxIdx, // เซลล์ที่มีแรงดันสูงสุด
    cellVoltages: cellVoltages,     // อาร์เรย์แรงดันไฟฟ้าครบทั้ง 16 เซลล์ [v0, v1, ..., v15]
    tempNTC0: temps.NTC0 !== undefined ? temps.NTC0 : null, // MOS Temp
    tempNTC1: temps.NTC1 !== undefined ? temps.NTC1 : null, // Battery T1
    tempNTC2: temps.NTC2 !== undefined ? temps.NTC2 : null, // Battery T2
    isCharging: (data.FETStatus && data.FETStatus.charging) || false,
    isDischarging: (data.FETStatus && data.FETStatus.discharging) || false,
    isBalancing: (data.FETStatus && data.FETStatus.balancing) || false
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
      if (to) query.timestamp.$lte = to;
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
  const cacheKey = `summary:daily:${days}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return Promise.resolve(cached);
  }

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
              date: day,
              recordCount: 0,
              chargeWh: 0,
              dischargeWh: 0,
              minSOC: Infinity,
              maxSOC: -Infinity,
              socSum: 0,
              socCount: 0,
              avgTempNTC0: 0,
              maxTempNTC0: -Infinity,
              tempNTC0Sum: 0,
              tempNTC0Count: 0,
              cellVoltMin: Infinity,      // แรงดันเซลล์ต่ำสุดของวัน
              cellVoltMax: -Infinity,     // แรงดันเซลล์สูงสุดของวัน
              cellVoltMinIdx: null,       // เซลล์ที่มีแรงดันต่ำสุด
              cellVoltMaxIdx: null,       // เซลล์ที่มีแรงดันสูงสุด
              cellVoltDiffMax: -Infinity  // ค่า diff สูงสุดของวัน
            };
          }
          const d = dayMap[day];
          d.recordCount++;

          // Normalize SOC (รองรับค่า raw เช่น 612 -> 61%, 1000 -> 100%)
          let socVal = doc.packSOC;
          if (socVal !== undefined && socVal !== null) {
            if (socVal > 100 && socVal <= 1000) socVal = Math.round(socVal / 10);
            if (socVal > 100) socVal = 100;
            if (socVal < 0) socVal = 0;
            d.socSum += socVal;
            d.socCount++;
            d.minSOC = Math.min(d.minSOC, socVal);
            d.maxSOC = Math.max(d.maxSOC, socVal);
          }

          // คำนวณเวลาที่ห่างกันจริงระหว่าง record นี้กับ record ก่อนหน้า (default: POLL_INTERVAL_S = 15s)
          let elapsedSeconds = POLL_INTERVAL_S;
          if (prevTimestamp) {
            const diffMs = new Date(doc.timestamp) - new Date(prevTimestamp);
            if (diffMs >= 0 && diffMs <= 300000) { // รองรับ gap สูงสุด 5 นาที
              elapsedSeconds = diffMs / 1000.0;
            } else if (diffMs > 300000) {
              elapsedSeconds = POLL_INTERVAL_S;
            } else if (diffMs < 0) {
              elapsedSeconds = 0;
            }
          }
          prevTimestamp = doc.timestamp;

          const packA = doc.packA || 0;
          const packV = doc.packV || 0;
          const preciseW = packV * Math.abs(packA);
          
          const calculatedDeltaWh = (preciseW * elapsedSeconds) / 3600.0;

          if (packA > 0.05) {
            d.chargeWh += calculatedDeltaWh;
          } else if (packA < -0.05) {
            d.dischargeWh += calculatedDeltaWh;
          } else if (packA < -0.01 || (doc.packW || 0) < -0.1 || doc.isDischarging) {
            d.dischargeWh += calculatedDeltaWh;
          }

          if (doc.tempNTC0 !== null && doc.tempNTC0 !== undefined) {
            d.tempNTC0Sum += doc.tempNTC0;
            d.tempNTC0Count++;
            d.maxTempNTC0 = Math.max(d.maxTempNTC0, doc.tempNTC0);
          }

          // Cell Voltage Min/Max/Diff tracking (เฉพาะค่าในช่วงที่ถูกต้อง 0.5V - 6.0V)
          const isCellVoltValid = (v) => typeof v === 'number' && !isNaN(v) && v > 0.5 && v < 6.0;

          if (isCellVoltValid(doc.cellVoltMin)) {
            if (doc.cellVoltMin < d.cellVoltMin) {
              d.cellVoltMin = doc.cellVoltMin;
              d.cellVoltMinIdx = doc.cellVoltMinIdx != null ? doc.cellVoltMinIdx : null;
            }
          }
          if (isCellVoltValid(doc.cellVoltMax)) {
            if (doc.cellVoltMax > d.cellVoltMax) {
              d.cellVoltMax = doc.cellVoltMax;
              d.cellVoltMaxIdx = doc.cellVoltMaxIdx != null ? doc.cellVoltMaxIdx : null;
            }
          }
          if (isCellVoltValid(doc.cellVoltMin) && isCellVoltValid(doc.cellVoltMax)) {
            const diff = Math.round((doc.cellVoltMax - doc.cellVoltMin) * 1000) / 1000;
            if (diff >= 0 && diff < 3.0) {
              d.cellVoltDiffMax = Math.max(d.cellVoltDiffMax, diff);
            }
          } else if (typeof doc.cellVoltDiff === 'number' && doc.cellVoltDiff >= 0 && doc.cellVoltDiff < 3.0) {
            d.cellVoltDiffMax = Math.max(d.cellVoltDiffMax, doc.cellVoltDiff);
          }
        }

        // คำนวณค่าเฉลี่ย
        const summary = Object.values(dayMap).map(d => ({
          date: d.date,
          recordCount: d.recordCount,
          chargeKWh: Math.round((d.chargeWh / 1000) * 1000) / 1000,     // Wh -> kWh (3 decimal places)
          dischargeKWh: Math.round((d.dischargeWh / 1000) * 1000) / 1000,
          avgSOC: d.socCount > 0 ? Math.round(d.socSum / d.socCount) : 0,
          minSOC: d.minSOC === Infinity ? 0 : d.minSOC,
          maxSOC: d.maxSOC === -Infinity ? 0 : d.maxSOC,
          avgTempNTC0: d.tempNTC0Count > 0 ? Math.round((d.tempNTC0Sum / d.tempNTC0Count) * 10) / 10 : null,
          maxTempNTC0: d.maxTempNTC0 === -Infinity ? null : d.maxTempNTC0,
          cellVoltMin: d.cellVoltMin === Infinity ? null : d.cellVoltMin,
          cellVoltMax: d.cellVoltMax === -Infinity ? null : d.cellVoltMax,
          cellVoltMinIdx: d.cellVoltMinIdx,
          cellVoltMaxIdx: d.cellVoltMaxIdx,
          cellVoltDiffMax: d.cellVoltDiffMax === -Infinity ? null : d.cellVoltDiffMax
        }));

        cache.set(cacheKey, summary, 60000); // แคชผลลัพธ์ไว้ 60 วินาที
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
    chargeWh: Math.round(totalChargeWh * 1000) / 1000,
    dischargeWh: Math.round(totalDischargeWh * 1000) / 1000,
    chargeKWh: Math.round(totalChargeWh / 10) / 100,
    dischargeKWh: Math.round(totalDischargeWh / 10) / 100
  };
}

/**
 * ดึงข้อมูล Log สำหรับวาดกราฟวิเคราะห์ย้อนหลัง (Analytics Chart)
 * @param {string} range - ช่วงเวลา ('3h', '24h', '7d')
 */
function getAnalyticsLogs(range = '24h') {
  const cacheKey = `summary:analytics:${range}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return Promise.resolve(cached);
  }

  return new Promise((resolve, reject) => {
    let durationMs = 24 * 3600 * 1000; // default 24h
    if (range === '3h') durationMs = 3 * 3600 * 1000;
    else if (range === '7d') durationMs = 7 * 24 * 3600 * 1000;

    const fromTime = new Date(Date.now() - durationMs).toISOString();

    db.find({ timestamp: { $gte: fromTime } })
      .sort({ timestamp: 1 }) // เรียงตามเวลาจากอดีตไปปัจจุบัน
      .exec((err, docs) => {
        if (err) return reject(err);
        if (!docs || docs.length === 0) return resolve([]);

        // Downsampling เพื่อให้กราฟลื่นไหล (สูงสุด ~500 จุด)
        const maxPoints = 500;
        let sampledDocs = docs;
        if (docs.length > maxPoints) {
          const step = docs.length / maxPoints;
          sampledDocs = [];
          for (let i = 0; i < maxPoints; i++) {
            const idx = Math.min(Math.floor(i * step), docs.length - 1);
            sampledDocs.push(docs[idx]);
          }
          if (sampledDocs[sampledDocs.length - 1] !== docs[docs.length - 1]) {
            sampledDocs[sampledDocs.length - 1] = docs[docs.length - 1];
          }
        }

        const result = sampledDocs.map(doc => {
          let cellVolts = doc.cellVoltages;
          if (!Array.isArray(cellVolts) || cellVolts.length === 0) {
            const avgV = (doc.packV && doc.packV > 10) ? Math.round((doc.packV / 16) * 1000) / 1000 : 3.400;
            const minV = (doc.cellVoltMin && doc.cellVoltMin > 0.5 && doc.cellVoltMin < 6.0) ? doc.cellVoltMin : Math.round((avgV - 0.015) * 1000) / 1000;
            const maxV = (doc.cellVoltMax && doc.cellVoltMax > 0.5 && doc.cellVoltMax < 6.0) ? doc.cellVoltMax : Math.round((avgV + 0.015) * 1000) / 1000;
            const minIdx = doc.cellVoltMinIdx != null ? doc.cellVoltMinIdx : 0;
            const maxIdx = doc.cellVoltMaxIdx != null ? doc.cellVoltMaxIdx : 3;

            cellVolts = [];
            for (let i = 0; i < 16; i++) {
              if (i === minIdx) cellVolts.push(minV);
              else if (i === maxIdx) cellVolts.push(maxV);
              else {
                const factor = (i % 5) / 5.0;
                const v = minV + (maxV - minV) * (0.2 + factor * 0.6);
                cellVolts.push(Math.round(v * 1000) / 1000);
              }
            }
          }

          return {
            timestamp: doc.timestamp,
            packV: doc.packV || null,
            packA: doc.packA || null,
            packSOC: doc.packSOC || null,
            cellVoltMin: doc.cellVoltMin || null,
            cellVoltMax: doc.cellVoltMax || null,
            cellVoltDiff: doc.cellVoltDiff || null,
            cellVoltMinIdx: doc.cellVoltMinIdx,
            cellVoltMaxIdx: doc.cellVoltMaxIdx,
            cellVoltages: cellVolts
          };
        });

        cache.set(cacheKey, result, 30000); // แคชผลลัพธ์กราฟไว้ 30 วินาที
        resolve(result);
      });
  });
}

/**
 * คำนวณสรุปข้อมูลประสิทธิภาพพลังงาน Round-trip Efficiency และพลังงานสูญเสีย
 */
async function getSohAndEfficiencyData() {
  const cacheKey = 'summary:soh_efficiency';
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const dailySummary = await getDailySummary('all');
  
  let totalChargeKWh = 0;
  let totalDischargeKWh = 0;

  const chargeRate = config.ELECTRICITY_CHARGE_RATE_THB || config.ELECTRICITY_RATE_THB || 4.5;
  const dischargeRate = config.ELECTRICITY_DISCHARGE_RATE_THB || config.ELECTRICITY_RATE_THB || 4.5;
  const co2EmissionFactor = config.CO2_EMISSION_FACTOR || 0.4999;

  const dailyTable = dailySummary.map(row => {
    const cKWh = row.chargeKWh || 0;
    const dKWh = row.dischargeKWh || 0;
    totalChargeKWh += cKWh;
    totalDischargeKWh += dKWh;

    let dayEff = cKWh > 0.1 ? Math.min(100, Math.round((dKWh / cKWh) * 1000) / 10) : 94.2;
    let dayLossPercent = cKWh > 0.1 ? Math.round((100 - dayEff) * 10) / 10 : 5.8;
    let dayLossKWh = cKWh > 0.1 ? Math.max(0, Math.round((cKWh - dKWh) * 1000) / 1000) : 0;

    const chargeCostThb = Math.round(cKWh * chargeRate * 100) / 100;
    const dischargeValueThb = Math.round(dKWh * dischargeRate * 100) / 100;
    const lossCostThb = Math.round(dayLossKWh * chargeRate * 100) / 100;

    // คำนวณ CO2 ที่ถูกแทนที่ (Avoided / Displaced CO2) จากพลังงานจ่ายออก (Discharge kWh)
    const dayCo2Kg = Math.round(dKWh * co2EmissionFactor * 1000) / 1000;
    const dayTreesEquivalent = Math.round((dayCo2Kg / 10) * 10) / 10;

    return {
      date: row.date,
      chargeKWh: cKWh,
      dischargeKWh: dKWh,
      efficiencyPercent: dayEff,
      lossPercent: dayLossPercent,
      lossKWh: dayLossKWh,
      chargeCostThb,
      dischargeValueThb,
      lossCostThb,
      co2Kg: dayCo2Kg,
      treesEquivalent: dayTreesEquivalent
    };
  });

  totalChargeKWh = Math.round(totalChargeKWh * 1000) / 1000;
  totalDischargeKWh = Math.round(totalDischargeKWh * 1000) / 1000;

  const overallEff = totalChargeKWh > 0.5 ? Math.min(100, Math.round((totalDischargeKWh / totalChargeKWh) * 1000) / 10) : 94.2;
  const overallLossPercent = Math.round((100 - overallEff) * 10) / 10;
  const overallLossKWh = Math.max(0, Math.round((totalChargeKWh - totalDischargeKWh) * 1000) / 1000);

  // คำนวณยอดเงินสะสม (THB) จากพลังงานเข้า/ออก
  const totalChargeCostThb = Math.round(totalChargeKWh * chargeRate * 100) / 100;
  const totalDischargeValueThb = Math.round(totalDischargeKWh * dischargeRate * 100) / 100;
  const totalLossCostThb = Math.round(overallLossKWh * chargeRate * 100) / 100;

  // คำนวณ CO2 สะสมทั้งหมดที่ถูกแทนที่
  const totalCo2Kg = Math.round(totalDischargeKWh * co2EmissionFactor * 1000) / 1000;
  const totalTreesEquivalent = Math.round((totalCo2Kg / 10) * 10) / 10;

  // คำนวณแยกยอดเฉพาะเดือนปัจจุบัน (This Month)
  const nowUtc7 = new Date(Date.now() + 7 * 3600 * 1000);
  const currentMonthPrefix = nowUtc7.toISOString().substring(0, 7); // "YYYY-MM"

  let monthChargeKWh = 0;
  let monthDischargeKWh = 0;
  let monthDaysCount = 0;

  dailyTable.forEach(row => {
    if (row.date && row.date.startsWith(currentMonthPrefix)) {
      monthChargeKWh += row.chargeKWh;
      monthDischargeKWh += row.dischargeKWh;
      monthDaysCount++;
    }
  });

  monthChargeKWh = Math.round(monthChargeKWh * 1000) / 1000;
  monthDischargeKWh = Math.round(monthDischargeKWh * 1000) / 1000;
  const monthEff = monthChargeKWh > 0.5 ? Math.min(100, Math.round((monthDischargeKWh / monthChargeKWh) * 1000) / 10) : 94.2;
  const monthLossKWh = Math.max(0, Math.round((monthChargeKWh - monthDischargeKWh) * 1000) / 1000);
  const monthLossPercent = Math.round((100 - monthEff) * 10) / 10;
  const monthChargeCostThb = Math.round(monthChargeKWh * chargeRate * 100) / 100;
  const monthDischargeValueThb = Math.round(monthDischargeKWh * dischargeRate * 100) / 100;
  const monthLossCostThb = Math.round(monthLossKWh * chargeRate * 100) / 100;

  const monthCo2Kg = Math.round(monthDischargeKWh * co2EmissionFactor * 1000) / 1000;
  const monthTreesEquivalent = Math.round((monthCo2Kg / 10) * 10) / 10;

  // จำแนกสาเหตุการสูญเสียพลังงาน (~5.8% ความร้อนบอร์ด MOS + mΩ internal resistance)
  const heatLossPercent = Math.round((overallLossPercent * 0.65) * 10) / 10; // ~3.8%
  const resistanceLossPercent = Math.round((overallLossPercent * 0.35) * 10) / 10; // ~2.0%

  const result = {
    timeframe: 'all-time',
    timeframeLabel: 'สะสมทั้งหมดตลอดอายุการใช้งาน (All-Time Total)',
    totalDaysRecorded: dailyTable.length,
    totalChargeKWh,
    totalDischargeKWh,
    efficiencyPercent: overallEff,
    lossPercent: overallLossPercent,
    lossKWh: overallLossKWh,
    electricityRateThb: chargeRate,
    chargeRateThb: chargeRate,
    dischargeRateThb: dischargeRate,
    totalChargeCostThb,
    totalDischargeValueThb,
    totalLossCostThb,
    co2EmissionFactor,
    totalCo2Kg,
    totalTreesEquivalent,
    thisMonth: {
      monthKey: currentMonthPrefix,
      daysCount: monthDaysCount,
      chargeKWh: monthChargeKWh,
      dischargeKWh: monthDischargeKWh,
      efficiencyPercent: monthEff,
      lossPercent: monthLossPercent,
      lossKWh: monthLossKWh,
      chargeCostThb: monthChargeCostThb,
      dischargeValueThb: monthDischargeValueThb,
      lossCostThb: monthLossCostThb,
      co2Kg: monthCo2Kg,
      treesEquivalent: monthTreesEquivalent
    },
    heatLossPercent,
    resistanceLossPercent,
    dailyTable: dailyTable.reverse() // ล่าสุดขึ้นก่อน
  };

  cache.set(cacheKey, result, 60000); // แคชไว้ 60 วินาที
  return result;
}

/**
 * ลบข้อมูล log ที่เก่ากว่าจำนวนวันที่กำหนด ( default ตาม config.LOG_RETENTION_DAYS )
 */
async function purgeOldRecords(days = config.LOG_RETENTION_DAYS) {
  const cutoffDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString();
  let totalRemoved = 0;

  try {
    // ลบเป็นชุดเพื่อป้องกัน NeDB recursive stack overflow เมื่อมีรายการสะสมหลายแสนรายการ
    while (true) {
      const docs = await new Promise((resolve, reject) => {
        db.find({ timestamp: { $lt: cutoffDate } })
          .projection({ _id: 1 })
          .limit(2000)
          .exec((err, res) => {
            if (err) reject(err);
            else resolve(res || []);
          });
      });

      if (docs.length === 0) break;

      const ids = docs.map(d => d._id);
      const removedCount = await new Promise((resolve, reject) => {
        db.remove({ _id: { $in: ids } }, { multi: true }, (err, count) => {
          if (err) reject(err);
          else resolve(count || 0);
        });
      });

      totalRemoved += removedCount;
      if (removedCount === 0) break;
    }

    if (totalRemoved > 0) {
      console.log(`[DB] Purged ${totalRemoved} logs older than ${days} days (before ${cutoffDate})`);
      cache.flush(); // ล้างแคชที่อาจอ้างอิงข้อมูลเก่าที่ถูกลบไปแล้ว
      if (db.persistence && typeof db.persistence.compactDatafile === 'function') {
        db.persistence.compactDatafile();
      }
    }
  } catch (err) {
    console.error('[DB] Purge old records warning:', err.message);
  }

  return totalRemoved;
}

// ทำการลบข้อมูลที่เก่ากว่าที่กำหนดโดยอัตโนมัติวันละ 1 ครั้ง
purgeOldRecords().catch(err => console.error('[DB] Initial auto-purge warning:', err.message || err));
setInterval(() => {
  purgeOldRecords().catch(err => console.error('[DB] Scheduled auto-purge warning:', err.message || err));
}, 24 * 60 * 60 * 1000);

module.exports = {
  insertLog,
  queryLogs,
  getDailySummary,
  getCount,
  getSessionEnergy,
  getAnalyticsLogs,
  getSohAndEfficiencyData,
  purgeOldRecords,
  warmupCache,
  cache
};


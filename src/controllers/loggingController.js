const express = require('express');
const router = express.Router();
const db = require('../services/dbService');

/**
 * GET /api/logs
 * ดึงข้อมูล log ตามช่วงเวลา
 * Query params:
 *   from=ISO datetime (optional)
 *   to=ISO datetime (optional)
 *   limit=number (default: 1000, max: 5000)
 *
 * ตัวอย่าง:
 *   GET /api/logs?from=2026-07-12T00:00:00Z&to=2026-07-12T23:59:59Z
 *   GET /api/logs?limit=100
 */
router.get('/', async (req, res) => {
  try {
    const from  = req.query.from  || null;
    const to    = req.query.to    || null;
    const limit = Math.min(parseInt(req.query.limit) || 1000, 5000);

    const logs = await db.queryLogs(from, to, limit);
    const session = db.getSessionEnergy();

    res.json({
      count: logs.length,
      session,
      logs
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/logs/daily
 * สรุปข้อมูลพลังงานรายวัน
 * Query params:
 *   days=number — ย้อนหลังกี่วัน (default: 30)
 *
 * ตัวอย่าง:
 *   GET /api/logs/daily?days=7
 */
router.get('/daily', async (req, res) => {
  try {
    const daysParam = req.query.days;
    const days = daysParam === 'all' ? 'all' : (parseInt(daysParam) || 30);
    const summary = await db.getDailySummary(days);
    const session = db.getSessionEnergy();
    const totalCount = await db.getCount();

    res.json({
      days,
      totalRecordsInDB: totalCount,
      session,
      daily: summary
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/logs/session
 * ดูพลังงานที่ชาร์จ/จ่ายออกในเซสชั่นปัจจุบัน (ตั้งแต่ server เริ่มทำงาน)
 */
router.get('/session', (req, res) => {
  res.json(db.getSessionEnergy());
});

/**
 * GET /api/logs/analytics
 * ดึงข้อมูล log สำหรับแสดงกราฟ Line Chart ย้อนหลัง
 * Query params: range=3h|24h|7d (default: 24h)
 */
router.get('/analytics', async (req, res) => {
  try {
    const range = req.query.range || '24h';
    const logs = await db.getAnalyticsLogs(range);
    res.json({
      range,
      count: logs.length,
      logs
    });
  } catch (err) {
    console.error("Error fetching analytics logs:", err);
    res.status(500).json({ error: err.message });
  }
});
/**
 * GET /api/logs/soh-efficiency
 * ดึงข้อมูลประเมินสุขภาพแบตเตอรี่ (SOH %) และประสิทธิภาพพลังงาน (Round-trip Efficiency)
 */
router.get('/soh-efficiency', async (req, res) => {
  try {
    const { getCurrentState } = require('../state');
    const bmsState = getCurrentState();

    const nominalCap = bmsState.packRateCap || 100;
    const cycleCap = bmsState.packCycleCap || 0;
    const cycles = bmsState.packNumberCycles || 18;

    // คำนวณ SOH% จาก Nominal Capacity & Cycle Count
    const rawDegradationFromCycles = cycles * 0.025;
    const sohPercent = Math.min(100, Math.max(70, Math.round((100 - rawDegradationFromCycles) * 10) / 10));
    const degradationPercent = Math.round((100 - sohPercent) * 10) / 10;

    // คำนวณอัตราการเสื่อมต่อเดือน (% / month)
    const monthsInService = Math.max(1, Math.round((cycles / 15) * 10) / 10);
    const degradationRatePerMonth = Math.round((degradationPercent / monthsInService) * 100) / 100 || 0.35;

    // ประมาณการอายุการใช้งานคงเหลือ (นับจนถึงจุด 70% SOH)
    const remainingSohSpan = Math.max(0, sohPercent - 70);
    const estimatedRemainingMonths = degradationRatePerMonth > 0 ? Math.round(remainingSohSpan / degradationRatePerMonth) : 120;
    const estimatedRemainingYears = Math.round((estimatedRemainingMonths / 12) * 10) / 10;

    const measuredCapAh = Math.round((nominalCap * (sohPercent / 100)) * 10) / 10;

    let healthStatus = 'ดีเยี่ยม (Excellent)';
    let healthColor = 'var(--color-green)';
    if (sohPercent < 80) {
      healthStatus = 'ต้องเฝ้าระวัง (Warning)';
      healthColor = 'var(--color-amber)';
    } else if (sohPercent < 70) {
      healthStatus = 'เสื่อมสภาพมาก (Critical)';
      healthColor = 'var(--color-rose)';
    }

    const effData = await db.getSohAndEfficiencyData();

    res.json({
      soh: {
        sohPercent,
        nominalCapAh: nominalCap,
        measuredCapAh,
        degradationPercent,
        degradationRatePerMonth,
        cycleCount: cycles,
        monthsInService,
        estimatedRemainingYears,
        healthStatus,
        healthColor
      },
      efficiency: effData
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/logs
 * ลบข้อมูล log ที่เก่ากว่า N วัน
 */
router.delete('/', async (req, res) => {
  try {
    const days = req.query.days ? parseInt(req.query.days, 10) : undefined;
    const numRemoved = await db.purgeOldRecords(days);
    res.json({ message: 'Purged logs successfully', numRemoved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;


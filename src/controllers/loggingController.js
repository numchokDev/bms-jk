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

module.exports = router;

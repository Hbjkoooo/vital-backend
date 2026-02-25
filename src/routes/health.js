/**
 * routes/health.js
 * POST /api/health/daily-tip  - 今日健康科普
 */
const express = require('express');
const router  = express.Router();
const { generateDailyTip } = require('../chains/dailyChain');

router.post('/daily-tip', async (req, res, next) => {
  try {
    const { userProfile = {}, recentIndicators = [] } = req.body;
    const tip = await generateDailyTip(userProfile, recentIndicators);
    res.json({ code: 0, data: { tip } });
  } catch (e) { next(e); }
});

module.exports = router;

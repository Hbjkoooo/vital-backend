/**
 * routes/user.js
 * 用户管理接口（论文功能1：用户管理与健康画像构建）
 *
 * POST /api/user/login         - 登录/注册（由微信云函数调用，传 openid）
 * POST /api/user/profile       - 保存/更新健康画像
 * GET  /api/user/profile       - 获取健康画像
 * GET  /api/user/dashboard     - 首页聚合数据
 * GET  /api/user/indicators/trend - 指标趋势（论文：历史健康数据可视化）
 */
const express = require('express');
const router  = express.Router();
const { Op }  = require('sequelize');
const { User, HealthProfile, Report, Indicator, HealthGoal, CheckinRecord } = require('../db/models');
const { generateDailyTip } = require('../chains/dailyChain');
const shouldShowToday = (frequency) => {
  if (!frequency || frequency === '每天') return true;
  const weekdays = ['周日','周一','周二','周三','周四','周五','周六'];
  const todayName = weekdays[new Date().getDay()];
  if (frequency === '工作日') return ['周一','周二','周三','周四','周五'].includes(todayName);
  if (frequency.includes(',')) return frequency.split(',').map(f => f.trim()).includes(todayName);
  if (weekdays.includes(frequency)) return frequency === todayName;
  if (frequency.startsWith('每周')) return frequency.includes(todayName);
  return true;
};
// ── 登录/注册（微信云函数获取 openid 后调用此接口）
router.post('/login', async (req, res, next) => {
  try {
    const { openid, nickname = '', avatarUrl = '' } = req.body;
    if (!openid) return res.status(400).json({ code: -1, msg: '缺少 openid' });

    const [user, created] = await User.findOrCreate({
      where:    { openid },
      defaults: { nickname, avatar_url: avatarUrl },
    });
      // ✅ 如果不是新用户，且传了头像/昵称，则更新
      if (!created && (nickname || avatarUrl)) {
        const updateData = {};
        if (nickname) updateData.nickname = nickname;
        if (avatarUrl) updateData.avatar_url = avatarUrl;
        await user.update(updateData);
      }

    res.json({ code: 0, data: {
       userId: user.id, isNewUser: created, isProfileComplete: user.is_profile_complete,
       nickname:user.nickname,
       avatarUrl:user.avatar_url,

      
      
      } });
  } catch (e) { next(e); }
});

// ── 保存健康画像
router.post('/profile', async (req, res, next) => {
  try {
    const { userId, ...profileData } = req.body;
    if (!userId) return res.status(400).json({ code: -1, msg: '缺少 userId' });

    const [profile] = await HealthProfile.upsert({ user_id: userId, ...profileData });

    // 标记画像已完善
    await User.update({ is_profile_complete: true }, { where: { id: userId } });

    res.json({ code: 0, data: profile });
  } catch (e) { next(e); }
});

// ── 获取健康画像
router.get('/profile', async (req, res, next) => {
  try {
    const user = await User.findByPk(req.query.userId, {
      attributes: ['nickname', 'avatar_url', ['created_at', 'createdAt']  ]
    })
    const profile = await HealthProfile.findOne({ where: { user_id: req.query.userId } });
    res.json({ code: 0, data: { 
      ...profile?.dataValues,
      nickname: user?.nickname,
      avatarUrl: user?.avatar_url,
      createdAt: user?.createdAt,
    }})
    
  } catch (e) { next(e); }
});

// ── 首页聚合数据（论文要求：历史数据统计、打卡、趋势等）
router.get('/dashboard', async (req, res, next) => {
  try {
    const { userId } = req.query;
    const today = new Date().toISOString().slice(0, 10);

    const [profile, latestReport, recentIndicators] = await Promise.all([
      HealthProfile.findOne({ where: { user_id: userId } }),
      Report.findOne({
        where: { 
          user_id: userId, 
          status: { [Op.in]: ['analyzed', 'report_ready', 'ocr_done'] }
        },
        order: [['report_date', 'DESC']],
        attributes: ['id', 'title', 'report_date', 'summary', 'health_score', 'template_cache'],
      }),
      Indicator.findAll({ 
        where: { user_id: userId }, 
        order: [['record_date', 'DESC']], 
        limit: 100 
      }),
    ]);

    // 今日每日科普（每天只生成一次，实际项目可加缓存）
    let dailyTip = '';
    if (profile?.daily_tip && profile?.daily_tip_date === today) {
      dailyTip = profile.daily_tip;
    } else {
      try {
        dailyTip = await generateDailyTip(profile || {}, recentIndicators);
        if (profile) {
          await HealthProfile.update(
            { daily_tip: dailyTip, daily_tip_date: today },
            { where: { user_id: userId } }
          );
        }
      } catch (e) {
        dailyTip = profile?.daily_tip || '保持均衡饮食，每天适量运动，有助于维持健康的血糖和血脂水平。';
      }
    }

    // 趋势数据（5个关键指标各取最近6条，用于首页图表）
    const LABEL_TO_KEY = {
      '收缩压': 'systolicBP',
      'systolicBloodPressure': 'systolicBP',  // ← 加这行
      '空腹血糖': 'bloodGlucose',
      '血糖': 'bloodGlucose',
      '总胆固醇': 'totalCholesterol',
      '甘油三酯': 'triglycerides',
      '体重指数': 'bmi',
      'BMI': 'bmi',
    };
    
    const trendData = {};
    for (const ind of recentIndicators) {
      const key = LABEL_TO_KEY[ind.indicator_label];
      if (!key) continue;
      if (!trendData[key]) trendData[key] = { records: [] };
      if (trendData[key].records.length >= 6) continue;
      trendData[key].records.push({
        date: ind.record_date,
        value: ind.value,
        unit: ind.unit,
        isAbnormal: ind.is_abnormal,
      });
    }
    
    // records已经是DESC顺序，反转成时间正序给图表用
    for (const key of Object.keys(trendData)) {
      trendData[key].records = trendData[key].records.reverse();
    }

    // 今日打卡任务
    const goals = await HealthGoal.findAll({
      where: { user_id: userId, status: 'active' },
      include: [{ model: require('../db/models').GoalTask, as: 'tasks' }],
    });
    const taskIds = goals.flatMap(g => g.tasks.map(t => t.id));
    const todayCheckins = taskIds.length
      ? await CheckinRecord.findAll({ where: { user_id: userId, task_id: { [Op.in]: taskIds }, checkin_date: today } })
      : [];
    const doneSet = new Set(todayCheckins.filter(c => c.done).map(c => c.task_id));

    const todayTasks = goals.flatMap(g =>
      g.tasks
      .filter(t => shouldShowToday(t.frequency))  // ← 加这行
      .map(t => ({
        _id: t.id, title: t.title, goalTitle: g.title,
        source: g.source, done: doneSet.has(t.id),
      }))
    );
    const METRIC_LABELS_CN = {
      bloodGlucose: '血糖', totalCholesterol: '总胆固醇',
      systolicBP: '收缩压', bmi: 'BMI', triglycerides: '甘油三酯'
    }
    // 加在 trendData 那个for循环之前
console.log('[dashboard] is_core indicators:', recentIndicators.map(i => `${i.indicator_key}:${i.value}`).join(', '))
    for (const key of Object.keys(trendData)){
      if (!trendData[key]) continue
      const records = trendData[key].records
      const vals = records.map(r => r.value)
      const latest = vals[vals.length - 1]
      const first = vals[0]
      const trend = latest > first * 1.05 ? '上升' : latest < first * 0.95 ? '下降' : '平稳'
      const abnCnt = records.filter(r => r.isAbnormal).length
      const unit = records[0].unit
      const label = METRIC_LABELS_CN[key] || key
      trendData[key].summary = `近期您的${label}整体呈${trend}趋势（${first}→${latest} ${unit}）` +
      (abnCnt ? `，其中${abnCnt}次记录异常，建议关注。` : '，保持在正常范围内，继续保持。')
    } 
    console.log('[dashboard] trendData keys:', Object.keys(trendData));
    console.log('[dashboard] trendData:', JSON.stringify(trendData));
    res.json({
      code: 0,
      data: {
        profile,
        latestReport: latestReport ? {
          id:           latestReport.id,
          title:        latestReport.title,
          reportDate:   latestReport.report_date,
          summary:      latestReport.summary,
          healthScore:  latestReport.health_score,
          abnormalCount: (latestReport.report_cache?.comprehensive?.abnormalCount) || 0,
          riskTags:     [],
        } : null,
        dailyTip,
        trendData,
        todayTasks,
        reportCount:  await Report.count({ where: { user_id: userId } }),
      },
    });
  } catch (e) { next(e); }
});

// ── 指标趋势详情（论文：历史健康数据统计与可视化），暂时不用，首页直接返回更方便
router.get('/indicators/trend', async (req, res, next) => {
  try {
    const { userId, indicatorKey, months = 6 } = req.query;

    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - parseInt(months));

    const records = await Indicator.findAll({
      where: {
        user_id:       userId,
        indicator_key: indicatorKey,
        record_date:   { [Op.gte]: startDate.toISOString().slice(0, 10) },
      },
      order: [['record_date', 'ASC']],
      attributes: ['value', 'unit', 'record_date', 'is_abnormal', 'normal_min', 'normal_max', 'reference_range'],
    });

    if (!records.length) return res.json({ code: 0, data: { records: [] } });

    // 简单趋势分析文字
    const vals = records.map(r => r.value);
    const latest  = vals[vals.length - 1];
    const first   = vals[0];
    const trend   = latest > first * 1.05 ? '上升' : latest < first * 0.95 ? '下降' : '平稳';
    const abnCnt  = records.filter(r => r.is_abnormal).length;
    const unit    = records[0].unit;
    const label   = indicatorKey;

    const trendSummary = `近${months}个月您的${label}整体呈${trend}趋势（${first}→${latest} ${unit}）` +
      (abnCnt ? `，其中${abnCnt}次记录偏高，建议关注。` : '，保持在正常范围内，继续保持良好习惯。');

    res.json({
      code: 0,
      data: {
        records: records.map(r => ({ date: r.record_date, value: r.value, unit: r.unit, isAbnormal: r.is_abnormal })),
        normalMin:    records[0].normal_min,
        normalMax:    records[0].normal_max,
        referenceRange: records[0].reference_range,
        trendSummary,
      },
    });
  } catch (e) { next(e); }
});

module.exports = router;

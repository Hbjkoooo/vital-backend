/**
 * routes/goal.js
 * 健康目标与打卡接口（论文功能4：健康管理与智能问答支持模块）
 *
 * POST /api/goal                 - 创建目标
 * PUT  /api/goal/:id             - 编辑目标
 * GET  /api/goal/list            - 获取目标列表
 * POST /api/goal/:id/archive     - 归档目标
 * POST /api/goal/task/:taskId/checkin  - 打卡
 * GET  /api/goal/today           - 今日打卡任务
 * GET  /api/goal/trend           - 打卡趋势（14天热图）
 */
const express = require('express');
const router  = express.Router();
const { Op } = require('sequelize');
const { HealthGoal, GoalTask, CheckinRecord } = require('../db/models');

// ── 创建目标（支持 AI 推荐来源 source:'ai' 和用户自建 source:'user'）
router.post('/', async (req, res, next) => {
  try {
    const { userId, title, description, targetDays = 30, tasks = [], source = 'user' } = req.body;
    if (!title) return res.status(400).json({ code: -1, msg: '目标名称不能为空' });

    const goal = await HealthGoal.create({ user_id: userId, title, description, target_days: targetDays, source });

    if (tasks.length) {
      await GoalTask.bulkCreate(
        tasks.map((t, i) => ({ goal_id: goal.id, user_id: userId, title: t.title, frequency: t.frequency || '每天', sort_order: i }))
      );
    }

    const fullGoal = await HealthGoal.findByPk(goal.id, { include: [{ model: GoalTask, as: 'tasks' }] });
    res.json({ code: 0, data: fullGoal });
  } catch (e) { next(e); }
});

// ── 编辑目标（编辑后 source 自动变为 'user'，论文要求）
router.put('/:id', async (req, res, next) => {
  try {
    const { title, description, targetDays, tasks } = req.body;
    await HealthGoal.update(
      { title, description, target_days: targetDays, source: 'user' },
      { where: { id: req.params.id } }
    );
    if (tasks) {
      await GoalTask.destroy({ where: { goal_id: req.params.id } });
      await GoalTask.bulkCreate(
        tasks.map((t, i) => ({ goal_id: req.params.id, user_id: req.body.userId, title: t.title, frequency: t.frequency || '每天', sort_order: i }))
      );
    }
    const updated = await HealthGoal.findByPk(req.params.id, { include: [{ model: GoalTask, as: 'tasks' }] });
    res.json({ code: 0, data: updated });
  } catch (e) { next(e); }
});

// ── 目标列表
router.get('/list', async (req, res, next) => {
  try {
    const { userId, status = 'active' } = req.query;
    const goals = await HealthGoal.findAll({
      where:   { user_id: userId, status },
      include: [{ model: GoalTask, as: 'tasks' }],
      order:   [['created_at', 'DESC']],
    });
    res.json({ code: 0, data: goals });
  } catch (e) { next(e); }
});

// ── 归档目标
router.post('/:id/archive', async (req, res, next) => {
  try {
    await HealthGoal.update({ status: 'archived' }, { where: { id: req.params.id } });
    res.json({ code: 0 });
  } catch (e) { next(e); }
});

// ── 任务打卡（幂等：同天多次打卡不重复）
router.post('/task/:taskId/checkin', async (req, res, next) => {
  try {
    const { taskId }    = req.params;
    const { userId, goalId, note = '', done = true } = req.body;
    const today = new Date().toISOString().slice(0, 10);

    const [record, created] = await CheckinRecord.findOrCreate({
      where: { user_id: userId, task_id: taskId, checkin_date: today },
      defaults: { goal_id: goalId, done, note },
    });

    if (!created && record.done !== done) {
      await record.update({ done, note });
    }

    res.json({ code: 0, data: { record, created } });
  } catch (e) { next(e); }
});

// ── 今日打卡任务列表（首页打卡模块用）
router.get('/today', async (req, res, next) => {
  try {
    const { userId } = req.query;
    const today = new Date().toISOString().slice(0, 10);

    const goals = await HealthGoal.findAll({
      where:   { user_id: userId, status: 'active' },
      include: [{ model: GoalTask, as: 'tasks' }],
    });

    // 查今日打卡记录
    const taskIds = goals.flatMap(g => g.tasks.map(t => t.id));
    const checkins = await CheckinRecord.findAll({
      where: { user_id: userId, task_id: { [Op.in]: taskIds }, checkin_date: today },
    });
    const doneSet = new Set(checkins.filter(c => c.done).map(c => c.task_id));

    // 整合成平铺任务列表
    const todayTasks = goals.flatMap(goal =>
      goal.tasks.map(task => ({
        _id:       task.id,
        title:     task.title,
        goalTitle: goal.title,
        source:    goal.source,
        done:      doneSet.has(task.id),
      }))
    );

    res.json({ code: 0, data: todayTasks });
  } catch (e) { next(e); }
});

// ── 打卡趋势（近 N 天热图，论文要求：统计与可视化）
router.get('/trend', async (req, res, next) => {
  try {
    const { userId, days = 14 } = req.query;

    // 生成近 N 天日期列表
    const dateList = [];
    for (let i = parseInt(days) - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dateList.push(d.toISOString().slice(0, 10));
    }

    const records = await CheckinRecord.findAll({
      where: { user_id: userId, checkin_date: { [Op.in]: dateList }, done: true },
      attributes: ['checkin_date'],
    });

    const doneSet = new Set(records.map(r => r.checkin_date));
    const today   = new Date().toISOString().slice(0, 10);

    const heatmap = dateList.map(date => ({
      date,
      dayLabel: date.slice(5),  // MM-DD
      done:     doneSet.has(date),
      isToday:  date === today,
    }));

    const streakDays = calcStreak(dateList, doneSet);

    res.json({ code: 0, data: { heatmap, streakDays, totalDone: doneSet.size } });
  } catch (e) { next(e); }
});

// 连续打卡天数计算
const calcStreak = (dateList, doneSet) => {
  let streak = 0;
  const sorted = [...dateList].reverse();
  for (const date of sorted) {
    if (doneSet.has(date)) streak++;
    else break;
  }
  return streak;
};

module.exports = router;

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
const { HealthProfile, Indicator, ChatSession, ChatMessage, Report } = require('../db/models');
const { HealthGoal, GoalTask, CheckinRecord } = require('../db/models');
const { chatForGoalSetup, finalizeGoals } = require('../chains/chatChain');

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
// ── 单独新增任务
router.post('/:goalId/task', async (req, res, next) => {
  try {
    const { userId, title, frequency = '每天', source = 'user' } = req.body
    const task = await GoalTask.create({
      goal_id: req.params.goalId,
      user_id: userId,
      title,
      frequency,
      source,
    })
    res.json({ code: 0, data: task })
  } catch (e) { next(e) }
})

// ── 单独编辑任务（编辑后 source 自动变 user）
router.put('/task/:taskId', async (req, res, next) => {
  try {
    const { title, frequency, source = 'user' } = req.body
    await GoalTask.update({ title, frequency, source }, { where: { id: req.params.taskId } })
    const task = await GoalTask.findByPk(req.params.taskId)
    res.json({ code: 0, data: task })
  } catch (e) { next(e) }
})

// ── 单独删除任务
router.delete('/task/:taskId', async (req, res, next) => {
  try {
    await GoalTask.destroy({ where: { id: req.params.taskId } })
    res.json({ code: 0, msg: '删除成功' })
  } catch (e) { next(e) }
})
// ── 任务打卡（幂等：同天多次打卡不重复）
router.post('/task/:taskId/checkin', async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const { userId, note = '', done = true } = req.body;
    const today = new Date().toISOString().slice(0, 10);

    // ✅ 自动从 task 查 goalId
    const task = await GoalTask.findByPk(taskId);
    if (!task) return res.status(404).json({ code: -1, msg: '任务不存在' });
    const goalId = task.goal_id;

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
      goal.tasks 
      .filter(task => shouldShowToday(task.frequency))       
      .map(task => ({
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
// ── AI目标推荐对话
router.post('/chat', async (req, res, next) => {
  try {
    const { userId, sessionId, message, isInit } = req.body

    // 获取或创建 goal session
    let session
    if (sessionId) {
      session = await ChatSession.findByPk(sessionId)
    }
    if (!session) {
      session = await ChatSession.create({
        user_id: userId,
        session_type: 'goal',
        title: 'AI目标推荐',
      })
    }

    // 拉取对话历史
    const history = await ChatMessage.findAll({
      where: { session_id: session.id },
      order: [['createdAt', 'ASC']],
      limit: 20,
    })

    const [profile, abnormalIndicators, existingGoals, recentReports] = await Promise.all([
      HealthProfile.findOne({ where: { user_id: userId } }),
      Indicator.findAll({
        where: { user_id: userId, is_abnormal: true },
        order: [['record_date', 'DESC']],
        limit: 10,
      }),
      HealthGoal.findAll({
        where: { user_id: userId, status: 'active' },
        include: [{ model: GoalTask, as: 'tasks' }],
      }),
      Report.findAll({
        where: { user_id: userId },
        order: [['report_date', 'DESC']],
        limit: 2,
        attributes: ['report_date', 'chief_complaint'],
      }),
    ]);
    
    const chiefComplaints = recentReports
      .filter(r => r.chief_complaint)
      .map(r => `${r.report_date}：${r.chief_complaint}`)
      .join('\n') || '暂无';

      const goalContext = {
        userProfile: profile || {},
        abnormalIndicators,
        existingGoals,
        chiefComplaints,
      };

    let reply
    let hasProposal = false
    let proposal = null
    if (isInit) {
      reply = `你好！我是你的健康目标助手 🌱\n\n我会根据你的身体状况，帮你制定一个真正适合你的健康计划。\n\n你最想从哪个方面开始改善？\n• 饮食习惯\n• 运动锻炼\n• 作息睡眠\n• 针对体检异常指标\n\n直接告诉我，或者说说你最近身体上有什么困扰也行 😊`;
    
      await ChatMessage.create({
        session_id: session.id,
        role: 'assistant',
        content: reply,
      });
    
      await ChatSession.update(
        { last_active: new Date() },
        { where: { id: session.id } }
      );
    
      return res.json({
        code: 0,
        data: { reply, sessionId: session.id, hasProposal: false, proposal: null },
      });
    }
  else {
    // 存用户消息
    await ChatMessage.create({
      session_id: session.id,
      role: 'user',
      content: message,
    })
  
    // 拉取最新历史（含刚存的用户消息）
    const msgCount = history.length
  
    // 用户主动要求生成目标
    const userWantsGoal = ['生成目标', '生成吧', '可以了', '差不多了', '开始吧', '确认', '好了', '生成', '给我生成'].some(kw => message.includes(kw))
  
    if (userWantsGoal) {
      try {
        const allHistory = [...history, { role: 'user', content: message }]
        const goals = await finalizeGoals(allHistory, goalContext)
        if (goals?.length) {
          hasProposal = true
          proposal = goals[0]
          reply = '好的，我已经为你整理好了健康目标方案，点击下方按钮查看并添加！'
        } else {
          reply = await chatForGoalSetup(message, history, goalContext)
        }
      } catch (e) {
        console.error('finalizeGoals error', e)
        reply = await chatForGoalSetup(message, history, goalContext)
      }
    } else {
      reply = await chatForGoalSetup(message, history, goalContext)
  
      // 宽松判断是否顺带触发
      // 改后
const goalKeywords = ['为你生成目标方案', '生成目标方案', '来为你生成']
      if (goalKeywords.some(kw => reply.includes(kw))) {
        try {
          const allHistory = [...history, { role: 'user', content: message }, { role: 'assistant', content: reply }]
          const goals = await finalizeGoals(allHistory, goalContext)
          if (goals?.length) {
            hasProposal = true
            proposal = goals[0]
          }
        } catch (e) {
          console.error('finalizeGoals error', e)
        }
      }
    }
  }

    // 存AI回复
    await ChatMessage.create({
      session_id: session.id,
      role: 'assistant',
      content: reply,
    })

    await ChatSession.update(
      { last_active: new Date() },
      { where: { id: session.id } }
    )

    res.json({
      code: 0,
      data: {
        reply,
        sessionId: session.id,
        hasProposal,
        proposal,
      },
    })
  } catch (e) { next(e) }
})

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
router.delete('/:id', async (req, res, next) => {
  try {
    // 同时删除关联任务和打卡记录
    await GoalTask.destroy({ where: { goal_id: req.params.id } })
    await HealthGoal.destroy({ where: { id: req.params.id } })
    res.json({ code: 0, msg: '删除成功' })
  } catch (e) { next(e) }
})

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

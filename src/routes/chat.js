/**
 * routes/chat.js
 * 对话接口（三种模式）
 *
 * POST /api/chat/report          - 报告对话（发消息）
 * POST /api/chat/assistant       - 日常助手（发消息）
 * POST /api/chat/goal            - 目标设置引导对话
 * POST /api/chat/goal/finalize   - 生成结构化目标 JSON
 * POST /api/chat/session         - 创建新 session
 * GET  /api/chat/sessions        - 获取 session 列表
 * GET  /api/chat/session/:id/messages - 获取消息历史
 */
const express = require('express');
const router  = express.Router();
const { ChatSession, ChatMessage, Indicator, HealthProfile, Report } = require('../db/models');
const { chatWithReport, chatWithAssistant, chatForGoalSetup, finalizeGoals } = require('../chains/chatChain');
const { indicatorsToText } = require('../parsers/indicatorParser');

// ── 工具：保存消息 ─────────────────────────────────────────────
const saveMessages = async (sessionId, userInput, aiReply) => {
  await ChatMessage.bulkCreate([
    { session_id: sessionId, role: 'user',      content: userInput },
    { session_id: sessionId, role: 'assistant', content: aiReply  },
  ]);
  await ChatSession.update({ last_active: new Date() }, { where: { id: sessionId } });
};

// ── 工具：构建历史消息数组 ─────────────────────────────────────
const buildHistory = async (sessionId, limit = 10) => {
  const msgs = await ChatMessage.findAll({
    where: { session_id: sessionId },
    order: [['created_at', 'DESC']],
    limit,
  });
  return msgs.reverse().map(m => ({ role: m.role, content: m.content }));
};

// ── 报告对话 ──────────────────────────────────────────────────
router.post('/report', async (req, res, next) => {
  try {
    const { input, sessionId, reportId, userId } = req.body;
    if (!input?.trim()) return res.status(400).json({ code: -1, msg: '消息不能为空' });

    const [history, report, profile] = await Promise.all([
      buildHistory(sessionId),
      Report.findByPk(reportId, { include: [{ model: require('../db/models').Indicator, as: 'indicators' }] }),
      HealthProfile.findOne({ where: { user_id: userId } }),
    ]);

    const reply = await chatWithReport(input, history, {
      indicators:    report?.indicators || [],
      reportSummary: report?.summary || '',
      userProfile:   profile || {},
    });

    if (sessionId) await saveMessages(sessionId, input, reply);

    res.json({ code: 0, data: { reply } });
  } catch (e) { next(e); }
});

// ── 日常助手对话 ──────────────────────────────────────────────
router.post('/assistant', async (req, res, next) => {
  try {
    const { input, sessionId, userId } = req.body;
    if (!input?.trim()) return res.status(400).json({ code: -1, msg: '消息不能为空' });

    const [history, profile, recentIndicators] = await Promise.all([
      sessionId ? buildHistory(sessionId) : Promise.resolve([]),
      HealthProfile.findOne({ where: { user_id: userId } }),
      Indicator.findAll({
        where:  { user_id: userId },
        order:  [['record_date', 'DESC']],
        limit:  30,
      }),
    ]);

    const reply = await chatWithAssistant(input, history, {
      userProfile:       profile || {},
      recentIndicators,
    });

    if (sessionId) await saveMessages(sessionId, input, reply);

    res.json({ code: 0, data: { reply } });
  } catch (e) { next(e); }
});

// ── 目标设置对话 ──────────────────────────────────────────────
router.post('/goal', async (req, res, next) => {
  try {
    const { input, history = [], userId } = req.body;
    if (!input?.trim()) return res.status(400).json({ code: -1, msg: '消息不能为空' });

    const [profile, abnormals] = await Promise.all([
      HealthProfile.findOne({ where: { user_id: userId } }),
      Indicator.findAll({ where: { user_id: userId, is_abnormal: true }, order: [['record_date', 'DESC']], limit: 10 }),
    ]);

    const reply = await chatForGoalSetup(input, history, {
      userProfile:        profile || {},
      abnormalIndicators: abnormals,
    });

    res.json({ code: 0, data: { reply } });
  } catch (e) { next(e); }
});

// ── 生成结构化目标 ─────────────────────────────────────────────
router.post('/goal/finalize', async (req, res, next) => {
  try {
    const { history = [], userId } = req.body;
    const [profile, abnormals] = await Promise.all([
      HealthProfile.findOne({ where: { user_id: userId } }),
      Indicator.findAll({ where: { user_id: userId, is_abnormal: true }, limit: 5 }),
    ]);

    const goals = await finalizeGoals(history, { userProfile: profile || {}, abnormalIndicators: abnormals });
    res.json({ code: 0, data: { goals } });
  } catch (e) { next(e); }
});

// ── Session 管理 ──────────────────────────────────────────────
router.post('/session', async (req, res, next) => {
  try {
    const { userId, sessionType, reportId, templateId, title } = req.body;
    const session = await ChatSession.create({
      user_id: userId, session_type: sessionType,
      report_id: reportId, template_id: templateId || 'comprehensive',
      title: title || '新对话',
    });
    res.json({ code: 0, data: session });
  } catch (e) { next(e); }
});

router.get('/sessions', async (req, res, next) => {
  try {
    const { userId, sessionType, reportId } = req.query;
    const where = { user_id: userId };
    if (sessionType) where.session_type = sessionType;
    if (reportId)    where.report_id    = reportId;
    const sessions = await ChatSession.findAll({ where, order: [['last_active', 'DESC']], limit: 30 });
    res.json({ code: 0, data: sessions });
  } catch (e) { next(e); }
});

router.get('/session/:id/messages', async (req, res, next) => {
  try {
    const msgs = await ChatMessage.findAll({
      where: { session_id: req.params.id },
      order: [['created_at', 'ASC']],
    });
    res.json({ code: 0, data: msgs });
  } catch (e) { next(e); }
});

module.exports = router;

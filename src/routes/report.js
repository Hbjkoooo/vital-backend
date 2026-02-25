/**
 * routes/report.js
 * 体检报告接口
 *
 * POST /api/report/ocr        - OCR 识别（上传 PDF 文件）
 * POST /api/report/analyze    - AI 指标提取（传 rawText）
 * POST /api/report/generate   - 生成/缓存健康分析报告
 * POST /api/report/:id/confirm- 用户确认/修正指标（论文要求）
 * GET  /api/report/list       - 用户报告列表
 * GET  /api/report/:id        - 报告详情
 */
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const { Report, Indicator, HealthProfile } = require('../db/models');
const { extractIndicators, generateReport } = require('../chains/reportChain');
const { filterKeyIndicators }               = require('../parsers/indicatorParser');
const { ocrPdf }                            = require('../utils/ocr');

// multer 配置：PDF 存到系统临时目录
const upload = multer({
  dest: path.join(os.tmpdir(), 'vitalic-uploads'),
  limits: { fileSize: 20 * 1024 * 1024 }, // 最大 20MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('只支持 PDF 文件'));
    }
  },
});

// ── OCR 识别 ──────────────────────────────────────────────────
router.post('/ocr', upload.single('file'), async (req, res, next) => {
  const tmpPath = req.file?.path;
  try {
    if (!req.file) return res.status(400).json({ code: -1, msg: '请上传 PDF 文件' });

    const { reportId } = req.body;
    if (reportId) await Report.update({ status: 'ocr_running' }, { where: { id: reportId } });

    const rawText = await ocrPdf(tmpPath);

    if (reportId) await Report.update({ raw_text: rawText, status: 'ocr_done' }, { where: { id: reportId } });

    res.json({ code: 0, data: { rawText, reportId } });
  } catch (e) {
    if (req.body?.reportId) await Report.update({ status: 'failed', error_msg: e.message }, { where: { id: req.body.reportId } }).catch(() => {});
    next(e);
  } finally {
    // 用完删掉临时文件
    if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
});

// ── AI 指标提取 ───────────────────────────────────────────────
router.post('/analyze', async (req, res, next) => {
  try {
    const { rawText, reportId, userId } = req.body;
    if (!rawText) return res.status(400).json({ code: -1, msg: '缺少 rawText' });

    const indicators    = await extractIndicators(rawText);
    const keyIndicators = filterKeyIndicators(indicators);
    const abnormalList  = indicators.filter(i => i.isAbnormal);

    // 关键指标写库（趋势追踪）
    if (reportId && userId && keyIndicators.length) {
      const report     = await Report.findByPk(reportId);
      const recordDate = report?.report_date || new Date().toISOString().slice(0, 10);
      await Indicator.bulkCreate(
        keyIndicators.map(ind => ({
          user_id: userId, report_id: reportId,
          indicator_key: ind.key, indicator_label: ind.label,
          value: ind.value, unit: ind.unit,
          reference_range: ind.referenceRange,
          normal_min: ind.normalMin, normal_max: ind.normalMax,
          is_abnormal: ind.isAbnormal, record_date: recordDate,
        })),
        { ignoreDuplicates: true }
      );
    }

    if (reportId) await Report.update({ status: 'analyzed' }, { where: { id: reportId } });

    res.json({ code: 0, data: { reportId, indicators, keyIndicators, abnormalList } });
  } catch (e) { next(e); }
});

// ── 生成健康分析报告 ──────────────────────────────────────────
router.post('/generate', async (req, res, next) => {
  try {
    const { reportId, userId, templateId = 'comprehensive' } = req.body;
    if (!reportId) return res.status(400).json({ code: -1, msg: '缺少 reportId' });

    const report = await Report.findByPk(reportId, { include: [{ model: Indicator, as: 'indicators' }] });
    if (!report) return res.status(404).json({ code: -1, msg: '报告不存在' });;

    // 命中缓存
    if (report.report_cache?.[templateId]) {
      return res.json({ code: 0, data: { ...report.report_cache[templateId], reportId, cached: true } });
    }

    const profile = await HealthProfile.findOne({ where: { user_id: userId || report.user_id } });
    const { markdown, summary, healthScore } = await generateReport(report.indicators, profile || {}, templateId);

    const newCache = { ...(report.report_cache || {}), [templateId]: { markdown, summary, healthScore, generatedAt: new Date() } };
    await report.update({ report_cache: newCache, summary: report.summary || summary, health_score: report.health_score || healthScore, status: 'report_ready' });

    res.json({ code: 0, data: { reportId, templateId, markdown, summary, healthScore } });
  } catch (e) { next(e); }
});

// ── 用户确认/修正指标 ─────────────────────────────────────────
router.post('/:id/confirm', async (req, res, next) => {
  try {
    const { corrections = [] } = req.body;
    for (const c of corrections) {
      await Indicator.update(
        { value: c.newValue, is_abnormal: c.isAbnormal ?? false },
        { where: { report_id: req.params.id, indicator_key: c.indicatorKey } }
      );
    }
    // 修正后清空报告缓存，下次重新生成
    await Report.update({ report_cache: {} }, { where: { id: req.params.id } });
    res.json({ code: 0, msg: '指标已更新，下次查看将重新生成报告' });
  } catch (e) { next(e); }
});

// ── 报告列表 & 详情 ───────────────────────────────────────────
router.get('/list', async (req, res, next) => {
  try {
    const reports = await Report.findAll({
      where: { user_id: req.query.userId },
      order: [['report_date', 'DESC']],
      attributes: ['id', 'title', 'report_date', 'hospital', 'status', 'summary', 'health_score'],
    });
    res.json({ code: 0, data: reports });
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const report = await Report.findByPk(req.params.id, { include: [{ model: Indicator, as: 'indicators' }] });
    if (!report) return res.status(404).json({ code: -1, msg: '报告不存在' });
    res.json({ code: 0, data: report });
  } catch (e) { next(e); }
});

module.exports = router;

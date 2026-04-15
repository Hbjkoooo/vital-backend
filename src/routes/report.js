/**
 * routes/report.js
 * 体检报告接口
 *
 * POST /api/report/ocr-by-url - OCR 识别（传 tempUrl，后端自行下载 PDF）★ 新增
 * POST /api/report/ocr        - OCR 识别（上传 PDF 文件，旧接口保留）
 * POST /api/report/analyze    - AI 指标提取（传 rawText）
 * POST /api/report/generate   - 生成/缓存健康分析报告
 * POST /api/report/:id/confirm- 用户确认/修正指标（论文要求）
 * GET  /api/report/list       - 用户报告列表
 * GET  /api/report/:id        - 报告详情
 */
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const axios   = require('axios');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const { KEY_INDICATOR_KEYS } = require('../parsers/indicatorParser');
const { Report, Indicator, HealthProfile } = require('../db/models');
const { extractIndicators, generateReport } = require('../chains/reportChain');
const { filterKeyIndicators }               = require('../parsers/indicatorParser');
const { ocrPdf }                            = require('../utils/ocr');

// ── 文本脱敏：去除患者个人敏感信息 ──────────────────────────
const desensitize = (text) => {
  return text
    .replace(/1[3-9]\d{9}/g, '***********')                    // 手机号
    .replace(/(体检号[\s_：:]*)[\d]+/g, '$1**********')         // 体检号
    .replace(/(姓\s*名[\s：:]*)[^\s\n，,。]+/g, '$1***')       // 患者姓名
    .replace(/\d{17}[\dXx]/g, '******************');           // 身份证号
};

// multer 配置：PDF 存到系统临时目录
const upload = multer({
  dest: path.join(os.tmpdir(), 'vitalic-uploads'),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('只支持 PDF 文件'));
    }
  },
});

// ── 创建报告记录 ──────────────────────────────────────────────
router.post('/create', async (req, res, next) => {
  try {
    const { userId, fileId, reportDate, hospital, title } = req.body;
    if (!userId) return res.status(400).json({ code: -1, msg: '缺少 userId' });

    const report = await Report.create({
      user_id:     userId,
      file_id:     fileId || '',
      report_date: reportDate || new Date().toISOString().slice(0, 10),
      hospital:    hospital || '',
      title:       title || '体检报告',
      status:      'pending',
    });

    res.json({ code: 0, data: { reportId: report.id } });
  } catch (e) { next(e); }
});

// ── OCR 识别 ──────────────────────────────────────────────────
router.post('/ocr', upload.single('file'), async (req, res, next) => {
  const tmpPath = req.file?.path;
  try {
    if (!req.file) return res.status(400).json({ code: -1, msg: '请上传 PDF 文件' });

    const { reportId } = req.body;
    if (reportId) await Report.update({ status: 'ocr_running' }, { where: { id: reportId } });

    // ✅ 立即返回，不等 OCR 完成
    res.json({ code: 0, data: { reportId, status: 'ocr_running' } });

    // ✅ 异步跑 OCR
    (async () => {
      try {
        const rawText = desensitize(await ocrPdf(tmpPath));
        await Report.update({ raw_text: rawText, status: 'ocr_done' }, { where: { id: reportId } });
      } catch (e) {
        await Report.update({ status: 'failed', error_msg: e.message }, { where: { id: reportId } }).catch(() => {});
      } finally {
        if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      }
    })();

  } catch (e) {
    if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath).catch?.(() => {});
    next(e);
  }
});


// ── OCR 识别（新接口）- 前端传 tempUrl，后端自行下载 PDF ────────
router.post('/ocr-by-url', async (req, res, next) => {
  const { reportId, tempUrl } = req.body;
  if (!tempUrl)  return res.status(400).json({ code: -1, msg: '缺少 tempUrl' });
  if (!reportId) return res.status(400).json({ code: -1, msg: '缺少 reportId' });

  try {
    await Report.update({ status: 'ocr_running' }, { where: { id: reportId } });

    // 立即返回，不等 OCR 完成
    res.json({ code: 0, data: { reportId, status: 'ocr_running' } });

    // 异步：下载 PDF → OCR
    (async () => {
      let tmpPath = null;
      try {
        const tmpDir = path.join(os.tmpdir(), 'vitalic-uploads');
        fs.mkdirSync(tmpDir, { recursive: true });
        tmpPath = path.join(tmpDir, `${Date.now()}.pdf`);

        const response = await axios.get(tempUrl, {
          responseType: 'arraybuffer',
          timeout: 30000,
        });
        fs.writeFileSync(tmpPath, response.data);
        console.log(`[ocr-by-url] PDF 下载完成: ${tmpPath}`);

        const rawText = desensitize(await ocrPdf(tmpPath));
        await Report.update(
          { raw_text: rawText, status: 'ocr_done' },
          { where: { id: reportId } }
        );
        console.log(`[ocr-by-url] OCR 完成, reportId=${reportId}`);
      } catch (e) {
        console.error('[ocr-by-url] 失败:', e.message);
        await Report.update(
          { status: 'failed', error_msg: e.message },
          { where: { id: reportId } }
        ).catch(() => {});
      } finally {
        if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      }
    })();

  } catch (e) { next(e); }
});

// ── AI 指标提取 ───────────────────────────────────────────────
router.post('/analyze', async (req, res, next) => {
  try {
    const { rawText, reportId, userId } = req.body;
    if (!rawText) return res.status(400).json({ code: -1, msg: '缺少 rawText' });
    console.log('[analyze] 开始提取指标, rawText长度:', rawText.length);

   // 改后
const { indicators, chiefComplaints } = await extractIndicators(rawText);
    console.log('[analyze] 提取完成, 指标数量:', indicators.length,chiefComplaints);

    const keyIndicators = filterKeyIndicators(indicators);
    const abnormalList  = indicators.filter(i => i.isAbnormal);

    if (reportId && userId && indicators.length) {
      const report     = await Report.findByPk(reportId);
      const recordDate = report?.report_date || new Date().toISOString().slice(0, 10);
      await Indicator.bulkCreate(
        indicators.map(ind => ({
          user_id:         userId,
          report_id:       reportId,
          indicator_key:   ind.key,
          indicator_label: ind.label,
          value:           ind.value,
          unit:            ind.unit,
          reference_range: ind.referenceRange,
          normal_min:      ind.normalMin,
          normal_max:      ind.normalMax,
          is_abnormal:     ind.isAbnormal,
          record_date:     recordDate,
          is_core:         KEY_INDICATOR_KEYS.has(ind.key),
        })),
        { ignoreDuplicates: true }
      );
    }

    if (reportId) await Report.update({ 
      status: 'analyzed',
       chief_complaint: chiefComplaints || '',
    }, { where: { id: reportId } });

    res.json({ code: 0, data: { reportId, indicators, keyIndicators, abnormalList } });
  } catch (e) { next(e); }
});

// ── 生成健康分析报告 ──────────────────────────────────────────
router.post('/generate', async (req, res, next) => {
  try {
    const { reportId, userId, templateId = 'comprehensive' } = req.body;
    if (!reportId) return res.status(400).json({ code: -1, msg: '缺少 reportId' });

    const report = await Report.findByPk(reportId, { include: [{ model: Indicator, as: 'indicators' }] });
    if (!report) return res.status(404).json({ code: -1, msg: '报告不存在' });

    // ✅ 命中缓存（改用 template_cache）
    if (report.template_cache?.[templateId]) {
      return res.json({ code: 0, data: { ...report.template_cache[templateId], reportId, cached: true } });
    }

    const profile       = await HealthProfile.findOne({ where: { user_id: userId || report.user_id } });
    const allIndicators = await Indicator.findAll({ where: { report_id: reportId } });
    const { markdown, summary, healthScore } = await generateReport(allIndicators, profile || {}, templateId,report.chief_complaint || '');

    // ✅ 存入 template_cache，风险等级根据 healthScore 自动判断
    const riskLevel = healthScore >= 80 ? 'normal' : healthScore >= 65 ? 'mild' : 'high';
    const newCache  = {
      ...(report.template_cache || {}),
      [templateId]: { markdown, summary, healthScore, generatedAt: new Date() },
    };
    await report.update({
      template_cache:     newCache,
      summary:            report.summary || summary,
      health_score:       report.health_score || healthScore,
      overall_risk_level: report.overall_risk_level === 'normal' ? riskLevel : report.overall_risk_level,
      status:             'report_ready',
    });

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
    // ✅ 修正后清空 template_cache，下次重新生成
    await Report.update({ template_cache: {} }, { where: { id: req.params.id } });
    res.json({ code: 0, msg: '指标已更新，下次查看将重新生成报告' });
  } catch (e) { next(e); }
});

// ── 报告列表 ─────────────────────────────────────────────────
router.get('/list', async (req, res, next) => {
  try {
    const reports = await Report.findAll({
      where:      { user_id: req.query.userId },
      order:      [['report_date', 'DESC']],
      attributes: ['id', 'title', 'report_date', 'hospital', 'status', 'summary', 'health_score', 'overall_risk_level'],
    });
    res.json({ code: 0, data: reports });
  } catch (e) { next(e); }
});

// ── 删除报告 ─────────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const { userId } = req.query;
    const report = await Report.findOne({ where: { id: req.params.id, user_id: userId } });
    if (!report) return res.status(404).json({ code: -1, msg: '报告不存在' });

    await Indicator.destroy({ where: { report_id: req.params.id } });
    await report.destroy();

    res.json({ code: 0, msg: '删除成功' });
  } catch (e) { next(e); }
});

// ── 报告详情 ─────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const report = await Report.findByPk(req.params.id, { include: [{ model: Indicator, as: 'indicators' }] });
    if (!report) return res.status(404).json({ code: -1, msg: '报告不存在' });
    res.json({ code: 0, data: report });
  } catch (e) { next(e); }
});

module.exports = router;
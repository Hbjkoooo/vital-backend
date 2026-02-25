/**
 * 云函数：analyzeReport
 * 完整报告分析流程编排：
 * 1. OCR 识别（调云托管）
 * 2. AI 指标提取（调云托管）
 * 3. 生成健康报告（调云托管）
 * 4. 更新云数据库报告状态（写微信云数据库）
 *
 * 由小程序上传图片后触发（或由 uploadReport 云函数异步触发）
 */
const cloud = require('wx-server-sdk');
const { callServer } = require('./callServer');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { reportId, fileIds, userId } = event;

  // 获取云存储临时下载链接并转 base64
  let base64List = [];
  try {
    const { fileList } = await cloud.getTempFileURL({ fileList: fileIds });
    base64List = await Promise.all(
      fileList.map(async f => {
        const axios = require('axios');
        const res   = await axios.get(f.tempFileURL, { responseType: 'arraybuffer', timeout: 20000 });
        return Buffer.from(res.data).toString('base64');
      })
    );
  } catch (e) {
    await db.collection('reports').doc(reportId).update({ data: { status: 'failed', errorMsg: 'OCR 图片下载失败' } });
    return { code: -1, msg: e.message };
  }

  // Step 1: OCR
  let rawText = '';
  try {
    await db.collection('reports').doc(reportId).update({ data: { status: 'ocr_running' } });
    const ocrResult = await callServer('/api/report/ocr', { base64List, reportId });
    rawText = ocrResult.rawText;
  } catch (e) {
    await db.collection('reports').doc(reportId).update({ data: { status: 'failed', errorMsg: 'OCR 识别失败' } });
    return { code: -1, msg: e.message };
  }

  // Step 2: 指标提取
  let indicators = [], abnormalList = [];
  try {
    await db.collection('reports').doc(reportId).update({ data: { status: 'analyzing' } });
    const analyzeResult = await callServer('/api/report/analyze', { rawText, reportId, userId });
    indicators   = analyzeResult.indicators;
    abnormalList = analyzeResult.abnormalList;
    // 把指标也写进云数据库（小程序端展示用）
    await db.collection('reports').doc(reportId).update({
      data: { indicators, abnormalList, abnormalCount: abnormalList.length, status: 'analyzed' },
    });
  } catch (e) {
    await db.collection('reports').doc(reportId).update({ data: { status: 'failed', errorMsg: '指标提取失败' } });
    return { code: -1, msg: e.message };
  }

  // Step 3: 生成综合报告（comprehensive 模板先跑，其他模板懒生成）
  try {
    await db.collection('reports').doc(reportId).update({ data: { status: 'report_generating' } });
    await callServer('/api/report/generate', { reportId, userId, templateId: 'comprehensive' });
    await db.collection('reports').doc(reportId).update({ data: { status: 'report_ready' } });
  } catch (e) {
    // 报告生成失败不影响指标展示，降级处理
    await db.collection('reports').doc(reportId).update({ data: { status: 'analyzed', errorMsg: '报告生成失败，可手动刷新' } });
  }

  return { code: 0, data: { reportId, abnormalCount: abnormalList.length } };
};

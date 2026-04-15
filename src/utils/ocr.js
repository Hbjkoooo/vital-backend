/**
 * utils/ocr.js
 * 腾讯云 OCR 调用封装
 * 论文要求：第三方 OCR 接口（百度/腾讯云 OCR）
 * 选腾讯云是因为和微信云开发同生态，内网调用更快
 */
const axios  = require('axios');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const { fromPath } = require('pdf2pic');

const REGION   = process.env.TENCENT_OCR_REGION || 'ap-guangzhou';
const HOST     = 'ocr.tencentcloudapi.com';
const SERVICE  = 'ocr';
const VERSION  = '2018-11-19';

/**
 * 腾讯云 API v3 签名
 */
const sign = (secretId, secretKey, payload, timestamp) => {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const credentialScope = `${date}/${SERVICE}/tc3_request`;

  const hashedPayload = crypto.createHash('sha256').update(payload).digest('hex');
  const canonicalRequest = [
    'POST',
    '/',
    '',
    `content-type:application/json\nhost:${HOST}\n`,
    'content-type;host',
    hashedPayload,
  ].join('\n');

  const stringToSign = [
    'TC3-HMAC-SHA256',
    timestamp,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');
  const hmac = (key, msg) => crypto.createHmac('sha256', key).update(msg).digest();
  const signingDate    = hmac('TC3' + secretKey, date);
  const signingService = hmac(signingDate, SERVICE);
  const signingFinal   = hmac(signingService, 'tc3_request');
  const signature      = crypto.createHmac('sha256', signingFinal).update(stringToSign).digest('hex');
  
  return `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=content-type;host, Signature=${signature}`;}

/**
 * 调用腾讯云通用印刷体 OCR
 * @param {string} imageBase64 - 图片 base64（不含 data:image 前缀）
 * @returns {string} 识别出的完整文本
 */
const ocrImage = async (imageBase64) => {
  const action    = 'GeneralAccurateOCR';
  const timestamp = Math.floor(Date.now() / 1000);
  const payload   = JSON.stringify({ ImageBase64: imageBase64 });

  const authorization = sign(
    process.env.TENCENT_SECRET_ID,
    process.env.TENCENT_SECRET_KEY,
    payload,
    timestamp
  );

  const res = await axios.post(`https://${HOST}`, payload, {
    headers: {
      'Content-Type':   'application/json',
      'Host':           HOST,
      'X-TC-Action':    action,
      'X-TC-Version':   VERSION,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region':    REGION,
      'Authorization':  authorization,
    },
    timeout: 30000,
  });

  const data = res.data?.Response;
  if (data?.Error) throw new Error(`OCR 错误: ${data.Error.Code} - ${data.Error.Message}`);

  // 拼接所有识别结果
  return (data?.TextDetections || []).map(t => t.DetectedText).join('\n');
};

/**
 * 支持多图（体检报告可能多页）
 * @param {string[]} base64List
 * @returns {string} 合并文本
 */
const ocrMultipleImages = async (base64List) => {
  const results = await Promise.all(base64List.map(b64 => ocrImage(b64)));
  return results.join('\n\n--- 下一页 ---\n\n');
};

/**
 * PDF 文件 → OCR 文本
 * 流程：PDF 每页转 PNG → base64 → 逐页调 OCR → 合并文本
 * @param {string} pdfPath - PDF 文件的本地绝对路径
 * @returns {string} 所有页识别出的完整文本
 */
const ocrPdf = async (pdfPath) => {
  const tmpDir = path.join(os.tmpdir(), 'vitalic-ocr-' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  const convert = fromPath(pdfPath, {
    density: 200,
    saveFilename: 'page',
    savePath: tmpDir,
    format: 'png',
    width: 2480,
    height: 3508,
  });

  const results = await convert.bulk(-1, { responseType: 'image' });

  if (!results || results.length === 0) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw new Error('PDF 转图片失败，请确认文件是否损坏');
  }

  console.log(`[OCR] PDF 共 ${results.length} 页，开始并行识别...`);

  // 并行识别所有页，保持页码顺序
  const pageTexts = await Promise.all(
    results.map(async (result, i) => {
      const imgPath = result.path;
      if (!imgPath || !fs.existsSync(imgPath)) {
        console.warn(`[OCR] 第 ${i + 1} 页图片不存在，跳过`);
        return '';
      }
      const base64 = fs.readFileSync(imgPath).toString('base64');
      console.log(`[OCR] 并行识别第 ${i + 1}/${results.length} 页...`);
      const text = await ocrImage(base64);
      console.log(`[OCR] 第 ${i + 1} 页完成`);
      return text;
    })
  );

  // 全部识别完再删
  fs.rmSync(tmpDir, { recursive: true, force: true });

  return pageTexts.join('\n\n--- 下一页 ---\n\n');
};

module.exports = { ocrImage, ocrMultipleImages, ocrPdf };

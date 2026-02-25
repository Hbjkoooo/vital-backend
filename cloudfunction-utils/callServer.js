/**
 * 微信云函数通用工具：callServer.js
 * 云函数内部调用云托管服务（内网，无需外网地址）
 *
 * 使用方式：在任意云函数中 require 此工具
 * const { callServer } = require('./callServer');
 * const data = await callServer('/api/report/analyze', { rawText, reportId, userId });
 */
const axios = require('axios');

// 云托管服务名（在微信云托管控制台配置）
// 内网地址格式：http://<服务名>（云托管内网域名，无需外网）
const SERVER_BASE = process.env.SERVER_BASE_URL || 'http://vitalic-server';
const INTERNAL_KEY = process.env.INTERNAL_API_KEY || 'vitalic-internal-2024';

const callServer = async (path, body = {}, options = {}) => {
  const { timeout = 55000, method = 'POST' } = options; // 55s < 云函数60s超时

  try {
    const res = await axios({
      method,
      url:     `${SERVER_BASE}${path}`,
      data:    method !== 'GET' ? body : undefined,
      params:  method === 'GET' ? body : undefined,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key':    INTERNAL_KEY,
      },
      timeout,
    });

    if (res.data?.code !== 0) {
      throw new Error(res.data?.msg || '服务调用失败');
    }
    return res.data.data;
  } catch (err) {
    if (err.code === 'ECONNABORTED') {
      throw new Error('AI 服务响应超时，请稍后重试');
    }
    throw err;
  }
};

module.exports = { callServer };

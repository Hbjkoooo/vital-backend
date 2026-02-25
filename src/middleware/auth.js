/**
 * middleware/auth.js
 * 简单内部鉴权：云函数调用云托管时带上 x-api-key header
 * 防止接口被外部直接访问
 */
const auth = (req, res, next) => {
  // 开发环境跳过
  if (process.env.NODE_ENV === 'development') return next();

  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ code: 401, msg: 'Unauthorized' });
  }
  next();
};

module.exports = auth;

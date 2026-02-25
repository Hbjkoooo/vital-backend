const auth = (req, res, next) => {
  if (process.env.NODE_ENV === 'development') return next();

  // 云托管会自动为来自小程序的请求注入 x-wx-openid
  const openid = req.headers['x-wx-openid'];
  if (openid) return next();

  return res.status(401).json({ code: 401, msg: 'Unauthorized' });
};

module.exports = auth;

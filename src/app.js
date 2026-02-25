require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { connect, sequelize } = require('./db/index');
require('./db/models');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV === 'production') {
  app.use(require('./middleware/auth'));
}

app.use('/api/user',   require('./routes/user'));
app.use('/api/report', require('./routes/report'));
app.use('/api/chat',   require('./routes/chat'));
app.use('/api/goal',   require('./routes/goal'));
app.use('/api/health', require('./routes/health'));

app.get('/ping', (req, res) => res.json({ ok: true, ts: Date.now(), env: process.env.NODE_ENV }));

app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  const isTimeout = err.code === 'ETIMEDOUT' || err.message?.includes('timeout');
  res.status(500).json({
    code: -1,
    msg: isTimeout ? 'AI 服务响应超时，请稍后重试' : (err.message || '服务器内部错误'),
  });
});

const start = async () => {
  await connect();
  if (process.env.NODE_ENV === 'development') {
    await sequelize.sync({ alter: true });
    console.log('✅ 数据库表同步完成');
  }
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`✅ Vitalic Server running on :${PORT}  [${process.env.NODE_ENV}]`);
  });
};

start().catch(err => { console.error('启动失败:', err); process.exit(1); });
module.exports = app;

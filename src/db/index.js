/**
 * db/index.js
 * MySQL 连接（Sequelize ORM）
 * 论文要求使用 MySQL 或 MongoDB，此处选 MySQL
 */
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
  process.env.DB_NAME || 'vitalic',
  process.env.DB_USER || 'root',
  process.env.DB_PASS || '',
  {
    host:    process.env.DB_HOST || 'localhost',
    port:    parseInt(process.env.DB_PORT) || 3306,
    dialect: 'mysql',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: {
      max: 10, min: 0, acquire: 30000, idle: 10000,
    },
    define: {
      timestamps:  true,        // 自动 createdAt / updatedAt
      underscored: true,        // 字段名下划线风格
      charset:     'utf8mb4',
    },
    timezone: '+08:00',
  }
);

// 测试连接
const connect = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ MySQL 连接成功');
  } catch (err) {
    console.error('❌ MySQL 连接失败:', err.message);
    process.exit(1);
  }
};

module.exports = { sequelize, connect };

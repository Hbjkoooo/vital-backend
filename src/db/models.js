/**
 * db/models.js
 * 数据库模型定义（对应论文数据库设计说明）
 *
 * 表结构：
 *   users            - 用户表
 *   health_profiles  - 健康画像表
 *   reports          - 体检报告表
 *   indicators       - 健康指标表（长期趋势存储）
 *   report_sessions  - 报告对话 session 表
 *   chat_messages    - 对话消息表（报告对话 + 助手对话共用）
 *   health_goals     - 健康目标表
 *   goal_tasks       - 目标任务表
 *   checkin_records  - 打卡记录表
 */
const { DataTypes } = require('sequelize');
const { sequelize } = require('./index');

// ============================================================
// 1. 用户表
// ============================================================
const User = sequelize.define('User', {
  id:       { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  openid:   { type: DataTypes.STRING(64), allowNull: false, unique: true, comment: '微信 openid' },
  nickname: { type: DataTypes.STRING(50), defaultValue: '' },
  avatar_url: { type: DataTypes.STRING(500), defaultValue: '' },
  is_profile_complete: { type: DataTypes.BOOLEAN, defaultValue: false },
}, { tableName: 'users' });

// ============================================================
// 2. 健康画像表（与 users 1:1）
// ============================================================
const HealthProfile = sequelize.define('HealthProfile', {
  id:      { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false, unique: true },

  // 基础信息
  name:    { type: DataTypes.STRING(20), defaultValue: '' },
  age:     { type: DataTypes.TINYINT.UNSIGNED },
  gender:  { type: DataTypes.ENUM('male', 'female', 'other') },
  height:  { type: DataTypes.FLOAT, comment: '身高 cm' },
  weight:  { type: DataTypes.FLOAT, comment: '体重 kg' },

  // 生活习惯（论文要求）
  occupation:     { type: DataTypes.STRING(50), defaultValue: '' },
  work_intensity: { type: DataTypes.ENUM('sedentary', 'light', 'moderate', 'heavy'), defaultValue: 'sedentary' },
  sleep_pattern:  { type: DataTypes.ENUM('early', 'normal', 'late', 'irregular'), defaultValue: 'normal' },
  sleep_hours:    { type: DataTypes.FLOAT },
  exercise_freq:  { type: DataTypes.ENUM('none', '1-2', '3+'), defaultValue: 'none' },
  smoking_status: { type: DataTypes.ENUM('none', 'quit', 'occasional', 'daily'), defaultValue: 'none' },
  drinking_status:{ type: DataTypes.ENUM('none', 'occasional', 'weekly', 'daily'), defaultValue: 'none' },

  // 既往史（JSON 存储）
 // 改后
med_history:    { type: DataTypes.JSON },
family_history: { type: DataTypes.JSON },
  allergies:      { type: DataTypes.STRING(200), defaultValue: '' },

  // 健康目标文字描述
  health_goal: { type: DataTypes.TEXT, defaultValue: '' },
}, { tableName: 'health_profiles' });

// ============================================================
// 3. 体检报告表
// ============================================================
const Report = sequelize.define('Report', {
  id:          { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id:     { type: DataTypes.INTEGER, allowNull: false },

  title:       { type: DataTypes.STRING(100), defaultValue: '体检报告' },
  report_date: { type: DataTypes.DATEONLY, comment: '体检日期' },
  hospital:    { type: DataTypes.STRING(100), defaultValue: '' },

  // 云存储文件 ID（微信云存储）
  file_id:     { type: DataTypes.STRING(500), defaultValue: '' },

  // 处理状态
  status: {
    type: DataTypes.ENUM('pending', 'ocr_running', 'ocr_done', 'analyzed', 'report_ready', 'failed'),
    defaultValue: 'pending',
  },
  raw_text:     { type: DataTypes.TEXT('long'), comment: 'OCR 原始文本' },
  report_cache: { type: DataTypes.JSON },
  summary:      { type: DataTypes.TEXT },
  health_score: { type: DataTypes.TINYINT.UNSIGNED },

  error_msg:    { type: DataTypes.STRING(500), defaultValue: '' },
}, { tableName: 'reports' });

// ============================================================
// 4. 健康指标表（长期趋势存储）
//    每次上传报告后，关键指标存一条记录
//    论文要求支持历史健康数据统计与可视化
// ============================================================
const Indicator = sequelize.define('Indicator', {
  id:          { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id:     { type: DataTypes.INTEGER, allowNull: false },
  report_id:   { type: DataTypes.INTEGER, allowNull: false },

  indicator_key:   { type: DataTypes.STRING(50),  allowNull: false, comment: '指标英文key，如bloodGlucose' },
  indicator_label: { type: DataTypes.STRING(50),  allowNull: false, comment: '指标中文名' },
  value:           { type: DataTypes.FLOAT,        allowNull: false },
  unit:            { type: DataTypes.STRING(20),   defaultValue: '' },
  reference_range: { type: DataTypes.STRING(50),   defaultValue: '' },
  normal_min:      { type: DataTypes.FLOAT },
  normal_max:      { type: DataTypes.FLOAT },
  is_abnormal:     { type: DataTypes.BOOLEAN,      defaultValue: false },
  record_date:     { type: DataTypes.DATEONLY,     allowNull: false, comment: '体检日期' },
}, { tableName: 'indicators' });

// ============================================================
// 5. 对话 Session 表
//    session_type: 'report'（报告对话）| 'assistant'（日常助手）
// ============================================================
const ChatSession = sequelize.define('ChatSession', {
  id:           { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id:      { type: DataTypes.INTEGER, allowNull: false },
  session_type: { type: DataTypes.ENUM('report', 'assistant'), allowNull: false },
  report_id:    { type: DataTypes.INTEGER, comment: '仅 report 类型有值' },
  template_id:  { type: DataTypes.STRING(30), defaultValue: 'comprehensive' },
  title:        { type: DataTypes.STRING(50), defaultValue: '新对话' },
  is_default:   { type: DataTypes.BOOLEAN, defaultValue: false },
  last_active:  { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, { tableName: 'chat_sessions' });

// ============================================================
// 6. 对话消息表
// ============================================================
const ChatMessage = sequelize.define('ChatMessage', {
  id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  session_id: { type: DataTypes.INTEGER, allowNull: false },
  role:       { type: DataTypes.ENUM('user', 'assistant'), allowNull: false },
  content:    { type: DataTypes.TEXT('long'), allowNull: false },
  token_count:{ type: DataTypes.SMALLINT, defaultValue: 0 },
}, { tableName: 'chat_messages' });

// ============================================================
// 7. 健康目标表
// ============================================================
const HealthGoal = sequelize.define('HealthGoal', {
  id:          { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id:     { type: DataTypes.INTEGER, allowNull: false },
  title:       { type: DataTypes.STRING(50), allowNull: false },
  description: { type: DataTypes.STRING(200), defaultValue: '' },
  target_days: { type: DataTypes.SMALLINT, defaultValue: 30 },
  source:      { type: DataTypes.ENUM('ai', 'user'), defaultValue: 'user', comment: 'AI生成或用户自建' },
  status:      { type: DataTypes.ENUM('active', 'archived', 'completed'), defaultValue: 'active' },
  // 颜色区分：ai=绿色标签 user=黄色标签（论文要求）
}, { tableName: 'health_goals' });

// ============================================================
// 8. 目标任务表（从属于 goal）
// ============================================================
const GoalTask = sequelize.define('GoalTask', {
  id:        { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  goal_id:   { type: DataTypes.INTEGER, allowNull: false },
  user_id:   { type: DataTypes.INTEGER, allowNull: false },
  title:     { type: DataTypes.STRING(100), allowNull: false },
  frequency: { type: DataTypes.STRING(20), defaultValue: '每天' },
  sort_order:{ type: DataTypes.TINYINT, defaultValue: 0 },
}, { tableName: 'goal_tasks' });

// ============================================================
// 9. 打卡记录表（论文要求：日常健康行为打卡）
// ============================================================
const CheckinRecord = sequelize.define('CheckinRecord', {
  id:       { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id:  { type: DataTypes.INTEGER, allowNull: false },
  goal_id:  { type: DataTypes.INTEGER, allowNull: false },
  task_id:  { type: DataTypes.INTEGER, allowNull: false },
  done:     { type: DataTypes.BOOLEAN, defaultValue: true },
  checkin_date: { type: DataTypes.DATEONLY, allowNull: false },
  note:     { type: DataTypes.STRING(200), defaultValue: '' },
}, {
  tableName: 'checkin_records',
  indexes: [{ unique: true, fields: ['user_id', 'task_id', 'checkin_date'] }],
});

// ============================================================
// 关联关系
// ============================================================
User.hasOne(HealthProfile,  { foreignKey: 'user_id', as: 'profile' });
HealthProfile.belongsTo(User, { foreignKey: 'user_id' });

User.hasMany(Report,      { foreignKey: 'user_id', as: 'reports' });
User.hasMany(Indicator,   { foreignKey: 'user_id', as: 'indicators' });
User.hasMany(ChatSession, { foreignKey: 'user_id', as: 'sessions' });
User.hasMany(HealthGoal,  { foreignKey: 'user_id', as: 'goals' });

Report.hasMany(Indicator,   { foreignKey: 'report_id', as: 'indicators' });
Report.hasMany(ChatSession, { foreignKey: 'report_id', as: 'sessions' });

ChatSession.hasMany(ChatMessage, { foreignKey: 'session_id', as: 'messages' });

HealthGoal.hasMany(GoalTask,      { foreignKey: 'goal_id', as: 'tasks' });
HealthGoal.hasMany(CheckinRecord, { foreignKey: 'goal_id' });
GoalTask.hasMany(CheckinRecord,   { foreignKey: 'task_id' });

// ============================================================
// 同步数据库（开发用 alter: true，生产改为 false）
// ============================================================
const syncDB = async () => {
  await sequelize.sync({ alter: process.env.NODE_ENV === 'development' });
  console.log('✅ 数据库表同步完成');
};

module.exports = {
  sequelize,
  syncDB,
  User,
  HealthProfile,
  Report,
  Indicator,
  ChatSession,
  ChatMessage,
  HealthGoal,
  GoalTask,
  CheckinRecord,
};

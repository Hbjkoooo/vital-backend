/**
 * db/models.js
 * 数据库模型定义（对应论文数据库设计说明）
 *
 * 表结构：
 *   users            - 用户表
 *   health_profiles  - 健康画像表
 *   reports          - 体检报告表
 *   indicators       - 健康指标表（长期趋势存储）
 *   chat_sessions    - 对话 session 表
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
  openid:   { type: DataTypes.STRING(64), allowNull: false, comment: '微信 openid' },
  nickname: { type: DataTypes.STRING(50), defaultValue: '' },
  avatar_url: { type: DataTypes.STRING(500), defaultValue: '' },
  is_profile_complete: { type: DataTypes.BOOLEAN, defaultValue: false },
}, { 
  tableName: 'users',
  indexes: [{ unique: true, fields: ['openid'], name: 'openid' }],
});

// ============================================================
// 2. 健康画像表（与 users 1:1）
// ============================================================
const HealthProfile = sequelize.define('HealthProfile', {
  id:      { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },

  // 基础信息
  name:    { type: DataTypes.STRING(20), defaultValue: '' },
  age:     { type: DataTypes.TINYINT.UNSIGNED },
  gender:  { type: DataTypes.ENUM('male', 'female', 'other') },
  height:  { type: DataTypes.FLOAT, comment: '身高 cm' },
  weight:  { type: DataTypes.FLOAT, comment: '体重 kg' },

  // 生活习惯
  occupation:      { type: DataTypes.STRING(50), defaultValue: '' },
  work_intensity:  { type: DataTypes.ENUM('sedentary', 'light', 'moderate', 'heavy'), defaultValue: 'sedentary' },
  sleep_pattern:   { type: DataTypes.ENUM('early', 'normal', 'late', 'irregular'), defaultValue: 'normal' },
  sleep_hours:     { type: DataTypes.FLOAT },
  exercise_freq:   { type: DataTypes.ENUM('none', '1-2', '3+'), defaultValue: 'none' },
  smoking_status:  { type: DataTypes.ENUM('none', 'quit', 'occasional', 'daily'), defaultValue: 'none' },
  drinking_status: { type: DataTypes.ENUM('none', 'occasional', 'weekly', 'daily'), defaultValue: 'none' },

  // 既往史（JSON 存储）
  med_history:    { type: DataTypes.JSON, comment: '既往病史数组' },
  family_history: { type: DataTypes.JSON, comment: '家族病史数组' },
  allergies:      { type: DataTypes.STRING(200), defaultValue: '' },

  // ✅ 新增：补充健康信息（个性化Prompt需要）
  medication:   { type: DataTypes.STRING(200), defaultValue: '', comment: '长期服药情况' },
  stress_level: { type: DataTypes.ENUM('low', 'medium', 'high'), comment: '压力情况' },
  other_notes:  { type: DataTypes.TEXT, defaultValue: '', comment: '其他补充说明' },

  // 健康目标文字描述
  health_goal: { type: DataTypes.TEXT, defaultValue: '' },
  daily_tip:      { type: DataTypes.TEXT, defaultValue: '' },
  daily_tip_date: { type: DataTypes.STRING(10), defaultValue: '' },
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

  // 云存储文件 ID
  file_id:     { type: DataTypes.STRING(500), defaultValue: '' },

  // 处理状态
  status: {
    type: DataTypes.ENUM('pending', 'ocr_running', 'ocr_done', 'analyzed', 'report_ready', 'failed'),
    defaultValue: 'pending',
  },

  raw_text:     { type: DataTypes.TEXT('long'), comment: 'OCR 原始文本' },

  // ✅ 改：template_cache 替代 report_cache，按模板分key存
  // 结构：{ comprehensive: { markdown, summary, healthScore }, personalized: { ... } }
  template_cache: { type: DataTypes.JSON, comment: '各模板报告内容' },

  // 保留 summary 和 health_score 存综合版的结果，用于首页展示
  summary:      { type: DataTypes.TEXT },
  health_score: { type: DataTypes.TINYINT.UNSIGNED },

  // ✅ 新增：整体风险等级，用于首页标签展示
  overall_risk_level: {
    type: DataTypes.ENUM('normal', 'mild', 'high'),
    defaultValue: 'normal',
    comment: '整体风险等级',
  },

  error_msg: { type: DataTypes.STRING(500), defaultValue: '' },
  chief_complaint: { type: DataTypes.TEXT, defaultValue: '', comment: '主检建议原文' },
}, { tableName: 'reports' });

// ============================================================
// 4. 健康指标表（长期趋势存储）
// ============================================================
const Indicator = sequelize.define('Indicator', {
  id:          { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id:     { type: DataTypes.INTEGER, allowNull: false },
  report_id:   { type: DataTypes.INTEGER, allowNull: false },

  indicator_key:   { type: DataTypes.STRING(50), allowNull: false, comment: '指标英文key，如bloodGlucose' },
  indicator_label: { type: DataTypes.STRING(50), allowNull: false, comment: '指标中文名' },
  value:           { type: DataTypes.FLOAT, allowNull: false },
  unit:            { type: DataTypes.STRING(20), defaultValue: '' },
  reference_range: { type: DataTypes.STRING(50), defaultValue: '' },
  normal_min:      { type: DataTypes.FLOAT },
  normal_max:      { type: DataTypes.FLOAT },
  is_abnormal:     { type: DataTypes.BOOLEAN, defaultValue: false },
  record_date:     { type: DataTypes.DATEONLY, allowNull: false, comment: '体检日期' },

  // ✅ 新增：是否为核心长期趋势指标
  // true = 参与首页趋势图展示；false = 仅用于本次报告解读
  is_core: { type: DataTypes.BOOLEAN, defaultValue: false, comment: '是否参与长期趋势统计' },
}, { tableName: 'indicators' });

// ============================================================
// 5. 对话 Session 表
// ============================================================
const ChatSession = sequelize.define('ChatSession', {
  id:           { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id:      { type: DataTypes.INTEGER, allowNull: false },
  session_type: { type: DataTypes.ENUM('report', 'assistant', 'goal'), allowNull: false },
  report_id:    { type: DataTypes.INTEGER, comment: '仅 report 类型有值' },
  template_id:  { type: DataTypes.STRING(30), defaultValue: 'comprehensive', comment: 'comprehensive | personalized' },
  title:        { type: DataTypes.STRING(100), defaultValue: '新对话' },
  is_default:   { type: DataTypes.BOOLEAN, defaultValue: false },
  last_active:  { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, { tableName: 'chat_sessions' });


// ============================================================
// 6. 对话消息表
// ============================================================
const ChatMessage = sequelize.define('ChatMessage', {
  id:          { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  session_id:  { type: DataTypes.INTEGER, allowNull: false },
  role:        { type: DataTypes.ENUM('user', 'assistant'), allowNull: false },
  content:     { type: DataTypes.TEXT('long'), allowNull: false },
  token_count: { type: DataTypes.SMALLINT, defaultValue: 0 },
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
  // 颜色区分：ai=绿色标签 user=黄色标签
}, { tableName: 'health_goals' });

// ============================================================
// 8. 目标任务表
// ============================================================
const GoalTask = sequelize.define('GoalTask', {
  id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  goal_id:    { type: DataTypes.INTEGER, allowNull: false },
  user_id:    { type: DataTypes.INTEGER, allowNull: false },
  title:      { type: DataTypes.STRING(100), allowNull: false },
  frequency:  { type: DataTypes.STRING(20), defaultValue: '每天' },
  sort_order: { type: DataTypes.TINYINT, defaultValue: 0 },
  source:     { type: DataTypes.ENUM('ai', 'user'), defaultValue: 'user', comment: 'AI生成或用户编辑' },
}, { tableName: 'goal_tasks' });

// ============================================================
// 9. 打卡记录表
// ============================================================
const CheckinRecord = sequelize.define('CheckinRecord', {
  id:           { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id:      { type: DataTypes.INTEGER, allowNull: false },
  goal_id:      { type: DataTypes.INTEGER, allowNull: false },
  task_id:      { type: DataTypes.INTEGER, allowNull: false },
  done:         { type: DataTypes.BOOLEAN, defaultValue: true },
  checkin_date: { type: DataTypes.DATEONLY, allowNull: false },
  note:         { type: DataTypes.STRING(200), defaultValue: '' },
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

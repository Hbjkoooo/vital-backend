const { ChatPromptTemplate } = require('@langchain/core/prompts');
const { StringOutputParser } = require('@langchain/core/output_parsers');
const { extractLLM, analysisLLM } = require('../utils/llm');
const { parseIndicators, indicatorsToText } = require('../parsers/indicatorParser');

const TEMPLATE_DESCRIPTIONS = {
  comprehensive:  '综合健康评估',
  cardiovascular: '心血管专项评估',
  metabolic:      '代谢健康评估',
};

const extractIndicators = async (rawText) => {
  const prompt = ChatPromptTemplate.fromMessages([
    ['system', `从体检报告原始文本中提取所有健康检测指标。
严格返回JSON数组，不要任何额外文字或代码块：
[{{"key":"英文camelCase","label":"中文名","value":数字,"unit":"单位","referenceRange":"参考范围","normalMin":数字或null,"normalMax":数字或null,"isAbnormal":true或false}}]`],
    ['human', '体检报告原文：\n{rawText}'],
  ]);
  const chain = prompt.pipe(extractLLM).pipe(new StringOutputParser());
  const result = await chain.invoke({ rawText });
  return parseIndicators(result);
};

const generateReport = async (indicators, userProfile, templateId = 'comprehensive') => {
  const templateType = TEMPLATE_DESCRIPTIONS[templateId] || '综合健康评估';
  const prompt = ChatPromptTemplate.fromMessages([
    ['system', `你是 Vitalic 智能健康助手，生成个性化健康分析报告。
用户信息：{userProfile}
报告类型：{templateType}
语言通俗易懂，建议具体可执行。
输出格式（Markdown）：
## 整体健康评估
## 关键指标解读
## 潜在健康风险
## 个性化建议
### 饮食建议
### 运动建议
### 生活方式建议
## 复查提醒
---
⚠️ 本报告由AI生成，仅供健康参考，不构成医疗诊断或治疗建议。`],
    ['human', '体检指标：\n{indicatorsText}\n\n请生成{templateType}报告。'],
  ]);
  const chain = prompt.pipe(analysisLLM).pipe(new StringOutputParser());
  const markdown = await chain.invoke({
    userProfile: formatUserProfile(userProfile),
    templateType,
    indicatorsText: indicatorsToText(indicators),
  });
  const summary = markdown.match(/##\s*整体健康评估\n+([\s\S]*?)(?:\n##|$)/)?.[1]?.trim().slice(0, 100) + '...' || markdown.slice(0, 100) + '...';
  const abnormalCount = indicators.filter(i => i.isAbnormal).length;
  const healthScore = Math.max(60, Math.round(100 - (abnormalCount / (indicators.length || 1)) * 60));
  return { markdown, summary, healthScore };
};

const formatUserProfile = (profile = {}) => {
  const parts = [];
  if (profile.name)   parts.push(`姓名:${profile.name}`);
  if (profile.age)    parts.push(`年龄:${profile.age}岁`);
  if (profile.gender) parts.push(`性别:${profile.gender === 'male' ? '男' : '女'}`);
  if (profile.height) parts.push(`身高:${profile.height}cm`);
  if (profile.weight) parts.push(`体重:${profile.weight}kg`);
  if (profile.height && profile.weight) {
    parts.push(`BMI:${(profile.weight / Math.pow(profile.height / 100, 2)).toFixed(1)}`);
  }
  if (profile.health_goal || profile.healthGoal) parts.push(`健康目标:${profile.health_goal || profile.healthGoal}`);
  return parts.join('，') || '未填写';
};

module.exports = { extractIndicators, generateReport, formatUserProfile };
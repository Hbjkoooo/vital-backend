const { ChatPromptTemplate } = require('@langchain/core/prompts');
const { StringOutputParser } = require('@langchain/core/output_parsers');
const { getLLM } = require('../utils/llm');
const { indicatorsToText, parseGoals } = require('../parsers/indicatorParser');
const { formatUserProfile } = require('./reportChain');

const chatLLM = getLLM({ temperature: 0.7, maxTokens: 800 });

const buildHistory = (messages = []) =>
  messages.slice(-10).map(m => ({
    role: m.role === 'user' ? 'human' : 'assistant',
    content: m.content,
  }));

const chatWithReport = async (input, history, reportContext) => {
  const { indicators = [], reportSummary = '', userProfile = {} } = reportContext;
  const prompt = ChatPromptTemplate.fromMessages([
    ['system', `你是 Vitalic 健康助手，正在帮助用户解读其体检报告。
用户信息：{userProfile}
体检指标：{indicatorsSummary}
报告结论：{reportSummary}
请耐心解释指标含义，给出具体建议，语言通俗易懂，回复控制在300字以内。
⚠️ 免责：内容仅供健康参考，不构成医疗建议。`],
    ...buildHistory(history).map(m => [m.role, m.content]),
    ['human', '{input}'],
  ]);
  const chain = prompt.pipe(chatLLM).pipe(new StringOutputParser());
  return chain.invoke({
    input,
    userProfile: formatUserProfile(userProfile),
    indicatorsSummary: indicatorsToText(indicators.slice(0, 8)),
    reportSummary: reportSummary || '暂无报告摘要',
  });
};

const chatWithAssistant = async (input, history, assistantContext) => {
  const { userProfile = {}, recentIndicators = [] } = assistantContext;
  const recentText = recentIndicators
    .slice(0, 10)
    .map(i => `${i.indicator_label || i.label}: ${i.value}${i.unit}`)
    .join('、') || '暂无数据';
  const prompt = ChatPromptTemplate.fromMessages([
    ['system', `你是 Vitalic 专属健康管理助手。
用户档案：{userProfile}
近期指标：{recentIndicators}
风格：像懂医学的朋友，亲切耐心，回复200字以内。
⚠️ 内容仅供健康参考，不构成医疗诊断建议。`],
    ...buildHistory(history).map(m => [m.role, m.content]),
    ['human', '{input}'],
  ]);
  const chain = prompt.pipe(chatLLM).pipe(new StringOutputParser());
  return chain.invoke({ input, userProfile: formatUserProfile(userProfile), recentIndicators: recentText });
};

const chatForGoalSetup = async (input, history, goalContext) => {
  const { userProfile = {}, abnormalIndicators = [] } = goalContext;
  const abnormalText = abnormalIndicators
    .map(i => `${i.indicator_label || i.label}: ${i.value}${i.unit}偏高`)
    .join('、') || '暂无异常';
  const prompt = ChatPromptTemplate.fromMessages([
    ['system', `你是健康目标规划助手，帮助用户制定个性化健康目标。
用户档案：{userProfile}
异常指标：{abnormalIndicators}
引导用户确定目标，回复100字以内。⚠️ 不构成医疗建议。`],
    ...buildHistory(history).map(m => [m.role, m.content]),
    ['human', '{input}'],
  ]);
  const chain = prompt.pipe(chatLLM).pipe(new StringOutputParser());
  return chain.invoke({ input, userProfile: formatUserProfile(userProfile), abnormalIndicators: abnormalText });
};

const finalizeGoals = async (history, goalContext) => {
  const { userProfile = {}, abnormalIndicators = [] } = goalContext;
  const conversationHistory = history
    .map(m => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`)
    .join('\n');
  const prompt = ChatPromptTemplate.fromMessages([
    ['system', `根据对话历史生成1-3个健康目标，严格返回JSON，不要其他内容：
{"goals":[{"title":"目标名称","description":"描述","targetDays":30,"tasks":[{"title":"任务名","frequency":"每天"}]}]}`],
    ['human', '对话历史：{conversationHistory}\n用户档案：{userProfile}\n异常指标：{abnormalIndicators}'],
  ]);
  const chain = prompt.pipe(getLLM({ temperature: 0.1 })).pipe(new StringOutputParser());
  const result = await chain.invoke({
    conversationHistory,
    userProfile: formatUserProfile(userProfile),
    abnormalIndicators: abnormalIndicators.map(i => `${i.label}偏高`).join('、') || '无',
  });
  return parseGoals(result);
};

module.exports = { chatWithReport, chatWithAssistant, chatForGoalSetup, finalizeGoals };

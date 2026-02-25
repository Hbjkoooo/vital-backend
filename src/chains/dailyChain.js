const { ChatPromptTemplate } = require('@langchain/core/prompts');
const { StringOutputParser } = require('@langchain/core/output_parsers');
const { getLLM } = require('../utils/llm');
const { formatUserProfile } = require('./reportChain');

const generateDailyTip = async (userProfile = {}, recentIndicators = []) => {
  const focusIndicators = recentIndicators
    .filter(i => i.is_abnormal || i.isAbnormal)
    .map(i => `${i.indicator_label || i.label}(${i.value}${i.unit})`)
    .slice(0, 3)
    .join('、') || '无明显异常';

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', '根据用户健康画像生成一条今日个性化健康科普提示，2-3句话，简洁有用，只输出内容不要前缀。'],
    ['human', '用户信息：{userProfile}\n关注指标：{focusIndicators}\n请生成今日健康科普提示。'],
  ]);

  const chain = prompt.pipe(getLLM({ temperature: 0.7, maxTokens: 200 })).pipe(new StringOutputParser());
  return (await chain.invoke({ userProfile: formatUserProfile(userProfile), focusIndicators })).trim();
};

module.exports = { generateDailyTip };
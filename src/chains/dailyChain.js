const { ChatPromptTemplate } = require('@langchain/core/prompts');
const { StringOutputParser } = require('@langchain/core/output_parsers');
const { getLLM } = require('../utils/llm');
const { formatUserProfile } = require('./reportChain');

const generateDailyTip = async (userProfile = {}, recentIndicators = []) => {
  const today = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
  
  const focusIndicators = recentIndicators
    .filter(i => i.is_abnormal || i.isAbnormal)
    .map(i => `${i.indicator_label || i.label}(${i.value}${i.unit})`)
    .slice(0, 5)  // 从3个扩展到5个
    .join('、') || '无明显异常';

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', `你是用户的专属健康科普助手，每天生成一条个性化健康科普内容。

    今天是：{today}
    
    生成规则：
    - 科普一个和用户健康状况相关的健康知识点，重点在"知识"而不是"建议"
    - 如果今天是健康相关节日（如爱眼日、世界心脏日等），结合节日主题科普
    - 语言通俗有趣，像在给朋友讲一个有意思的健康冷知识
    - 3-4句话，让用户读完有"原来如此"的感觉
    - 只输出内容，不要任何前缀或标题
    - 不要出现"建议你""你应该"等建议性语句`],
  ]);

  const chain = prompt.pipe(getLLM({ temperature: 0.7, maxTokens: 300 })).pipe(new StringOutputParser());
  return (await chain.invoke({ today, userProfile: formatUserProfile(userProfile), focusIndicators })).trim();
};

module.exports = { generateDailyTip };
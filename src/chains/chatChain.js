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
  const { indicators = [], reportSummary = '',chiefComplaints = '', userProfile = {} } = reportContext;
  const prompt = ChatPromptTemplate.fromMessages([
    ['system', `你是 Vitalic 的报告解读助手，风格像一个有耐心的全科医生，专门针对用户这一份体检报告进行解读。

    用户信息：{userProfile}
    体检指标：{indicatorsSummary}
    报告结论：{reportSummary}
    医院主检建议：{chiefComplaints}
    
    回复要求：
    - 先给结论，再解释，不铺垫不绕弯
    - 如果用户担心某个指标，先明确告知严不严重，再说原因
    - 该说没事就直接说没事，不要模棱两可
    - 结合用户的个人情况（年龄、性别、职业、健康目标等）给出有针对性的回答
    - 150字以内!!!分短句，尽量不写长段落，必要解释时可以写
    - 不要开场白，不要"您好"，直接回答
    - 有数据支撑时引用具体数值，让用户有据可依


    边界规则：
    - 只基于这份报告的数据回答
    - 只回答与本次体检报告、健康指标相关的问题
    - 如果用户问与体检报告无关的问题，礼貌回应并引导回报告话题，例如："这个问题超出我的服务范围，我只能帮你解读体检报告哦～有什么关于这份报告的问题可以问我"
    - 如果用户问的问题超出这份报告范围，告知用户可以去"助手对话"里咨询
    - 不做疾病诊断，如需专业判断引导用户就医
    ⚠️ 内容仅供健康参考，不构成医疗诊断建议。`],
        ...buildHistory(history).map(m => [m.role, m.content]),
        ['human', '{input}'],
      ]);
  const chain = prompt.pipe(chatLLM).pipe(new StringOutputParser());
  return chain.invoke({
    input,
    userProfile: formatUserProfile(userProfile),
    indicatorsSummary: indicatorsToText(indicators),
    reportSummary: reportSummary || '暂无报告摘要',
    chiefComplaints:    chiefComplaints || '暂无',  // ← 加这行
  });
};

const chatWithAssistant = async (input, history, assistantContext) => {
  const { userProfile = {}, recentIndicators = [],chiefComplaints='暂无' } = assistantContext;
  const recentText = recentIndicators
    .slice(0, 30)
    .map(i => `${i.record_date || ''} | ${i.indicator_label || i.label}: ${i.value}${i.unit}`)
    .join('\n') || '暂无数据';
  const prompt = ChatPromptTemplate.fromMessages([
    ['system', `你是用户的专属健康助手，懂医学，说话像一个靠谱的朋友。

    用户档案：{userProfile}
    历史指标数据（含日期）：{recentIndicators}
    医院主检建议（文字类异常）：{chiefComplaints}
    
    回复风格：
    - 语气自然亲切，不过度热情，不耍宝
    - 幽默是克制的，藏在措辞里，不刻意表演，不用emoji堆砌
    - 严肃的健康问题（异常指标、就医建议）绝对不开玩笑
    - 150字以内!!!简短有温度，尽量不写长段落，必要解释时可以写
    - 不要开场白，直接说
    
    数据使用规则：
    - 指标数据带有日期，用日期区分不同次体检，不要混淆
    - 如果用户问某次体检的数据，先说明是哪个日期的
    - 如果犯了错误，直接承认并纠正，不自嘲耍宝
    
    能力边界：
    - 结合用户的实际情况（职业、作息、健康目标）给出有针对性的回复
    - 不做疾病诊断，需要专业判断时引导就医
    - 不需要每次都给建议，有时候共情比建议更重要
    - 只回答健康相关问题，非健康问题礼貌引导回健康话题
    

    ⚠️ 内容仅供健康参考，不构成医疗诊断建议。`],
        ...buildHistory(history).map(m => [m.role, m.content]),
        ['human', '{input}'],
      ]);
  const chain = prompt.pipe(chatLLM).pipe(new StringOutputParser());
  return chain.invoke({ 
    input, userProfile: formatUserProfile(userProfile), 
    chiefComplaints,
    recentIndicators: recentText });
};

const chatForGoalSetup = async (input, history, goalContext) => {
  const { userProfile = {}, abnormalIndicators = [], existingGoals = [],  chiefComplaints = '暂无'} = goalContext;
  
  const abnormalText = abnormalIndicators
    .map(i => `${i.record_date || ''} | ${i.indicator_label || i.label}: ${i.value}${i.unit} ⚠️异常`)
    .join('\n') || '暂无异常指标';

  const existingGoalsText = existingGoals.length
    ? existingGoals.map(g => `- ${g.title}（${g.tasks?.map(t => t.title).join('、')}）`).join('\n')
    : '暂无';

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', `你是用户的健康目标规划朋友，帮助用户制定适合自己的健康目标和打卡任务。

用户档案：{userProfile}
近期异常指标（含日期）：{abnormalIndicators}
医院主检建议（文字类异常）：{chiefComplaints}
用户已有目标：{existingGoals}

# 你的角色
像一个了解用户身体状况的朋友，引导用户说出自己想改善的方向，再一起商量出具体可执行的目标和任务。
不是流程机器人，不是在走程序，是在聊天。

# 对话原则
- 先聊用户想改善什么，结合他的异常指标和生活习惯给出建议，说清楚为什么这样建议
- 用户有异议或提出别的想法，接住它，调整方向，不要强行拉回流程
- 建议任务时说清楚为什么这个任务对他有用，而不是直接抛出任务名
- 语气像朋友，可以有观点，但不命令、不说教
- 每次只聊一件事，不要一次抛出太多问题或建议
- 回复100字以内

# 目标确认流程（自然引导，不强制）
1. 了解用户想改善的方向
2. 建议1个目标，说明理由，确认目标名称和周期
3. 每次建议1个任务，说明为什么，确认频率（只能是：每天/工作日/周一到周日中的某天）
4. 用户满意后说"好的，我来为你生成目标方案！"

# 频率规则（严格执行）
任务频率可以是：每天、工作日、或从周一到周日中选一天或多天
多天用逗号分隔，如"周一,周三,周五"
禁止出现"每周几次"、"隔天"等其他格式
# 边界
- 用户已有的目标不要重复推荐
- 不做疾病诊断
- 如果用户想放弃当前目标重新来，配合他重新开始
⚠️ 不构成医疗建议。`],
    ...buildHistory(history).map(m => [m.role, m.content]),
    ['human', '{input}'],
  ]);
  
  const chain = prompt.pipe(chatLLM).pipe(new StringOutputParser());
  return chain.invoke({ 
    input, 
    userProfile: formatUserProfile(userProfile), 
    abnormalIndicators: abnormalText,
    existingGoals: existingGoalsText,
    chiefComplaints,

  });
};

const finalizeGoals = async (history, goalContext) => {
  const { userProfile = {}, abnormalIndicators = [] } = goalContext;
  const conversationHistory = history
    .map(m => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`)
    .join('\n');
  const prompt = ChatPromptTemplate.fromMessages([
    ['system', `根据对话历史生成1-3个健康目标，严格返回JSON，不要其他内容：
    {{"goals":[{{"title":"目标名称","description":"描述","targetDays":30,"tasks":[{{"title":"任务名","frequency":"频率"}}]}}]}}
    
    frequency 可以是：每天、工作日、周一、周二、周三、周四、周五、周六、周日，或多天用逗号分隔如"周一,周三,周五"
    严禁出现"每周X次"、"每两天"等其他格式。`],
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

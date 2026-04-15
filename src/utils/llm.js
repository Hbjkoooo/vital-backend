const { ChatOpenAI } = require('@langchain/openai');

const getLLM = (opts = {}) => new ChatOpenAI({
  modelName:   process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  temperature: opts.temperature ?? 0.3,
  maxTokens:   opts.maxTokens   ?? 2000,
  streaming:   opts.streaming   ?? false,
  apiKey:      process.env.DEEPSEEK_API_KEY,
  configuration: {
    baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
  },
  timeout: 60000,
});

module.exports = {
  getLLM,
  extractLLM:  getLLM({ temperature: 0.0, maxTokens: 8000 }),
  analysisLLM: getLLM({ temperature: 0.2, maxTokens: 4000 }),
  chatLLM:     getLLM({ temperature: 0.7, maxTokens: 800  }),
};

/**
 * parsers/indicatorParser.js
 * 解析 LLM 返回的指标 JSON，做容错处理
 */

// 关键指标的标准 key 映射（用于规则兜底）
const KEY_INDICATOR_MAP = {
  '空腹血糖': { key: 'bloodGlucose',      normalMin: 3.9,  normalMax: 6.1  },
  '血糖':     { key: 'bloodGlucose',      normalMin: 3.9,  normalMax: 6.1  },
  '总胆固醇': { key: 'totalCholesterol',  normalMin: 0,    normalMax: 5.2  },
  '甘油三酯': { key: 'triglycerides',     normalMin: 0,    normalMax: 1.7  },
  '高密度脂蛋白': { key: 'hdl',           normalMin: 1.04, normalMax: 99   },
  '低密度脂蛋白': { key: 'ldl',           normalMin: 0,    normalMax: 3.37 },
  '收缩压':   { key: 'systolicBP',        normalMin: 90,   normalMax: 120  },
  '舒张压':   { key: 'diastolicBP',       normalMin: 60,   normalMax: 80   },
  '心率':     { key: 'heartRate',         normalMin: 60,   normalMax: 100  },
  '尿酸':     { key: 'uricAcid',          normalMin: 149,  normalMax: 416  },
  '肌酐':     { key: 'creatinine',        normalMin: 44,   normalMax: 133  },
  '血红蛋白': { key: 'hemoglobin',        normalMin: 120,  normalMax: 160  },
  '谷丙转氨酶': { key: 'alt',             normalMin: 0,    normalMax: 40   },
  '谷草转氨酶': { key: 'ast',             normalMin: 0,    normalMax: 40   },
  'BMI':      { key: 'bmi',              normalMin: 18.5, normalMax: 24.9 },
};

// 需要长期存储追踪的关键指标 key 集合
const KEY_INDICATOR_KEYS = new Set(Object.values(KEY_INDICATOR_MAP).map(v => v.key));

/**
 * 解析 LLM 返回的指标 JSON 字符串
 * 容错：去掉 ```json 代码块、处理多余文字
 */
const parseIndicators = (rawContent) => {
  try {
    // 去掉 markdown 代码块
    let cleaned = rawContent
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();

    // 提取第一个 [ ... ] 数组
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON array found');

    const indicators = JSON.parse(match[0]);

    // 标准化每条指标
    return indicators.map(ind => {
      const stdInfo = KEY_INDICATOR_MAP[ind.label] || {};
      return {
        key:            ind.key || stdInfo.key || ind.label,
        label:          ind.label,
        value:          parseFloat(ind.value) || 0,
        unit:           ind.unit || '',
        referenceRange: ind.referenceRange || '',
        normalMin:      ind.normalMin ?? stdInfo.normalMin ?? null,
        normalMax:      ind.normalMax ?? stdInfo.normalMax ?? null,
        isAbnormal:     Boolean(ind.isAbnormal),
      };
    }).filter(ind => ind.label && ind.value !== undefined);

  } catch (e) {
    console.error('[parseIndicators] 解析失败:', e.message, '\n原始内容:', rawContent.slice(0, 200));
    return [];
  }
};

/**
 * 从指标数组中筛选关键指标（用于长期存储）
 */
const filterKeyIndicators = (indicators) => {
  return indicators.filter(ind => KEY_INDICATOR_KEYS.has(ind.key));
};

/**
 * 将指标数组转为可读文本（用于注入 prompt）
 */
const indicatorsToText = (indicators) => {
  return indicators.map(ind => {
    const status = ind.isAbnormal ? '⚠️ 异常' : '✓ 正常';
    return `${ind.label}: ${ind.value} ${ind.unit} [${status}，参考范围: ${ind.referenceRange}]`;
  }).join('\n');
};

/**
 * 解析目标生成的 JSON
 */
const parseGoals = (rawContent) => {
  try {
    let cleaned = rawContent
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    return parsed.goals || [];
  } catch (e) {
    console.error('[parseGoals] 解析失败:', e.message);
    return [];
  }
};

module.exports = {
  parseIndicators,
  filterKeyIndicators,
  indicatorsToText,
  parseGoals,
  KEY_INDICATOR_KEYS,
};

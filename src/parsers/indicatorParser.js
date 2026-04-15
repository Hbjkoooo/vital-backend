/**
 * parsers/indicatorParser.js
 * 解析 LLM 返回的指标 JSON，做容错处理
 */

// 关键指标的标准 key 映射（用于规则兜底）
const KEY_INDICATOR_MAP = {
  // 血糖
  '空腹血糖':       { key: 'bloodGlucose',      normalMin: 3.9,  normalMax: 6.1  },
  '血糖':           { key: 'bloodGlucose',      normalMin: 3.9,  normalMax: 6.1  },
  '糖化血红蛋白':   { key: 'hba1c',             normalMin: 0,    normalMax: 6.0  },
  'HbA1c':          { key: 'hba1c',             normalMin: 0,    normalMax: 6.0  },

  // 血脂
  '总胆固醇':       { key: 'totalCholesterol',  normalMin: 0,    normalMax: 5.2  },
  '甘油三酯':       { key: 'triglycerides',     normalMin: 0,    normalMax: 1.7  },
  '高密度脂蛋白':   { key: 'hdl',               normalMin: 1.04, normalMax: 99   },
  '低密度脂蛋白':   { key: 'ldl',               normalMin: 0,    normalMax: 3.37 },

  // 血压
  '收缩压':         { key: 'systolicBP',        normalMin: 90,   normalMax: 120  },
  '舒张压':         { key: 'diastolicBP',       normalMin: 60,   normalMax: 80   },
  '心率':           { key: 'heartRate',         normalMin: 60,   normalMax: 100  },

  // 肝功能
  '谷丙转氨酶':     { key: 'alt',               normalMin: 0,    normalMax: 40   },
  'ALT':            { key: 'alt',               normalMin: 0,    normalMax: 40   },
  '谷草转氨酶':     { key: 'ast',               normalMin: 0,    normalMax: 40   },
  'AST':            { key: 'ast',               normalMin: 0,    normalMax: 40   },
  'γ-谷氨酰转肽酶': { key: 'ggt',               normalMin: 0,    normalMax: 50   },
  'GGT':            { key: 'ggt',               normalMin: 0,    normalMax: 50   },
  '总胆红素':       { key: 'tbil',              normalMin: 3.4,  normalMax: 17.1 },
  '血清白蛋白':     { key: 'albumin',           normalMin: 35,   normalMax: 55   },
  '白蛋白':         { key: 'albumin',           normalMin: 35,   normalMax: 55   },

  // 肾功能
  '尿酸':           { key: 'uricAcid',          normalMin: 149,  normalMax: 416  },
  '肌酐':           { key: 'creatinine',        normalMin: 44,   normalMax: 133  },

  // 血常规
  '血红蛋白':       { key: 'hemoglobin',        normalMin: 115,  normalMax: 175  },
  '白细胞':         { key: 'wbc',               normalMin: 3.5,  normalMax: 9.5  },
  '血小板':         { key: 'plt',               normalMin: 100,  normalMax: 300  },

  // 体征
  'BMI':            { key: 'bmi',               normalMin: 18.5, normalMax: 24.9 },
};

// 首页趋势图展示的5个核心指标
const HOME_TREND_KEYS = new Set([
  'bloodGlucose',
  'totalCholesterol',
  'systolicBP',
  'bmi',
  'triglycerides',
]);

// 需要长期存储追踪的关键指标 key 集合（所有关键指标）
const KEY_INDICATOR_KEYS = new Set(Object.values(KEY_INDICATOR_MAP).map(v => v.key));

/**
 * 解析 LLM 返回的指标 JSON 字符串
 * 容错：去掉 ```json 代码块、处理多余文字
 */
const parseIndicators = (rawContent) => {
  try {
    let cleaned = rawContent
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();

    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON array found');

    const indicators = JSON.parse(match[0]);

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
 * 判断是否为首页趋势展示指标
 */
const isHomeTrendIndicator = (key) => HOME_TREND_KEYS.has(key);

/**
 * 将指标数组转为可读文本（用于注入 prompt）
 */
const indicatorsToText = (indicators) => {
  // 兼容两种来源：解析后的驼峰字段 和 数据库查出的下划线字段
  return indicators.map(ind => {
    const label    = ind.label          || ind.indicator_label || '未知指标';
    const value    = ind.value          ?? '—';
    const unit     = ind.unit           || '';
    const range    = ind.referenceRange || ind.reference_range || '—';
    const abnormal = ind.isAbnormal     ?? ind.is_abnormal     ?? false;
    const status   = abnormal ? '⚠️ 异常' : '✓ 正常';
    const date     = ind.record_date    || ind.recordDate      || '';
    const prefix   = date ? `${date} | ` : '';
    return `${prefix}${label}: ${value} ${unit} [${status}，参考范围: ${range}]`;
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
  isHomeTrendIndicator,
  indicatorsToText,
  parseGoals,
  KEY_INDICATOR_KEYS,
  HOME_TREND_KEYS,
};

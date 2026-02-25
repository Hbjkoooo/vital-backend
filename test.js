require('dotenv').config();
const { ocrPdf }           = require('./src/utils/ocr');
const { extractIndicators, generateReport } = require('./src/chains/reportChain');

async function main() {
  console.log('1️⃣  OCR 识别中...');
  const rawText = await ocrPdf('./src/utils/anpanna.pdf');
  console.log('✅ OCR完成，文本长度:', rawText.length, '\n');

  console.log('2️⃣  AI提取指标中...');
  const indicators = await extractIndicators(rawText);
  console.log('✅ 提取到指标:', indicators.length, '条');
  console.log(indicators.map(i => `  ${i.label}: ${i.value} ${i.unit} ${i.isAbnormal ? '⚠️' : '✓'}`).join('\n'), '\n');

  console.log('3️⃣  生成健康报告中...');
  const { markdown, summary, healthScore } = await generateReport(indicators, {}, 'comprehensive');
  console.log('✅ 报告生成完成');
  console.log('健康评分:', healthScore);
  console.log('摘要:', summary);
  console.log('\n--- 报告内容 ---\n');
  console.log(markdown);
}

main().catch(err => console.error('❌ 失败:', err.message));
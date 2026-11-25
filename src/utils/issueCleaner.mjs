const TEMPLATE_FIELD_NAMES =
  '机场名称|机场网址|机场状态|已使用时长|近期续费套餐时长|机场此前使用体验|机场当前使用体验|异常开始时间|近期不可用情况起止时间|不可用情况起止时间|1周内的不可用天数|目前是否已经恢复|是否能够与机场方取得联系|机场当前能否与机场方取的联系|能否与机场方取的联系|机场方是否有回应|机场方给出的原因或说明|所使用的运营商|所使用的客户端|其他细节补充|其他补充|原因';

const EMPTY_FIELD_RE = new RegExp(
  `^[🏷️🔗🔄⏳💰📖📊🕐⏱️📅📞💬📝📡💻📌\\s>*]*\\*{0,2}(?:${TEMPLATE_FIELD_NAMES})\\*{0,2}[：:]\\*{0,2}\\s*(?:[（(][^）)]*[）)])?\\s*$`
);

const INLINE_HINT_RE = new RegExp(
  `^([🏷️🔗🔄⏳💰📖📊🕐⏱️📅📞💬📝📡💻📌\\s]*\\*{0,2}(?:${TEMPLATE_FIELD_NAMES})\\*{0,2}[：:]\\*{0,2}\\s*)(?:（(?:如[^）]*|能\\/否[^）]*|有\\/无[^）]*|移动\\/联通[^）]*|已跑路[^）]*|季\\/半年[^）]*|1\\.\\.\\.7)）|\\((?:如[^)]*|能\\/否[^)]*|有\\/无[^)]*|移动\\/联通[^)]*|已跑路[^)]*|季\\/半年[^)]*|1\\.\\.\\.7)\\))\\s*(.+)$`
);

const CUT_PATTERNS = [
  /\n\s*(?:---+|⸻|--)\s*\n+\s*(?:⚠️|#{1,3}\s*(?:⚠️\s*)?提交\s*Issue|#{1,3}\s*投稿与交流小贴士|#{1,3}\s*issue\s*\/?\s*留言模板参考)/i,
  /^\s*#{1,3}\s*⚠️?\s*提交\s*Issue\s*前请先确认[\s\S]*/im,
  /^\s*(?:#{1,3}\s*)?投稿与交流小贴士[\s\S]*/im,
  /^\s*(?:#{1,3}\s*)?issue\s*\/?\s*留言模板参考[\s\S]*/im,
  /^\s*(?:#{1,3}\s*)?提交\s*issues?\s*(?:及回复)?须知[\s\S]*/im,
  /^\s*(?:#{1,3}\s*)?细节补充\s*\n+\s*♻️[\s\S]*/im,
  /^\s*(?:#{1,3}\s*)?最后\s*\n+\s*管理员保留[\s\S]*/im,
  /^\s*⚠️\s*\*{0,2}以下\*{0,2}模板及相关说明[\s\S]*/im,
  /^\s*\*?\s*P\.S\.\s*千人千面[\s\S]*/im,
];

/**
 * 净化 Issue 正文：剔除模板指引、须知说明、小贴士与未填写占位行，仅保留用户实际反馈内容。
 * @param {string} [body='']
 * @param {{ fallback?: string }} [options]
 * @returns {string}
 */
export function cleanIssueBody(body = '', options = {}) {
  const { fallback = '原贴未提供详细文字描述，请前往 GitHub 查看原贴讨论。' } = options;
  if (!body) return fallback;

  let text = body.replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '');

  for (const pat of CUT_PATTERNS) {
    const idx = text.search(pat);
    if (idx !== -1) {
      text = text.slice(0, idx);
    }
  }

  const outLines = [];
  for (let line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      outLines.push('');
      continue;
    }

    if (
      /^>?\s*请按.*?(?:如实填写|详情说明|详情处模板)/.test(trimmed) ||
      /^\*{0,2}如何正确换行\*{0,2}[：:]/.test(trimmed) ||
      /^[（(]?Tips[：:]/i.test(trimmed) ||
      /^(?:⚠️\s*)?\*{0,2}以下\*{0,2}(?:信息|模板及相关说明).*?(?:完整保留|小贴士)/.test(trimmed) ||
      /^\*?P\.S\.\s*如不可用时间较短（不超过72小时）.*?(?:以免造成不必要的担忧|删除权)/.test(trimmed) ||
      /^为便于大家沟通交流，其他用户留言时可以参考/.test(trimmed) ||
      /^```$/.test(trimmed) ||
      /^#$/.test(trimmed)
    ) {
      continue;
    }

    const headingMatch = line.match(/^\s*(?:#{1,3}\s*)?(?:issue\s*)?详情说明(?:\s*[（(]请填写[）)])?\s*(.*)$/i);
    if (headingMatch) {
      const rest = headingMatch[1].trim();
      if (!rest) continue;
      line = rest;
    }

    if (EMPTY_FIELD_RE.test(line.trim())) {
      continue;
    }

    const hintMatch = line.match(INLINE_HINT_RE);
    if (hintMatch) {
      line = `${hintMatch[1]}${hintMatch[2]}`;
    }

    outLines.push(line);
  }

  let result = outLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  result = result
    .replace(/^(?:---+|⸻|--)\s*\n+/g, '')
    .replace(/\n+\s*(?:---+|⸻|--)$/g, '')
    .trim();

  return result || fallback;
}

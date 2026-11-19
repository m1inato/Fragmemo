import type { Lang } from '@fragmemo/core'

const LANG_NAME: Record<Lang, string> = { ja: '日语', en: '英语' }

const NOTE_RULES = [
  '- 词条（term）一律写原形（辞书形）；日语读音用平假名，写之前用 analyze_text 核对，不要凭感觉写',
  '- 释义、翻译用学习者的母语，简短准确；不确定的字段宁可留空，不要编造',
  '- 例句必须用到这个词（可以变形），难度不超过学习者档案里的目标水平；能用 known_terms 里的词就用',
  '- confusables 只放真正容易混淆的词（形近、音近、义近）',
  '- 新建前用 search_notes 查一下，已经有的词不要重复建；要改已有笔记就带上它的 id',
  '- 所有写入都只能通过 propose_notes 提交，一次最多 20 条'
].join('\n')

/** System prompt shared by every write task: role, the learner's profile, the rules. */
export function writerSystem(lang: Lang, profile: string): string {
  return [
    `你是 Fragmemo 的${LANG_NAME[lang]}卡片编辑，为一位学习者维护记忆卡片。`,
    '',
    '## 学习者档案',
    profile.trim(),
    '',
    '## 规则',
    NOTE_RULES,
    '',
    '完成后用一两句话总结你做了什么，不要复述卡片内容。'
  ].join('\n')
}

export function tutorSystem(lang: Lang, profile: string): string {
  return [
    `你是一位耐心的${LANG_NAME[lang]}老师，回答学习者关于词汇、语法、用法的问题。`,
    '',
    '## 学习者档案',
    profile.trim(),
    '',
    '## 回答方式',
    '- 用学习者的母语回答，先给结论，再给一两个例句；例句难度贴合学习者水平',
    '- 需要时用 search_notes、known_terms 看学习者学过什么，用 analyze_text 核对读音和原形',
    '- 你不能修改卡片；学习者想把内容加入卡组时，界面上有按钮',
    '- 简洁，不要寒暄'
  ].join('\n')
}

export const prompts = {
  generateDeck: (o: { request: string; count: number; deckName: string; made: string[] }) =>
    [
      `为卡组「${o.deckName}」制作 ${o.count} 条新笔记。`,
      `需求：${o.request}`,
      o.made.length ? `这个卡组里已经有：${o.made.join('、')}。不要重复。` : '',
      '每条单词至少配一个例句。'
    ].filter(Boolean).join('\n'),

  extractFromText: (o: { text: string }) =>
    [
      '从下面的文本里挑出值得学的词和语法点，做成笔记。',
      '优先挑学习者还没学过（不在 known_terms 里）、又在目标水平之内的；例句尽量用原文里的句子。',
      '',
      '<text>',
      o.text,
      '</text>'
    ].join('\n'),

  enrichNotes: (o: { notes: unknown[]; fields: string[] }) =>
    [
      `为下面这些笔记补全字段：${o.fields.join('、')}。其他字段保持原样，带原 id 提交。`,
      '```json',
      JSON.stringify(o.notes, null, 1),
      '```'
    ].join('\n'),

  convertRaw: (o: { notes: unknown[] }) =>
    [
      '下面是从 Anki 导入的原始笔记（字段是 HTML）。把每一条转成标准笔记（word / sentence / grammar），',
      '带原 id 提交，id 必须保持不变。从字段里提取词条、读音、释义、例句；去掉 HTML 标签和音频标记。',
      '```json',
      JSON.stringify(o.notes, null, 1),
      '```'
    ].join('\n'),

  processInbox: () =>
    '用 read_inbox 读出学习者收藏的词句，逐条判断：值得学的做成笔记（句子可以做成 sentence，' +
    '其中的生词另做 word），重复或没意义的跳过。最后说明哪些跳过了、为什么。',

  leechHelper: () =>
    '用 get_leeches 找出学习者反复遗忘的卡片。对每一张想想为什么难记：补上更好记的例句、' +
    '区分易混词（confusables）、在 notes 里写一句记忆提示。带原 id 修改，不要新建。'
}

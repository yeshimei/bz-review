/**
 * 做题家题目生成器（ticket 17 修正版：对齐源码 QuestionGenerator 逐字）
 */
import type { AIService } from '../../core/ai';
import type { QuizQuestion } from './manager';

/** 把 unknown 收窄成普通对象（非 null、非数组）——访问其属性前必须过这道守卫 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 把 unknown 收窄成数组（避免 Array.isArray 直接把 unknown 收成 any[]） */
function isUnknownArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

/** 批量返回单题的「够格再校验」形状守卫：字段齐全即可，correctIndices 的越界项
 *  交由调用方 filter 剔除（与原逻辑一致，不因个别坏索引整道丢题）。 */
function isBatchQuestionShape(v: unknown): v is QuizQuestion {
  if (!isRecord(v)) return false;
  if (typeof v.question !== 'string' || !v.question) return false;
  if (!Array.isArray(v.options) || v.options.length !== 4) return false;
  if (!Array.isArray(v.correctIndices)) return false;
  return true;
}

export class QuestionGenerator {
  /** 构建提示词（源码 L92-128 逐字；item 3 增 explain 字段：一句话解析+原文依据） */
  buildPrompt(content: string, enableMultipleChoice: boolean, questionsPerNote: number, difficulty: string): string {
    const truncated = content.slice(0, 3000);
    let typeHint = '单选题（四选一）';
    let structure = `{ "question": "题目文本", "options": ["A选项","B选项","C选项","D选项"], "correctIndices": [0], "explain": "一句话解析+原文依据" }`;
    if (enableMultipleChoice) {
      typeHint = '可以是单选题或多选题（正确选项数量不限）';
      structure = `{ "question": "题目文本", "options": ["A选项","B选项","C选项","D选项"], "correctIndices": [0, 2], "explain": "一句话解析+原文依据" }（数组内为正确选项的索引）`;
    }
    let countHint = '';
    if (questionsPerNote > 0) {
      countHint = `请生成恰好 ${questionsPerNote} 道题目。`;
    } else {
      countHint = '生成若干道题目（数量适中，建议 3~6 道）。';
    }

    let difficultyHint = '';
    if (difficulty === 'easy') {
      difficultyHint = '请生成基础概念题，选项区分度明显，避免陷阱，难度较低。';
    } else if (difficulty === 'medium') {
      difficultyHint = '生成中等难度题目，可包含细节辨析，选项有一定迷惑性。';
    } else if (difficulty === 'hard') {
      difficultyHint = '生成高难度题目，可涉及推理、多知识点交叉，选项具有较强迷惑性。';
    }
    // random 或不合法：不添加难度提示，让 AI 自由决定

    return `根据以下笔记内容，生成若干道四选一的选择题（每题一个正确答案），数量适中，以便复习。请仅返回一个合法的 JSON 对象，结构如下：
{
  "questions": [
    ${structure}
  ]
}
注意：题目类型为 ${typeHint}，${countHint}
${difficultyHint}
每题必须带 explain 字段：用一句话解析正确答案，并附原文依据（简短引用或出处）。
出题要求：只考笔记的内容与观点，不要问标题、文件名、作者、标签、日期这类元信息，
也不要把「这段话出自哪篇笔记」当成考点——那种题不做也能答对，等于白占一道。
笔记内容：
${truncated}`;
  }

  /** 提取 JSON（源码 L129-138 逐字） */
  extractJSON(text: string): unknown {
    const code = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (code) {
      try {
        const parsed: unknown = JSON.parse(code[1].trim());
        return parsed;
      } catch {
        /* 继续尝试 */
      }
    }
    try {
      const parsed: unknown = JSON.parse(text.trim());
      return parsed;
    } catch {
      /* 继续尝试 */
    }
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
      try {
        const parsed: unknown = JSON.parse(text.substring(first, last + 1));
        return parsed;
      } catch {
        /* 继续尝试 */
      }
    }
    throw new Error('无法从 AI 响应中提取有效的 JSON');
  }

  /** 生成题目（单篇，源码 L139-159 逐字） */
  async generate(noteContent: string, aiService: AIService, enableMultipleChoice: boolean, questionsPerNote: number, difficulty: string): Promise<QuizQuestion[]> {
    const prompt = this.buildPrompt(noteContent, enableMultipleChoice, questionsPerNote, difficulty);
    const result = await aiService.json(prompt);
    const parsed: unknown = this.extractJSON(result);
    if (!isRecord(parsed)) throw new Error('AI 未返回有效题目数组。');
    const questions = parsed.questions;
    if (!isUnknownArray(questions) || questions.length === 0) throw new Error('AI 未返回有效题目数组。');
    for (const raw of questions) {
      if (!isRecord(raw)) throw new Error('题目格式不正确：缺少 question 或 options 不是长度为4的数组');
      if (!raw.question || !Array.isArray(raw.options) || raw.options.length !== 4) {
        throw new Error('题目格式不正确：缺少 question 或 options 不是长度为4的数组');
      }
      const indices = raw.correctIndices;
      if (!Array.isArray(indices) || indices.length === 0) {
        throw new Error('题目格式不正确：correctIndices 必须是非空数组');
      }
      for (const idx of indices) {
        if (typeof idx !== 'number' || idx < 0 || idx > 3) {
          throw new Error('correctIndices 元素必须在 0~3 之间');
        }
      }
    }
    return questions as QuizQuestion[];
  }

  /** 批量提示词（源码 L162-191 逐字；item 3 增 explain 规则） */
  buildBatchPrompt(notes: { id: string; content: string }[], enableMultipleChoice: boolean, questionsPerNote: number, difficulty: string): string {
    let typeHint = '单选题（四选一）';
    if (enableMultipleChoice) {
      typeHint = '可以是单选题或多选题';
    }
    const countHint = questionsPerNote > 0 ? `每篇生成恰好 ${questionsPerNote} 道。` : '每篇生成 3~6 道。';
    let difficultyHint = '';
    if (difficulty === 'easy') difficultyHint = '生成基础概念题，难度较低。';
    else if (difficulty === 'medium') difficultyHint = '生成中等难度题目。';
    else if (difficulty === 'hard') difficultyHint = '生成高难度题目，涉及推理和多知识点交叉。';

    let notesBlock = '';
    for (const n of notes) {
      notesBlock += `\n===== 笔记ID:${n.id} =====\n${n.content.slice(0, 2000)}\n`;
    }

    return `根据以下多篇笔记内容，为每篇笔记生成选择题。请仅返回一个合法的 JSON 对象：
{
  "<笔记ID>": [ { "question": "...", "options": ["A","B","C","D"], "correctIndices": [0], "explain": "..." }, ... ],
  ...
}
规则：
- 类型：${typeHint}，${countHint}
- ${difficultyHint}
- 每题必须带 explain 字段：一句话解析正确答案并附原文依据
- 只考笔记的内容与观点；不要问标题、文件名、作者、标签、日期这类元信息（不做也能答对，白占一道）
- JSON 的键必须是下方「===== 笔记ID:xxx =====」中的 xxx 本身（完整笔记路径，逐字复制，不要自造编号如 noteId1），每篇笔记一个键，值为该笔记的题目数组
- 每题4个选项，correctIndices 为正确选项索引数组
笔记内容：${notesBlock}`;
  }

  /**
   * G5：返回键归一——AI 可能不按规则返回（照旧示例返回 noteId1、加「笔记ID:」前缀、
   * 带首尾空白等），归一到真实笔记路径；无法映射到已知笔记的键丢弃（不写垃圾键、
   * 不虚报「已为 N 篇生成」）。
   */
  private normalizeBatchKeys(parsed: Record<string, unknown>, knownIds: string[]): Record<string, QuizQuestion[]> {
    const exact = new Set(knownIds);
    const out: Record<string, QuizQuestion[]> = {};
    for (const [rawKey, qs] of Object.entries(parsed)) {
      if (!isUnknownArray(qs)) continue;
      let key = rawKey.trim();
      if (key.startsWith('笔记ID:')) key = key.slice('笔记ID:'.length).trim();
      if (!exact.has(key)) continue; // 无法映射真实笔记 → 丢弃（防垃圾键 + 假成功）
      const valid: QuizQuestion[] = [];
      for (const q of qs) {
        if (!isBatchQuestionShape(q)) continue;
        // P2：与单篇 generate 对齐——correctIndices 越界项剔除（须为 0~3 的数字），
        // 剔除后无有效索引则丢弃该题
        const indices = q.correctIndices.filter((i: unknown): i is number => typeof i === 'number' && i >= 0 && i <= 3);
        if (!indices.length) continue;
        valid.push({ ...q, correctIndices: indices });
      }
      if (valid.length) out[key] = valid;
    }
    return out;
  }

  /** 批量生成（源码 L193-212 逐字；G5：返回键归一到真实笔记路径） */
  async generateBatch(notes: { id: string; content: string }[], aiService: AIService, enableMultipleChoice: boolean, questionsPerNote: number, difficulty: string): Promise<Record<string, QuizQuestion[]>> {
    const prompt = this.buildBatchPrompt(notes, enableMultipleChoice, questionsPerNote, difficulty);
    const result = await aiService.json(prompt);
    const parsed = this.extractJSON(result) as Record<string, unknown>;
    // 返回 { noteId: questions[] } 的映射（键归一：无法映射已知笔记的键丢弃）
    return this.normalizeBatchKeys(parsed, notes.map((n) => n.id));
  }
}

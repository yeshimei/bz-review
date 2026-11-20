/**
 * 外部交来的卡片 → 排期表里的卡片（review/card-input.ts）
 *
 * 纯函数，不碰 obsidian、不碰 IO——只回答「这条输入能不能收、收进来长什么样」。
 * 抽出来是因为它有两个容易写错的口径，而且都只能靠断言钉住：
 *
 *   1. **qa 是「已经出好的题」**。阅读器把题出好了才交过来，这里必须原样存下，
 *      并补上生成时间；空问句当作没给（走原来的生成路径），空答案退回原文
 *      （不能让卡的背面空着）。
 *   2. **空钥匙 / 空原文一律不收**。没有这两样，卡片在复习时是一张白纸。
 */
import type { ReviewCard } from './data';
import type { ReviewCardInput } from './reader-api';
import type { QuizQuestion } from './quiz-core/manager';

const CARD_MODES: readonly string[] = ['flashcard', 'quiz', 'cloze', 'context', 'plain'];

/**
 * 阅读器交来的题目 → Review 题库格式。
 * 只有题干和选项都齐的题才留；空题写进题库会让用户点开一张「没有题的做题卡」。
 */
export function normalizeQuestions(
  raw: ReviewCardInput['questions'],
): QuizQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((q) => q && String(q.q ?? '').trim() && Array.isArray(q.options) && q.options.length > 0)
    .map((q) => {
      const options = q.options.map((o) => String(o ?? ''));
      const correctIndices = Array.isArray(q.correct)
        ? q.correct.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < options.length)
        : [];
      const out: QuizQuestion = {
        question: String(q.q).trim(),
        options,
        correctIndices,
      };
      if (q.explain) out.explain = String(q.explain);
      return out;
    });
}

/**
 * 归一一条外部输入；收不了返回 null。
 *
 * `now` 可注入，测试里好钉住 `qa.at`。
 */
export function normalizeCardInput(input: ReviewCardInput, now: number = Date.now()): ReviewCard | null {
  const key = String(input?.key ?? '').trim();
  const text = String(input?.text ?? '').trim();
  if (!key || !text) return null;

  const card: ReviewCard = {
    key,
    bookTitle: String(input.bookTitle ?? ''),
    text: String(input.text ?? ''),
  };
  if (input.chapterTitle) card.chapterTitle = String(input.chapterTitle);
  if (input.comment) card.comment = String(input.comment);
  if (input.backlink) card.backlink = String(input.backlink);
  if (input.context) card.context = input.context;
  /* 方式由 Reader 在制卡那一刻定下；这里是唯一的落库入口，丢了就只能按全局
     默认方式重盖——用户选的填空会变成抽认卡，选的做题会退化成看原文。 */
  if (typeof input.mode === 'string' && CARD_MODES.includes(input.mode)) {
    card.mode = input.mode;
  }

  const q = String(input?.qa?.q ?? '').trim();
  if (q) {
    const a = String(input?.qa?.a ?? '').trim() || text;
    card.qa = { q, a, at: now };
  }
  /* 阅读器交来已出好的做题卡：题目落进独立题库，卡上回填第一题题干当
     列表短标题（题目在别处、cardTitleOf 读不到，只能在这里写进来）。mode
     可能在盖章阶段才定，所以这里只看有没有题目，不依赖 mode 已就位。 */
  const questions = normalizeQuestions(input.questions);
  const firstQ = String(questions[0]?.question ?? '').trim();
  if (firstQ) card.displayTitle = firstQ;
  return card;
}

/** 这批输入里哪些已经带了题面（不用再排队生成） */
export function keysWithQa(cards: readonly ReviewCard[]): Set<string> {
  const out = new Set<string>();
  for (const c of cards) if (c.qa) out.add(c.key);
  return out;
}

import { getLearningStage } from './stages';

export interface QuizOption {
  readonly id: string;
  readonly label: string;
}

export interface QuizQuestion {
  readonly id: string;
  readonly prompt: string;
  readonly options: readonly QuizOption[];
  readonly correctOptionId: string;
  readonly explanation: string;
}

export interface StageQuiz {
  readonly stageId: string;
  readonly questions: readonly QuizQuestion[];
}

export interface QuizResult {
  readonly stageId: string;
  readonly answers: readonly string[];
  readonly correctOptionIds: readonly string[];
  readonly explanations: readonly string[];
  readonly correctCount: number;
  readonly totalQuestionCount: number;
  readonly passed: boolean;
}

export const PASSING_QUESTION_COUNT = 4 as const;

const options = (labels: readonly [string, string, string, string]): readonly QuizOption[] =>
  labels.map((label, index) => ({ id: String.fromCharCode(97 + index), label }));

const makeQuestion = (
  stageNumber: number,
  questionNumber: number,
  prompt: string,
  optionLabels: readonly [string, string, string, string],
  correctOptionId: string,
  explanation: string,
): QuizQuestion => ({
  id: `stage-${stageNumber}-question-${questionNumber}`,
  prompt,
  options: options(optionLabels),
  correctOptionId,
  explanation,
});

/** 五階段各五題的繁體中文選擇題；題目只檢查觀察與風險概念，不猜價格方向。 */
export const STAGE_QUIZZES: readonly StageQuiz[] = [
  {
    stageId: 'stage-1',
    questions: [
      makeQuestion(1, 1, 'OHLC 中，哪一個數值代表該週期開始成交的價格？', ['收盤價', '開盤價', '最高價', '最低價'], 'b', '開盤價是週期開始的第一筆成交價格。'),
      makeQuestion(1, 2, '影線最適合用來描述哪一種資訊？', ['週期內曾到達但未必收在那裡的價格範圍', '公司營收成長率', '隔日必然走勢', '投資人的年齡'], 'a', '影線保留了該週期內觸及高低點的範圍。'),
      makeQuestion(1, 3, '閱讀 K 線時，第一步應該先確認什麼？', ['先套用型態名稱', '先猜收盤方向', '時間週期與原始或調整價格口徑', '先設定目標價'], 'c', '時間與價格口徑不同，觀察結果也可能不同。'),
      makeQuestion(1, 4, '成交量在初步觀察中主要提供哪一類線索？', ['保證下一根 K 線', '公司治理評等', '稅率', '該段交易活動的相對程度'], 'd', '成交量是活動程度的線索，不是結果保證。'),
      makeQuestion(1, 5, '以下哪一句最符合本網站對型態的定位？', ['型態名稱等於買進指令', '型態是條件式觀察，需要背景與失效條件', '型態可以取代風險管理', '型態能消除市場不確定性'], 'b', '型態只是條件式描述，不能脫離背景與風險界線。'),
    ],
  },
  {
    stageId: 'stage-2',
    questions: [
      makeQuestion(2, 1, '波峰與波谷的主要用途是什麼？', ['記錄帳戶密碼', '描述價格結構與高低點關係', '預告公司配息', '判斷新聞真假'], 'b', '波峰波谷協助描述結構，仍需搭配時間與位置。'),
      makeQuestion(2, 2, '支撐區或壓力區較恰當的描述是什麼？', ['永遠不會被穿越的線', '固定的獲利保證', '可能出現反應的價格區域', '只看單一收盤價'], 'c', '區域是可能出現反應的範圍，不是不可突破的保證。'),
      makeQuestion(2, 3, '面對突破，哪一項查核最能避免把假突破當成確認？', ['只看顏色', '忽略成交量', '刪除失效條件', '檢查收盤位置、後續回測與背景'], 'd', '突破需要位置、收盤與後續行為共同查核。'),
      makeQuestion(2, 4, '多時間週期閱讀的合理做法是什麼？', ['讓較大週期提供背景，再用小週期描述觸發', '只使用一分鐘圖', '只使用最大週期', '讓不同週期互相覆蓋不記錄'], 'a', '大週期提供背景，小週期可補充觸發細節。'),
      makeQuestion(2, 5, '缺口在學習筆記中應先記錄哪一項？', ['缺口大小與所在背景', '保證回補日期', '必然的未來方向', '投資人情緒分數'], 'a', '先記錄可觀察的大小、位置與背景，不把缺口當成預測。'),
    ],
  },
  {
    stageId: 'stage-3',
    questions: [
      makeQuestion(3, 1, '單根 K 線的長上影通常先描述什麼？', ['上方曾有較高成交但收回的痕跡', '公司一定虧損', '隔日一定下跌', '交易一定成功'], 'a', '影線是觀察痕跡，需搭配位置與後續確認。'),
      makeQuestion(3, 2, '雙根或三根組合的名稱之外，還要補上什麼？', ['發生位置與前後背景', '固定目標價', '保證勝率', '與市場無關的暱稱'], 'a', '同一組合在不同位置可能代表不同的觀察意義。'),
      makeQuestion(3, 3, '量價關係中的「失敗訊號」較接近哪個概念？', ['條件未被確認或後續被否定', '任何下跌都算失敗', '任何放量都算成功', '不用記錄失效'], 'a', '失敗是條件被否定或未確認，應留下可查核紀錄。'),
      makeQuestion(3, 4, '低流動性股票的型態判讀需要特別注意什麼？', ['價差與零星成交可能放大形狀', '只看圖不看成交', '忽略交易成本', '把缺值補成預測'], 'a', '低流動性會放大雜訊，應把成本與成交連續性納入。'),
      makeQuestion(3, 5, '型態卡的「常見誤讀」用途是什麼？', ['提醒名稱不能取代證據', '提供買賣指令', '取代所有章節', '保證每次結果'], 'a', '誤讀欄位協助辨識把描述誤當成結論的風險。'),
    ],
  },
  {
    stageId: 'stage-4',
    questions: [
      makeQuestion(4, 1, 'ATR 在風險筆記中比較適合作為什麼？', ['波動程度的參考尺度', '未來價格保證', '公司評價', '交易許可證'], 'a', 'ATR 可協助描述波動尺度，不能直接給出方向。'),
      makeQuestion(4, 2, '情境、觸發與失效三者的順序應如何記錄？', ['先寫情境，再列觸發與失效條件', '只寫觸發', '先寫結果再補條件', '只寫型態名稱'], 'a', '先定義背景情境，再說明何時觸發、何時失效。'),
      makeQuestion(4, 3, '部位大小與停損距離的共同目的為何？', ['把單筆風險控制在可承受範圍', '讓每筆交易都獲利', '省略交易成本', '提高預測準確率'], 'a', '風險控制是邊界管理，不是獲利保證。'),
      makeQuestion(4, 4, '什麼情況適合選擇「不交易」？', ['條件不完整或失效界線無法清楚定義', '任何看到 K 線時', '只要有成交量時', '為了完成題數時'], 'a', '無法查核條件時，放棄交易本身就是紀律。'),
      makeQuestion(4, 5, 'R 倍數與期望值主要協助檢查什麼？', ['風險報酬與長期紀錄', '公司內線消息', '保證勝率', '明日開盤價'], 'a', '它們是事後與長期紀錄工具，不是預測器。'),
    ],
  },
  {
    stageId: 'stage-5',
    questions: [
      makeQuestion(5, 1, '遮圖案例實驗的第一個原則是什麼？', ['先寫下當下可見證據', '先看完整答案', '先猜最大漲幅', '先套用最熟悉名稱'], 'a', '遮圖練習先固定當下資訊，才能檢查推理是否越界。'),
      makeQuestion(5, 2, '交易紀錄中加入「失效原因」有什麼價值？', ['讓事後回顧能對照原先條件', '保證下一次成功', '取代原始資料', '刪除不利案例'], 'a', '記錄失效原因，才能檢查條件是否需要調整。'),
      makeQuestion(5, 3, '心理偏誤檢查清單的用途是什麼？', ['辨識自己如何跳過證據或風險界線', '推測別人的持股', '提供盤中訊號', '取代學習章節'], 'a', '偏誤檢查把決策過程拉回可觀察紀錄。'),
      makeQuestion(5, 4, '綜合案例驗收最重要的輸出是什麼？', ['可查核的觀察、條件與風險紀錄', '單一預測答案', '保證獲利曲線', '最熱門的型態名稱'], 'a', '能力驗收重點是推理證據鏈與風險界線。'),
      makeQuestion(5, 5, '完成階段測驗後，章節閱讀權限如何處理？', ['所有章節仍可自由開啟', '只開放下一章', '答錯就永久鎖定', '必須登入才能重看'], 'a', '測驗只記錄學習進度，不會鎖住任何章節。'),
    ],
  },
];

export function getStageQuiz(stageId: string): StageQuiz {
  getLearningStage(stageId);
  const quiz = STAGE_QUIZZES.find((candidate) => candidate.stageId === stageId);
  if (!quiz) {
    throw new Error('找不到學習階段');
  }
  return quiz;
}

export function scoreStageQuiz(stageId: string, answers: readonly string[]): QuizResult {
  const quiz = getStageQuiz(stageId);
  const normalizedAnswers = Array.from(answers);
  const correctOptionIds = quiz.questions.map((question) => question.correctOptionId);
  const correctCount = quiz.questions.reduce(
    (count, question, index) => count + (normalizedAnswers[index] === question.correctOptionId ? 1 : 0),
    0,
  );
  return {
    stageId,
    answers: normalizedAnswers,
    correctOptionIds,
    explanations: quiz.questions.map((question) => question.explanation),
    correctCount,
    totalQuestionCount: quiz.questions.length,
    passed: correctCount >= PASSING_QUESTION_COUNT,
  };
}

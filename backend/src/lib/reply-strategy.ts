/**
 * P390 — 「换一个」 strategy diversity. Three consecutive regen clicks used
 * to produce three paraphrases of one idea (「晾着 + 找事做 + 别老看手机」)
 * because the dedupe rule only forbade repeated sentences. A regenerate
 * turn now has to switch strategy dimension: pick one of five advice
 * routes the chain has not used yet, and report the pick on a trailing
 * machine-readable `strategy:` marker line that the server strips before
 * the reply reaches the bubble.
 */

/** The five advice routes a 「换一个」 chain cycles through. */
export const REPLY_STRATEGIES = [
  'wait',
  'light_probe',
  'clear_close',
  'distraction',
  'self_regulation',
] as const;

export type ReplyStrategy = (typeof REPLY_STRATEGIES)[number];

/** Chinese names the prompt lists each strategy under. */
export const REPLY_STRATEGY_LABELS: Record<ReplyStrategy, string> = {
  wait: '等待',
  light_probe: '轻量试探',
  clear_close: '明确收尾',
  distraction: '转移注意力',
  self_regulation: '自我调节',
};

/** One-line description of each route, rendered in the regen directive. */
export const REPLY_STRATEGY_HINTS: Record<ReplyStrategy, string> = {
  wait: '先按兵不动，给对方时间和空间，说清等待期间怎么过',
  light_probe: '发一条不带压力的轻量消息，给对方一个台阶重新开口',
  clear_close: '把这段关系或这个话题明确收个尾，不拖泥带水',
  distraction: '把注意力转向别的事或别的人，先降低内耗',
  self_regulation: '先安顿自己的情绪和状态，再决定下一步',
};

export function isReplyStrategy(value: unknown): value is ReplyStrategy {
  return typeof value === 'string' && (REPLY_STRATEGIES as readonly string[]).includes(value);
}

/** Chinese label → strategy id, for a model that reports the label instead. */
const LABEL_TO_STRATEGY = new Map<string, ReplyStrategy>(
  REPLY_STRATEGIES.map((s) => [REPLY_STRATEGY_LABELS[s], s]),
);

/**
 * A marker line looks like `strategy: wait`. The 策略 alias, full-width
 * colon and a Chinese-label value are all tolerated, and anything trailing
 * on the line is eaten so a stray period cannot leak the marker through.
 */
const STRATEGY_MARKER_LINE = /^[ \t]*(?:strategy|策略)[ \t]*[:：][ \t]*([\p{L}_]+)[^\n]*$/gimu;

/** Resolve a reported marker value to the enum; unknown → undefined. */
export function parseStrategyMarkerValue(raw: string): ReplyStrategy | undefined {
  const lowered = raw.toLowerCase();
  if (isReplyStrategy(lowered)) return lowered;
  return LABEL_TO_STRATEGY.get(raw);
}

/**
 * Split the strategy marker off a model reply. Every marker-shaped line is
 * removed; `strategy` carries the first value that resolves to the enum —
 * undefined when the model forgot the marker or reported an unknown id.
 * Content without a marker is returned byte-identical.
 */
export function extractReplyStrategy(content: string): { text: string; strategy?: ReplyStrategy } {
  let found = false;
  let strategy: ReplyStrategy | undefined;
  const stripped = content.replace(STRATEGY_MARKER_LINE, (_line, value: string) => {
    found = true;
    strategy ??= parseStrategyMarkerValue(value);
    return '';
  });
  if (!found) return { text: content };
  return { text: stripped.replace(/\n{3,}/g, '\n\n').trim(), strategy };
}

/**
 * Strategies a regenerate chain has already spent. Chains are keyed by
 * session + re-issued prompt (the same key the dedupe request state is
 * scoped to), so sequential 「换一个」 calls on the same question see each
 * other's picks. Bounded: past STRATEGY_CHAIN_LIMIT chains the oldest
 * entry drops out — the frontend caps regen rolls per reply, so nothing
 * user-visible depends on older entries surviving.
 */
export const STRATEGY_CHAIN_LIMIT = 500;

export class ReplyStrategyLedger {
  private chains = new Map<string, Set<ReplyStrategy>>();

  static key(sessionId: string, prompt: string): string {
    return `${sessionId}\n${prompt}`;
  }

  used(key: string): ReplyStrategy[] {
    return [...(this.chains.get(key) ?? [])];
  }

  record(key: string, strategy: ReplyStrategy): void {
    let chain = this.chains.get(key);
    if (!chain) {
      chain = new Set();
      this.chains.set(key, chain);
      while (this.chains.size > STRATEGY_CHAIN_LIMIT) {
        const oldest = this.chains.keys().next().value;
        if (oldest === undefined) break;
        this.chains.delete(oldest);
      }
    }
    chain.add(strategy);
  }
}

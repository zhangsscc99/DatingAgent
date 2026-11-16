/**
 * P192 — elapsed-time label for the pre-first-token wait.
 *
 * P189 made replies stream once tokens arrive, but the first visible
 * character still took 6–16 s in walkthroughs; until then the bubble sat
 * on a frozen 「正在生成回复」, indistinguishable from a hung request. A
 * label that changes once a second turns that window into visible
 * progress.
 *
 * The module stays DOM-free so the timing contract is testable under fake
 * timers: formatWaitingLabel is the pure copy rule, tickIntervalMs the
 * cadence, and startWaitingTicker the interval the App effect owns — its
 * stop() is what runs on the first delta/message, done, error, abort, and
 * unmount, and a stopped ticker must never fire again.
 */

/**
 * Placeholder copy for the wait before the first token arrives.
 *
 * P216 — a bare stopwatch for a 20–45 s model-thinking window still reads
 * like a hang, so the label now moves through stages: thinking (<1 s),
 * generating (1–10 s), organising the reply (10–30 s), and an explicit
 * "this one is taking a while" note past 30 s — always with the elapsed
 * time still ticking. The tool phase keeps its own P210 tool-name copy
 * in streamAnnouncement.ts and never reaches these buckets.
 */
export function formatWaitingLabel(elapsedMs: number): string {
  if (elapsedMs < 1000) return '正在思考…';
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const waited =
    elapsedMs < 60_000
      ? `${totalSeconds} 秒`
      : `${Math.floor(totalSeconds / 60)} 分 ${totalSeconds % 60} 秒`;
  if (elapsedMs < 10_000) return `正在生成…（已等待 ${waited}）`;
  if (elapsedMs < 30_000) return `正在组织回复…（已等待 ${waited}）`;
  return `这条想得比较久,仍在生成…（已等待 ${waited}）`;
}

/** Cadence of the waiting-label ticker — one update per second. */
export function tickIntervalMs(): number {
  return 1000;
}

export interface WaitingTicker {
  stop: () => void;
}

/**
 * Fire `onTick` once per tickIntervalMs() until stop() is called. Uses the
 * ambient interval functions so it runs identically in the browser and in
 * the node test environment (vitest fake timers patch both).
 */
export function startWaitingTicker(onTick: () => void): WaitingTicker {
  const id = setInterval(onTick, tickIntervalMs());
  return {
    stop: () => {
      clearInterval(id);
    },
  };
}

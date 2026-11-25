/**
 * FSRS-4.5 前端离线调度引擎（与后端 app/fsrs.py 算法参数与计算规则 100% 保持一致）。
 * 支持手机端完全断网离线刷卡并实时计算科学记忆间隔。
 */

import type { CardItem } from "../types";

const W = [
  0.4872, 1.4003, 3.7145, 13.8206,
  5.1618, 1.2298, 0.8975, 0.031,
  1.6474, 0.1367, 1.0461, 2.1072,
  0.0793, 0.3246, 1.587, 0.2272,
  2.8755,
];

const REQUEST_RETENTION = 0.9;
const MAXIMUM_INTERVAL = 36500;
const DECAY = -0.5;
const FACTOR = 19 / 81;

const clampDifficulty = (d: number) => Math.min(Math.max(Number(d.toFixed(4)), 1), 10);
const initStability = (rating: number) => Math.max(W[rating - 1], 0.1);
const initDifficulty = (rating: number) => clampDifficulty(W[4] - (rating - 3) * W[5]);
const forgettingCurve = (elapsedDays: number, s: number) =>
  s <= 0 ? 0 : Math.pow(1 + (FACTOR * elapsedDays) / s, DECAY);
const nextInterval = (s: number) =>
  Math.min(Math.max(Math.round((s / FACTOR) * (Math.pow(REQUEST_RETENTION, 1 / DECAY) - 1)), 1), MAXIMUM_INTERVAL);
const meanReversion = (init: number, current: number) => W[7] * init + (1 - W[7]) * current;
const nextDifficulty = (d: number, rating: number) => clampDifficulty(meanReversion(W[4], d - W[6] * (rating - 3)));

function nextRecallStability(d: number, s: number, r: number, rating: number): number {
  const hardPenalty = rating === 2 ? W[15] : 1;
  const easyBonus = rating === 4 ? W[16] : 1;
  return Number(
    (
      s *
      (1 +
        Math.exp(W[8]) *
          (11 - d) *
          Math.pow(s, -W[9]) *
          (Math.exp((1 - r) * W[10]) - 1) *
          hardPenalty *
          easyBonus)
    ).toFixed(4)
  );
}

function nextForgetStability(d: number, s: number, r: number): number {
  return Number(
    (
      W[11] *
      Math.pow(d, -W[12]) *
      (Math.pow(s + 1, W[13]) - 1) *
      Math.exp((1 - r) * W[14])
    ).toFixed(4)
  );
}

export function scheduleCardLocal(
  card: CardItem,
  rating: 1 | 2 | 3 | 4,
  now = new Date(),
  withPreview = true
): CardItem {
  const lastDt = card.last_review_at ? new Date(card.last_review_at) : now;
  const elapsedDays =
    card.state !== 0 ? Math.max(0, Math.floor((now.getTime() - lastDt.getTime()) / 86_400_000)) : 0;

  const reps = (card.reps || 0) + 1;
  let lapses = card.lapses || 0;
  let nextState = card.state || 0;
  let s = card.stability || 0;
  let d = card.difficulty || 0;
  let scheduledDays = 0;
  let dueMs = now.getTime();

  if (card.state === 0) {
    s = initStability(rating);
    d = initDifficulty(rating);
    if (rating === 1) {
      nextState = 1;
      dueMs = now.getTime() + 60_000;
    } else if (rating === 2) {
      nextState = 1;
      dueMs = now.getTime() + 5 * 60_000;
    } else if (rating === 3) {
      nextState = 1;
      dueMs = now.getTime() + 10 * 60_000;
    } else {
      nextState = 2;
      scheduledDays = nextInterval(s);
      dueMs = now.getTime() + scheduledDays * 86_400_000;
    }
  } else if (card.state === 1 || card.state === 3) {
    s = s > 0 ? s : initStability(rating);
    d = d > 0 ? d : initDifficulty(rating);
    if (rating === 1) {
      nextState = card.state;
      dueMs = now.getTime() + 5 * 60_000;
    } else if (rating === 2) {
      nextState = card.state;
      dueMs = now.getTime() + 10 * 60_000;
    } else if (rating === 3) {
      nextState = 2;
      scheduledDays = nextInterval(s);
      dueMs = now.getTime() + scheduledDays * 86_400_000;
    } else {
      nextState = 2;
      const goodIvl = nextInterval(s);
      scheduledDays = Math.max(nextInterval(s * 1.3), goodIvl + 1);
      dueMs = now.getTime() + scheduledDays * 86_400_000;
    }
  } else {
    const r = forgettingCurve(elapsedDays, s);
    d = nextDifficulty(d, rating);
    if (rating === 1) {
      lapses += 1;
      s = Math.max(0.1, Math.min(nextForgetStability(card.difficulty, card.stability, r), card.stability));
      nextState = 3;
      dueMs = now.getTime() + 5 * 60_000;
    } else {
      s = Math.max(0.1, nextRecallStability(card.difficulty, card.stability, r, rating));
      nextState = 2;
      let ivl = nextInterval(s);
      if (rating === 2) {
        ivl = Math.max(1, Math.min(ivl, Math.max(1, Math.round((card.scheduled_days || 1) * 1.2))));
      } else if (rating === 4) {
        ivl = Math.max(ivl, (card.scheduled_days || 0) + 1);
      }
      scheduledDays = ivl;
      dueMs = now.getTime() + scheduledDays * 86_400_000;
    }
  }

  const nowIso = now.toISOString();
  const updated: CardItem = {
    ...card,
    state: nextState,
    stability: Number(s.toFixed(4)),
    difficulty: Number(d.toFixed(4)),
    elapsed_days: elapsedDays,
    scheduled_days: scheduledDays,
    reps,
    lapses,
    due_at: new Date(dueMs).toISOString(),
    last_review_at: nowIso,
    updated_at: nowIso,
  };
  if (withPreview) {
    updated.intervals = previewIntervalsLocal(updated, now);
  }
  return updated;
}

export function previewIntervalsLocal(card: CardItem, now = new Date()): Record<number, string> {
  const labels: Record<number, string> = {};
  for (const r of [1, 2, 3, 4] as const) {
    const nxt = scheduleCardLocal(card, r, now, false);
    const diffSec = Math.max(60, Math.round((new Date(nxt.due_at).getTime() - now.getTime()) / 1000));
    if (diffSec < 3600) {
      labels[r] = `${Math.max(1, Math.round(diffSec / 60))} 分钟`;
    } else if (diffSec < 86400) {
      labels[r] = `${Math.round(diffSec / 3600)} 小时`;
    } else if (diffSec < 86400 * 30) {
      labels[r] = `${Math.max(1, Math.round(diffSec / 86400))} 天`;
    } else if (diffSec < 86400 * 365) {
      labels[r] = `${(diffSec / (86400 * 30)).toFixed(1)} 个月`;
    } else {
      labels[r] = `${(diffSec / (86400 * 365)).toFixed(1)} 年`;
    }
  }
  return labels;
}

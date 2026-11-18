import { describe, expect, it } from 'vitest';
import { fillBracketSlots } from '../src/lib/reply-clean.js';

/**
 * P334 — live replies shipped unfilled template slots (「一直想去看那个
 * [某部电影/展]」「最近发现一家很棒的[咖啡馆/展览]」), leaking the
 * fill-in-the-blank structure behind the promised「能直接照着用」line.
 * fillBracketSlots rewrites every surviving […]/【…】 slot into a generic
 * phrase that reads correctly: a deterministic table covers the usual
 * venue/activity slots, the generic fallback unwraps the first alternative
 * (某个X → 一个X), and markdown links / code / URLs pass through untouched.
 */

const SLOT = /\[[^\]]{1,20}\]/;
const SLOT_FW = /【[^【】]{1,20}】/;

describe('P334 · fillBracketSlots rewrites unfilled slots naturally', () => {
  it('rewrites the two live-observed replies', () => {
    expect(
      fillBracketSlots('一直想去看那个[某部电影/展]，正愁没人陪，周六下午有空一起吗？'),
    ).toBe('一直想去看一部电影，正愁没人陪，周六下午有空一起吗？');
    expect(fillBracketSlots('最近发现一家很棒的[咖啡馆/展览]，感觉你会喜欢')).toBe(
      '最近发现一家挺有氛围的小店，感觉你会喜欢',
    );
  });

  it('covers full-width 【】 variants with the same pass', () => {
    expect(fillBracketSlots('约在了【某家餐厅/火锅店】等你')).toBe(
      '约在了一家挺有氛围的小店等你',
    );
  });

  it('drops the slot intro so the replacement does not double up', () => {
    expect(fillBracketSlots('试试那个[某个App/软件]吧')).toBe('试试一个App吧');
    expect(fillBracketSlots('约那个[某天/周末]见')).toBe('约周六下午见');
    expect(fillBracketSlots('听说那个[某个乐队/歌手]最近很火')).toBe(
      '听说一场不错的演出最近很火',
    );
  });

  it('keeps a describing adjective when the fill is a bare noun', () => {
    expect(fillBracketSlots('介绍他很棒的[朋友/哥们儿]给我')).toBe('介绍他很棒的朋友给我');
  });

  it('falls back to a venue filler when nothing sensible applies', () => {
    expect(fillBracketSlots('就定在[xxx]见')).toBe('就定在附近一家不错的店见');
    expect(fillBracketSlots('就定在[/]见')).toBe('就定在附近一家不错的店见');
  });

  it('leaves no bracket pair in a battery of representative replies', () => {
    const replies = [
      '一直想去看那个[某部电影/展]，正愁没人陪，周六下午有空一起吗？',
      '最近发现一家很棒的[咖啡馆/展览]，感觉你会喜欢。',
      '可以这样说：「周六那家[某家餐厅/小店]我订好位了，去接你？」',
      '要不约【某个展/市集】逛逛，累了再找地方坐。',
      '她喜欢[某类电影/类型片]，你顺着聊一句就行。',
      '上次说的[某个地方/景点]这周末正好顺路。',
      '先回一句「[某句话/话术]」，看她怎么接。',
    ];
    for (const reply of replies) {
      const cleaned = fillBracketSlots(reply);
      expect(cleaned, reply).not.toMatch(SLOT);
      expect(cleaned, reply).not.toMatch(SLOT_FW);
      // The fill keeps the sentence a sendable line — no empty slot residue.
      expect(cleaned.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('P334 · fillBracketSlots leaves non-slot text untouched', () => {
  it('does not rewrite markdown link targets', () => {
    const reply = '看这个[攻略](https://example.com/a)吧，写得挺细';
    expect(fillBracketSlots(reply)).toBe(reply);
  });

  it('does not touch inline code, fenced code or URLs', () => {
    const reply = '用 `arr[0]` 取第一项\n```\nlist[1] = x;\n```\n再看 https://a.b/c[2] 就好';
    expect(fillBracketSlots(reply)).toBe(reply);
  });

  it('returns a bracket-free reply byte-identical', () => {
    const reply = '今晚先别想太多，好好睡一觉。';
    expect(fillBracketSlots(reply)).toBe(reply);
  });

  it('is idempotent', () => {
    const once = fillBracketSlots('一直想去看那个[某部电影/展]，正愁没人陪');
    expect(fillBracketSlots(once)).toBe(once);
  });
});

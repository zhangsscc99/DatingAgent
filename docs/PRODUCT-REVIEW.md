# DatingAgent — Product Review (first-person walkthroughs)

Loop rule: every round of the autonomous dev loop starts with a real-user walkthrough in a
fresh browser context, before any feature work. Impressions are first-person and subjective;
scores are 1-5 and anything below 3 must become a backlog item in `docs/FEATURES.md`.

---

## 2026-11-16 11:20 UTC · viewport 1440x900 + 390x844 (fresh context, no cache)

### What I did (fixed 10-step journey)

1. Opened http://127.0.0.1:3012 with an empty localStorage — landed on the onboarding modal
   over a blurred hero.
2. Filled 昵称「小周」/ 年龄 28 / 兴趣「徒步, 摄影」/ 恋爱目标「认真恋爱」→ 开始咨询.
3. Sent three messages in different tones: happy (「聊得挺好，怎么自然地约她出来」),
   anxious (「她这两天回消息变慢了，我有点焦虑」), dry (「周六下午三点，看展还是喝咖啡，你定。」).
4. Watched the reply area the whole time (sampled bubble text length every 0.5 s).
5. Cleared all chats from the sidebar.
6. Used the sidebar filter with a keyword that matches nothing, then cleared it.
7. Refreshed the page and checked that the conversation survived.
8. Opened 我的资料 → 编辑 and checked the form values.
9. Re-read the same screens at 390x844 (header actions collapse to ⬇ / ⬇ / ⧉).
10. Compared what I felt on each screen against what a dating-coach product should feel like.

### What I saw, in my own words

- The onboarding card is genuinely pretty on mobile: one column, big touch targets, magenta CTA,
  no clipping at 390px, 「稍后再说」 is clearly secondary. It does not feel like a programmer demo.
- Filling the profile and hitting 开始咨询 gave me no confirmation at all — the modal just vanished.
  I half-expected 「已保存」or the greeting to address me by name. It does say 「小周，28 岁」 in the
  sidebar afterwards, so the data is there, I just had to go looking for it.
- The first answer arrived **complete in one shot**: I sat looking at 「正在思考… / 正在生成回复」
  and then a wall of Markdown appeared. I sampled the bubble every 0.5 s: it stayed at 4–16
  characters for the entire wait, then jumped to the full 1145-character answer. Waiting 12.7 s,
  then 18.3 s, then **34.5 s** with nothing moving on screen felt dead — I caught myself
  re-clicking the composer to check whether the tab was frozen.
- When the answer did land it was good: it read my 徒步/摄影 interests and built邀约 examples on them,
  it never slipped into PUA talk, and the structure (时机 → 话术 → 心态) is what I wanted.
  It's long, though — 1100+ characters for a simple question, and I scrolled past the useful part.
- The anxious message got a warm, non-judgemental reply; the dry one got a crisp plan. Three tones,
  three appropriate registers: the conversation quality is not the problem, the arrival is.
- Sidebar search with a nonsense keyword shows 「没有匹配「不存在关键词」的对话」+ 清除筛选 — exactly
  what I wanted, one click and the list was back.
- Refresh: all four bubbles came back, the session row still says 「4 条」. State consistency is solid.
- 我的资料 → 编辑 was prefilled with 小周/28/徒步、摄影/认真恋爱 — no data-loss trap.
- Small things I noticed while waiting: a chip under the composer says 「剩余请求 29/30」 with no
  explanation of what resets it; during load the header briefly said 「Demo 模式」 before
  「LLM 已连接」, which made me think the demo mode was on.

### Scores (1-5)

| Dimension | Score | One-line reason |
|---|---|---|
| Responsiveness (alive within 1.5 s) | **2** | Reply text only appears after 12.7 / 18.3 / 34.5 s; the bubble shows a static placeholder the whole time. |
| Conversational quality | 4 | Uses my stated interests, warm on anxiety, no PUA; slightly too long and listicle-shaped. |
| State consistency | 4 | Refresh keeps all 4 messages and the sidebar count; profile edit is prefilled. |
| Discoverability | 3 | Onboarding and quick entries are clear, but the quota chip and the transient 「Demo 模式」 badge left me guessing. |

### What I naturally wanted next but the product lacked

- I wanted to **see the answer being written**. Even 3–4 characters per second would have told me
  the app was alive; the current static 「正在生成回复」 is indistinguishable from a hang.
- I wanted the onboarding save to acknowledge itself (a toast, or the greeting using my name).
- I wanted to know what 「剩余请求 29/30」 means without hovering a mystery chip.

### Backlog derived from this walkthrough

- **P189 (P0)** token-level streaming — responsiveness scored 2, so it becomes backlog and is this
  round's item.
- **P190 (P1)** 剩余请求 quota chip is unexplained to a first-time user.
- **P191 (P2)** the interests field asks the user to obey a comma rule instead of parsing it.

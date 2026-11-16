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

---

## 2026-11-16 12:10 UTC · viewport 390x844 + 1440x900 (fresh context, no cache)

### What I did

Same 10-step journey. This round I sampled the reply bubble every 0.5 s while waiting, to check
whether P189's streaming actually reached the browser.

### What I saw, in my own words

- **The wait finally has a pulse.** Reply 1: placeholder text for 4 s, then the bubble started
  growing at 9.2 s and was complete at 25.6 s (26 → 91 → 140 → 232 → 414 → 857 chars). Reply 3:
  first visible text at 15.6 s. Compared with last round's 「12.7 / 18.3 / 34.5 s, then a wall of text」
  this is a different product — I could tell it was writing.
- **But the first 9–16 seconds are still a still image.** The bubble sits on 「正在生成回复」 with no
  motion, no elapsed time, no character count. Twice I caught myself wondering whether 停止 would be
  faster than waiting. The minutes of doubt shrank, they did not disappear.
- The growth is bursty rather than smooth: it held at 26 characters for ~7 s, then jumped 26 → 300 in
  one second. That is the model, not the UI, but it means the "alive" feeling arrives late and then
  all at once.
- Quality is unchanged and good: the anxious message got 「先深呼吸一下，你的焦虑我接住了」 plus a
  non-blaming read of slow replies; the dry 「你定」 got a decisive 「☕ 定：咖啡 + 城市漫步」 with a
  three-line reason and a same-day checklist. Answers run 300–890 characters — still long.
- Refresh kept all 8 bubbles, the sidebar row still reads 「8 条」, and 我的资料 → 编辑 was prefilled
  (小周 / 28 / 徒步、摄影 / 认真恋爱). Nothing to complain about.
- The quota chip is the one thing that still reads like a debugging aid: 「剩余请求 27/30」 with the
  explanation only in `title`/`aria-label`, and after a page reload it is **absent entirely** until
  the next reply arrives (budget state is null until a response carries the headers).
- Sidebar filter empty state now says both 「无匹配对话：」 and 「没有匹配「zzz不存在」的对话」 — two
  lines saying the same thing, slightly noisy but not confusing.
- Profile-edit dialog measures 342×688 inside 390×844: fits, no clipping.

### Scores (1-5)

| Dimension | Score | One-line reason |
|---|---|---|
| Responsiveness (alive within 1.5 s) | **3** | Text now streams visibly from 9.2 s / 15.6 s and completes in bursts, but time-to-first-token is still a silent 9–16 s. |
| Conversational quality | 4 | Warm on anxiety, decisive on the dry message, uses my 徒步/摄影 interests; still 300–890 characters. |
| State consistency | 4 | 8 bubbles, sidebar count and profile all survive a refresh. |
| Discoverability | 3 | Onboarding is clear, but 「剩余请求 27/30」 is still unexplained in visible text and vanishes on reload. |

### What I naturally wanted next but the product lacked

- While the bubble is still empty, **something that counts**: 「正在生成… 已等待 6 秒」 or a live
  character counter. Anything that changes once a second makes the 9 s wait feel like progress.
- The quota chip should exist from page load (or not exist at all), and its visible text should say
  「本分钟」 instead of leaving it to a tooltip.

### Backlog derived from this walkthrough

- **P190 (P1)** quota chip copy — already in the pool, top unchecked item, this round's work.
- **P192 (P2)** the first-token window (9–16 s) still shows a frozen placeholder; a live elapsed
  counter would carry it.

### Harness note (not a product bug)

The mobile drawer measured `translateX(-100%)` while carrying `.open`: the CSS transition reports
`playState: "running"` forever in this headless harness, so transform never advances. Forcing
`transition: none` snaps it to `translateX(0)` and the drawer is correct. Do not file drawer CSS
bugs from this harness without re-checking with transitions disabled.

## 2026-11-16 12:34 UTC · viewport 390x844 (fresh context, cache cleared) + 780x380 default

### What I did

Same 10-step journey, this time as a **brand-new user**: cleared storage, filled onboarding the
way a normal person would type (`徒步 摄影 烹饪`, spaces, no documentation read), sent the three
tone messages, opened 我的资料 → 编辑, searched the sidebar with a nonsense term, refreshed, and read
the empty-state copy.

### What I saw, in my own words

- **First visible character: 6.5 s / 15.2 s / 11.6 s** on the happy / anxious / dry messages, with
  the bubble sitting on a static 「正在生成回复」 the whole time. P190's chip beside the composer is
  fixed and reads 「本分钟还可提问 29 次」, so the thing I *can* read is the rate limit while the thing
  I actually care about — how long I have been waiting — is still silent. P192 is exactly this gap.
- **The replies are the best part of the product.** The anxious message got 「先深呼吸——两小时真的
  不算异常信号」, a non-blaming read, and an explicit 「不建议问『怎么回这么慢』」. The dry 「你定」 got a
  decision plus a ready-to-paste message with a stated duration (「一个半小时左右」). It quoted my own
  interests (「我知道条江边很好拍的徒步路线」). This is worth waiting 12 s for.
- **Onboarding silently ate my interests.** I typed `徒步 摄影 烹饪` (spaces, the way you type when
  nothing tells you otherwise); the placeholder said 「…（用逗号分隔）」 which I read as *example
  separator*, not *a required syntax*. Stored result: `{"interests":["徒步 摄影 烹饪"]}` — one item.
  My profile card then showed 「徒步 摄影 烹饪」 which *looks* like three interests, so the damage is
  invisible; reopening 编辑 showed the raw string `徒步 摄影 烹饪` in the field, and the model happened
  to split it on its own — pure luck, not design. Same field, no error, no hint.
- **The quota chip disappears after a refresh** (chip: `absent` on the reloaded page until the next
  reply). Still the one element that reads like a debugging aid that comes and goes.
- **Filter empty state says the same thing twice**: 「无匹配对话：」 above 「没有匹配「zzz不存在」的对话」
  plus 清除筛选. Slightly noisy, not confusing — cosmetic only.
- Refresh kept all 6 bubbles, the sidebar row read 「6 条」, and the header's three export buttons fit
  inside 390 px as icons (P183 holds). Clearing everything goes through a native `window.confirm`,
  which froze the automation harness (not a product bug — but a custom dialog would be nicer on mobile).

### Scores (1-5)

| Dimension | Score | One-line reason |
|---|---|---|
| Responsiveness (alive within 1.5 s) | **3** | Text streams once it starts, but 6.5–15.2 s of frozen placeholder is still the first thing you feel. |
| Conversational quality | 5 | The anxious reply refused to feed my anxiety and the dry reply made a decision with a paste-ready message. |
| State consistency | 4 | 6 bubbles, sidebar count, profile chips and header layout all survive a refresh. |
| Discoverability | 3 | Onboarding is obvious, but nothing tells me how interests must be written and the quota chip vanishes on reload. |

### What I naturally wanted next but the product lacked

- A live elapsed counter during the first 6–15 s (P192, queued).
- The interests field to accept what I type — spaces included — and to show me the parsed chunks
  before saving (this round's item, P191).
- The quota chip to exist from page load instead of appearing after the first reply.

### Backlog derived from this walkthrough

- **P191 (P1)** interests parsing is this round's work — evidence measured live above.
- **P192 (P2)** the frozen first-token window is unchanged and is now the top responsiveness item.

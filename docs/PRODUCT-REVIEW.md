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

## 2026-11-16 12:55 — 第二轮真人走查（构建 6dd9671，390×844 + 1440×900）

清空 localStorage 后从零开始，模拟一个第一次用的普通用户：填昵称「林夏」、兴趣写「徒步 摄影 烹饪」（不按规则打逗号），然后连着问三条不同情绪的话。

**我看到什么。** 引导弹窗开门见山，占位文案现在是「徒步、摄影、烹饪…（逗号、空格都行）」——我照着空格敲，保存后侧栏和欢迎页各出现三枚 chip「徒步 / 摄影 / 烹饪」，说明上一轮 P191 真的生效了，我不再需要猜分隔符。发第一条（开心约看展）后，气泡里先出现「正在思考」，大约 3.9 s 变成「正在生成回复」，然后就一动不动；我盯着屏幕数到 8.5 s 才蹦出第一个字「可以回得**开心但不过度激动」。第二句（焦虑，三小时没回）这次更久：0.2 s 出现「正在思考」，6.2 s 换成「正在生成回复」，11.1 s 才有第一个字。第三句（干巴，「明天约会去哪吃？给个方案。」）8.4 s 出字。

**哪里卡住了我。** 就是这段 4–11 s 的静止。两次我手指已经移到底部想找「停止」按钮——没有；也想再发一条催它，但发出去只会更乱。P189 之后流式是好的（出字之后 200 ms 一段，看得出在写），可是「还没出字」的这段时间在所有回复里占了一半，而且占位文案是冻住的四个字，读起来和一个卡死的请求没有区别。这条是 P192，本轮已实现。

**我自然而然想要、产品却没有的。** ①等待时给我一个在动的秒数，让我知道它在干活而不是挂了（P192）。②「复制 / 换一个」这两个动作出现在气泡底部，我等的时候气泡里什么都没有，于是那行按钮在空白气泡里孤零零悬着——直到正文到达才有内容可复制。③情绪化的问题（焦虑那条）回得很暖，但它用 🌟 emoji 开头做小标题，和产品「不 emoji 装饰」的调性有点冲；这条只是观感，不列 backlog。

**手机端（390×844）实测。** 顶栏三个导出按钮已经收成图标，`.header-actions` 右边界 374 px < 视口 390 px，没有溢出（P183 守住）。刷新后 6 条气泡、侧栏「6 条」、资料 chip 全在。但底部的输入框有问题：`textarea` 高度 50 px，而它的内容需要 96 px，占位文案「描述你的问题，例如：对方说「在干嘛」，我该怎么回？」在 390 px 下折成三行、被从中间切断，看起来像被裁了一半的字——这是本轮新发现，记为 P193。

**侧栏筛选空态**仍有重复：「无匹配对话：」和「没有匹配「zzz不存在」的对话」上下叠着说同一件事，能一键「清除筛选」，不阻断操作，记为 cosmetic P194。

### Scores (1-5)

| Dimension | Score | One-line reason |
|---|---|---|
| Responsiveness (alive within 1.5 s) | 3 | 出字之后是活的（200 ms 一帧），但 8.4–11.1 s 的冻结占位仍是第一感受。 |
| Conversational quality | 5 | 焦虑那条先接住情绪再给三条不施压的跟进话术；干巴那条直接给了餐厅类型、预算和一句可复制的话。 |
| State consistency | 4 | 刷新后 6 条气泡、侧栏计数、资料 chip 全部一致；只有配额 chip 在刷新后消失（老问题）。 |
| Discoverability | 3 | 引导清晰、兴趣不再要求语法；但等待期没有任何进度提示，手机上输入框占位文案被裁。 |

### Backlog derived from this walkthrough

- **P192 (P1)** 首字到达前的静止占位 —— 本轮实现，实测 8.5 / 11.1 / 8.4 s。
- **P193 (P2)** 390 px 下输入框占位文案被裁断（textarea 50 px vs scrollHeight 96 px），新增。
- **P194 (cosmetic)** 筛选空态重复文案，新增。

## 2026-11-16 13:28 — P193 复测（390×844 输入框占位）

本轮修的 P193，我回到 390×844 重新量了一遍：修复前 `textarea` 高 50 px、`scrollHeight` 96 px，「…我该怎么回？」被拦腰切断；修复后占位文案换成「说说你的情况…」，`scrollHeight` 48 px ≤ `clientHeight` 48 px，一行放得下，不再有裁断感。1440×900 下仍是原来的完整提示文案，`aria-label` 两种宽度都是「描述你的问题，例如：对方说「在干嘛」，我该怎么回？」。顺手把发送键、快捷键提示钮、气泡排布都看了一遍，没有发现新的错位；唯一留意的是 431–600 px 之间长文案理论上仍可能折两行（composer 只有 48–50 px），这次没动它，先记下。


## 2026-11-16 13:20 — 第三轮真人走查（构建 a079811，390×844 + 1440×900，全新浏览器上下文）

又清了一次 localStorage 从零走 10 步旅程：落地 → 新对话 → 连着发三条不同情绪的消息 → 盯着回复质量和延迟 → 清空对话 → 侧栏筛选 → 刷新 → 找设置入口。

**我看到什么。** 回复质量是这产品最强的一项。焦虑那条「她三个小时没回我消息，我是不是做错什么了，我很慌。」拿到的回答居然引用了我上一轮开心时的问题（「你之前问我怎么把气氛推进…」），还点出了情绪模式而不是甩模板——是真的在听。第三条干得只剩「嗯，她回了。」四个字，它照样给了具体的"下一句怎么说"，不是敷衍的填充回复。首字延迟实测：第一条 ~5 s，第二条 9.2 s，第三条 15.2 s，完整回复 15–19 s。P192 的「正在生成…（已等待 N 秒）」计数器确实在走，但 15 秒里除了一个数字在跳什么都没有，仍是整个体验最弱的一段。

**哪里卡住了我。** ①旅程里"打开设置"这一步根本没有目的地——全站没有任何设置界面，只有主题切换、快捷键说明和导出；一个想改回复风格、语言或模型的新用户无处可去。②桌面端 1440×900 的输入框：`textarea` 宽 364 px、高 47 px，`scrollHeight` 66 px——长占位文案折成两行，第二行被从字形中间切掉（截图确认）。P193 在手机上修好的"是不是坏了"的感觉，在桌面上还在。③侧栏筛选空态还是把同一句话说两遍：「无匹配对话：」下面叠着「没有匹配「zzz不存在」的对话」。

**刷新与状态。** 刷新后 6 条气泡全部还原，会话标题一字不差；清空对话、筛选、恢复都正常。

### Scores (1-5)

| Dimension | Score | One-line reason |
|---|---|---|
| Responsiveness (alive within 1.5 s) | **2** | 第三条首字等了 15 s，期间只有一个计数器在动。 |
| Conversational quality | 5 | 有上下文记忆、点名情绪模式、给出可直接用的话术。 |
| State consistency | 4 | 刷新后 6 条消息和会话标题精确还原。 |
| Discoverability | 4 | 快捷入口 chip 和每条回复的 复制/换一个 都很显眼；但没有设置入口，导出藏在一排工具按钮里容易漏看。 |

**我自然而然想要、产品却没有的。** ①一个真正的设置入口——哪怕只是一张改回复长度、语言、主题的小面板，"找设置"这一步应该有地方落。②桌面输入框的占位文案别被裁掉半行：要么宽屏也换短文案，要么让 textarea 按占位行数自动撑高，P193 的修法不该只覆盖 ≤430 px。③首字等待期除了秒数，再给一点"它在写什么"的信号——比如已收到的字符数或阶段性提示，15 s 只数秒还是觉得像挂起。

## 2026-11-16 13:52 — 第四轮真人走查（构建 a079811，390×844 + 1440×900 + 500 px 补充测量）

全新上下文、清 localStorage 从零走固定 10 步旅程：落地 → 新对话 → 三条不同情绪的消息 → 判回复质量与延迟 → 清空 → 侧栏搜索/筛选 → 刷新 → 找设置。

**我看到什么。** 手机端（390×844）输入框占位是「说说你的情况…」，`textarea` 240×48、`scrollHeight` 48，一行放得下，P193 守住了；`documentElement.scrollWidth == clientWidth == 390`，没有横向溢出。发第一条（约看展）时我盯着屏幕等首字：**16.2 s** 才蹦出「可以…」，期间只有「正在生成回复」和计数器；第二条（焦虑「三小时没回」）更久，首字 ~33 s；第三条只发「嗯，她回了。」5 s 左右就出答案，回复里明确说「不要用委屈抱怨或报复性冷淡的方式回」并让我把对方原话贴过来——这一条读起来像真人，不是在套模板。开头发「你好」那次，它回了一整张「服务清单」表格（💡资料优化 / 💬聊天指导 / 🌹约会策划 …），在 390 px 下表格没有被渲染，整段是竖着流的 `| 服务 | 说明 | |------|------|` 管道符，加上 👋😊 这堆表情，像一张塞进聊天气泡的产品彩页。

**哪里卡住了我。** ①首字等待仍是第一感受：16–33 s 里可点、可看的东西只有一个数字和「停止」，我两次把手指悬在停止键上。②「打开设置」这一步还是没地方落——全站搜不到「设置」，只有主题、快捷键、导出。③侧栏筛选空态依旧把同一句话说两遍：「无匹配对话：」下面紧接「没有匹配「zzz不存在」的对话」，再给「清除筛选」。④侧栏里「快捷入口」「AGENT 工具」两栏全是 emoji 图标（📝💬📅💕🎯），和产品整体的克制调性不符。

**刷新与状态。** 刷新后气泡、侧栏会话、资料 chip 全部还原；清空、筛选、恢复都正常，没有死链接。

**补充测量（P195 的前提要更正）。** 上一轮记录的「1440×900 下 textarea 364 px 宽、占位被裁」在我这里复现不出来：1440 下 `textarea` 1022×45、`scrollHeight` 45，占位一行放得下；侧栏是浮层抽屉，打开后输入框宽度不变。真正会裁的是一段窄窗：**500 px 视口 → 344×48 / scrollHeight 72；432 px → 276×48 / 72（裁掉约一行）**，600 px 就恢复正常。所以 P195 的修法应是「让 textarea 按占位行数自动撑高（min-height）」，覆盖 431–599 px 这段，而不是去改 1440 的文案。

### Scores (1-5)

| Dimension | Score | One-line reason |
|---|---|---|
| Responsiveness (alive within 1.5 s) | 2 | 三条实测首字 16.2 s / ~33 s / ~5 s，等待期只有一个数字在跳。 |
| Conversational quality | 4 | 情绪化那条接得住、给可直接用的话术；但打招呼换来一张带 emoji 的服务清单表格，且在手机上渲染成管道符。 |
| State consistency | 4 | 刷新后气泡、会话、资料 chip 精确还原。 |
| Discoverability | 3 | 引导清楚、筛选能一键清除；仍无设置入口，Emoji 图标林立的侧栏不像同一个产品。 |

### Backlog derived from this walkthrough

- **P194 (cosmetic)** 筛选空态同一句话说两遍 —— 本轮实现。
- **P195 (P2, 证据更正)** 真正的折行区间是 431–599 px（500 px 下 48 vs 72），不是 1440。
- **P196 (P1)** 没有设置入口。
- **P197 (P2, 新增)** 助手回复里的 Markdown 表格在气泡中不渲染，手机上整段变成 `| 服务 | 说明 |` 管道符串；同一轮还夹带 👋😊💡 emoji 小标题。

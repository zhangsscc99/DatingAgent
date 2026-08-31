import type { AgentContext, ToolDefinition } from '../agent/types.js';

const profileAnalyzer: ToolDefinition = {
  name: 'analyze_profile',
  description: 'Analyze and optimize a dating profile bio for authenticity and appeal',
  parameters: {
    type: 'object',
    properties: {
      bio: { type: 'string', description: 'Current profile bio text' },
      platform: { type: 'string', description: 'Dating platform (tinder, hinge, etc.)' },
    },
    required: ['bio'],
  },
  async execute(args, ctx) {
    const bio = String(args.bio ?? '');
    const platform = String(args.platform ?? 'general');

    const strengths: string[] = [];
    const improvements: string[] = [];

    if (bio.length > 50) strengths.push('资料有一定长度，展示了个人特点');
    else improvements.push('建议补充 2-3 个具体兴趣或经历，让资料更立体');

    if (/[？?]/.test(bio)) strengths.push('使用了问句，有助于引发对话');
    else improvements.push('可以加一个开放式问题，方便对方接话');

    if (/喜欢|热爱|兴趣/.test(bio)) strengths.push('表达了兴趣爱好');
    else improvements.push('加入 1-2 个真实爱好，比空泛形容词更有吸引力');

    const suggestedBio =
      bio.length > 20
        ? `${bio.slice(0, 80)}…\n\n💡 优化版：在末尾加一句「最近在学 ___，有同好吗？」`
        : '周末喜欢徒步和探店，最近在学手冲咖啡。你最近有什么让你开心的小事？';

    return JSON.stringify(
      {
        platform,
        score: Math.min(85, 50 + bio.length / 3 + strengths.length * 10),
        strengths,
        improvements,
        suggestedBio,
        tips: [
          '用具体场景代替抽象形容词（「爱旅行」→「上周在大理骑了 30 公里」）',
          '展示价值观而非只列条件',
          '保持真实，面试级项目也要真实 😄',
        ],
      },
      null,
      2,
    );
  },
};

const conversationCoach: ToolDefinition = {
  name: 'coach_conversation',
  description: 'Provide conversation reply suggestions with tone analysis',
  parameters: {
    type: 'object',
    properties: {
      scenario: { type: 'string', description: 'The conversation context or message received' },
      tone: { type: 'string', enum: ['warm', 'playful', 'sincere', 'casual'], description: 'Desired tone' },
    },
    required: ['scenario'],
  },
  async execute(args) {
    const scenario = String(args.scenario ?? '');
    const tone = String(args.tone ?? 'warm');

    const replies: Record<string, string[]> = {
      warm: [
        '听起来很棒！我也很喜欢这类体验，你最喜欢哪个部分？',
        '谢谢分享，感觉你对生活很有热情呢',
      ],
      playful: [
        '哈哈这个回答我要给满分，下一个问题更难哦',
        '看来我们有个共同点，要不要比比谁的故事更离谱？',
      ],
      sincere: [
        '我很欣赏你的坦诚，这让我觉得可以更深入地聊聊',
        '能理解你的感受，这种情况确实需要一些勇气',
      ],
      casual: [
        '不错诶，下次可以带上我一起',
        '懂了懂了，那你平时还喜欢干嘛',
      ],
    };

    const options = replies[tone] ?? replies.warm;

    return JSON.stringify(
      {
        scenario,
        tone,
        analysis: {
          intent: '对方在分享个人经历或表达观点',
          risk: '避免只回「哦」「嗯」，容易终结话题',
          strategy: '镜像 + 延伸：先回应情绪/内容，再抛一个开放式问题',
        },
        suggestedReplies: options.map((text, i) => ({
          id: i + 1,
          text,
          why: i === 0 ? '自然承接 + 开放提问' : '轻松幽默，降低压力',
        })),
        avoid: ['过早表白', '查户口式连环问', '复制粘贴感太强的套路'],
      },
      null,
      2,
    );
  },
};

const datePlanner: ToolDefinition = {
  name: 'plan_date',
  description: 'Generate personalized date plan ideas based on interests and budget',
  parameters: {
    type: 'object',
    properties: {
      interests: { type: 'array', items: { type: 'string' }, description: 'Shared interests' },
      budget: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Budget level' },
      city: { type: 'string', description: 'City name' },
    },
    required: ['interests'],
  },
  async execute(args, ctx) {
    const interests = (args.interests as string[]) ?? ctx.profile.interests ?? ['咖啡', '散步'];
    const budget = String(args.budget ?? 'medium');
    const city = String(args.city ?? '本地');

    const plans = [
      {
        title: '咖啡 + 城市漫步',
        duration: '2-3 小时',
        activities: ['选一家有特色的独立咖啡馆', '沿河边或老街区散步 40 分钟', '路过有趣的小店时可以即兴停留'],
        why: `契合兴趣：${interests.slice(0, 2).join('、')}，压力小、方便深入聊天`,
        budget: budget === 'low' ? '¥50-100' : '¥100-200',
      },
      {
        title: '展览 + 轻食',
        duration: '3-4 小时',
        activities: ['看一个小型艺术展或摄影展', '展后找附近 bistro 吃轻食', '聊对展品的感受（比聊条件自然得多）'],
        why: '共同体验创造话题，比干坐着吃饭不容易冷场',
        budget: '¥150-300',
      },
      {
        title: '运动 + 果汁吧',
        duration: '2 小时',
        activities: ['一起骑共享单车探索 ${city}', '结束后去果汁吧复盘路线', '拍 1-2 张合照留作纪念'],
        why: '轻度运动释放紧张感，适合第二次约会',
        budget: '¥30-80',
      },
    ];

    return JSON.stringify({ city, interests, budget, plans }, null, 2);
  },
};

const compatibilityCheck: ToolDefinition = {
  name: 'check_compatibility',
  description: 'Analyze relationship compatibility based on described traits and values',
  parameters: {
    type: 'object',
    properties: {
      traits: { type: 'string', description: 'Description of both personalities/values' },
    },
    required: ['traits'],
  },
  async execute(args) {
    const traits = String(args.traits ?? '');

    return JSON.stringify(
      {
        summary: '基于你描述的信息，以下是关系匹配度参考分析（非绝对结论）',
        dimensions: [
          { name: '沟通风格', score: 78, note: '一方偏理性一方偏感性，互补但需主动同步节奏' },
          { name: '价值观', score: 82, note: '对诚实和成长有共识，长期潜力较好' },
          { name: '生活方式', score: 70, note: '社交频率有差异，需要提前对齐期待' },
          { name: '冲突处理', score: 75, note: '建议建立「冷静期 + 复盘」机制' },
        ],
        overallScore: 76,
        strengths: ['都愿意为关系投入时间', '有共同兴趣可以深化连接'],
        watchouts: ['避免用「你应该」句式', '重大决定前多给彼此表达空间'],
        traits,
      },
      null,
      2,
    );
  },
};

const relationshipAdvice: ToolDefinition = {
  name: 'get_relationship_advice',
  description: 'General relationship coaching and advice',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'User relationship question' },
    },
    required: ['question'],
  },
  async execute(args) {
    const question = String(args.question ?? '');

    return JSON.stringify(
      {
        question,
        framework: 'GIVE 模型：Genuine（真诚）→ Interest（兴趣）→ Vulnerability（适度脆弱）→ Empathy（共情）',
        advice: [
          '先处理情绪，再处理事情 — 对方需要被理解，而不是被说服',
          '用「我感受」代替「你总是」，减少防御性',
          '好的关系不是找完美的人，而是一起成长',
        ],
        nextStep: '如果愿意，可以描述具体场景，我用 coach_conversation 帮你模拟回复',
      },
      null,
      2,
    );
  },
};

export const toolRegistry: ToolDefinition[] = [
  profileAnalyzer,
  conversationCoach,
  datePlanner,
  compatibilityCheck,
  relationshipAdvice,
];

export function getTool(name: string): ToolDefinition | undefined {
  return toolRegistry.find((t) => t.name === name);
}

import type { ChatIntent, ReplyLanguage, UserProfile } from '../types';
import type { ReplyLengthRequest } from './replyLength';

export interface ChatRequestFields {
  sessionId: string | null;
  message: string;
  profile?: UserProfile | null;
  language: ReplyLanguage;
  /** Non-default reply-length preference; the key is omitted entirely at 默认. */
  replyLength?: ReplyLengthRequest;
  /** P284: reply versions 「换一个」 must not repeat; omitted on normal sends. */
  previousReplies?: string[];
  /** P345: which starter capsule composed the first message; omitted for typed input. */
  intent?: ChatIntent;
}

/**
 * Serialize one /api/chat or /api/chat/stream request body. Key order matches
 * the pre-P196 inline payload exactly, so a default preference produces
 * byte-identical output to the old `JSON.stringify({…})` call.
 */
export function buildChatRequestBody(fields: ChatRequestFields): string {
  const body: Record<string, unknown> = {
    sessionId: fields.sessionId,
    message: fields.message,
    profile: fields.profile ?? undefined,
    language: fields.language,
  };
  if (fields.replyLength) body.replyLength = fields.replyLength;
  if (fields.previousReplies?.length) body.previousReplies = fields.previousReplies;
  if (fields.intent) body.intent = fields.intent;
  return JSON.stringify(body);
}

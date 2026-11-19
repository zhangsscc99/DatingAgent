import { useState } from 'react';
import type { ChatIntent } from '../types';
import {
  DATE_ORDINALS,
  PROFILE_PARTS,
  STARTERS,
  assembleStarterMessage,
} from '../lib/starterIntents';

interface Props {
  /** Which starter capsule opened this intake — one branch per intent. */
  intent: ChatIntent;
  /** Drop the assembled first message into the composer (prefill, never send). */
  onSubmit: (text: string) => void;
  /** Close the intake without filling the composer. */
  onCancel: () => void;
}

/**
 * P345 — per-intent intake form behind each starter capsule. Each branch
 * asks for the inputs that branch needs (资料缺哪块 / 她的原话 /
 * 城市·预算·第几次), assembles them into the real first message, and
 * hands it to the composer — replacing the old cosmetic prefills.
 * State resets per branch switch (the parent keys us by intent).
 */
export default function StarterIntake({ intent, onSubmit, onCancel }: Props) {
  const [missing, setMissing] = useState<string | null>(null);
  const [herWords, setHerWords] = useState('');
  const [city, setCity] = useState('');
  const [budget, setBudget] = useState('');
  const [ordinal, setOrdinal] = useState<string>(DATE_ORDINALS[0]);

  const def = STARTERS.find((s) => s.intent === intent)!;
  const assembled = assembleStarterMessage(intent, {
    missing,
    herWords,
    city,
    budget,
    ordinal,
  });

  return (
    <div className="starter-intake" role="group" aria-label={`${def.label}追问`}>
      <p className="starter-intake-q">{def.question}</p>

      {intent === 'profile' && (
        <div
          className="starter-intake-options"
          role="group"
          aria-label="缺的资料"
        >
          {PROFILE_PARTS.map((part) => (
            <button
              key={part}
              type="button"
              className="starter-intake-option"
              data-selected={missing === part ? 'true' : undefined}
              aria-pressed={missing === part}
              aria-label={part}
              onClick={() => setMissing(part)}
            >
              {part}
            </button>
          ))}
        </div>
      )}

      {intent === 'chat-coach' && (
        <textarea
          className="starter-intake-textarea"
          rows={3}
          value={herWords}
          onChange={(e) => setHerWords(e.target.value)}
          aria-label="她的原话"
          placeholder={'比如：「最近有点忙，再说吧」'}
        />
      )}

      {intent === 'date-plan' && (
        <div className="starter-intake-grid">
          <label className="starter-intake-field">
            城市
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              aria-label="城市"
              placeholder="比如 上海"
            />
          </label>
          <label className="starter-intake-field">
            预算
            <input
              type="text"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              aria-label="预算"
              placeholder="比如 300，可留空"
            />
          </label>
          <label className="starter-intake-field">
            第几次约会
            <select
              value={ordinal}
              onChange={(e) => setOrdinal(e.target.value)}
              aria-label="第几次约会"
            >
              {DATE_ORDINALS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="starter-intake-actions">
        <button
          type="button"
          className="starter-intake-fill"
          disabled={assembled === null}
          onClick={() => {
            if (assembled !== null) onSubmit(assembled);
          }}
        >
          填入输入框
        </button>
        <button
          type="button"
          className="starter-intake-cancel"
          onClick={onCancel}
        >
          收起
        </button>
      </div>
    </div>
  );
}

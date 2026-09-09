import { useEffect, useState } from 'react';
import type { UserProfile } from '../types';
import './ProfileOnboarding.css';

const GOAL_OPTIONS = [
  { value: 'serious', label: '认真恋爱，寻找长期伴侣' },
  { value: 'casual', label: '轻松交友，先认识再说' },
  { value: 'improve', label: '提升沟通与约会技巧' },
  { value: 'recover', label: '走出上一段关系，重新出发' },
];

interface Props {
  open: boolean;
  initialProfile?: UserProfile | null;
  allowSkip?: boolean;
  onSave: (profile: UserProfile) => void;
  onSkip?: () => void;
  onClose?: () => void;
}

export default function ProfileOnboarding({
  open,
  initialProfile,
  allowSkip = true,
  onSave,
  onSkip,
  onClose,
}: Props) {
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [interestsText, setInterestsText] = useState('');
  const [goals, setGoals] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(initialProfile?.name ?? '');
    setAge(initialProfile?.age ? String(initialProfile.age) : '');
    setInterestsText(initialProfile?.interests?.join('、') ?? '');
    setGoals(initialProfile?.goals ?? '');
    setError('');
  }, [open, initialProfile]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('请填写昵称，方便我更好地称呼你');
      return;
    }

    const ageNum = age.trim() ? parseInt(age, 10) : undefined;
    if (ageNum !== undefined && (Number.isNaN(ageNum) || ageNum < 18 || ageNum > 120)) {
      setError('年龄需为 18–120 之间的数字');
      return;
    }

    const interests = interestsText
      .split(/[,，、\n]/)
      .map((s) => s.trim())
      .filter(Boolean);

    onSave({
      name: trimmedName,
      age: ageNum,
      interests: interests.length ? interests : undefined,
      goals: goals.trim() || undefined,
    });
  };

  return (
    <div className="profile-overlay" role="dialog" aria-modal="true" aria-labelledby="profile-title">
      <div className="profile-panel">
        {onClose && (
          <button type="button" className="profile-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        )}
        <div className="profile-header">
          <span className="profile-icon">✨</span>
          <div>
            <h2 id="profile-title">完善你的资料</h2>
            <p>告诉我一点关于你的信息，我会给出更贴心的建议</p>
          </div>
        </div>

        <form className="profile-form" onSubmit={handleSubmit}>
          <label className="profile-field">
            <span>昵称 *</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="怎么称呼你？"
              maxLength={32}
              autoFocus
            />
          </label>

          <label className="profile-field">
            <span>年龄</span>
            <input
              type="number"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              placeholder="18+"
              min={18}
              max={120}
            />
          </label>

          <label className="profile-field">
            <span>兴趣爱好</span>
            <input
              type="text"
              value={interestsText}
              onChange={(e) => setInterestsText(e.target.value)}
              placeholder="徒步、摄影、烹饪…（用逗号分隔）"
            />
          </label>

          <fieldset className="profile-field profile-goals">
            <legend>恋爱目标</legend>
            <div className="goal-options">
              {GOAL_OPTIONS.map((opt) => (
                <label key={opt.value} className={`goal-option ${goals === opt.label ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="goals"
                    value={opt.label}
                    checked={goals === opt.label}
                    onChange={() => setGoals(opt.label)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </fieldset>

          {error && <p className="profile-error">{error}</p>}

          <div className="profile-actions">
            {allowSkip && onSkip && (
              <button type="button" className="profile-btn secondary" onClick={onSkip}>
                稍后再说
              </button>
            )}
            <button type="submit" className="profile-btn primary">
              开始咨询
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

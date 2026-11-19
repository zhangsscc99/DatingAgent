import { useEffect, useRef, useState } from 'react';
import { CLEAR_ALL_LABEL } from '../lib/copy';
import { startDialogDismiss } from '../lib/dialogDismiss';
import type { ReplyLengthPreference } from '../lib/replyLength';
import type { Theme } from '../hooks/useTheme';
import type { ReplyLanguage } from '../types';
import './SettingsSheet.css';

// P297 — the segments speak intent in the user's voice; the mechanical
// 档位 names 默认/精简/详细 never reach the settings panel.
const REPLY_LENGTH_OPTIONS: { value: ReplyLengthPreference; label: string }[] = [
  { value: 'default', label: '适中' },
  { value: 'concise', label: '简短一些' },
  { value: 'detailed', label: '详细一些' },
];

const LANGUAGE_OPTIONS: { value: ReplyLanguage; label: string }[] = [
  { value: 'auto', label: '自动' },
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
];

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

type VersionState =
  | { status: 'loading' }
  | { status: 'ok'; version: string; gitSha: string }
  | { status: 'error' };

interface Props {
  open: boolean;
  onClose: () => void;
  replyLength: ReplyLengthPreference;
  onReplyLengthChange: (next: ReplyLengthPreference) => void;
  language: ReplyLanguage;
  onLanguageChange: (next: ReplyLanguage) => void;
  theme: Theme;
  onThemeChange: (next: Theme) => void;
  canExport: boolean;
  hasSessions: boolean;
  busy?: boolean;
  onExportMarkdown: () => void;
  onExportJson: () => void;
  onClearAll: () => void;
  /** Model name already held by the health poll; folded into the 关于 title when present. */
  llmModel?: string;
}

export default function SettingsSheet({
  open,
  onClose,
  replyLength,
  onReplyLengthChange,
  language,
  onLanguageChange,
  theme,
  onThemeChange,
  canExport,
  hasSessions,
  busy = false,
  onExportMarkdown,
  onExportJson,
  onClearAll,
  llmModel,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);
  const wasOpenRef = useRef(open);
  if (open !== wasOpenRef.current) {
    wasOpenRef.current = open;
    // Same pattern as ProfileOnboarding (P136): capture the trigger before
    // this commit lands so it can regain focus when the sheet closes.
    openerRef.current = open ? document.activeElement : null;
  }

  const [version, setVersion] = useState<VersionState>({ status: 'loading' });

  // 关于: one fetch per opening; any failure degrades to 「版本未知」.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setVersion({ status: 'loading' });
    fetch('/api/version')
      .then((res) =>
        res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)),
      )
      .then((data: { version?: unknown; gitSha?: unknown }) => {
        if (cancelled) return;
        if (typeof data.version === 'string' && typeof data.gitSha === 'string') {
          setVersion({ status: 'ok', version: data.version, gitSha: data.gitSha });
        } else {
          setVersion({ status: 'error' });
        }
      })
      .catch(() => {
        if (!cancelled) setVersion({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Escape closes, Tab stays trapped, and the gear button regains focus on
  // close — all via the shared P136 dialogDismiss wiring.
  useEffect(() => {
    if (!open) return;
    panelRef.current
      ?.querySelector<HTMLElement>(
        'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      ?.focus();
    const handle = startDialogDismiss({
      onClose,
      getPanel: () => panelRef.current,
      opener: openerRef.current,
    });
    return () => handle.stop();
  }, [open, onClose]);

  if (!open) return null;

  // P353: at zero sessions the entry stays mounted but inert — the hint
  // says why (P270: a 「清空 0 段对话」 confirm must still never open).
  const clearAllHint = hasSessions
    ? CLEAR_ALL_LABEL
    : `${CLEAR_ALL_LABEL}（还没有对话可以清空）`;

  const renderSegmented = <T extends string>(
    label: string,
    options: { value: T; label: string }[],
    current: T,
    onPick: (next: T) => void,
  ) => (
    <div className="settings-segmented" role="group" aria-label={label}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`settings-segment${current === opt.value ? ' active' : ''}`}
          aria-pressed={current === opt.value}
          aria-label={opt.label}
          onClick={() => onPick(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  return (
    <div
      className="settings-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <div className="settings-panel" ref={panelRef}>
        <button
          type="button"
          className="settings-close"
          onClick={onClose}
          aria-label="关闭设置"
          title="关闭"
        >
          ×
        </button>
        <h2 id="settings-title" className="settings-title">
          设置
        </h2>

        <section className="settings-section" aria-label="回复长度偏好">
          <h3>回复长度偏好</h3>
          {renderSegmented('回复长度偏好', REPLY_LENGTH_OPTIONS, replyLength, onReplyLengthChange)}
        </section>

        <section className="settings-section" aria-label="回复语言">
          <h3>回复语言</h3>
          {renderSegmented('回复语言', LANGUAGE_OPTIONS, language, onLanguageChange)}
          <p className="settings-lang-note">
            {language === 'en'
              ? 'Reply language only — the interface stays in Chinese.'
              : '只影响 AI 回复的语言，界面保持中文。'}
          </p>
        </section>

        <section className="settings-section" aria-label="主题">
          <h3>主题</h3>
          {renderSegmented('主题', THEME_OPTIONS, theme, onThemeChange)}
        </section>

        <section className="settings-section" aria-label="数据">
          <h3>数据</h3>
          <div className="settings-data-actions">
            <button
              type="button"
              className="settings-data-btn"
              onClick={onExportMarkdown}
              disabled={!canExport}
              aria-label="导出 Markdown"
            >
              导出 Markdown
            </button>
            <button
              type="button"
              className="settings-data-btn"
              onClick={onExportJson}
              disabled={!canExport}
              aria-label="导出 JSON"
            >
              导出 JSON
            </button>
            {/* P353: always rendered, on every viewport — hiding it in
                the empty state left a phone with no reachable clear
                entry at all. At zero sessions it is inert: no handler,
                disabled, and the hint explains why (P270's no-op
                confirm stays impossible). */}
            <button
              type="button"
              className="settings-data-btn danger"
              data-tone="danger"
              onClick={hasSessions ? onClearAll : undefined}
              disabled={busy || !hasSessions}
              aria-disabled={busy || !hasSessions || undefined}
              aria-label={clearAllHint}
              title={clearAllHint}
            >
              {CLEAR_ALL_LABEL}
            </button>
          </div>
        </section>

        <section className="settings-section" aria-label="关于">
          <h3>关于</h3>
          <p
            className="settings-about"
            title={
              version.status === 'ok'
                ? `版本 ${version.version} · 构建 ${version.gitSha}${llmModel ? ` · 模型 ${llmModel}` : ''}`
                : undefined
            }
          >
            {version.status === 'ok'
              ? `DatingAgent ${version.version}`
              : version.status === 'error'
                ? '版本未知'
                : '版本加载中…'}
          </p>
          <p className="settings-about muted">
            由 AI 顾问驱动，随时可以调整回复长度与语言。
          </p>
        </section>
      </div>
    </div>
  );
}

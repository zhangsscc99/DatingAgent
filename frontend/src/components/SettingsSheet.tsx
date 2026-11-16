import { useEffect, useRef, useState } from 'react';
import { startDialogDismiss } from '../lib/dialogDismiss';
import type { ReplyLengthPreference } from '../lib/replyLength';
import type { Theme } from '../hooks/useTheme';
import type { ReplyLanguage } from '../types';
import './SettingsSheet.css';

const REPLY_LENGTH_OPTIONS: { value: ReplyLengthPreference; label: string }[] = [
  { value: 'default', label: '默认' },
  { value: 'concise', label: '精简' },
  { value: 'detailed', label: '详细' },
];

const LANGUAGE_OPTIONS: { value: ReplyLanguage; label: string }[] = [
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
  /** Model name already held by the health poll; the line is omitted without it. */
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

        <section className="settings-section" aria-label="语言">
          <h3>语言</h3>
          {renderSegmented('语言', LANGUAGE_OPTIONS, language, onLanguageChange)}
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
            <button
              type="button"
              className="settings-data-btn danger"
              onClick={onClearAll}
              disabled={busy || !hasSessions}
              aria-label="清空全部对话"
              title="清空全部对话"
            >
              清空全部对话
            </button>
          </div>
        </section>

        <section className="settings-section" aria-label="关于">
          <h3>关于</h3>
          <p className="settings-about">
            {version.status === 'ok'
              ? `版本 ${version.version} · 构建 ${version.gitSha}`
              : version.status === 'error'
                ? '版本未知'
                : '版本加载中…'}
          </p>
          {llmModel && <p className="settings-about muted">模型 {llmModel}</p>}
        </section>
      </div>
    </div>
  );
}

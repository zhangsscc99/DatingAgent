import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
} from 'react';
import type { ReactElement, ReactNode } from 'react';

interface Props {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  children: ReactNode;
}

/**
 * P227 — at 390px the header row squeezed seven controls into one line and
 * the export/copy hit areas shrank to ~30px, so the three low-frequency
 * actions moved behind a single「更多操作」trigger; the popover mounts the
 * exact same buttons (same aria-labels, same handlers, gained
 * role="menuitem"), so nothing about the actions themselves changes.
 * P340 — the collapse now applies at every width: at 1440×900 the topbar
 * put six controls on one line with the low-frequency exports at the same
 * weight as the search/theme actions, so the language picker and the
 * export/copy trio live in this menu on desktop too.
 *
 * Keyboard/touch contract: Escape closes and focus returns to the trigger,
 * a press outside closes, and the panel closes after an action fires —
 * mirroring the sidebar-backdrop / startDialogDismiss patterns without a
 * full-screen overlay.
 */
export default function HeaderMoreMenu({
  open,
  onToggle,
  onClose,
  children,
}: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    // Standard menu behaviour: opening lands focus on the first enabled
    // item so keyboard users don't have to Tab back through the header.
    const firstItem = Array.from(
      panelRef.current?.querySelectorAll('button') ?? [],
    ).find((el) => !el.hasAttribute('disabled'));
    (firstItem as HTMLElement | undefined)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
      triggerRef.current?.focus();
    };
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (
        (target && panelRef.current?.contains(target)) ||
        (target && triggerRef.current?.contains(target))
      ) {
        return;
      }
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open, onClose]);

  return (
    <div className="more-menu">
      <button
        ref={triggerRef}
        type="button"
        className="more-menu-trigger"
        aria-label="更多操作"
        title="更多操作"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open && (
        <div
          className="more-menu-panel"
          role="menu"
          ref={panelRef}
          onClick={(e) => {
            // The item's own handler runs first (bubbling); reaching this
            // point means an action just fired, so the menu's job is done.
            if ((e.target as HTMLElement | null)?.closest?.('button')) {
              onClose();
              triggerRef.current?.focus();
            }
          }}
        >
          {Children.map(children, (child) => {
            if (!isValidElement(child)) return child;
            const el = child as ReactElement<{ role?: string }>;
            // P295: a child may declare a more accurate role (the language
            // picker row is a labelled group, not an action); menuitem
            // stays the default for the plain action buttons.
            return cloneElement(el, { role: el.props.role ?? 'menuitem' });
          })}
        </div>
      )}
    </div>
  );
}

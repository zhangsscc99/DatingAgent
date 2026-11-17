import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
} from 'react';
import type { ReactElement, ReactNode } from 'react';

interface Props {
  /** True below the desktop breakpoint: the children collapse into a
   *  single「更多操作」trigger + popover. False passes them through so the
   *  wide header keeps rendering the same inline buttons. */
  collapsed: boolean;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  children: ReactNode;
}

/**
 * P227 — at 390px the header row squeezed seven controls into one line and
 * the export/copy hit areas shrank to ~30px. On narrow screens the three
 * low-frequency actions now live behind a single「更多操作」trigger; the
 * popover mounts the exact same buttons (same aria-labels, same handlers,
 * gained role="menuitem"), so nothing about the actions themselves changes.
 *
 * Keyboard/touch contract: Escape closes and focus returns to the trigger,
 * a press outside closes, and the panel closes after an action fires —
 * mirroring the sidebar-backdrop / startDialogDismiss patterns without a
 * full-screen overlay.
 */
export default function HeaderMoreMenu({
  collapsed,
  open,
  onToggle,
  onClose,
  children,
}: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!collapsed || !open) return;

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
  }, [collapsed, open, onClose]);

  if (!collapsed) return <>{children}</>;

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
          {Children.map(children, (child) =>
            isValidElement(child)
              ? cloneElement(child as ReactElement<{ role?: string }>, {
                  role: 'menuitem',
                })
              : child,
          )}
        </div>
      )}
    </div>
  );
}

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { clsx } from './format';
import { useStore } from '../store/store';

/* ---------------------------------------------------------------- layout */

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold text-ink-50">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-300">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, pad = true, id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean; id?: string }) {
  return (
    <section id={id} className={clsx('card', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-ink-700 px-4 py-2.5">
          <h2 className="card-title">{title}</h2>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="stat-label">{label}</div>
      <div className={clsx('stat-value truncate', tone)}>{value}</div>
      {sub && <div className="truncate text-xs text-ink-300">{sub}</div>}
    </div>
  );
}

export function Chip({ children, tone, title }: { children: ReactNode; tone?: 'good' | 'bad' | 'warn' | 'info'; title?: string }) {
  return <span title={title} className={clsx('chip', tone === 'good' && 'chip-good', tone === 'bad' && 'chip-bad', tone === 'warn' && 'chip-warn', tone === 'info' && 'chip-info')}>{children}</span>;
}

export function Bar({ value, max = 100, color = 'bg-pitch-500', label, className }: { value: number; max?: number; color?: string; label?: string; className?: string }) {
  const w = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={clsx('h-1.5 w-full overflow-hidden rounded-full bg-ink-700', className)} role="meter" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={max}>
      <div className={clsx('h-full rounded-full transition-[width] duration-300', color)} style={{ width: `${w}%` }} />
    </div>
  );
}

export function Meter({ label, value, color, text }: { label: string; value: number; color: string; text?: string }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-ink-300">{label}</span>
        <span className="font-medium text-ink-100">{text ?? Math.round(value)}</span>
      </div>
      <Bar value={value} color={color} label={label} />
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-ink-600 px-6 py-10 text-center">
      <div className="text-sm font-medium text-ink-100">{title}</div>
      {body && <div className="max-w-md text-sm text-ink-300">{body}</div>}
      {action}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={clsx('inline-block h-4 w-4 animate-spin rounded-full border-2 border-ink-500 border-t-pitch-400', className)} aria-hidden />;
}

/* ---------------------------------------------------------------- controls */

/**
 * A horizontally scrolling wrapper for wide tables. When the content really is wider than the screen it becomes a focusable
 * region, so a keyboard user can reach it and scroll with the arrow keys; when everything fits it adds no extra tab stop.
 */
export function ScrollX({ children, className, label = 'Table' }: { children: ReactNode; className?: string; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setScrolls(el.scrollWidth > el.clientWidth + 1);
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  });
  return (
    <div ref={ref} className={clsx('overflow-x-auto', className)} {...(scrolls ? { tabIndex: 0, role: 'region', 'aria-label': `${label} (scrolls sideways)` } : {})}>
      {children}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: ReactNode; badge?: number }[]; value: T; onChange: (v: T) => void; label?: string }) {
  return (
    <div role="tablist" aria-label={label} className="mb-4 flex gap-1 overflow-x-auto border-b border-ink-700">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={clsx(
            'relative -mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            value === t.id ? 'border-pitch-500 text-pitch-400' : 'border-transparent text-ink-300 hover:text-ink-100',
          )}
        >
          {t.label}
          {!!t.badge && <span className="ml-1.5 rounded-full bg-pitch-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string | number>({ options, value, onChange, label, size = 'md' }: { options: { id: T; label: ReactNode; hint?: string }[]; value: T; onChange: (v: T) => void; label?: string; size?: 'sm' | 'md' }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-lg border border-ink-700 bg-ink-900 p-1">
      {options.map((o) => (
        <button
          key={String(o.id)}
          role="radio"
          aria-checked={value === o.id}
          title={o.hint}
          onClick={() => onChange(o.id)}
          className={clsx(
            'rounded-md font-medium transition-colors',
            size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm',
            value === o.id ? 'bg-pitch-600 text-white' : 'text-ink-200 hover:bg-ink-800',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-4 py-1.5">
      <span>
        <span className="block text-sm text-ink-100">{label}</span>
        {hint && <span className="block text-xs text-ink-300">{hint}</span>}
      </span>
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx('relative h-6 w-11 shrink-0 rounded-full transition-colors', checked ? 'bg-pitch-600' : 'bg-ink-600')}
      >
        <span className={clsx('absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
      </button>
    </label>
  );
}

export function Slider({ value, min, max, step = 1, onChange, label, format }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; label: string; format?: (v: number) => string }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-ink-300">{label}</span>
        <span className="font-medium text-ink-100">{format ? format(value) : value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-ink-700 accent-emerald-500" />
    </div>
  );
}

/* ---------------------------------------------------------------- modal */

export function Modal({ open, title, onClose, children, footer, wide, locked }: { open: boolean; title: ReactNode; onClose?: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; locked?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // callers usually pass a fresh closure on every render; keep it out of the effect's dependencies so a re-render while the
  // dialog is open (typing in a field, say) does not pull focus back to the first control
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus], button, [href], input, select, textarea');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !locked) { e.stopPropagation(); closeRef.current?.(); }
      if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
        if (!items.length) return;
        const a = items[0];
        const b = items[items.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); } else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  }, [open, locked]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !locked) onClose?.(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className={clsx('pop flex max-h-[92vh] w-full flex-col rounded-t-xl border border-ink-600 bg-ink-850 shadow-2xl sm:rounded-xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <header className="flex items-center justify-between gap-3 border-b border-ink-700 px-5 py-3">
          <h2 id={titleId} className="text-base font-semibold text-ink-50">{title}</h2>
          {!locked && onClose && <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-ink-700 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

/** Confirmation dialog driven by the store, so any screen can ask before a destructive action. */
export function ConfirmHost() {
  const c = useStore((s) => s.confirm);
  const ask = useStore((s) => s.ask);
  return (
    <Modal
      open={!!c}
      title={c?.title ?? ''}
      onClose={() => ask(null)}
      footer={
        <>
          <button className="btn" onClick={() => ask(null)}>Cancel</button>
          <button className={clsx('btn', c?.danger ? 'btn-danger' : 'btn-primary')} data-autofocus onClick={() => { const fn = c?.onConfirm; ask(null); fn?.(); }}>
            {c?.confirmLabel ?? 'Confirm'}
          </button>
        </>
      }
    >
      <p className="text-sm text-ink-200">{c?.body}</p>
    </Modal>
  );
}

export function ToastHost() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-[60] flex max-w-[min(92vw,26rem)] flex-col gap-2 lg:bottom-4" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={clsx(
            'slide-in pointer-events-auto flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm shadow-lg',
            t.kind === 'ok' && 'border-pitch-600/60 bg-ink-800 text-ink-50',
            t.kind === 'err' && 'border-bad-500/60 bg-ink-800 text-ink-50',
            t.kind === 'info' && 'border-info-400/40 bg-ink-800 text-ink-50',
          )}
        >
          <span className={clsx('mt-1 h-2 w-2 shrink-0 rounded-full', t.kind === 'ok' ? 'bg-pitch-400' : t.kind === 'err' ? 'bg-bad-400' : 'bg-info-400')} />
          <span className="flex-1">{t.text}</span>
          <button className="text-ink-400 hover:text-ink-100" onClick={() => dismiss(t.id)} aria-label="Dismiss">✕</button>
        </div>
      ))}
    </div>
  );
}

export function BusyOverlay() {
  const busy = useStore((s) => s.busy);
  if (!busy) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" role="alertdialog" aria-busy="true" aria-label={busy.label}>
      <div className="card flex items-center gap-3 px-5 py-4 shadow-2xl">
        <Spinner className="h-5 w-5" />
        <div>
          <div className="text-sm font-medium text-ink-50">{busy.label}…</div>
          {busy.detail && <div className="text-xs text-ink-300">{busy.detail}</div>}
        </div>
      </div>
    </div>
  );
}

/** A labelled definition row used all over the detail panels. */
export function Row({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex items-baseline justify-between gap-3 border-b border-ink-800 py-1.5 last:border-b-0', className)}>
      <span className="text-sm text-ink-300">{label}</span>
      <span className="text-right text-sm font-medium text-ink-50">{children}</span>
    </div>
  );
}

export function Help({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-ink-300">{children}</p>;
}

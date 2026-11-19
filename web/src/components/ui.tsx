import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { Member } from '../types';

// ---------------- Icons (SVG) ----------------
const paths: Record<string, ReactNode> = {
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  success: <><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.5 2.5L16 9.5" /></>,
  warning: <><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 10v4M12 17h.01" /></>,
  error: <><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4-4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6M9 12h6" /></>,
  qr: <><rect x="4" y="4" width="6" height="6" /><rect x="14" y="4" width="6" height="6" /><rect x="4" y="14" width="6" height="6" /><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" /></>,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  chart: <path d="M5 20V10M12 20V4M19 20v-7" />,
  wallet: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M16 12.5h2M3 9h18" /></>,
  refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 5v6h-6" /></>,
  trash: <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" />,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 17-5-5-9 8" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
};
export function Icon({ name, size = 18 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

// ---------------- Alert ----------------
export type AlertKind = 'info' | 'success' | 'warning' | 'error';
export function Alert({ kind = 'info', title, children, action, onClose }: {
  kind?: AlertKind; title: string; children?: ReactNode; action?: ReactNode; onClose?: () => void;
}) {
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' || kind === 'warning' ? 'alert' : 'status'}>
      <span className="alert-icon"><Icon name={kind} size={22} /></span>
      <div className="alert-body">
        <div className="alert-title">{title}</div>
        {children && <div className="alert-text">{children}</div>}
        {action && <div className="alert-action">{action}</div>}
      </div>
      {onClose && (
        <button className="alert-close" onClick={onClose} aria-label="ปิดข้อความ"><Icon name="close" size={16} /></button>
      )}
    </div>
  );
}

// ---------------- Buttons / Fields ----------------
export function Button({ variant = 'primary', size, icon, loading, children, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm'; icon?: string; loading?: boolean }) {
  return (
    <button {...rest} className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} ${rest.className || ''}`} disabled={rest.disabled || loading}>
      {loading ? <Spinner small /> : icon ? <Icon name={icon} size={size === 'sm' ? 16 : 18} /> : null}
      {children && <span>{children}</span>}
    </button>
  );
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`field ${error ? 'has-error' : ''} ${className || ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export const Spinner = ({ small }: { small?: boolean }) => <span className={`spinner ${small ? 'spinner-sm' : ''}`} aria-label="กำลังโหลด" />;

export function Loading({ text = 'กำลังโหลดข้อมูล' }: { text?: string }) {
  return <div className="loading"><Spinner /><span>{text}</span></div>;
}

export function Empty({ icon = 'list', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} size={28} /></span>
      <div className="empty-title">{title}</div>
      {children && <div className="empty-text">{children}</div>}
    </div>
  );
}

// ---------------- Avatar ----------------
const COLORS = ['#2f6f8f', '#7a5c99', '#b0623b', '#3f7d5a', '#9a4a6b', '#4b5fa8', '#8a6d2f', '#4d7c80'];
const colorOf = (id: string) => COLORS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
export function Avatar({ member, size = 32 }: { member?: Member; size?: number }) {
  if (!member) return <span className="avatar" style={{ width: size, height: size }} />;
  if (member.pictureUrl) return <img className="avatar" src={member.pictureUrl} alt="" width={size} height={size} />;
  return (
    <span className="avatar" style={{ width: size, height: size, background: colorOf(member.id), fontSize: size * 0.42 }}>
      {member.name.slice(0, 1).toUpperCase()}
    </span>
  );
}
export function Person({ member, size = 28, suffix }: { member?: Member; size?: number; suffix?: ReactNode }) {
  return <span className="person"><Avatar member={member} size={size} /><span className="person-name">{member?.name ?? 'ไม่ทราบชื่อ'}</span>{suffix}</span>;
}

// ---------------- Badges ----------------
export function Badge({ kind, children }: { kind: 'success' | 'warning' | 'danger' | 'neutral'; children: ReactNode }) {
  return <span className={`badge badge-${kind}`}>{children}</span>;
}

// ---------------- Segmented ----------------
export function Segmented<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string; icon?: string }[];
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} size={17} />}<span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

// ---------------- Modal ----------------
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('no-scroll'); };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="ปิด"><Icon name="close" /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

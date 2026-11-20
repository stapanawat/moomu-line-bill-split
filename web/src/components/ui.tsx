import { useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
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
  edit: <><path d="M4 20h4l10-10-4-4L4 16v4Z" /><path d="m13 7 4 4" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" /></>,
  scan: <><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><path d="M4 12h16" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  paw: <g fill="currentColor" stroke="none"><ellipse cx="12" cy="16" rx="4.6" ry="3.8" /><circle cx="6" cy="10.5" r="2.1" /><circle cx="9.6" cy="6.6" r="2.2" /><circle cx="14.4" cy="6.6" r="2.2" /><circle cx="18" cy="10.5" r="2.1" /></g>,
};
export function Icon({ name, size = 18 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

// ---------------- Sticker (แมว Moomu) ----------------
export type StickerName = 'bill' | 'paid' | 'due1' | 'due2' | 'due3' | 'due4' | 'due5';
const STICKER_ALT: Record<StickerName, string> = {
  bill: 'แมว Moomu ถือใบแจ้งยอด', paid: 'แมว Moomu ดีใจได้รับเงิน',
  due1: 'แมว Moomu รอยอดค้าง เฟส 1', due2: 'แมว Moomu กังวล เฟส 2', due3: 'แมว Moomu ร้องไห้ เฟส 3',
  due4: 'แมว Moomu อ้อนขอ เฟส 4', due5: 'แมว Moomu ตกใจ เฟส 5',
};
export function Sticker({ name, size = 120, className }: { name: StickerName; size?: number; className?: string }) {
  return <img className={`sticker ${className || ''}`} src={`/stickers/${name}.png?v=1`} alt={STICKER_ALT[name]} width={size} style={{ width: size }} draggable={false} />;
}
/** เฟสค้างชำระ 1-5 นับจากวันที่ในบิล (วันแรก = 1, ตั้งแต่ 5 วัน = 5) */
export function duePhase(date: string, today = new Date()): 1 | 2 | 3 | 4 | 5 {
  const start = Date.parse(date.slice(0, 10) + 'T00:00:00Z');
  const t = Date.parse(today.toISOString().slice(0, 10) + 'T00:00:00Z');
  const d = Math.floor((t - start) / 864e5);
  return Math.min(5, Math.max(1, Number.isFinite(d) ? d : 1)) as 1 | 2 | 3 | 4 | 5;
}
export const dueSticker = (date: string) => `due${duePhase(date)}` as StickerName;

// ---------------- Alert ----------------
export type AlertKind = 'info' | 'success' | 'warning' | 'error';
export function Alert({ kind = 'info', title, children, action, onClose, sticker }: {
  kind?: AlertKind; title: string; children?: ReactNode; action?: ReactNode; onClose?: () => void; sticker?: StickerName;
}) {
  return (
    <div className={`alert alert-${kind} ${sticker ? 'alert-has-sticker' : ''}`} role={kind === 'error' || kind === 'warning' ? 'alert' : 'status'}>
      {sticker ? <Sticker name={sticker} size={84} className="alert-sticker" /> : <span className="alert-icon"><Icon name={kind} size={22} /></span>}
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
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost'; size?: 'sm'; icon?: string; loading?: boolean }) {
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

/** โครงร่างระหว่างโหลด: คงความสูงใกล้เคียงเนื้อหาจริง เพื่อไม่ให้หน้ากระโดด */
export function SkeletonRows({ rows = 4, label = 'กำลังโหลดข้อมูล' }: { rows?: number; label?: string }) {
  return (
    <div className="skeleton-list" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-row" key={i}>
          <span className="sk sk-block" />
          <span className="skeleton-lines"><span className="sk sk-line" style={{ width: `${62 - i * 7}%` }} /><span className="sk sk-line sk-short" /></span>
          <span className="sk sk-num" />
        </div>
      ))}
    </div>
  );
}

/** จำนวนเงินแบบตัวเลขบัญชี (ตัวเลขกว้างเท่ากัน) */
export function Money({ value, unit, className, tone }: { value: number; unit?: boolean; className?: string; tone?: 'due' | 'paid' }) {
  return (
    <span className={`money ${tone ? `money-${tone}` : ''} ${className || ''}`}>
      {Number(value).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      {unit && <small> บาท</small>}
    </span>
  );
}

/** แถบสถานะการชำระ: 1 ช่องต่อผู้ที่ต้องจ่าย ช่องที่เต็มคือคนที่ชำระแล้ว */
export function PaidTrack({ paid, total, label }: { paid: number; total: number; label?: string }) {
  if (total <= 0) return null;
  const done = paid >= total;
  return (
    <span className={`track ${done ? 'track-done' : ''}`} role="img" aria-label={label ?? `ชำระแล้ว ${paid} จาก ${total} คน`}>
      {Array.from({ length: total }, (_, i) => <span key={i} className={i < paid ? 'on' : ''} />)}
    </span>
  );
}

/** แถบสัดส่วน: ค่าที่เปลี่ยนจะเลื่อนความยาวอย่างนุ่มนวล บอกการเปลี่ยนแปลงของยอด */
export function Meter({ value, max, tone = 'paid', label }: { value: number; max: number; tone?: 'paid' | 'due' | 'ink'; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <span className={`meter meter-${tone}`} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}

/** คืนชุดคีย์ที่เพิ่งปรากฏใหม่ (ไม่นับการแสดงครั้งแรก) ใช้ไฮไลต์แถวที่สถานะเพิ่งเปลี่ยน */
export function useFreshKeys(keys: string[], ms = 1800) {
  const prev = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const sig = keys.join('|');
  useEffect(() => {
    const before = prev.current;
    prev.current = new Set(keys);
    if (!before) return;
    const added = keys.filter((k) => !before.has(k));
    if (!added.length) return;
    setFresh(new Set(added));
    const t = setTimeout(() => setFresh(new Set()), ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return fresh;
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
// สีประจำตัวสมาชิก: ใช้ซ้ำทุกจุด (รูปโปรไฟล์ เจ้าของรายการ แถบยอด) ให้จำคนได้จากสี
const COLORS = ['#d0735a', '#2f8f87', '#8a6cc9', '#cc5f8c', '#b98222', '#4a86c4', '#6b9234', '#9a6748'];
export const memberColor = (id: string) => COLORS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
export function Avatar({ member, size = 32, ring }: { member?: Member; size?: number; ring?: boolean }) {
  const style: CSSProperties = { width: size, height: size };
  if (member) (style as Record<string, string | number>)['--mc'] = memberColor(member.id);
  const cls = `avatar ${ring ? 'avatar-ring' : ''}`;
  if (!member) return <span className={cls} style={style} />;
  if (member.pictureUrl) return <img className={cls} src={member.pictureUrl} alt="" width={size} height={size} style={style} />;
  return (
    <span className={`${cls} avatar-initial`} style={{ ...style, fontSize: size * 0.42 }}>
      {member.name.slice(0, 1).toUpperCase()}
    </span>
  );
}
/** รูปสมาชิกซ้อนกัน แสดงเจ้าของรายการ */
export function AvatarStack({ members, size = 22, max = 5 }: { members: (Member | undefined)[]; size?: number; max?: number }) {
  const shown = members.slice(0, max);
  return (
    <span className="avatar-stack" aria-label={members.map((m) => m?.name).filter(Boolean).join(', ')}>
      {shown.map((m, i) => <Avatar key={m?.id ?? i} member={m} size={size} ring />)}
      {members.length > max && <span className="avatar-more" style={{ height: size, minWidth: size }}>+{members.length - max}</span>}
    </span>
  );
}
export function Person({ member, size = 28, suffix }: { member?: Member; size?: number; suffix?: ReactNode }) {
  return <span className="person"><Avatar member={member} size={size} /><span className="person-name">{member?.name ?? 'ไม่ทราบชื่อ'}</span>{suffix}</span>;
}

// ---------------- Badges ----------------
/** สถานะแบบเครื่องหมาย + ข้อความ (ไม่ใช้สีอย่างเดียว เพื่อผู้ที่แยกสีไม่ได้) */
export function Badge({ kind, children }: { kind: 'success' | 'warning' | 'danger' | 'neutral'; children: ReactNode }) {
  return <span className={`badge badge-${kind}`}><span className="badge-mark" aria-hidden="true" />{children}</span>;
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

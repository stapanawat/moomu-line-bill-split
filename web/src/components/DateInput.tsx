import { thDate } from '../lib/format';
import { Icon } from './ui';

/**
 * ช่องเลือกวันที่ที่แสดงผลชัดบนมือถือ
 * (input type=date บน iOS/Android จะว่างเปล่าเมื่อยังไม่เลือก จึงแสดงข้อความแทน และแสดงวันที่แบบไทยเมื่อเลือกแล้ว)
 */
export default function DateInput({ value, onChange, placeholder = 'เลือกวันที่', clearable = true, long = false }: {
  value: string; onChange: (v: string) => void; placeholder?: string; clearable?: boolean; long?: boolean;
}) {
  return (
    <span className={`date-input ${value ? 'date-set' : 'date-empty'}`}>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} aria-label={placeholder} />
      <span className="date-text" aria-hidden="true">{value ? thDate(value, long) : placeholder}</span>
      {value && clearable ? (
        <button type="button" className="date-clear" aria-label="ล้างวันที่"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange(''); }}>
          <Icon name="close" size={16} />
        </button>
      ) : (
        <span className="date-icon" aria-hidden="true"><Icon name="calendar" size={18} /></span>
      )}
    </span>
  );
}

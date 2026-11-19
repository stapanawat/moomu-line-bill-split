import { useState } from 'react';
import { useApp, errorText } from '../context';
import { compressImage, baht } from '../lib/format';
import { Alert, Button, Icon } from './ui';

/** แนบรูปสลิปจากเว็บ แล้วให้ระบบตรวจสอบเหมือนส่งในกลุ่ม LINE */
export default function SlipUploader({ billId, memberId, memberName, amount, onDone, onCancel, onBehalf }: {
  billId: string; memberId: string; memberName: string; amount: number;
  onDone: () => void; onCancel: () => void; onBehalf: boolean;
}) {
  const { api } = useApp();
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ amount: number; transRef: string; announced: boolean } | null>(null);

  const pick = async (file?: File) => {
    if (!file) return;
    setError(null);
    try {
      // ย่อรูปแบบคงความคมชัด เพื่อให้อ่าน QR บนสลิปได้
      setImage(await compressImage(file, 2000, 0.92));
    } catch {
      setError('ไม่สามารถอ่านไฟล์รูปได้ กรุณาเลือกไฟล์รูปภาพ (JPG หรือ PNG)');
    }
  };

  const submit = async () => {
    if (!image) { setError('กรุณาเลือกรูปสลิปก่อนส่งตรวจสอบ'); return; }
    setBusy(true); setError(null);
    try {
      const r = await api.uploadSlip(billId, image, onBehalf ? memberId : undefined);
      setDone(r);
    } catch (e) {
      setError(errorText(e));
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="slip-box">
        <Alert kind="success" title="ตรวจสอบสลิปผ่าน บันทึกการชำระเรียบร้อยแล้ว"
          action={<Button variant="secondary" size="sm" onClick={onDone}>ปิด</Button>}>
          ยอด {baht(done.amount)} บาท เลขอ้างอิง {done.transRef}
          {done.announced ? ' ระบบได้แจ้งในกลุ่ม LINE แล้ว' : ''}
        </Alert>
      </div>
    );
  }

  return (
    <div className="slip-box">
      <div className="slip-head">
        <div>
          <div className="slip-title">แนบสลิป{onBehalf ? `แทน ${memberName}` : ''}</div>
          <div className="muted">ยอดที่ต้องชำระ {baht(amount)} บาท</div>
        </div>
        <button className="icon-btn" onClick={onCancel} aria-label="ยกเลิกการแนบสลิป" disabled={busy}><Icon name="close" /></button>
      </div>

      {error && <Alert kind="error" title="ตรวจสอบสลิปไม่ผ่าน" onClose={() => setError(null)}>{error}</Alert>}

      {image ? (
        <div className="slip-preview">
          <img src={image} alt="สลิปที่เลือก" />
          <label className="btn btn-secondary btn-sm slip-change">
            <input type="file" accept="image/*" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} disabled={busy} />
            <span>เปลี่ยนรูป</span>
          </label>
        </div>
      ) : (
        <label className="upload">
          <input type="file" accept="image/*" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
          <Icon name="image" size={26} />
          <span>แตะเพื่อเลือกรูปสลิปจากอัลบั้ม</span>
        </label>
      )}
      <p className="field-hint">ใช้รูปสลิปฉบับเต็มจากแอปธนาคาร ให้เห็น QR ชัดเจน ระบบจะตรวจยอดเงิน บัญชีผู้รับ และสลิปซ้ำ</p>
      <Button onClick={submit} loading={busy} disabled={!image} className="w-full">
        {busy ? 'กำลังตรวจสอบสลิป' : 'ส่งตรวจสอบสลิป'}
      </Button>
    </div>
  );
}

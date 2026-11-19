import { useState } from 'react';
import { normalizePromptPay } from '../../../shared/billing.js';
import { useApp, errorText } from '../context';
import { ApiError } from '../lib/api';
import { Alert, Button, Field } from '../components/ui';

export default function PaymentSettings() {
  const { api, session, setMe } = useApp();
  const me = session.me;
  const [pp, setPp] = useState(me.promptpayId || '');
  const [bank, setBank] = useState(me.bankAccount || '');
  const [name, setName] = useState(me.accountName || '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setResult(null);
    const f: Record<string, string> = {};
    if (pp.trim() && !normalizePromptPay(pp)) f.promptpayId = 'เลขพร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขบัตรประชาชน 13 หลัก';
    const digits = bank.replace(/\D/g, '');
    if (digits && (digits.length < 10 || digits.length > 15)) f.bankAccount = 'เลขบัญชีธนาคารไม่ถูกต้อง';
    setErrors(f);
    if (Object.keys(f).length) return setResult({ ok: false, text: 'กรุณาแก้ไขข้อมูลที่ไม่ถูกต้องก่อนบันทึก' });
    setSaving(true);
    try {
      setMe(await api.updatePayment({ promptpayId: pp.trim(), bankAccount: digits, accountName: name.trim() }));
      setResult({ ok: true, text: 'ระบบจะใช้ข้อมูลนี้เป็นค่าเริ่มต้นเมื่อท่านเป็นผู้รับเงิน และใช้ตรวจสอบบัญชีผู้รับในสลิป' });
    } catch (e) {
      if (e instanceof ApiError && e.fields) setErrors(e.fields);
      setResult({ ok: false, text: errorText(e) });
    } finally { setSaving(false); }
  };

  return (
    <div className="stack">
      {result && (
        <Alert kind={result.ok ? 'success' : 'error'} title={result.ok ? 'บันทึกบัญชีรับเงินเรียบร้อยแล้ว' : 'ไม่สามารถบันทึกได้'} onClose={() => setResult(null)}>{result.text}</Alert>
      )}
      <section className="card">
        <h2 className="card-title">บัญชีรับเงินของท่าน</h2>
        <p className="muted">ใช้เมื่อท่านเป็นผู้ชำระบิลไปก่อน ระบบจะสร้าง QR จากเลขพร้อมเพย์ และใช้เลขบัญชีหรือชื่อบัญชีเพื่อยืนยันว่าสลิปโอนเข้าบัญชีของท่านจริง</p>
        <div className="grid-2">
          <Field label="เลขพร้อมเพย์" error={errors.promptpayId} hint="เบอร์มือถือ 10 หลัก หรือเลขบัตรประชาชน 13 หลัก" className="span-2">
            <input inputMode="numeric" value={pp} onChange={(e) => setPp(e.target.value)} placeholder="0812345678" />
          </Field>
          <Field label="เลขบัญชีธนาคารที่ผูกพร้อมเพย์ (ไม่บังคับ)" error={errors.bankAccount} hint="บางธนาคารแสดงเลขบัญชีแทนเบอร์โทรในสลิป">
            <input inputMode="numeric" value={bank} onChange={(e) => setBank(e.target.value)} placeholder="1234567890" />
          </Field>
          <Field label="ชื่อบัญชี (ไม่บังคับ)" error={errors.accountName} hint="ตามที่ปรากฏในสลิป เช่น มายด์ สุขใจ">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อ นามสกุล" />
          </Field>
        </div>
        <div className="actions"><Button onClick={save} loading={saving}>บันทึก</Button></div>
      </section>
    </div>
  );
}

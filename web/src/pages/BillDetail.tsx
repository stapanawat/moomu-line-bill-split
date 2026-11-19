import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { promptPayPayload } from '../../../shared/billing.js';
import { useApp, errorText } from '../context';
import type { BillDetail } from '../types';
import { baht, maskPromptPay, thDate } from '../lib/format';
import { Alert, Badge, Button, Empty, Loading, Modal, Person, Segmented } from '../components/ui';
import { StatusBadge } from './BillsPage';
import SlipUploader from '../components/SlipUploader';

type View = 'qr' | 'receipt' | `slip:${string}`;

export default function BillDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { api, session, member, liveTick } = useApp();
  const first = useRef(true);
  const [bill, setBill] = useState<BillDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<View>('qr');
  const [target, setTarget] = useState<string>('');

  useEffect(() => {
    let alive = true;
    setError(null);
    api.getBill(id).then((b) => {
      if (!alive) return;
      setBill(b);
      if (!first.current) {
        // อัปเดตจากเหตุการณ์: ถ้าคนที่กำลังดู QR จ่ายแล้ว ให้เลื่อนไปคนถัดไป
        setTarget((t) => (b.shares.some((s) => s.memberId === t && !s.paidAt) ? t : b.shares.find((s) => !s.isPayer && !s.paidAt)?.memberId || ''));
        return;
      }
      first.current = false;
      const mine = b.shares.find((s) => s.memberId === session.me.id && !s.isPayer && !s.paidAt);
      const firstDue = b.shares.find((s) => !s.isPayer && !s.paidAt);
      setTarget((mine || firstDue)?.memberId || '');
      setView(mine ? 'qr' : b.receiptUrl ? 'receipt' : 'qr');
    }).catch((e) => alive && setError(errorText(e)));
    return () => { alive = false; };
  }, [api, id, session.me.id, reload, liveTick]);

  return (
    <Modal title={bill?.title || 'รายละเอียดบิล'} onClose={onClose} wide>
      {error && (
        <Alert kind="error" title="ไม่สามารถโหลดรายละเอียดบิลได้" action={<Button variant="secondary" size="sm" icon="refresh" onClick={() => setReload((r) => r + 1)}>ลองใหม่</Button>}>{error}</Alert>
      )}
      {!bill && !error && <Loading />}
      {bill && <Body bill={bill} view={view} setView={setView} target={target} setTarget={setTarget} meId={session.me.id} member={member} reload={() => setReload((r) => r + 1)} />}
    </Modal>
  );
}

function Body({ bill, view, setView, target, setTarget, meId, member, reload }: {
  bill: BillDetail; view: View; setView: (v: View) => void; target: string; setTarget: (s: string) => void;
  meId: string; member: ReturnType<typeof useApp>['member']; reload: () => void;
}) {
  const { session } = useApp();
  const [uploadFor, setUploadFor] = useState<string | null>(null);
  // ผู้รับเงินของบิล หรือผู้ดูแลที่ไม่ได้อยู่ในกลุ่ม แนบสลิปแทนคนอื่นได้
  const canUploadForOthers = meId === bill.payerId || !session.members.some((m) => m.id === meId);
  const uploadShare = uploadFor ? bill.shares.find((s) => s.memberId === uploadFor) : undefined;
  const payer = member(bill.payerId);
  const myShare = bill.shares.find((s) => s.memberId === meId);
  const debtors = bill.shares.filter((s) => !s.isPayer);
  const slipOf = view.startsWith('slip:') ? bill.shares.find((s) => `slip:${s.memberId}` === view) : undefined;

  return (
    <div className="detail">
      <div className="detail-head">
        <div className="kv"><span>วันที่</span><b>{thDate(bill.date, true)}</b></div>
        <div className="kv"><span>ผู้รับเงิน</span><b>{payer?.name ?? '-'}</b></div>
        <div className="kv"><span>ยอดรวม</span><b>{baht(bill.total)} บาท</b></div>
        <div className="kv"><span>สถานะ</span><StatusBadge b={bill} /></div>
      </div>

      {myShare && !myShare.isPayer && (
        myShare.paidAt
          ? <Alert kind="success" title="ท่านชำระรายการนี้เรียบร้อยแล้ว">ยอด {baht(myShare.amount)} บาท{myShare.transRef ? ` เลขอ้างอิง ${myShare.transRef}` : ''}</Alert>
          : <Alert kind="warning" title={`ยอดที่ท่านต้องชำระ ${baht(myShare.amount)} บาท`}
              action={uploadFor !== meId && <Button size="sm" icon="image" onClick={() => setUploadFor(meId)}>แนบสลิปที่นี่</Button>}>
              สแกน QR ด้านล่างเพื่อโอนเงินให้ {payer?.name} เมื่อโอนแล้ว แนบสลิปที่ปุ่มด้านล่าง หรือส่งรูปสลิปในกลุ่ม LINE ระบบจะตรวจสอบและอัปเดตสถานะให้อัตโนมัติ
            </Alert>
      )}

      {uploadShare && (
        <SlipUploader key={uploadShare.memberId} billId={bill.id} memberId={uploadShare.memberId}
          memberName={member(uploadShare.memberId)?.name ?? ''} amount={uploadShare.amount}
          onBehalf={uploadShare.memberId !== meId}
          onCancel={() => setUploadFor(null)} onDone={() => { setUploadFor(null); reload(); }} />
      )}

      <div className="viewer">
        <Segmented<'qr' | 'receipt'>
          value={view === 'receipt' ? 'receipt' : 'qr'}
          onChange={setView}
          options={[{ value: 'qr', label: 'QR ชำระเงิน', icon: 'qr' }, { value: 'receipt', label: 'ใบเสร็จ', icon: 'receipt' }]}
        />
        {slipOf ? (
          <div className="viewer-panel">
            <div className="viewer-caption">
              สลิปของ {member(slipOf.memberId)?.name} {slipOf.transRef && <span className="muted">เลขอ้างอิง {slipOf.transRef}</span>}
              <Button variant="ghost" size="sm" onClick={() => setView('receipt')}>กลับไปดูใบเสร็จ</Button>
            </div>
            {slipOf.slipUrl ? <img className="big-image" src={slipOf.slipUrl} alt="สลิปโอนเงิน" /> : <Empty icon="image" title="ไม่มีรูปสลิป" />}
          </div>
        ) : view === 'receipt' ? (
          <div className="viewer-panel">
            {bill.receiptUrl ? <img className="big-image" src={bill.receiptUrl} alt="ใบเสร็จ" /> : <Empty icon="receipt" title="ไม่มีรูปใบเสร็จ">ผู้บันทึกบิลไม่ได้แนบรูปใบเสร็จไว้</Empty>}
          </div>
        ) : (
          <QrPanel bill={bill} target={target} setTarget={setTarget} meId={meId} member={member} />
        )}
      </div>

      <section>
        <h3 className="section-title">รายการ</h3>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>รายการ</th><th>ผู้ร่วมจ่าย</th><th className="num">ราคา (บาท)</th></tr></thead>
            <tbody>
              {bill.items.map((it, i) => (
                <tr key={i}>
                  <td>{it.name}</td>
                  <td className="muted">{it.memberIds.map((m) => member(m)?.name).join(', ')}</td>
                  <td className="num">{baht(it.price)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {bill.servicePct > 0 && <tr><td colSpan={2}>ค่าบริการ / ภาษี</td><td className="num">{bill.servicePct}%</td></tr>}
              {bill.discount > 0 && <tr><td colSpan={2}>ส่วนลด</td><td className="num">-{baht(bill.discount)}</td></tr>}
              <tr className="total-row"><td colSpan={2}>ยอดรวม</td><td className="num">{baht(bill.total)}</td></tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section>
        <h3 className="section-title">สถานะการชำระ</h3>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>สมาชิก</th><th className="num">ยอด (บาท)</th><th>สถานะ</th><th /></tr></thead>
            <tbody>
              {bill.shares.map((s) => (
                <tr key={s.memberId} className={s.memberId === meId ? 'row-me' : ''}>
                  <td><Person member={member(s.memberId)} size={24} /></td>
                  <td className="num">{baht(s.amount)}</td>
                  <td>{s.isPayer ? <Badge kind="neutral">ผู้รับเงิน</Badge> : s.paidAt ? <Badge kind="success">ชำระแล้ว</Badge> : <Badge kind="danger">รอชำระ</Badge>}</td>
                  <td className="num">
                    {s.slipUrl && <Button variant="ghost" size="sm" icon="image" onClick={() => setView(`slip:${s.memberId}`)}>ดูสลิป</Button>}
                    {!s.isPayer && !s.paidAt && <Button variant="ghost" size="sm" icon="qr" onClick={() => { setTarget(s.memberId); setView('qr'); }}>QR</Button>}
                    {!s.isPayer && !s.paidAt && (s.memberId === meId || canUploadForOthers) && (
                      <Button variant="ghost" size="sm" icon="image" onClick={() => { setUploadFor(s.memberId); window.scrollTo({ top: 0 }); document.querySelector('.modal-backdrop')?.scrollTo({ top: 0, behavior: 'smooth' }); }}>แนบสลิป</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="total-row"><td>คงค้าง</td><td className="num">{baht(bill.dueAmount)}</td><td colSpan={2}>{debtors.filter((s) => !s.paidAt).length} คน</td></tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
}

function QrPanel({ bill, target, setTarget, meId, member }: {
  bill: BillDetail; target: string; setTarget: (s: string) => void; meId: string; member: ReturnType<typeof useApp>['member'];
}) {
  const unpaid = bill.shares.filter((s) => !s.isPayer && !s.paidAt);
  const share = bill.shares.find((s) => s.memberId === target);
  const [img, setImg] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const payload = useMemo(() => {
    if (!share || !bill.promptpayId) return null;
    try { return promptPayPayload(bill.promptpayId, share.amount); } catch { return null; }
  }, [share, bill.promptpayId]);

  useEffect(() => {
    setImg(null); setQrError(null);
    if (!payload) return;
    QRCode.toDataURL(payload, { width: 720, margin: 2, errorCorrectionLevel: 'M' })
      .then(setImg)
      .catch(() => setQrError('ไม่สามารถสร้าง QR ได้ กรุณาลองใหม่อีกครั้ง'));
  }, [payload]);

  if (!unpaid.length) {
    return <div className="viewer-panel"><Alert kind="success" title="สมาชิกทุกคนชำระครบแล้ว">รายการนี้ไม่มียอดค้างชำระ</Alert></div>;
  }
  const payer = member(bill.payerId);
  const canChoose = meId === bill.payerId || !unpaid.some((s) => s.memberId === meId);

  return (
    <div className="viewer-panel">
      {canChoose && (
        <label className="field field-inline">
          <span className="field-label">แสดง QR สำหรับ</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {unpaid.map((s) => <option key={s.memberId} value={s.memberId}>{member(s.memberId)?.name} ({baht(s.amount)} บาท)</option>)}
          </select>
        </label>
      )}
      {!bill.promptpayId && !bill.qrUrl ? (
        <Alert kind="warning" title="ยังไม่มีช่องทางรับเงิน">ผู้รับเงินยังไม่ได้ระบุเลขพร้อมเพย์หรือแนบรูป QR ในรายการนี้</Alert>
      ) : (
        <div className="qr-card">
          <div className="qr-brand">PromptPay</div>
          {bill.promptpayId ? (
            img ? <img className="qr-image" src={img} alt={`QR พร้อมเพย์ ยอด ${share ? baht(share.amount) : ''} บาท`} />
              : qrError ? <Alert kind="error" title="สร้าง QR ไม่สำเร็จ">{qrError}</Alert>
                : <div className="qr-image qr-placeholder"><span className="spinner" /></div>
          ) : (
            <img className="qr-image" src={bill.qrUrl!} alt="QR รับเงิน" />
          )}
          <div className="qr-amount">{share ? baht(share.amount) : '-'} <small>บาท</small></div>
          <div className="qr-info">
            <div>ผู้รับเงิน <b>{payer?.name}</b>{bill.promptpayId && <> ({maskPromptPay(bill.promptpayId)})</>}</div>
            <div>ผู้ชำระ <b>{member(target)?.name}</b></div>
          </div>
          <p className="qr-note">
            {bill.promptpayId
              ? 'ยอดเงินถูกกำหนดไว้ใน QR แล้ว กดค้างที่รูปเพื่อบันทึก แล้วสแกนผ่านแอปธนาคาร'
              : 'QR นี้ไม่มียอดเงินกำหนดไว้ กรุณากรอกยอดเงินตามที่แสดงด้านบนเมื่อโอน'}
          </p>
        </div>
      )}
    </div>
  );
}

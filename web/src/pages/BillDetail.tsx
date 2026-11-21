import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { promptPayPayload } from '../../../shared/billing.js';
import { useApp, errorText } from '../context';
import type { BillDetail } from '../types';
import { baht, maskPromptPay, thDate } from '../lib/format';
import { Alert, Avatar, AvatarStack, Button, Empty, Icon, Modal, Money, PaidTrack, Person, Segmented, SkeletonRows, dueSticker, useFreshKeys } from '../components/ui';
import { StatusBadge } from './BillsPage';
import SlipUploader from '../components/SlipUploader';

type View = 'qr' | 'receipt' | `slip:${string}`;

export default function BillDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { api, session, member, liveTick, notify } = useApp();
  const first = useRef(true);
  const prevStatus = useRef<string | null>(null);
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
      // บิลถูกปิดระหว่างที่เปิดดูอยู่ (ยกเลิก หรือทุกคนชำระครบ): ปิดหน้าต่างแล้วแจ้งเตือน
      const was = prevStatus.current;
      prevStatus.current = b.status;
      if (was === 'open' && b.status !== 'open') {
        onClose();
        if (b.status === 'cancelled') notify(`บิล "${b.title}" ถูกยกเลิกแล้ว`, 'ย้ายไปไว้ที่หน้าประวัติ ไม่ต้องชำระรายการนี้แล้ว', { kind: 'info' });
        else notify(`บิล "${b.title}" ชำระครบทุกคนแล้ว`, 'ปิดบิลและย้ายไปไว้ที่หน้าประวัติเรียบร้อย', { sticker: 'paid' });
        return;
      }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, id, session.me.id, reload, liveTick]);

  return (
    <Modal title={bill?.title || 'รายละเอียดบิล'} onClose={onClose} wide>
      {error && (
        <Alert kind="error" title="ไม่สามารถโหลดรายละเอียดบิลได้" action={<Button variant="secondary" size="sm" icon="refresh" onClick={() => setReload((r) => r + 1)}>ลองใหม่</Button>}>{error}</Alert>
      )}
      {!bill && !error && <SkeletonRows rows={5} label="กำลังโหลดรายละเอียดบิล" />}
      {bill && <Body bill={bill} view={view} setView={setView} target={target} setTarget={setTarget} meId={session.me.id} member={member} reload={() => setReload((r) => r + 1)} onClose={onClose} />}
    </Modal>
  );
}

function Body({ bill, view, setView, target, setTarget, meId, member, reload, onClose }: {
  bill: BillDetail; view: View; setView: (v: View) => void; target: string; setTarget: (s: string) => void;
  meId: string; member: ReturnType<typeof useApp>['member']; reload: () => void; onClose: () => void;
}) {
  const { session, api, startEdit, notify } = useApp();
  const [uploadFor, setUploadFor] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reason, setReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const paidOthers = bill.shares.filter((s) => !s.isPayer && s.paidAt);
  const cancelled = bill.status === 'cancelled';

  const doCancel = async () => {
    setCancelling(true); setCancelError(null);
    try {
      const r = await api.cancelBill(bill.id, reason.trim());
      onClose();
      notify(`ยกเลิกบิล "${bill.title}" แล้ว`, `${r.announced ? 'ระบบได้แจ้งการยกเลิกในกลุ่ม LINE แล้ว' : 'ยกเลิกสำเร็จ แต่ไม่สามารถแจ้งในกลุ่ม LINE ได้ในขณะนี้'} บิลนี้ย้ายไปอยู่ที่หน้าประวัติ`, { kind: 'info' });
    } catch (e) {
      setCancelError(errorText(e));
    } finally { setCancelling(false); }
  };
  // ผู้รับเงินของบิล หรือผู้ดูแลที่ไม่ได้อยู่ในกลุ่ม แนบสลิปแทนคนอื่นได้
  const canUploadForOthers = meId === bill.payerId || !session.members.some((m) => m.id === meId);
  const uploadShare = uploadFor ? bill.shares.find((s) => s.memberId === uploadFor) : undefined;
  const payer = member(bill.payerId);
  const myShare = bill.shares.find((s) => s.memberId === meId);
  const fresh = useFreshKeys(bill.shares.filter((s) => s.paidAt).map((s) => s.memberId));
  const slipOf = view.startsWith('slip:') ? bill.shares.find((s) => `slip:${s.memberId}` === view) : undefined;

  return (
    <div className="detail">
      <header className="detail-hero">
        <span className="kicker">{thDate(bill.date, true)}</span>
        <div className="hero-figure"><Money value={bill.total} /><small>บาท</small></div>
        <div className="detail-hero-row">
          <Person member={payer} size={22} suffix={<span className="muted"> รับเงิน{bill.promptpayId ? ` · ${maskPromptPay(bill.promptpayId)}` : ''}</span>} />
          {cancelled ? <StatusBadge b={bill} /> : (
            <span className={`bill-progress ${bill.paidCount >= bill.debtorCount ? 'is-done' : ''}`}>
              <PaidTrack paid={bill.paidCount} total={bill.debtorCount} />
              <span>{bill.paidCount >= bill.debtorCount ? 'ชำระครบ' : `ชำระแล้ว ${bill.paidCount}/${bill.debtorCount}`}</span>
            </span>
          )}
        </div>
      </header>

      {cancelled && (
        <Alert kind="warning" title="บิลนี้ถูกยกเลิกแล้ว">
          ไม่ต้องชำระและจะไม่ถูกทวงอีก{bill.cancelReason ? ` เหตุผล: ${bill.cancelReason}` : ''}
        </Alert>
      )}
      {bill.canManage && !confirmCancel && (
        <div className="manage-bar">
          <span className="muted">ท่านจัดการบิลนี้ได้</span>
          <div className="manage-actions">
            <Button variant="secondary" size="sm" icon="edit" onClick={() => startEdit(bill)}>แก้ไขบิล</Button>
            <Button variant="danger-ghost" size="sm" icon="trash" onClick={() => setConfirmCancel(true)}>ยกเลิกบิล</Button>
          </div>
        </div>
      )}
      {confirmCancel && (
        <div className="cancel-box">
          <Alert kind="warning" title={`ยืนยันการยกเลิกบิล "${bill.title}"`}>
            บิลจะไม่ถูกทวงและไม่นับในสรุปยอดอีก ระบบจะแจ้งสมาชิกในกลุ่ม LINE
            {paidOthers.length > 0 && <> <b>มีผู้ชำระแล้ว {paidOthers.length} คน</b> ({paidOthers.map((s) => member(s.memberId)?.name).join(', ')}) ผู้รับเงินต้องคืนเงินให้เอง</>}
          </Alert>
          {cancelError && <Alert kind="error" title="ยกเลิกบิลไม่สำเร็จ">{cancelError}</Alert>}
          <label className="field">
            <span className="field-label">เหตุผล (ไม่บังคับ)</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="เช่น บันทึกซ้ำ, ราคาผิด" />
          </label>
          <div className="manage-actions">
            <Button variant="secondary" onClick={() => { setConfirmCancel(false); setCancelError(null); }} disabled={cancelling}>ไม่ยกเลิก</Button>
            <Button variant="danger" icon="trash" loading={cancelling} onClick={doCancel}>ยืนยันยกเลิกบิล</Button>
          </div>
        </div>
      )}

      {!cancelled && myShare && !myShare.isPayer && (
        myShare.paidAt
          ? <Alert kind="success" sticker="paid" title="ท่านชำระรายการนี้เรียบร้อยแล้ว">ยอด {baht(myShare.amount)} บาท{myShare.transRef ? ` เลขอ้างอิง ${myShare.transRef}` : ''}</Alert>
          : <Alert kind="warning" sticker={dueSticker(bill.date)} title={`ยอดที่ท่านต้องชำระ ${baht(myShare.amount)} บาท`}
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
        ) : cancelled ? (
          <div className="viewer-panel"><Alert kind="info" title="ไม่มี QR สำหรับบิลที่ยกเลิกแล้ว" /></div>
        ) : (
          <QrPanel bill={bill} target={target} setTarget={setTarget} meId={meId} member={member} />
        )}
      </div>

      <section className="detail-section">
        <h3 className="section-title">รายการ <span className="muted">{bill.items.length}</span></h3>
        <ul className="ledger">
          {bill.items.map((it, i) => (
            <li key={i} className="ledger-row">
              <span className="ledger-name">{it.name}</span>
              <AvatarStack members={it.memberIds.map((m) => member(m))} size={20} />
              <Money value={it.price} className="ledger-amt" />
            </li>
          ))}
        </ul>
        <dl className="ledger-foot">
          {bill.servicePct > 0 && <div><dt>ค่าบริการ / ภาษี</dt><dd className="money">{bill.servicePct}%</dd></div>}
          {bill.discount > 0 && <div><dt>ส่วนลด</dt><dd className="money">-{baht(bill.discount)}</dd></div>}
          <div className="ledger-total"><dt>ยอดรวม</dt><dd><Money value={bill.total} /></dd></div>
        </dl>
      </section>

      <section className="detail-section">
        <h3 className="section-title">สถานะการชำระ <span className="muted">คงค้าง <Money value={bill.dueAmount} tone={bill.dueAmount > 0.004 ? 'due' : 'paid'} /></span></h3>
        <ul className="share-list">
          {bill.shares.map((s) => {
            const state = s.isPayer ? 'payer' : s.paidAt ? 'paid' : 'due';
            return (
              <li key={s.memberId} className={`share-row share-${state} ${s.memberId === meId ? 'is-me' : ''} ${fresh.has(s.memberId) ? 'just-paid' : ''}`}>
                <Avatar member={member(s.memberId)} size={32} ring />
                <span className="share-who">
                  <span className="share-name">{member(s.memberId)?.name ?? 'ไม่ทราบชื่อ'}{s.memberId === meId && <span className="muted"> (ท่าน)</span>}</span>
                  <span className={`share-state state-${state}`}>
                    {state === 'payer' ? 'ผู้รับเงิน' : state === 'paid' ? <><Icon name="paw" size={14} />ชำระแล้ว</> : 'รอชำระ'}
                  </span>
                </span>
                <Money value={s.amount} className="share-amt" tone={state === 'due' ? 'due' : undefined} />
                <span className="share-actions">
                  {s.slipUrl && <Button variant="ghost" size="sm" icon="image" onClick={() => setView(`slip:${s.memberId}`)}>ดูสลิป</Button>}
                  {!cancelled && !s.isPayer && !s.paidAt && <Button variant="ghost" size="sm" icon="qr" onClick={() => { setTarget(s.memberId); setView('qr'); }}>QR</Button>}
                  {!cancelled && !s.isPayer && !s.paidAt && (s.memberId === meId || canUploadForOthers) && (
                    <Button variant="ghost" size="sm" icon="image" onClick={() => { setUploadFor(s.memberId); window.scrollTo({ top: 0 }); document.querySelector('.modal-backdrop')?.scrollTo({ top: 0, behavior: 'smooth' }); }}>แนบสลิป</Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/** รูปที่ใช้บันทึก: QR + ยอดเงิน + ชื่อผู้รับ/ผู้ชำระ บนพื้นขาว (แอปธนาคารสแกนจากรูปนี้ได้) */
async function composeQrImage(src: string, lines: { amount: string; payee: string; payer: string; title: string }): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('load'));
    i.src = src;
  });
  const W = 900, pad = 60, qr = W - pad * 2;
  const qrH = Math.round(qr * (img.height / img.width));
  const H = 150 + qrH + 300;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const font = (w: number, s: number) => `${w} ${s}px 'IBM Plex Sans Thai', 'Noto Sans Thai', sans-serif`;
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#103b6e'; g.fillRect(0, 0, W, 110);
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = font(700, 46); g.fillText('PromptPay', W / 2, 56);
  g.drawImage(img, pad, 130, qr, qrH);
  let y = 130 + qrH + 70;
  g.fillStyle = '#2b1d14'; g.font = font(700, 64); g.fillText(`${lines.amount} บาท`, W / 2, y);
  y += 70; g.font = font(500, 32); g.fillStyle = '#4a3a2e'; g.fillText(`ผู้รับเงิน ${lines.payee}`, W / 2, y);
  y += 46; g.fillText(`ผู้ชำระ ${lines.payer}`, W / 2, y);
  y += 46; g.font = font(400, 26); g.fillStyle = '#8a7565'; g.fillText(lines.title.slice(0, 40), W / 2, y);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('blob'))), 'image/png'));
}

const blobToDataUrl = (b: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(new Error('read'));
  r.readAsDataURL(b);
});

function QrPanel({ bill, target, setTarget, meId, member }: {
  bill: BillDetail; target: string; setTarget: (s: string) => void; meId: string; member: ReturnType<typeof useApp>['member'];
}) {
  const unpaid = bill.shares.filter((s) => !s.isPayer && !s.paidAt);
  const share = bill.shares.find((s) => s.memberId === target);
  const [img, setImg] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<{ kind: 'success' | 'warning'; text: string } | null>(null);
  const { api, inClient, os, openExternal } = useApp();
  const payload = useMemo(() => {
    if (!share || !bill.promptpayId) return null;
    try { return promptPayPayload(bill.promptpayId, share.amount); } catch { return null; }
  }, [share, bill.promptpayId]);

  useEffect(() => {
    setImg(null); setQrError(null); setSaveNote(null);
    if (!payload) return;
    QRCode.toDataURL(payload, { width: 720, margin: 2, errorCorrectionLevel: 'M' })
      .then(setImg)
      .catch(() => setQrError('ไม่สามารถสร้าง QR ได้ กรุณาลองใหม่อีกครั้ง'));
  }, [payload]);

  if (!unpaid.length) {
    return <div className="viewer-panel"><Alert kind="success" title="สมาชิกทุกคนชำระครบแล้ว">รายการนี้ไม่มียอดค้างชำระ</Alert></div>;
  }
  const payer = member(bill.payerId);
  const qrSrc = bill.promptpayId ? img : bill.qrUrl;
  /**
   * บันทึกรูป QR
   * 1) มือถือที่มีเมนูแชร์ไฟล์ (Safari/Chrome/LINE บน iPhone): เปิดเมนูแชร์ ให้เลือก "บันทึกรูปภาพ" เข้าคลังรูป
   * 2) ในแอป LINE ที่ไม่มีเมนูแชร์ (LINE บน Android เป็น WebView: ไม่มี Web Share และดาวน์โหลดจาก blob: ไม่ได้)
   *    ฝากไฟล์ไว้ที่เซิร์ฟเวอร์ แล้วเปิดลิงก์ https ในเบราว์เซอร์ของเครื่องให้ดาวน์โหลด
   * 3) เบราว์เซอร์ทั่วไป: ดาวน์โหลดไฟล์ตามปกติ
   */
  const downloadQr = async () => {
    if (!qrSrc || !share) return;
    setSaving(true); setSaveNote(null);
    const name = `QR-${(member(target)?.name || 'payment').replace(/[^\p{L}\p{M}\p{N}_-]+/gu, '')}-${share.amount.toFixed(2)}.png`;
    let step = 'สร้างรูป';
    try {
      let blob: Blob;
      try {
        blob = await composeQrImage(qrSrc, { amount: baht(share.amount), payee: payer?.name || '-', payer: member(target)?.name || '-', title: bill.title });
      } catch {
        // รูป QR ที่แนบไว้วาดลงแคนวาสไม่ได้ (ข้ามโดเมน): ใช้ไฟล์ต้นฉบับแทน
        step = 'โหลดรูป QR';
        blob = await (await fetch(qrSrc)).blob();
      }
      const file = new File([blob], name, { type: blob.type || 'image/png' });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };

      if (os !== 'web' && typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
        step = 'เปิดเมนูแชร์';
        try {
          await nav.share({ files: [file] });
          setSaveNote({ kind: 'success', text: 'ถ้ายังไม่ได้เลือก ให้เลือก "บันทึกรูปภาพ" ในเมนูแชร์ รูปจะอยู่ในคลังรูปภาพ' });
          return;
        } catch (e) {
          if ((e as Error)?.name === 'AbortError') return; // ผู้ใช้ปิดเมนูแชร์เอง
          // แชร์ไม่ได้: ไปใช้วิธีดาวน์โหลดต่อ
        }
      }

      if (inClient) {
        step = 'เตรียมลิงก์ดาวน์โหลด';
        const r = await api.createDownload(await blobToDataUrl(blob), name);
        step = 'เปิดเบราว์เซอร์';
        openExternal(new URL(r.url, location.origin).href);
        setSaveNote({
          kind: 'success',
          text: os === 'ios'
            ? 'เปิด Safari เพื่อดาวน์โหลดแล้ว กด "ดาวน์โหลด" ไฟล์จะอยู่ในแอปไฟล์ (Files) โฟลเดอร์ดาวน์โหลด'
            : 'เปิดเบราว์เซอร์ของเครื่องเพื่อดาวน์โหลดแล้ว รูปจะอยู่ในโฟลเดอร์ Download ดูได้ในแอปแกลเลอรีหรือรูปภาพ',
        });
        return;
      }

      step = 'ดาวน์โหลด';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setSaveNote({ kind: 'success', text: `ดาวน์โหลดไฟล์ ${name} แล้ว` });
    } catch (e) {
      console.error('[qr] save failed at', step, e);
      setSaveNote({ kind: 'warning', text: `บันทึกรูปไม่สำเร็จ (ขั้นตอน: ${step}) ${errorText(e)}` });
    } finally { setSaving(false); }
  };
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
          <div className="qr-brand">PromptPay <span>Thai QR Payment</span></div>
          {bill.promptpayId ? (
            img ? <img className="qr-image" src={img} alt={`QR พร้อมเพย์ ยอด ${share ? baht(share.amount) : ''} บาท`} />
              : qrError ? <Alert kind="error" title="สร้าง QR ไม่สำเร็จ">{qrError}</Alert>
                : <div className="qr-image qr-placeholder"><span className="spinner" /></div>
          ) : (
            <img className="qr-image" src={bill.qrUrl!} alt="QR รับเงิน" />
          )}
          <div className="qr-amount">{share ? <Money value={share.amount} /> : '-'} <small>บาท</small></div>
          <div className="qr-info">
            <div>ผู้รับเงิน <b>{payer?.name}</b>{bill.promptpayId && <> ({maskPromptPay(bill.promptpayId)})</>}</div>
            <div>ผู้ชำระ <b>{member(target)?.name}</b></div>
          </div>
          <div className="qr-actions">
            <Button icon="download" onClick={downloadQr} loading={saving} disabled={!qrSrc || !share}>บันทึกรูป QR</Button>
          </div>
          {saveNote && (
            <div className="qr-save-note">
              <Alert kind={saveNote.kind} title={saveNote.kind === 'success' ? 'กำลังบันทึกรูป QR' : 'บันทึกรูปไม่สำเร็จ'} onClose={() => setSaveNote(null)}>{saveNote.text}</Alert>
            </div>
          )}
          <p className="qr-note">
            {bill.promptpayId
              ? 'ยอดเงินถูกกำหนดไว้ใน QR แล้ว กด "บันทึกรูป QR" แล้วเปิดสแกนจากรูปในแอปธนาคาร'
              : 'QR นี้ไม่มียอดเงินกำหนดไว้ กรุณากรอกยอดเงินตามที่แสดงด้านบนเมื่อโอน'}
          </p>
        </div>
      )}
    </div>
  );
}

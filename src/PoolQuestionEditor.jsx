import { useRef, useState, useLayoutEffect } from 'react';
import html2canvas from 'html2canvas';
import { PDFDocument } from 'pdf-lib';
import { supabase } from './supabase';

// Havuz için soru + çözüm yazma ekranı. Yazılan soru ve çözüm, mevcut
// InDesign çıktılarıyla aynı ölçüde (160 x 90 mm, 16:9) TEK SAYFALIK birer
// PDF'e çevrilip havuza eklenir -- yani havuz, birleştirme ve test üretme
// mantığı hiç değişmez.
const PAGE_W_PT = 453.543;
const PAGE_H_PT = 255.118;
const PX_W = 640; // ekrandaki sayfa genişliği (px); yükseklik 16:9
const PX_H = Math.round((PX_W * PAGE_H_PT) / PAGE_W_PT); // ~360
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

// Düz metni güvenli HTML'e çevirir; _{2} alt simge, ^{2} üst simge.
const fmt = (text) => {
  const esc = String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return esc
    .replace(/_\{([^}]*)\}/g, '<sub>$1</sub>')
    .replace(/\^\{([^}]*)\}/g, '<sup>$1</sup>')
    .replace(/\n/g, '<br/>');
};

const pageStyle = {
  position: 'relative',
  width: `${PX_W}px`,
  height: `${PX_H}px`,
  backgroundColor: '#fff',
  boxSizing: 'border-box',
  padding: '22px 30px',
  fontFamily: 'Arial, Helvetica, sans-serif',
  color: '#000',
  overflow: 'hidden',
  border: '1px solid #e2e8f0',
};
const colStyle = { width: '56%', textAlign: 'justify', hyphens: 'auto', WebkitHyphens: 'auto', lineHeight: 1.35 };

export default function PoolQuestionEditor({ lessonCategories, topics, learningOutcomes, existingGroups, onClose, onSaved }) {
  const [batchName, setBatchName] = useState('');
  const [dersId, setDersId] = useState('');
  const [konuId, setKonuId] = useState('');
  const [kazanimId, setKazanimId] = useState('');
  const [setCode, setSetCode] = useState('');
  const [intro, setIntro] = useState('');
  const [items, setItems] = useState('');
  const [stem, setStem] = useState('');
  const [opts, setOpts] = useState(['', '', '', '', '']);
  const [answer, setAnswer] = useState('');
  const [solution, setSolution] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [qOverflow, setQOverflow] = useState(false);
  const [sOverflow, setSOverflow] = useState(false);
  const qRef = useRef(null);
  const sRef = useRef(null);

  const itemLines = items.split('\n').map((l) => l.trim()).filter(Boolean);

  useLayoutEffect(() => {
    if (qRef.current) setQOverflow(qRef.current.scrollHeight > qRef.current.clientHeight + 1);
    if (sRef.current) setSOverflow(sRef.current.scrollHeight > sRef.current.clientHeight + 1);
  });

  const pageToPdfBytes = async (node) => {
    const canvas = await html2canvas(node, { scale: 3, backgroundColor: '#ffffff', logging: false });
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    const pngBytes = new Uint8Array(await blob.arrayBuffer());
    const pdf = await PDFDocument.create();
    const img = await pdf.embedPng(pngBytes);
    const page = pdf.addPage([PAGE_W_PT, PAGE_H_PT]);
    page.drawImage(img, { x: 0, y: 0, width: PAGE_W_PT, height: PAGE_H_PT });
    return await pdf.save();
  };

  const uploadPdf = async (bytes, prefix) => {
    const name = `${prefix}_${Math.random().toString(36).substring(2)}_${Date.now()}.pdf`;
    const { error } = await supabase.storage.from('exam-files').upload(name, new Blob([bytes], { type: 'application/pdf' }));
    if (error) throw new Error('PDF yüklenemedi: ' + error.message);
    return name;
  };

  const handleSave = async () => {
    const batch = batchName.trim();
    if (!batch) { alert('Grup adı girin (ör. "Biyoloji Kitabı 1").'); return; }
    if (!stem.trim() && !intro.trim()) { alert('Soru metnini yazın.'); return; }
    if (opts.some((o) => !o.trim())) { alert('A–E şıklarının hepsini doldurun.'); return; }
    if (!['A', 'B', 'C', 'D', 'E'].includes(answer)) { alert('Doğru cevabı seçin.'); return; }
    if (qOverflow || sOverflow) {
      if (!window.confirm('Metin sayfaya sığmıyor, alt kısım kesilecek. Yine de kaydedilsin mi?')) return;
    }
    setSaving(true);
    try {
      const qBytes = await pageToPdfBytes(qRef.current);
      const qName = await uploadPdf(qBytes, 'pool');
      let sName = null;
      if (solution.trim()) {
        const sBytes = await pageToPdfBytes(sRef.current);
        sName = await uploadPdf(sBytes, 'pool_sol');
      }
      const { error } = await supabase.from('question_pool').insert([{
        pdf_file: qName,
        solution_pdf_file: sName,
        correct_answer: answer,
        upload_batch_id: batch,
        lesson_category_id: dersId || null,
        topic_id: konuId || null,
        outcome_id: kazanimId || null,
        set_key: setCode.trim() ? `${batch}::${setCode.trim()}` : null,
      }]);
      if (error) throw new Error('Havuz kaydı oluşturulamadı: ' + error.message);
      setSavedCount((c) => c + 1);
      // Ders/Konu/Kazanım/Grup korunur, soru alanları temizlenir -- seri giriş için.
      setIntro(''); setItems(''); setStem(''); setOpts(['', '', '', '', '']); setAnswer(''); setSolution('');
      if (onSaved) onSaved();
    } catch (err) {
      alert('Kaydedilemedi: ' + err.message);
    }
    setSaving(false);
  };

  const inp = { width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box', fontFamily: 'inherit' };
  const lbl = { display: 'block', fontSize: '0.8rem', fontWeight: 'bold', margin: '10px 0 4px', color: '#334155' };
  const konular = topics.filter((t) => String(t.lesson_category_id) === String(dersId));
  const kazanimlar = learningOutcomes.filter((lo) => String(lo.topic_id) === String(konuId));

  const optGrid = (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, auto)', justifyContent: 'start', columnGap: '22px', rowGap: '4px', fontSize: '12px', marginTop: '8px' }}>
      {['A', 'B', 'C', 'D', 'E'].map((L, i) => (
        <div key={L}>{L}) <span dangerouslySetInnerHTML={{ __html: fmt(opts[i]) }} /></div>
      ))}
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div style={{ backgroundColor: '#fff', borderRadius: '12px', padding: '22px', width: '740px', maxWidth: '100%', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '1.15rem' }}>✏️ Soru Yaz {savedCount > 0 && <span style={{ fontSize: '0.8rem', color: '#16a34a' }}>({savedCount} soru eklendi)</span>}</h2>
          {!saving && <button onClick={onClose} style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#f1f5f9', cursor: 'pointer' }}>Kapat</button>}
        </div>
        <p style={{ margin: '6px 0 0', fontSize: '0.8rem', color: '#64748b' }}>
          Alt simge: <code>CO_{'{2}'}</code> &nbsp; Üst simge: <code>x^{'{2}'}</code>. Kaydedince soru (ve çözüm) tek sayfalık PDF olarak havuza eklenir.
        </p>

        <label style={lbl}>Grup Adı</label>
        <input list="pool-editor-groups" style={inp} value={batchName} onChange={(e) => setBatchName(e.target.value)} placeholder='Ör. "Biyoloji Kitabı 1"' />
        <datalist id="pool-editor-groups">{(existingGroups || []).map((g) => <option key={g} value={g} />)}</datalist>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
          <div>
            <label style={lbl}>Ders</label>
            <select style={inp} value={dersId} onChange={(e) => { setDersId(e.target.value); setKonuId(''); setKazanimId(''); }}>
              <option value="">Seçin</option>
              {lessonCategories.map((lc) => <option key={lc.id} value={lc.id}>{lc.name}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Konu</label>
            <select style={inp} value={konuId} disabled={!dersId} onChange={(e) => { setKonuId(e.target.value); setKazanimId(''); }}>
              <option value="">Seçin</option>
              {konular.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Kazanım</label>
            <select style={inp} value={kazanimId} disabled={!konuId} onChange={(e) => setKazanimId(e.target.value)}>
              <option value="">Seçin</option>
              {kazanimlar.map((lo) => <option key={lo.id} value={lo.id}>{lo.name}</option>)}
            </select>
          </div>
        </div>

        <label style={lbl}>Soru girişi (kalın, ör. "Bir hayvan hücresindeki;")</label>
        <textarea style={inp} rows={2} value={intro} onChange={(e) => setIntro(e.target.value)} />
        <label style={lbl}>Öncüller (her satır bir öncül; I., II., III. otomatik eklenir)</label>
        <textarea style={inp} rows={3} value={items} onChange={(e) => setItems(e.target.value)} placeholder={'glikojen\nyağ\nprotein'} />
        <label style={lbl}>Soru kökü (kalın)</label>
        <textarea style={inp} rows={3} value={stem} onChange={(e) => setStem(e.target.value)} />

        <label style={lbl}>Şıklar</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
          {['A', 'B', 'C', 'D', 'E'].map((L, i) => (
            <input key={L} style={inp} placeholder={`${L})`} value={opts[i]} onChange={(e) => setOpts((o) => o.map((v, j) => (j === i ? e.target.value : v)))} />
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <div>
            <label style={lbl}>Doğru cevap</label>
            <select style={inp} value={answer} onChange={(e) => setAnswer(e.target.value)}>
              <option value="">Seçin</option>
              {['A', 'B', 'C', 'D', 'E'].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Soru grubu kodu (ortak metne bağlıysa, opsiyonel)</label>
            <input style={inp} value={setCode} onChange={(e) => setSetCode(e.target.value)} placeholder="Ör. G1" />
          </div>
        </div>

        <label style={lbl}>Çözüm açıklaması (boşsa çözüm sayfası oluşturulmaz)</label>
        <textarea style={inp} rows={3} value={solution} onChange={(e) => setSolution(e.target.value)} />

        <div style={{ fontWeight: 'bold', fontSize: '0.85rem', margin: '16px 0 6px' }}>Önizleme — Soru {qOverflow && <span style={{ color: '#dc2626' }}>⚠ sığmıyor</span>}</div>
        <div style={{ overflowX: 'auto' }}>
          <div ref={qRef} lang="tr" style={pageStyle}>
            <div style={colStyle}>
              {intro.trim() && <div style={{ fontWeight: 'bold', fontSize: '13px' }} dangerouslySetInnerHTML={{ __html: fmt(intro) }} />}
              {itemLines.length > 0 && (
                <div style={{ fontSize: '12px', margin: '6px 0' }}>
                  {itemLines.map((l, i) => (
                    <div key={i} style={{ display: 'flex', gap: '8px', marginLeft: '8px', textAlign: 'left' }}>
                      <span style={{ minWidth: '22px' }}>{ROMAN[i] || i + 1}.</span>
                      <span dangerouslySetInnerHTML={{ __html: fmt(l) }} />
                    </div>
                  ))}
                </div>
              )}
              {stem.trim() && <div style={{ fontWeight: 'bold', fontSize: '13px' }} dangerouslySetInnerHTML={{ __html: fmt(stem) }} />}
            </div>
            {optGrid}
          </div>
        </div>

        <div style={{ fontWeight: 'bold', fontSize: '0.85rem', margin: '14px 0 6px' }}>Önizleme — Çözüm {sOverflow && <span style={{ color: '#dc2626' }}>⚠ sığmıyor</span>}</div>
        <div style={{ overflowX: 'auto' }}>
          <div ref={sRef} lang="tr" style={pageStyle}>
            <div style={{ ...colStyle, fontSize: '12px' }} dangerouslySetInnerHTML={{ __html: fmt(solution) }} />
            <div style={{ width: '56%', textAlign: 'right', fontSize: '12px', marginTop: '6px' }}>
              {['A', 'B', 'C', 'D', 'E'].map((L) => (
                <span key={L}>|<span style={{ fontWeight: L === answer ? 'bold' : 'normal' }}>{L}</span></span>
              ))}|
            </div>
          </div>
        </div>

        <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={handleSave} disabled={saving}
            style={{ padding: '10px 22px', borderRadius: '6px', border: 'none', backgroundColor: saving ? '#94a3b8' : '#2563eb', color: '#fff', fontWeight: 'bold', cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Kaydediliyor...' : 'Havuza Kaydet'}
          </button>
        </div>
      </div>
    </div>
  );
}

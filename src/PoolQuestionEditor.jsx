import { useRef, useState, useLayoutEffect } from 'react';
import html2canvas from 'html2canvas';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';
import { supabase } from './supabase';

// Havuz için soru + çözüm yazma / düzenleme ekranı. Yazılan soru ve çözüm,
// InDesign çıktılarıyla aynı ölçüde (160 x 90 mm, 16:9) TEK SAYFALIK birer
// PDF'e çevrilip havuza eklenir -- havuz, birleştirme ve test üretme mantığı
// hiç değişmez. Yazılan alanlar source_json'da saklanır; "Düzenle" ile açılır.
const PAGE_W_PT = 453.543;
const PAGE_H_PT = 255.118;
const PX_W = 640;
const PX_H = Math.round((PX_W * PAGE_H_PT) / PAGE_W_PT); // ~360
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

const fmt = (text) => {
  const esc = String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(/_\{([^}]*)\}/g, '<sub>$1</sub>').replace(/\^\{([^}]*)\}/g, '<sup>$1</sup>').replace(/\n/g, '<br/>');
};

const pageStyle = {
  position: 'relative', width: `${PX_W}px`, height: `${PX_H}px`, backgroundColor: '#fff',
  boxSizing: 'border-box', padding: '22px 30px', fontFamily: 'Arial, Helvetica, sans-serif',
  color: '#000', overflow: 'hidden', border: '1px solid #e2e8f0',
};

// Yüklenen şekli (PNG/JPG/SVG ya da PDF/Illustrator-PDF'in ilk sayfası) PNG data URL'ine çevirir.
const fileToPngDataUrl = async (file) => {
  const MAX_W = 1100;
  const isPdf = file.type === 'application/pdf' || /\.(pdf|ai)$/i.test(file.name);
  let canvas = document.createElement('canvas');
  if (isPdf) {
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(3, MAX_W / base.width);
    const vp = page.getViewport({ scale });
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
  } else {
    const url = URL.createObjectURL(file);
    const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Resim okunamadı')); im.src = url; });
    const w = Math.min(MAX_W, img.naturalWidth || MAX_W);
    const h = Math.round(w * ((img.naturalHeight || w) / (img.naturalWidth || w)));
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
  }
  return trimWhiteMargins(canvas).toDataURL('image/png');
};

// Çizimin etrafındaki boş beyaz alanı (Illustrator'ın tüm sayfayı kaydetmesi gibi)
// otomatik kırpar; çizime 6 px pay bırakır. Her şey beyazsa olduğu gibi döner.
const trimWhiteMargins = (canvas) => {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, w, h);
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] > 10 && (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return canvas;
  const pad = 6;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = cw; out.height = ch;
  out.getContext('2d').drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch);
  return out;
};

export default function PoolQuestionEditor({ lessonCategories, topics, learningOutcomes, existingGroups, editRow, onClose, onSaved }) {
  const src = (editRow && editRow.source_json) || {};
  const isEdit = !!editRow;
  const [batchName, setBatchName] = useState(isEdit ? (editRow.upload_batch_id || '') : '');
  const [dersId, setDersId] = useState(isEdit && editRow.lesson_category_id != null ? String(editRow.lesson_category_id) : '');
  const [konuId, setKonuId] = useState(isEdit && editRow.topic_id != null ? String(editRow.topic_id) : '');
  const [kazanimId, setKazanimId] = useState(isEdit && editRow.outcome_id != null ? String(editRow.outcome_id) : '');
  const [setCode, setSetCode] = useState(isEdit && editRow.set_key ? editRow.set_key.split('::').slice(1).join('::') : '');
  const [intro, setIntro] = useState(src.intro || '');
  const [items, setItems] = useState(src.items || '');
  const [stem, setStem] = useState(src.stem || '');
  const [opts, setOpts] = useState(src.opts || ['', '', '', '', '']);
  const [answer, setAnswer] = useState(isEdit ? (editRow.correct_answer || '') : '');
  const [solution, setSolution] = useState(src.solution || '');
  const [optLayout, setOptLayout] = useState(src.optLayout || 'auto');
  const [colWidth, setColWidth] = useState(src.colWidth || 56);
  const [img, setImg] = useState(src.img || null); // {dataUrl, pos:'right'|'below', widthPct, topPx}
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

  const handleImageFile = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const dataUrl = await fileToPngDataUrl(f);
      setImg({ dataUrl, pos: 'right', widthPct: 36, topPx: 20 });
    } catch (err) {
      alert('Şekil eklenemedi: ' + err.message + '\n(Illustrator dosyasını PDF, SVG veya PNG olarak dışa aktarıp deneyin.)');
    }
  };

  const pageToPdfBytes = async (node) => {
    const canvas = await html2canvas(node, { scale: 3, backgroundColor: '#ffffff', logging: false });
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    const pngBytes = new Uint8Array(await blob.arrayBuffer());
    const pdf = await PDFDocument.create();
    const image = await pdf.embedPng(pngBytes);
    const page = pdf.addPage([PAGE_W_PT, PAGE_H_PT]);
    page.drawImage(image, { x: 0, y: 0, width: PAGE_W_PT, height: PAGE_H_PT });
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
      const fields = {
        pdf_file: qName,
        solution_pdf_file: sName,
        correct_answer: answer,
        upload_batch_id: batch,
        lesson_category_id: dersId || null,
        topic_id: konuId || null,
        outcome_id: kazanimId || null,
        set_key: setCode.trim() ? `${batch}::${setCode.trim()}` : null,
        source_json: { intro, items, stem, opts, solution, optLayout, colWidth, img },
      };
      if (isEdit) {
        const { error } = await supabase.from('question_pool').update(fields).eq('id', editRow.id);
        if (error) throw new Error('Soru güncellenemedi: ' + error.message);
        // Eski dosyalar depoda artık kalmasın (hata olursa sessizce geçilir).
        const old = [editRow.pdf_file, editRow.solution_pdf_file].filter(Boolean);
        if (old.length) { try { await supabase.storage.from('exam-files').remove(old); } catch (e) { /* önemsiz */ } }
        if (onSaved) onSaved(editRow.id);
        onClose();
        setSaving(false);
        return;
      }
      const { error } = await supabase.from('question_pool').insert([fields]);
      if (error) throw new Error('Havuz kaydı oluşturulamadı: ' + error.message);
      setSavedCount((c) => c + 1);
      setIntro(''); setItems(''); setStem(''); setOpts(['', '', '', '', '']); setAnswer(''); setSolution(''); setImg(null);
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

  // Şık düzeni: kısa şıklar 3 sütun, orta 2 sütun, uzun şıklar tek sütun.
  const maxLen = Math.max(0, ...opts.map((o) => o.length));
  const cols = optLayout === 'auto' ? (maxLen <= 14 ? 3 : maxLen <= 26 ? 2 : 1) : Number(optLayout);
  const colPct = img && img.pos === 'right' ? colWidth : Math.max(colWidth, 56);
  const optGrid = (
    <div style={{ width: `${colPct}%`, display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, columnGap: '14px', rowGap: '5px', fontSize: '12px', marginTop: '8px', textAlign: 'left', lineHeight: 1.3 }}>
      {['A', 'B', 'C', 'D', 'E'].map((L, i) => (
        <div key={L}>{L}) <span dangerouslySetInnerHTML={{ __html: fmt(opts[i]) }} /></div>
      ))}
    </div>
  );
  const colStyle = { width: `${colPct}%`, textAlign: 'justify', hyphens: 'auto', WebkitHyphens: 'auto', lineHeight: 1.35 };

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div style={{ backgroundColor: '#fff', borderRadius: '12px', padding: '22px', width: '1320px', maxWidth: '100%', maxHeight: '94vh', overflowY: 'auto' }}>
        <div style={{ position: 'sticky', top: '-22px', zIndex: 10, backgroundColor: '#fff', margin: '-22px -22px 0', padding: '14px 22px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>
            {isEdit ? `✏️ Soruyu Düzenle (#${editRow.id})` : '✏️ Soru Yaz'} {savedCount > 0 && <span style={{ fontSize: '0.8rem', color: '#16a34a' }}>({savedCount} soru eklendi)</span>}
          </h2>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {(qOverflow || sOverflow) && <span style={{ color: '#dc2626', fontSize: '0.8rem', fontWeight: 'bold' }}>⚠ Metin sayfaya sığmıyor</span>}
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '8px 20px', borderRadius: '6px', border: 'none', backgroundColor: saving ? '#94a3b8' : '#2563eb', color: '#fff', fontWeight: 'bold', cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Kaydediliyor...' : (isEdit ? 'Değişiklikleri Kaydet' : 'Havuza Kaydet')}
            </button>
            {!saving && <button onClick={onClose} style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#f1f5f9', cursor: 'pointer' }}>Kapat</button>}
          </div>
        </div>
        <p style={{ margin: '8px 0 0', fontSize: '0.8rem', color: '#64748b' }}>
          Alt simge: <code>CO_{'{2}'}</code> &nbsp; Üst simge: <code>x^{'{2}'}</code>. Kaydedince soru (ve çözüm) tek sayfalık PDF olarak havuza eklenir.
        </p>

        <div style={{ display: 'flex', gap: '22px', flexWrap: 'wrap', alignItems: 'flex-start', marginTop: '4px' }}>
        <div style={{ flex: '1 1 420px', minWidth: 0 }}>
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
            <label style={lbl}>Şık düzeni</label>
            <select style={inp} value={optLayout} onChange={(e) => setOptLayout(e.target.value)}>
              <option value="auto">Otomatik (şık uzunluğuna göre)</option>
              <option value="1">Alt alta (tek sütun)</option>
              <option value="2">İki sütun</option>
              <option value="3">Üç sütun</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Metin sütunu genişliği: %{colWidth}</label>
            <input type="range" min="40" max="100" value={colWidth} onChange={(e) => setColWidth(Number(e.target.value))} style={{ width: '100%' }} />
          </div>
        </div>

        <label style={lbl}>Şekil / resim (PNG, JPG, SVG ya da PDF — Illustrator'dan PDF/SVG/PNG dışa aktarın)</label>
        <input type="file" accept="image/*,.pdf,.svg" onChange={handleImageFile} />
        {img && (
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginTop: '8px', padding: '8px', backgroundColor: '#f8fafc', borderRadius: '6px' }}>
            <img src={img.dataUrl} alt="" style={{ height: '48px', border: '1px solid #e2e8f0' }} />
            <label style={{ fontSize: '0.8rem' }}>Konum:{' '}
              <select value={img.pos} onChange={(e) => setImg({ ...img, pos: e.target.value })}>
                <option value="right">Sağda</option>
                <option value="below">Altta</option>
              </select>
            </label>
            <label style={{ fontSize: '0.8rem' }}>Boyut %{img.widthPct}{' '}
              <input type="range" min="15" max="90" value={img.widthPct} onChange={(e) => setImg({ ...img, widthPct: Number(e.target.value) })} />
            </label>
            {img.pos === 'right' && (
              <label style={{ fontSize: '0.8rem' }}>Yukarıdan {img.topPx}px{' '}
                <input type="range" min="0" max="260" value={img.topPx} onChange={(e) => setImg({ ...img, topPx: Number(e.target.value) })} />
              </label>
            )}
            <button onClick={() => setImg(null)} style={{ fontSize: '0.8rem', padding: '4px 10px', borderRadius: '6px', border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#dc2626', cursor: 'pointer' }}>Kaldır</button>
          </div>
        )}

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

        </div>
        <div style={{ flex: '0 0 auto', width: `${PX_W + 4}px`, maxWidth: '100%', position: 'sticky', top: '64px' }}>
        <div style={{ fontWeight: 'bold', fontSize: '0.85rem', margin: '0 0 6px' }}>Önizleme — Soru {qOverflow && <span style={{ color: '#dc2626' }}>⚠ sığmıyor</span>}</div>
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
            {img && img.pos === 'below' && (
              <img src={img.dataUrl} alt="" style={{ display: 'block', width: `${img.widthPct}%`, marginTop: '8px' }} />
            )}
            {img && img.pos === 'right' && (
              <img src={img.dataUrl} alt="" style={{ position: 'absolute', right: '30px', top: `${img.topPx}px`, width: `${img.widthPct}%` }} />
            )}
          </div>
        </div>

        <div style={{ fontWeight: 'bold', fontSize: '0.85rem', margin: '14px 0 6px' }}>Önizleme — Çözüm {sOverflow && <span style={{ color: '#dc2626' }}>⚠ sığmıyor</span>}</div>
        <div style={{ overflowX: 'auto' }}>
          <div ref={sRef} lang="tr" style={pageStyle}>
            <div style={{ ...colStyle, width: '56%', fontSize: '12px' }} dangerouslySetInnerHTML={{ __html: fmt(solution) }} />
            <div style={{ width: '56%', textAlign: 'right', fontSize: '12px', marginTop: '6px' }}>
              {['A', 'B', 'C', 'D', 'E'].map((L) => (
                <span key={L}>|<span style={{ fontWeight: L === answer ? 'bold' : 'normal' }}>{L}</span></span>
              ))}|
            </div>
          </div>
        </div>

        </div>
        </div>
      </div>
    </div>
  );
}

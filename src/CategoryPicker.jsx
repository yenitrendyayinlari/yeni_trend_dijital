import React, { useState } from 'react';

// Ders / Konu / Kazanım seçici -- hem "Soru Yaz" ekranında hem "Etiketlenmemiş Sorular" bölümünde AYNI bileşen.
// Her kutunun sonunda "＋ Yeni … ekle" vardır: yazılan ad oluşturulur ve hemen seçilir.
// Ortak liste mantığı: aynı adlı dersler tek ders olarak gösterilir; birebir aynı ad tekrar eklenmek istenirse
// (büyük/küçük harf farkı olmadan) uyarı verilir -- bu kontrolü onCreate* fonksiyonları yapar.
//
// Props:
//   lessons, topics, outcomes  : listeler ({id, name}, topics: lesson_category_id, outcomes: topic_id)
//   dersId, konuId, kazanimId  : seçili id'ler (string/number/''/null)
//   onChange({dersId, konuId, kazanimId}, changed)  changed: 'ders' | 'konu' | 'kazanim'
//   onCreateLesson(name) / onCreateTopic(dersId, name) / onCreateOutcome(konuId, name) : Promise<{id,name}|null>
//   layout: 'column' (etiketli, alt alta) | 'row' (yan yana, küçük)
const NEW = '__new__';
const byName = (a, b) => a.name.localeCompare(b.name, 'tr');
const same = (a, b) => a != null && b != null && a !== '' && b !== '' && String(a) === String(b);

export default function CategoryPicker({
  lessons = [], topics = [], outcomes = [],
  dersId, konuId, kazanimId, onChange,
  onCreateLesson, onCreateTopic, onCreateOutcome,
  layout = 'column', labelStyle, selectStyle, disabled = false,
}) {
  const [adding, setAdding] = useState(null); // 'ders' | 'konu' | 'kazanim'
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const dId = dersId == null ? '' : String(dersId);
  const kId = konuId == null ? '' : String(konuId);
  const zId = kazanimId == null ? '' : String(kazanimId);

  const uniqLessons = lessons.filter((lc, i, a) => a.findIndex((x) => x.name === lc.name) === i).sort(byName);
  const konular = topics.filter((t) => same(t.lesson_category_id, dId)).sort(byName);
  const kazanimlar = outcomes.filter((o) => same(o.topic_id, kId)).sort(byName);

  const emit = (patch, changed) => onChange && onChange({ dersId: dId, konuId: kId, kazanimId: zId, ...patch }, changed);

  const startAdd = (level) => { setAdding(level); setText(''); };
  const cancelAdd = () => { setAdding(null); setText(''); };
  const confirmAdd = async () => {
    const name = text.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      let created = null;
      if (adding === 'ders' && onCreateLesson) created = await onCreateLesson(name);
      else if (adding === 'konu' && onCreateTopic) created = await onCreateTopic(dId, name);
      else if (adding === 'kazanim' && onCreateOutcome) created = await onCreateOutcome(kId, name);
      if (created) {
        if (adding === 'ders') emit({ dersId: String(created.id), konuId: '', kazanimId: '' }, 'ders');
        else if (adding === 'konu') emit({ konuId: String(created.id), kazanimId: '' }, 'konu');
        else emit({ kazanimId: String(created.id) }, 'kazanim');
        cancelAdd();
      }
    } finally {
      setBusy(false);
    }
  };

  const isRow = layout === 'row';
  const sel = { ...(isRow ? { padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.8rem' } : { width: '100%', boxSizing: 'border-box' }), ...(selectStyle || {}) };
  const addRow = (level, placeholder) => adding === level && (
    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', margin: isRow ? 0 : '6px 0 0' }}>
      <input
        autoFocus type="text" value={text} placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmAdd(); } if (e.key === 'Escape') cancelAdd(); }}
        style={{ flex: 1, minWidth: isRow ? '150px' : 0, padding: '6px 8px', borderRadius: '6px', border: '1px solid #2563eb', fontSize: '0.82rem', boxSizing: 'border-box' }}
      />
      <button type="button" onClick={confirmAdd} disabled={busy || !text.trim()} style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #16a34a', color: '#16a34a', backgroundColor: '#fff', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 'bold', opacity: (busy || !text.trim()) ? 0.5 : 1 }}>Ekle</button>
      <button type="button" onClick={cancelAdd} style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', color: '#475569', backgroundColor: '#fff', cursor: 'pointer', fontSize: '0.78rem' }}>Vazgeç</button>
    </div>
  );

  const block = (label, control, extra) => (isRow
    ? <React.Fragment>{control}{extra}</React.Fragment>
    : <div><label style={labelStyle}>{label}</label>{control}{extra}</div>);

  const dersSel = (
    <select disabled={disabled} style={sel} value={dId}
      onChange={(e) => { if (e.target.value === NEW) { startAdd('ders'); return; } cancelAdd(); emit({ dersId: e.target.value, konuId: '', kazanimId: '' }, 'ders'); }}>
      <option value="">{isRow ? 'Ders Seçin' : 'Seçin'}</option>
      {uniqLessons.map((lc) => <option key={lc.id} value={String(lc.id)}>{lc.name}</option>)}
      {onCreateLesson && <option value={NEW}>＋ Yeni ders ekle…</option>}
    </select>
  );
  const konuSel = (
    <select disabled={disabled || !dId} style={sel} value={kId}
      onChange={(e) => { if (e.target.value === NEW) { startAdd('konu'); return; } cancelAdd(); emit({ konuId: e.target.value, kazanimId: '' }, 'konu'); }}>
      <option value="">{dId ? (isRow ? 'Konu Seçin' : 'Seçin') : 'Önce Ders seçin'}</option>
      {konular.map((t) => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
      {dId && onCreateTopic && <option value={NEW}>＋ Yeni konu ekle…</option>}
    </select>
  );
  const kazSel = (
    <select disabled={disabled || !kId} style={sel} value={zId}
      onChange={(e) => { if (e.target.value === NEW) { startAdd('kazanim'); return; } cancelAdd(); emit({ kazanimId: e.target.value }, 'kazanim'); }}>
      <option value="">{kId ? (isRow ? 'Kazanım Seçin' : 'Seçin') : 'Önce Konu seçin'}</option>
      {kazanimlar.map((o) => <option key={o.id} value={String(o.id)}>{o.name}</option>)}
      {kId && onCreateOutcome && <option value={NEW}>＋ Yeni kazanım ekle…</option>}
    </select>
  );

  const wrapStyle = isRow ? { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } : {};
  return (
    <div style={wrapStyle}>
      {block('Ders', dersSel, addRow('ders', 'Yeni ders adı'))}
      {block('Konu', konuSel, addRow('konu', 'Yeni konu adı'))}
      {block('Kazanım', kazSel, addRow('kazanim', 'Yeni kazanım adı'))}
    </div>
  );
}

// Sınav içeriği / soru dağılımı: Sınav > Ders > Konu > Kazanım ağacı, her seviyede o sınavdaki soru sayısı.
// Kurallar: Ders sayısı = konu sayılarının toplamı (tam eşit olmalı). Konu sayısı >= kazanımlara yazılan KESİN sayıların toplamı;
// kazanım kutusu boşsa "serbest" (denemede kalan sorular o konunun kazanımlarından rastgele gelir). Kurala uymayan satır
// kırmızı gösterilir ve Kaydet engellenir. Ders / konu / kazanım sırası ▲▼ ile belirlenir (sınava özel). Kaydedilenler:
//   exam_category_lessons (ders, soru sayısı, sıra), exam_distribution (konu / kazanım sayıları),
//   exam_categories (süre, yanlış katsayısı).
import { useState, useEffect } from 'react';
import { supabase } from './supabase';

const toInt = (v) => { const n = parseInt(String(v == null ? '' : v).trim(), 10); return Number.isFinite(n) && n > 0 ? n : 0; };
const trSort = (a, b) => String(a).localeCompare(String(b), 'tr');

export default function ExamBlueprintEditor({ exam, lessonCategories, topics, learningOutcomes, onClose, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [duration, setDuration] = useState('');
  const [wrongRatio, setWrongRatio] = useState('4');
  const [lessons, setLessons] = useState([]); // [{id, count}] -- sıra = dizi sırası
  const [tCount, setTCount] = useState({});
  const [oCount, setOCount] = useState({});
  const [tSort, setTSort] = useState({}); // konu id -> sıra
  const [oSort, setOSort] = useState({}); // kazanım id -> sıra
  const [open, setOpen] = useState({});
  const [pool, setPool] = useState({ lesson: {}, topic: {}, outcome: {} });
  const [poolReady, setPoolReady] = useState(false);
  const [addSel, setAddSel] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const ex = await supabase.from('exam_categories').select('duration_min, wrong_ratio').eq('id', exam.id).maybeSingle();
        if (ex.error) throw new Error('Sınav bilgileri okunamadı (sinav_dagilimi.sql çalıştırıldı mı?): ' + ex.error.message);
        const el = await supabase.from('exam_category_lessons').select('lesson_category_id, question_count, sort_order').eq('exam_category_id', exam.id);
        if (el.error) throw new Error('Dersler okunamadı (sinav_dagilimi.sql çalıştırıldı mı?): ' + el.error.message);
        const ds = await supabase.from('exam_distribution').select('level, ref_id, question_count, sort_order').eq('exam_category_id', exam.id);
        if (ds.error) throw new Error('Dağılım okunamadı (sinav_dagilimi.sql çalıştırıldı mı?): ' + ds.error.message);
        if (dead) return;
        const row = ex.data || {};
        setDuration(row.duration_min ? String(row.duration_min) : '');
        setWrongRatio(row.wrong_ratio == null ? '4' : String(row.wrong_ratio));
        const nameOf = (id) => (lessonCategories.find((l) => l.id === id) || {}).name || '';
        const ls = (el.data || []).slice().sort((a, b) => (a.sort_order - b.sort_order) || trSort(nameOf(a.lesson_category_id), nameOf(b.lesson_category_id)));
        setLessons(ls.map((r) => ({ id: r.lesson_category_id, count: r.question_count ? String(r.question_count) : '' })));
        const t = {}, o = {}, ts = {}, os = {};
        (ds.data || []).forEach((r) => {
          if (r.level === 'topic') { if (r.question_count > 0) t[r.ref_id] = String(r.question_count); ts[r.ref_id] = r.sort_order || 0; }
          else { if (r.question_count > 0) o[r.ref_id] = String(r.question_count); os[r.ref_id] = r.sort_order || 0; }
        });
        setTCount(t); setOCount(o); setTSort(ts); setOSort(os);
        setLoading(false);
      } catch (e) { if (!dead) { setLoadErr(e.message); setLoading(false); } }
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam.id]);

  // Havuzdaki soru sayıları (kazanım / konu / ders başına) -- eksik soruyu görmek için
  useEffect(() => {
    let dead = false;
    (async () => {
      const lesson = {}, topic = {}, outcome = {};
      const topicOfOutcome = {};
      learningOutcomes.forEach((o) => { topicOfOutcome[o.id] = o.topic_id; });
      const lessonOfTopic = {};
      topics.forEach((t) => { lessonOfTopic[t.id] = t.lesson_category_id; });
      for (let from = 0; from < 40000; from += 1000) {
        const { data, error } = await supabase.from('question_pool').select('lesson_category_id, topic_id, outcome_id, extra_outcome_ids').order('id').range(from, from + 999);
        if (error || dead) return;
        (data || []).forEach((r) => {
          const oids = new Set();
          if (r.outcome_id != null) oids.add(r.outcome_id);
          (Array.isArray(r.extra_outcome_ids) ? r.extra_outcome_ids : []).forEach((x) => oids.add(Number(x)));
          const tids = new Set(); const lids = new Set();
          if (r.topic_id != null) tids.add(r.topic_id);
          if (r.lesson_category_id != null) lids.add(r.lesson_category_id);
          oids.forEach((oid) => { outcome[oid] = (outcome[oid] || 0) + 1; if (topicOfOutcome[oid] != null) tids.add(topicOfOutcome[oid]); });
          tids.forEach((tid) => { topic[tid] = (topic[tid] || 0) + 1; if (lessonOfTopic[tid] != null) lids.add(lessonOfTopic[tid]); });
          lids.forEach((lid) => { lesson[lid] = (lesson[lid] || 0) + 1; });
        });
        if (!data || data.length < 1000) break;
      }
      if (!dead) { setPool({ lesson, topic, outcome }); setPoolReady(true); }
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Doğrulama ----
  const lessonName = (id) => (lessonCategories.find((l) => l.id === id) || {}).name || `#${id}`;
  const checks = { lesson: {}, topic: {} }; // id -> {err, note}
  let errCount = 0;
  lessons.forEach((l) => {
    const ts = topics.filter((t) => t.lesson_category_id === l.id);
    const cnt = toInt(l.count);
    const sumT = ts.reduce((s, t) => s + toInt(tCount[t.id]), 0);
    if (ts.length > 0 && sumT !== cnt) { checks.lesson[l.id] = { err: `Konuların toplamı ${sumT}, ders sayısı ${cnt} olmalı` }; errCount++; }
    ts.forEach((t) => {
      const os = learningOutcomes.filter((o) => o.topic_id === t.id);
      const tc = toInt(tCount[t.id]);
      const sumO = os.reduce((s, o) => s + toInt(oCount[o.id]), 0);
      if (sumO > tc) { checks.topic[t.id] = { err: `Kesin kazanımların toplamı ${sumO}, konu sayısı ${tc}'i aşıyor` }; errCount++; }
      else if (tc > 0 && os.length > 0) checks.topic[t.id] = { note: sumO === tc ? `${tc} soru kesin (hepsi kazanımlara dağıtıldı)` : (sumO > 0 ? `${sumO} soru kesin, ${tc - sumO} soru serbest (kazanımlardan rastgele)` : `${tc} soru serbest (kazanımlardan rastgele)`) };
    });
  });
  const total = lessons.reduce((s, l) => s + toInt(l.count), 0);

  const sorted = (arr, sortMap) => arr.slice().sort((a, b) => ((sortMap[a.id] != null ? sortMap[a.id] : 1e6) - (sortMap[b.id] != null ? sortMap[b.id] : 1e6)) || trSort(a.name, b.name));
  // Bir grubun (dersin konuları / konunun kazanımları) sırasını yukarı-aşağı kaydır; tüm grubun sırasını yeniden numaralandır
  const moveIn = (list, sortMap, setSortMap, idx, d) => {
    const j = idx + d;
    if (j < 0 || j >= list.length) return;
    const c = list.slice(); [c[idx], c[j]] = [c[j], c[idx]];
    setSortMap((p) => { const n = { ...p }; c.forEach((x, k) => { n[x.id] = k; }); return n; });
  };
  const move = (i, d) => setLessons((arr) => { const j = i + d; if (j < 0 || j >= arr.length) return arr; const c = arr.slice(); [c[i], c[j]] = [c[j], c[i]]; return c; });
  const addLesson = () => {
    const id = Number(addSel);
    if (!id || lessons.some((l) => l.id === id)) return;
    setLessons((arr) => [...arr, { id, count: '' }]); setAddSel('');
  };
  const removeLesson = (id) => {
    if (!window.confirm(`"${lessonName(id)}" dersi bu sınavdan çıkarılsın mı? (Ders silinmez, bu sınavdaki dağılımı kaybolur. Kaydet'e basınca uygulanır.)`)) return;
    setLessons((arr) => arr.filter((l) => l.id !== id));
  };

  const save = async () => {
    if (errCount > 0 || saving) return;
    setSaving(true); setSaveMsg('');
    try {
      const wr = toInt(wrongRatio);
      const up = await supabase.from('exam_categories').update({ duration_min: toInt(duration) || null, wrong_ratio: wr }).eq('id', exam.id);
      if (up.error) throw new Error(up.error.message);
      // Dersler: önce çıkarılanlar, sonra mevcutlar (upsert)
      const keepIds = lessons.map((l) => l.id);
      const cur = await supabase.from('exam_category_lessons').select('lesson_category_id').eq('exam_category_id', exam.id);
      if (cur.error) throw new Error(cur.error.message);
      const removed = (cur.data || []).map((r) => r.lesson_category_id).filter((id) => !keepIds.includes(id));
      if (removed.length) {
        const del = await supabase.from('exam_category_lessons').delete().eq('exam_category_id', exam.id).in('lesson_category_id', removed);
        if (del.error) throw new Error(del.error.message);
      }
      if (lessons.length) {
        const rows = lessons.map((l, i) => ({ exam_category_id: exam.id, lesson_category_id: l.id, question_count: toInt(l.count), sort_order: i }));
        const ins = await supabase.from('exam_category_lessons').upsert(rows, { onConflict: 'exam_category_id,lesson_category_id' });
        if (ins.error) throw new Error(ins.error.message);
      }
      // Dağılım: bu sınavın eski satırlarını silip yenilerini yaz (yalnız sınavda olan derslerin konu/kazanımları)
      const del2 = await supabase.from('exam_distribution').delete().eq('exam_category_id', exam.id);
      if (del2.error) throw new Error(del2.error.message);
      const dist = [];
      lessons.forEach((l) => {
        sorted(topics.filter((t) => t.lesson_category_id === l.id), tSort).forEach((t, ti) => {
          dist.push({ exam_category_id: exam.id, level: 'topic', ref_id: t.id, question_count: toInt(tCount[t.id]), sort_order: ti });
          sorted(learningOutcomes.filter((o) => o.topic_id === t.id), oSort).forEach((o, oi) => {
            dist.push({ exam_category_id: exam.id, level: 'outcome', ref_id: o.id, question_count: toInt(oCount[o.id]), sort_order: oi });
          });
        });
      });
      if (dist.length) {
        const ins2 = await supabase.from('exam_distribution').insert(dist);
        if (ins2.error) throw new Error(ins2.error.message);
      }
      setSaveMsg('Kaydedildi ✓');
      if (onSaved) onSaved();
    } catch (e) { setSaveMsg('Kaydedilemedi: ' + e.message); }
    setSaving(false);
  };

  // ---- Görünüm ----
  const numInp = (value, onChange, hasErr, ph = '0') => (
    <input type="text" inputMode="numeric" value={value} placeholder={ph} onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))}
      style={{ width: '54px', padding: '5px 6px', textAlign: 'center', borderRadius: '6px', border: `1.5px solid ${hasErr ? '#dc2626' : '#cbd5e1'}`, backgroundColor: hasErr ? '#fef2f2' : '#fff', fontSize: '0.88rem' }} />
  );
  const upDown = (onUp, onDown, firstRow, lastRow) => (
    <>
      <button type="button" onClick={onUp} disabled={firstRow} title="Yukarı" style={{ border: 'none', background: 'none', cursor: 'pointer', opacity: firstRow ? 0.25 : 1, padding: '0 2px' }}>▲</button>
      <button type="button" onClick={onDown} disabled={lastRow} title="Aşağı" style={{ border: 'none', background: 'none', cursor: 'pointer', opacity: lastRow ? 0.25 : 1, padding: '0 2px' }}>▼</button>
    </>
  );
  const arrow = (k) => (
    <button type="button" onClick={() => setOpen((p) => ({ ...p, [k]: !p[k] }))} style={{ border: 'none', background: 'none', cursor: 'pointer', width: '20px', color: '#64748b' }}>{open[k] ? '▾' : '▸'}</button>
  );
  const poolBadge = (n, need) => {
    if (!poolReady) return null;
    const have = n || 0;
    const low = need > 0 && have < need;
    return <span title="Soru havuzundaki soru sayısı" style={{ fontSize: '0.72rem', color: low ? '#b45309' : '#94a3b8', fontWeight: low ? 'bold' : 'normal', whiteSpace: 'nowrap' }}>havuz {have}{low ? ' (eksik)' : ''}</span>;
  };
  const statusText = (c) => (c && c.err ? <div style={{ color: '#dc2626', fontSize: '0.74rem', fontWeight: 'bold', paddingLeft: '28px' }}>⚠ {c.err}</div> : (c && c.note ? <div style={{ color: '#94a3b8', fontSize: '0.72rem', paddingLeft: '28px' }}>{c.note}</div> : null));

  const freeLessons = (() => {
    const sinavDersIds = new Set(lessons.map((l) => l.id));
    return lessonCategories.filter((l) => !sinavDersIds.has(l.id)).sort((a, b) => trSort(a.name, b.name));
  })();

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.6)', zIndex: 1020, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '14px' }}>
      <div style={{ backgroundColor: '#fff', borderRadius: '12px', padding: '18px 20px', width: '900px', maxWidth: '100%', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <h2 style={{ margin: 0, fontSize: '1.15rem' }}>📐 {exam.name} · içerik ve soru dağılımı</h2>
          <button onClick={onClose} style={{ marginLeft: 'auto', padding: '6px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#f1f5f9', cursor: 'pointer' }}>Kapat ✕</button>
        </div>

        {loading ? <p style={{ color: '#64748b' }}>Yükleniyor…</p> : loadErr ? <p style={{ color: '#dc2626' }}>{loadErr}</p> : (
          <>
            <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', alignItems: 'center', padding: '8px 0 10px', borderBottom: '1px solid #e2e8f0', fontSize: '0.88rem' }}>
              <span>Toplam soru: <b style={{ fontSize: '1.05rem' }}>{total}</b></span>
              <label>Süre: <input type="text" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value.replace(/[^\d]/g, ''))} placeholder="130" style={{ width: '56px', padding: '5px 6px', textAlign: 'center', borderRadius: '6px', border: '1.5px solid #cbd5e1' }} /> dk</label>
              <label>Her <input type="text" inputMode="numeric" value={wrongRatio} onChange={(e) => setWrongRatio(e.target.value.replace(/[^\d]/g, ''))} style={{ width: '46px', padding: '5px 6px', textAlign: 'center', borderRadius: '6px', border: '1.5px solid #cbd5e1' }} /> yanlış 1 doğruyu götürür <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>(0 = götürmez)</span></label>
            </div>

            <div style={{ overflowY: 'auto', flex: 1, minHeight: '200px', padding: '8px 0' }}>
              {lessons.length === 0 && <p style={{ color: '#94a3b8', fontSize: '0.86rem' }}>Bu sınava henüz ders eklenmedi. Aşağıdan ekleyin.</p>}
              {lessons.map((l, i) => {
                const ts = sorted(topics.filter((t) => t.lesson_category_id === l.id), tSort);
                const c = checks.lesson[l.id];
                const lcnt = toInt(l.count);
                return (
                  <div key={l.id} style={{ borderBottom: '1px solid #e2e8f0', padding: '6px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {arrow('l:' + l.id)}
                      <span style={{ fontWeight: 'bold', flex: 1 }}>{lessonName(l.id)} <span style={{ fontWeight: 'normal', color: '#94a3b8', fontSize: '0.74rem' }}>({ts.length} konu)</span></span>
                      {poolBadge(pool.lesson[l.id], lcnt)}
                      {numInp(l.count, (v) => setLessons((arr) => arr.map((x) => (x.id === l.id ? { ...x, count: v } : x))), !!(c && c.err))}
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0} title="Yukarı" style={{ border: 'none', background: 'none', cursor: 'pointer', opacity: i === 0 ? 0.25 : 1 }}>▲</button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === lessons.length - 1} title="Aşağı" style={{ border: 'none', background: 'none', cursor: 'pointer', opacity: i === lessons.length - 1 ? 0.25 : 1 }}>▼</button>
                      <button type="button" onClick={() => removeLesson(l.id)} title="Sınavdan çıkar" style={{ border: 'none', background: '#fee2e2', color: '#dc2626', borderRadius: '6px', cursor: 'pointer', padding: '3px 7px', fontSize: '0.75rem' }}>✕</button>
                    </div>
                    {statusText(c)}
                    {open['l:' + l.id] && (
                      <div style={{ paddingLeft: '26px', paddingTop: '4px' }}>
                        {ts.length === 0 && <p style={{ color: '#cbd5e1', fontSize: '0.76rem', margin: '4px 0' }}>Bu derse bağlı konu yok.</p>}
                        {ts.map((t, ti) => {
                          const os = sorted(learningOutcomes.filter((o) => o.topic_id === t.id), oSort);
                          const tc = checks.topic[t.id];
                          const tcnt = toInt(tCount[t.id]);
                          return (
                            <div key={t.id} style={{ borderTop: '1px solid #f1f5f9', padding: '4px 0' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                {arrow('t:' + t.id)}
                                <span style={{ flex: 1, fontSize: '0.88rem' }}>{t.name} <span style={{ color: '#94a3b8', fontSize: '0.72rem' }}>({os.length} kazanım)</span></span>
                                {poolBadge(pool.topic[t.id], tcnt)}
                                {numInp(tCount[t.id] || '', (v) => setTCount((p) => ({ ...p, [t.id]: v })), !!(tc && tc.err))}
                                {upDown(() => moveIn(ts, tSort, setTSort, ti, -1), () => moveIn(ts, tSort, setTSort, ti, 1), ti === 0, ti === ts.length - 1)}
                              </div>
                              {statusText(tc)}
                              {open['t:' + t.id] && (
                                <div style={{ paddingLeft: '26px' }}>
                                  {os.length === 0 && <p style={{ color: '#cbd5e1', fontSize: '0.74rem', margin: '3px 0' }}>Bu konuya bağlı kazanım yok.</p>}
                                  {os.map((o, oi) => (
                                    <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 0' }}>
                                      <span style={{ width: '20px' }} />
                                      <span style={{ flex: 1, fontSize: '0.82rem', color: '#475569' }}>{o.name}</span>
                                      {poolBadge(pool.outcome[o.id], toInt(oCount[o.id]))}
                                      {numInp(oCount[o.id] || '', (v) => setOCount((p) => ({ ...p, [o.id]: v })), false, '–')}
                                      {upDown(() => moveIn(os, oSort, setOSort, oi, -1), () => moveIn(os, oSort, setOSort, oi, 1), oi === 0, oi === os.length - 1)}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid #e2e8f0', paddingTop: '10px' }}>
              <select value={addSel} onChange={(e) => setAddSel(e.target.value)} style={{ padding: '7px', borderRadius: '6px', border: '1px solid #cbd5e1', minWidth: '180px' }}>
                <option value="">+ Ders ekle…</option>
                {freeLessons.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <button type="button" onClick={addLesson} disabled={!addSel} style={{ padding: '7px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: addSel ? 'pointer' : 'not-allowed' }}>Ekle</button>
              <span style={{ marginLeft: 'auto', fontSize: '0.82rem', color: saveMsg.startsWith('Kaydedilemedi') ? '#dc2626' : '#16a34a' }}>{saveMsg}</span>
              {errCount > 0 && <span style={{ fontSize: '0.8rem', color: '#dc2626', fontWeight: 'bold' }}>{errCount} satırda toplam tutmuyor — kaydedilemez</span>}
              <button type="button" onClick={save} disabled={errCount > 0 || saving} style={{ padding: '9px 22px', borderRadius: '8px', border: 'none', backgroundColor: errCount > 0 ? '#cbd5e1' : '#16a34a', color: '#fff', fontWeight: 'bold', cursor: errCount > 0 || saving ? 'not-allowed' : 'pointer' }}>{saving ? 'Kaydediliyor…' : 'Kaydet'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

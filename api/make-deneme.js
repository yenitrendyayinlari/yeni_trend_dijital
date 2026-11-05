import { createClient } from '@supabase/supabase-js';
import { PDFDocument } from 'pdf-lib';

// Öğrenci için ANLIK DENEME üretir: sınav tanımındaki (Tanımla > Sınavlar > İçerik ve dağılım) ders / konu / kazanım
// sayılarına göre soru havuzundan rastgele soru seçer, soru ve çözüm PDF'lerini birleştirir ve o öğrenciye ait
// gerçek bir "exams" kaydı açar (owner_email dolu). Sonrası mevcut sınav ekranıdır (süre, soru paleti, cevap kartı, rapor).
// Yalnız ders denemesi: { examCategoryId, lessonIds }  (lessonIds = aynı adlı derslerin tüm id'leri)
export const config = { maxDuration: 60 };

const supabaseAdmin = createClient(
  'https://gzkqylheloxcgpcrftci.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const BUCKET = 'exam-files';
const HOURLY_LIMIT = 10; // bir öğrenci saatte en fazla kaç deneme üretebilir

function extractStoragePath(value) {
  if (!value) return null;
  const marker = `/${BUCKET}/`;
  const idx = value.indexOf(marker);
  return idx !== -1 ? value.slice(idx + marker.length) : value;
}
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const nums = (a) => (Array.isArray(a) ? a.map(Number).filter((n) => Number.isFinite(n)).slice(0, 200) : []);
const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const trSort = (a, b) => String(a).localeCompare(String(b), 'tr');

async function selectAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function download(path) {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error('Soru dosyası indirilemedi');
  return await data.arrayBuffer();
}
async function mapLimit(items, limit, fn) {
  const res = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; res[k] = await fn(items[k], k); }
  }));
  return res;
}
async function mergeBytes(list) {
  const merged = await PDFDocument.create();
  for (const bytes of list) {
    if (bytes === null) { merged.addPage(); continue; } // çözümü olmayan soru: sayfa numarası hizalı kalsın
    const src = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }
  return await merged.save();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!token) return res.status(401).json({ error: 'Deneme çözmek için giriş yapmalısınız.' });
  const { data: u, error: ue } = await supabaseAdmin.auth.getUser(token);
  if (ue || !u?.user?.email) return res.status(401).json({ error: 'Oturum geçersiz, tekrar giriş yapın.' });
  const email = u.user.email;

  const examCategoryId = num(req.body?.examCategoryId);
  const lessonIds = nums(req.body?.lessonIds);
  if (!examCategoryId || !lessonIds.length) return res.status(400).json({ error: 'Geçersiz istek' });

  try {
    // --- Kötüye kullanım sınırı ---
    const since = new Date(Date.now() - 3600 * 1000).toISOString();
    const recent = await supabaseAdmin.from('exams').select('id', { count: 'exact', head: true }).eq('owner_email', email).gte('created_at', since);
    if ((recent.count || 0) >= HOURLY_LIMIT) return res.status(429).json({ error: 'Kısa sürede çok fazla deneme başlattın. Biraz bekleyip tekrar dene.' });

    // --- Sınav ve ders tanımı ---
    const { data: cat, error: ce } = await supabaseAdmin.from('exam_categories').select('id, name, duration_min').eq('id', examCategoryId).maybeSingle();
    if (ce || !cat) return res.status(404).json({ error: 'Sınav bulunamadı.' });
    const ecl = await supabaseAdmin.from('exam_category_lessons').select('lesson_category_id, question_count').eq('exam_category_id', examCategoryId);
    if (ecl.error) throw ecl.error;
    const allRows = ecl.data || [];
    const myRows = allRows.filter((r) => lessonIds.includes(r.lesson_category_id));
    const L = myRows.reduce((s, r) => s + num(r.question_count), 0);
    if (!myRows.length || L <= 0) return res.status(400).json({ error: 'Bu ders için sınav tanımında soru sayısı girilmemiş.' });
    const totalAll = allRows.reduce((s, r) => s + num(r.question_count), 0);
    const myLessonIds = myRows.map((r) => r.lesson_category_id);
    const { data: lessonRow } = await supabaseAdmin.from('lesson_categories').select('id, name').eq('id', myLessonIds[0]).maybeSingle();
    const lessonName = lessonRow?.name || 'Ders';

    // --- Konu / kazanım dağılımı ---
    const dist = await selectAll(() => supabaseAdmin.from('exam_distribution').select('level, ref_id, question_count, sort_order, excluded, parent_lesson_id').eq('exam_category_id', examCategoryId).order('ref_id'));
    const topicRowsAll = dist.filter((r) => r.level === 'topic' && !r.excluded && r.question_count > 0);
    const topicIdsAll = topicRowsAll.map((r) => r.ref_id);
    if (!topicIdsAll.length) return res.status(400).json({ error: 'Bu ders için konu dağılımı tanımlanmamış.' });
    const { data: topicDefs, error: te } = await supabaseAdmin.from('topics').select('id, name, lesson_category_id').in('id', topicIdsAll);
    if (te) throw te;
    const topicById = new Map((topicDefs || []).map((t) => [t.id, t]));
    const myTopicRows = topicRowsAll
      .filter((r) => { const t = topicById.get(r.ref_id); if (!t) return false; return r.parent_lesson_id ? myLessonIds.includes(r.parent_lesson_id) : myLessonIds.includes(t.lesson_category_id); })
      .sort((a, b) => ((a.sort_order || 0) - (b.sort_order || 0)) || trSort(topicById.get(a.ref_id).name, topicById.get(b.ref_id).name));
    const sumT = myTopicRows.reduce((s, r) => s + r.question_count, 0);
    if (!myTopicRows.length || sumT !== L) return res.status(400).json({ error: `Sınav tanımında konuların toplamı (${sumT}) ders sayısına (${L}) eşit değil.` });
    const myTopicIds = myTopicRows.map((r) => r.ref_id);

    const { data: outDefs, error: oe } = await supabaseAdmin.from('learning_outcomes').select('id, name, topic_id').in('topic_id', myTopicIds);
    if (oe) throw oe;
    const topicOfOutcome = new Map((outDefs || []).map((o) => [o.id, o.topic_id]));
    const outName = new Map((outDefs || []).map((o) => [o.id, o.name]));
    const exOut = new Set(dist.filter((r) => r.level === 'outcome' && r.excluded).map((r) => r.ref_id));
    const outRow = new Map(dist.filter((r) => r.level === 'outcome').map((r) => [r.ref_id, r]));

    // --- Havuz adayları ---
    const COLS = 'id, topic_id, outcome_id, extra_outcome_ids, set_key, pdf_file, solution_pdf_file, correct_answer, lesson_category_id';
    const A = ['A', 'B', 'C', 'D', 'E'];
    const outIds = (outDefs || []).map((o) => o.id);
    const fetched = new Map();
    const add = (rows) => rows.forEach((r) => { if (r.pdf_file && A.includes(String(r.correct_answer || '').trim().toUpperCase())) fetched.set(r.id, r); });
    add(await selectAll(() => supabaseAdmin.from('question_pool').select(COLS).in('topic_id', myTopicIds).order('id')));
    if (outIds.length) {
      add(await selectAll(() => supabaseAdmin.from('question_pool').select(COLS).in('outcome_id', outIds).order('id')));
      add(await selectAll(() => supabaseAdmin.from('question_pool').select(COLS).neq('extra_outcome_ids', '[]').order('id')));
    }
    const qOutcomes = (q) => { const s = new Set(); if (q.outcome_id != null) s.add(q.outcome_id); (Array.isArray(q.extra_outcome_ids) ? q.extra_outcome_ids : []).forEach((x) => s.add(Number(x))); return [...s]; };
    const bySet = new Map();
    fetched.forEach((q) => { if (q.set_key) { if (!bySet.has(q.set_key)) bySet.set(q.set_key, []); bySet.get(q.set_key).push(q); } });

    // Öğrencinin daha önce üretilmiş denemelerinde gördüğü sorular: yeni sorular öne alınır
    const seen = new Set();
    const mine = await selectAll(() => supabaseAdmin.from('exams').select('id').eq('owner_email', email).order('id'));
    if (mine.length) {
      const exIds = mine.map((m) => m.id);
      for (let i = 0; i < exIds.length; i += 200) {
        const { data: us } = await supabaseAdmin.from('question_pool_usage').select('pool_question_id').in('exam_id', exIds.slice(i, i + 200));
        (us || []).forEach((x) => seen.add(x.pool_question_id));
      }
    }

    const used = new Set();
    const pickFrom = (cands, n) => {
      // Birkaç rastgele deneme: soru grupları bölünmediği için tam n'e en yakın seçimi bul (yeni sorular öncelikli)
      let best = [];
      for (let attempt = 0; attempt < 40 && best.length < n; attempt++) {
        const order = [...shuffle(cands.filter((q) => !seen.has(q.id))), ...shuffle(cands.filter((q) => seen.has(q.id)))];
        const taken = new Set(); const picked = [];
        for (const q of order) {
          if (picked.length >= n) break;
          if (used.has(q.id) || taken.has(q.id)) continue;
          const group = q.set_key ? (bySet.get(q.set_key) || [q]).filter((g) => !used.has(g.id) && !taken.has(g.id)).sort((a, b) => a.id - b.id) : [q];
          if (group.length > n - picked.length) continue; // soru grubu bölünmez
          group.forEach((g) => { taken.add(g.id); picked.push(g); });
        }
        if (picked.length > best.length) best = picked;
      }
      best.forEach((g) => used.add(g.id));
      return best;
    };

    const picked = []; // sırayla: { q, topicId }
    const shortages = [];
    for (const tr of myTopicRows) {
      const T = tr.ref_id;
      const topicName = topicById.get(T).name;
      const eligible = [...fetched.values()].filter((q) => {
        const outs = qOutcomes(q).filter((o) => topicOfOutcome.get(o) === T);
        if (q.topic_id !== T && !outs.length) return false;
        if (outs.length && outs.every((o) => exOut.has(o))) return false; // yalnız bu sınavda pasif kazanımlara bağlı
        return true;
      });
      const outsOfT = (outDefs || []).filter((o) => o.topic_id === T && !exOut.has(o.id))
        .sort((a, b) => (((outRow.get(a.id) || {}).sort_order || 0) - ((outRow.get(b.id) || {}).sort_order || 0)) || trSort(a.name, b.name));
      let need = tr.question_count;
      const got = [];
      for (const o of outsOfT) {
        const c = Math.min(num((outRow.get(o.id) || {}).question_count), need - got.length);
        if (c <= 0) continue;
        const p = pickFrom(eligible.filter((q) => qOutcomes(q).includes(o.id)), c);
        if (p.length < c) shortages.push({ topic: topicName, outcome: outName.get(o.id), missing: c - p.length });
        got.push(...p);
      }
      const free = need - got.length;
      if (free > 0) {
        const p = pickFrom(eligible, free);
        if (p.length < free) shortages.push({ topic: topicName, missing: free - p.length });
        got.push(...p);
      }
      got.forEach((q) => picked.push({ q, topicId: T }));
    }
    if (shortages.length) {
      const txt = shortages.map((s) => `${s.topic}${s.outcome ? ' › ' + s.outcome : ''}: ${s.missing} soru eksik`).join('; ');
      return res.status(409).json({ error: 'Bu deneme için havuzda yeterli soru yok.', shortages, detail: txt });
    }

    // --- PDF'leri birleştir ---
    const qBytes = await mapLimit(picked, 8, (p) => download(extractStoragePath(p.q.pdf_file)));
    const mergedQ = await mergeBytes(qBytes);
    const stamp = `${Math.random().toString(36).slice(2)}_${Date.now()}`;
    const qName = `deneme_${stamp}.pdf`;
    const up1 = await supabaseAdmin.storage.from(BUCKET).upload(qName, mergedQ, { contentType: 'application/pdf' });
    if (up1.error) throw up1.error;
    let sName = null;
    if (picked.some((p) => p.q.solution_pdf_file)) {
      const sBytes = await mapLimit(picked, 8, (p) => (p.q.solution_pdf_file ? download(extractStoragePath(p.q.solution_pdf_file)) : Promise.resolve(null)));
      const mergedS = await mergeBytes(sBytes);
      sName = `deneme_sol_${stamp}.pdf`;
      const up2 = await supabaseAdmin.storage.from(BUCKET).upload(sName, mergedS, { contentType: 'application/pdf' });
      if (up2.error) throw up2.error;
    }

    // --- Sınav kaydı + cevap anahtarı + kazanım haritası ---
    const lessonById = new Map();
    const topicMap = {}; const answerKey = {};
    const { data: lessons } = await supabaseAdmin.from('lesson_categories').select('id, name').in('id', [...new Set(picked.map((p) => p.q.lesson_category_id).filter((x) => x != null))]);
    (lessons || []).forEach((l) => lessonById.set(l.id, l.name));
    picked.forEach((p, i) => {
      const page = i + 1;
      const oid = p.q.outcome_id != null && topicOfOutcome.get(p.q.outcome_id) === p.topicId ? p.q.outcome_id : qOutcomes(p.q).find((o) => topicOfOutcome.get(o) === p.topicId);
      topicMap[page] = { ders: lessonName, konu: topicById.get(p.topicId).name, kazanim: oid != null ? (outName.get(oid) || '') : '' };
      answerKey[page] = String(p.q.correct_answer).trim().toUpperCase();
    });
    const duration = cat.duration_min && totalAll > 0 ? Math.max(1, Math.round((cat.duration_min * L) / totalAll)) : Math.max(1, Math.round(L * 1.2));
    const d = new Date(Date.now() + 3 * 3600 * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    const examName = `${cat.name} ${lessonName} Denemesi · ${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    const ins = await supabaseAdmin.from('exams').insert([{
      name: examName,
      parent_id: null,
      is_published: true,
      exam_type: 'deneme',
      category_exam_type: cat.name,
      category_lesson: lessonName,
      duration,
      price: 0,
      sections: [{ name: lessonName, start: 1, end: picked.length }],
      num_pages: picked.length,
      sort_order: 0,
      pdf_file: qName,
      solution_pdf_file: sName,
      topic_map: topicMap,
      owner_email: email,
    }]).select().single();
    if (ins.error) throw ins.error;
    const exam = ins.data;
    const key = await supabaseAdmin.from('exam_answer_keys').upsert([{ exam_id: exam.id, answer_key: answerKey }], { onConflict: 'exam_id' });
    if (key.error) throw key.error;
    try {
      const batch = (globalThis.crypto && globalThis.crypto.randomUUID) ? globalThis.crypto.randomUUID() : undefined;
      await supabaseAdmin.from('question_pool_usage').insert(picked.map((p) => ({ pool_question_id: p.q.id, exam_id: exam.id, batch_id: batch })));
    } catch (e) { console.error('usage kaydı', e); }

    return res.status(200).json({ exam });
  } catch (e) {
    console.error('make-deneme', e);
    return res.status(500).json({ error: 'Deneme hazırlanamadı, tekrar deneyin.' });
  }
}

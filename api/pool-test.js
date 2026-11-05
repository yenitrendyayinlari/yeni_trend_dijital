import { createClient } from '@supabase/supabase-js';

// Öğrenci tarafı konu testi: soruları SUNUCUDA seçer, böylece question_pool
// tablosu admin-only kalır ve doğru cevap tarayıcıya cevap verilmeden gitmez.
const supabaseAdmin = createClient(
  'https://gzkqylheloxcgpcrftci.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const BUCKET = 'exam-files';
const TTL = 4 * 60 * 60;

function extractStoragePath(value) {
  if (!value) return null;
  const marker = `/${BUCKET}/`;
  const idx = value.indexOf(marker);
  return idx !== -1 ? value.slice(idx + marker.length) : value;
}
async function signed(value) {
  const path = extractStoragePath(value);
  if (!path) return null;
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, TTL);
  return error || !data ? null : data.signedUrl;
}
const ids = (a) => (Array.isArray(a) ? a.map(Number).filter((n) => Number.isFinite(n)).slice(0, 200) : []);
const GUEST_LIMIT = 5; // misafir kaç soru çözebilir (App.jsx'teki KonuTesti ile aynı olmalı)
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  // Giriş yapmamış (misafir) öğrenci de başlayabilir; GUEST_LIMIT sorudan sonra giriş istenir.
  // Geçersiz bir jeton gelirse misafir sayılmaz, 401 döner (oturum süresi dolmuş olabilir).
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  let userId = null;
  if (token) {
    const { data: u, error: ue } = await supabaseAdmin.auth.getUser(token);
    if (ue || !u?.user) return res.status(401).json({ error: 'Oturum geçersiz, tekrar giriş yapın.' });
    userId = u.user.id;
  }
  const { action } = req.body || {};

  try {
    if (action === 'next') {
      const lessonIds = ids(req.body.lessonIds);
      const topicIds = ids(req.body.topicIds);
      const outcomeIds = ids(req.body.outcomeIds);
      const seen = new Set(ids(req.body.seen));
      if (!lessonIds.length) return res.status(400).json({ error: 'Ders seçilmedi.' });
      if (!userId && seen.size >= GUEST_LIMIT) return res.status(200).json({ needLogin: true, limit: GUEST_LIMIT });

      // Havuzdaki uygun soruların id'leri (sayfa sayfa)
      const all = [];
      for (let from = 0; ; from += 1000) {
        let q = supabaseAdmin.from('question_pool').select('id').in('lesson_category_id', lessonIds).not('pdf_file', 'is', null).in('correct_answer', ['A', 'B', 'C', 'D', 'E']).order('id').range(from, from + 999);
        if (topicIds.length) q = q.in('topic_id', topicIds);
        if (outcomeIds.length) q = q.or([`outcome_id.in.(${outcomeIds.join(',')})`, ...outcomeIds.map((o) => `extra_outcome_ids.cs.[${o}]`)].join(','));
        const { data, error } = await q;
        if (error) throw error;
        all.push(...data.map((r) => r.id));
        if (data.length < 1000) break;
      }
      if (!all.length) return res.status(200).json({ empty: true, total: 0 });

      // Öğrencinin bu sorulardaki son cevabı (misafirde kayıt yok)
      const last = new Map();
      for (let i = 0; userId && i < all.length; i += 500) {
        const { data, error } = await supabaseAdmin.from('student_answers')
          .select('pool_question_id, is_correct, created_at').eq('user_id', userId)
          .in('pool_question_id', all.slice(i, i + 500)).order('created_at', { ascending: true });
        if (error) throw error;
        data.forEach((r) => last.set(r.pool_question_id, r.is_correct));
      }
      const cand = all.filter((id) => !seen.has(id));
      const unseen = cand.filter((id) => !last.has(id));
      const wrong = cand.filter((id) => last.get(id) === false);
      const right = cand.filter((id) => last.get(id) === true);
      const pool = unseen.length ? unseen : wrong.length ? wrong : right;
      const stats = { total: all.length, unseen: all.filter((id) => !last.has(id)).length, wrong: all.filter((id) => last.get(id) === false).length, right: all.filter((id) => last.get(id) === true).length };
      if (!pool.length) return res.status(200).json({ empty: true, ...stats });

      const id = pick(pool);
      const { data: row, error } = await supabaseAdmin.from('question_pool').select('id, pdf_file').eq('id', id).single();
      if (error || !row) throw error || new Error('Soru bulunamadı');
      const url = await signed(row.pdf_file);
      if (!url) return res.status(500).json({ error: 'Soru dosyası bulunamadı.' });
      return res.status(200).json({ id, url, kind: unseen.length ? 'new' : wrong.length ? 'wrong' : 'right', ...stats });
    }

    if (action === 'answer') {
      const poolId = Number(req.body.poolId);
      const choice = ['A', 'B', 'C', 'D', 'E'].includes(req.body.choice) ? req.body.choice : null;
      if (!poolId) return res.status(400).json({ error: 'Geçersiz istek' });
      const { data: row, error } = await supabaseAdmin.from('question_pool').select('id, correct_answer, solution_pdf_file').eq('id', poolId).single();
      if (error || !row) return res.status(404).json({ error: 'Soru bulunamadı' });
      const correct = String(row.correct_answer || '').trim().toUpperCase();
      const isCorrect = !!choice && choice === correct;
      if (userId) {
      const { error: ie } = await supabaseAdmin.from('student_answers').insert({ user_id: userId, pool_question_id: poolId, choice, is_correct: isCorrect });
      if (ie) throw ie;
      }
      return res.status(200).json({ correct, isCorrect, solutionUrl: await signed(row.solution_pdf_file) });
    }

    return res.status(400).json({ error: 'Geçersiz istek' });
  } catch (e) {
    console.error('pool-test', e);
    return res.status(500).json({ error: 'Bir hata oluştu, tekrar deneyin.' });
  }
}

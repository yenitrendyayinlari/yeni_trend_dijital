import { createClient } from '@supabase/supabase-js';

// Depo temizliği (SADECE admin): question_pool ve exams kayıtlarına bağlı OLMAYAN dosyaları bulur / siler.
// Service Role anahtarı yalnızca bu sunucu dosyasında kullanılır.
const supabaseAdmin = createClient('https://gzkqylheloxcgpcrftci.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY);
const BUCKET = 'exam-files';
export const config = { maxDuration: 60 };

// Eski sınav kayıtlarında tam public URL olabilir; yalnızca dosya adını al.
const toPath = (v) => {
  if (!v) return null;
  const m = `/${BUCKET}/`; const i = v.indexOf(m);
  let p = i !== -1 ? v.slice(i + m.length) : v;
  p = p.split('?')[0];
  try { p = decodeURIComponent(p); } catch (e) { /* olduğu gibi */ }
  return p;
};

async function collect() {
  const used = new Set();
  for (const tbl of ['question_pool', 'exams']) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabaseAdmin.from(tbl).select('pdf_file, solution_pdf_file').order('id').range(from, from + 999);
      if (error) throw new Error(`${tbl} okunamadı: ${error.message}`);
      (data || []).forEach((r) => { [r.pdf_file, r.solution_pdf_file].forEach((v) => { const p = toPath(v); if (p) { used.add(p); used.add(v); } }); });
      if (!data || data.length < 1000) break;
    }
  }
  const orphan = []; let total = 0, bytes = 0;
  const recent = Date.now() - 2 * 3600 * 1000;
  for (let off = 0; ; off += 1000) {
    const { data, error } = await supabaseAdmin.storage.from(BUCKET).list('', { limit: 1000, offset: off, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error('Depo listelenemedi: ' + error.message);
    (data || []).forEach((o) => {
      if (!o.id) return; // klasör
      total++;
      if (used.has(o.name)) return;
      if (o.created_at && new Date(o.created_at).getTime() > recent) return;
      orphan.push(o.name); bytes += (o.metadata && o.metadata.size) || 0;
    });
    if (!data || data.length < 1000) break;
  }
  return { total, orphan, bytes, usedCount: used.size };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Giriş gerekli' });
    const { data: u, error: ue } = await supabaseAdmin.auth.getUser(token);
    if (ue || !u?.user?.email || u.user.email !== 'admin@yayinevi.com') return res.status(403).json({ error: 'Yetkisiz' });

    const { action } = req.body || {};
    const r = await collect();
    if (action !== 'delete') {
      return res.status(200).json({ total: r.total, orphanCount: r.orphan.length, bytes: r.bytes, sample: r.orphan.slice(0, 5), usedCount: r.usedCount });
    }
    // Güvenlik: bağlı dosya sayısı 0 görünüyorsa (okuma hatası olasılığı) hiçbir şey silme.
    if (r.usedCount === 0) return res.status(409).json({ error: 'Kayıtlara bağlı dosya bulunamadı; güvenlik için silinmedi.' });
    // Zaman aşımına düşmemek için her istekte en fazla 1000 dosya silinir; ekran kalan kalmayana dek tekrar çağırır.
    const batch = r.orphan.slice(0, 1000);
    let removed = 0, failed = 0;
    for (let i = 0; i < batch.length; i += 100) {
      const chunk = batch.slice(i, i + 100);
      const { data, error } = await supabaseAdmin.storage.from(BUCKET).remove(chunk);
      if (error) failed += chunk.length; else { removed += (data || []).length; failed += chunk.length - (data || []).length; }
    }
    return res.status(200).json({ removed, failed, remaining: r.orphan.length - batch.length });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

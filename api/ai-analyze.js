import { createClient } from '@supabase/supabase-js';

// Soru Havuzu "Benzer Sorular" penceresindeki "Yapay zekayla doğrula" düğmesinin sunucu tarafı.
// SADECE admin çağırabilir. API anahtarları Vercel > Settings > Environment Variables içinde durur,
// tarayıcıya hiç gitmez:
//   ANTHROPIC_API_KEY   (Claude)         -- isteğe bağlı model: ANTHROPIC_MODEL (varsayılan claude-sonnet-5-5)
//   GEMINI_API_KEY      (Google Gemini)  -- isteğe bağlı model: GEMINI_MODEL    (varsayılan gemini-3.8-flash)
// Not: Bir istek tek bir benzer-soru grubunu analiz eder (Vercel'in süre sınırına takılmamak için).
const supabaseAdmin = createClient(
  'https://gzkqylheloxcgpcrftci.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PROMPT = (items) => `Sen bir KPSS/AGS soru bankası editörüsün. Aşağıda bir soru havuzunda birbirine benzer görünen ${items.length} soru var.
Görevin: bu soruların hangilerinin GERÇEKTEN tekrar (aynı soru ya da aynı bilgiyi ölçen soru) olduğunu belirlemek.

Kurallar:
- "ayni": Aynı bilgiyi aynı şekilde soran sorular. Kelimelerin, şık sırasının ya da küçük yazım farklarının önemi yok.
- "benzer": Aynı bilgiyi/kazanımı ölçüyor ama soru kalıbı belirgin farklı (ör. biri "hangisidir", diğeri "hangisi değildir" ama aynı bilgiye dayanıyor). Havuzda ikisini birden tutmak gereksiz tekrar sayılır.
- "farkli": Farklı bilgiyi ölçüyor. Ortak kelimeler (ör. "Yukarıdakilerden hangileri", "Yalnız I", "I ve III", dönem adı) benzerlik sayılmaz.
Matematik/sayısal sorularda sayılar farklıysa genelde "farkli" dir.
Tüm sorular bir kümeye atanmalı; tekrar olmayan soru tek başına bir küme olur. Her çok üyeli küme için hangisinin tutulacağını (daha net, daha doğru, daha iyi yazılmış olan) öner.

SORULAR:
${items.map((q) => `[#${q.id}] (doğru cevap: ${q.answer || '?'})\n${String(q.text || '').slice(0, 2500)}`).join('\n\n')}

SADECE şu JSON'u döndür (başka metin yok):
{"clusters":[{"ids":[<soru numaraları>],"verdict":"ayni|benzer|farkli","reason":"<tek cümle Türkçe gerekçe>","keep":<tutulacak soru numarası ya da null>}]}`;

async function callClaude(prompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY Vercel ortam değişkenlerinde tanımlı değil.');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Claude: ${j.error?.message || r.status}`);
  return (j.content || []).map((c) => c.text || '').join('');
}

async function callGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY Vercel ortam değişkenlerinde tanımlı değil.');
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Gemini: ${j.error?.message || r.status}`);
  return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Giriş yapmalısınız.' });
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user?.email || userData.user.email !== 'admin@yayinevi.com') {
    return res.status(403).json({ error: 'Yetkiniz yok.' });
  }

  const { provider, items } = req.body || {};
  if (!['claude', 'gemini'].includes(provider)) return res.status(400).json({ error: 'Geçersiz model.' });
  if (!Array.isArray(items) || items.length < 2 || items.length > 8) return res.status(400).json({ error: 'Bir grupta 2-8 soru olmalı.' });

  try {
    const prompt = PROMPT(items);
    const text = provider === 'claude' ? await callClaude(prompt) : await callGemini(prompt);
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Modelden anlaşılır bir cevap gelmedi.');
    const parsed = JSON.parse(m[0]);
    const known = new Set(items.map((q) => Number(q.id)));
    const clusters = (parsed.clusters || []).map((c) => ({
      ids: (c.ids || []).map(Number).filter((id) => known.has(id)),
      verdict: ['ayni', 'benzer', 'farkli'].includes(c.verdict) ? c.verdict : 'farkli',
      reason: String(c.reason || '').slice(0, 300),
      keep: c.keep != null && known.has(Number(c.keep)) ? Number(c.keep) : null,
    })).filter((c) => c.ids.length > 0);
    return res.status(200).json({ clusters });
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Yapay zekâ isteği başarısız.' });
  }
}

import { createClient } from '@supabase/supabase-js';

// Soru Havuzu "Benzer Sorular" penceresindeki "Yapay zekayla doğrula" düğmesinin sunucu tarafı.
// SADECE admin çağırabilir. API anahtarları Vercel > Settings > Environment Variables içinde durur.
const supabaseAdmin = createClient(
  'https://gzkqylheloxcgpcrftci.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PROMPT = (groups) => `Sen bir KPSS/AGS soru bankası editörüsün. Aşağıda birbirine benzer ${groups.length} grup soru var.
Görevin: Her gruptaki soruların hangilerinin GERÇEKTEN tekrar (aynı bilgi) olduğunu bulmak. Gruplar birbirinden bağımsızdır.

Kurallar:
- "ayni": Aynı bilgiyi aynı şekilde soran sorular.
- "benzer": Aynı bilgiyi ölçüyor ama soru kalıbı farklı (ikisini tutmak gereksiz).
- "farkli": Farklı bilgiyi ölçüyor. Ortak kelimeler benzerlik sayılmaz.

${groups.map((g) => `=== GRUP ${g.key} ===\n` + g.items.map((q) => `[#${q.id}] (cevap: ${q.answer || '?'})\n${String(q.text || '').slice(0, 1200)}`).join('\n\n')).join('\n\n')}

SADECE şu JSON'u döndür (başka metin yok):
{"groups":[{"key":"<grup anahtarı>","clusters":[{"ids":[<soru numaraları>],"verdict":"ayni|benzer|farkli","reason":"<kısa gerekçe>","keep":<tutulacak soruno ya da null>}]}]}`;

async function callGemini(prompt, retries = 2, delay = 2500) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY Vercel ortam değişkenlerinde tanımlı değil.');
  
  // Güncel ve hızlı Gemini 2.5 Flash modeli
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const generationConfig = { 
    temperature: 0, 
    responseMimeType: 'application/json' 
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        // Vercel 60sn limitine takılmadan hata fırlatabilmesi için 45sn timeout
        signal: AbortSignal.timeout(45000),
        body: JSON.stringify({ 
          contents: [{ parts: [{ text: prompt }] }], 
          generationConfig 
        }),
      });

      const j = await r.json().catch(() => ({}));

      // Sunucu yoğunluğu (429 / 503) varsa bekleyip tekrar dene
      if ((r.status === 429 || r.status === 503) && attempt < retries) {
        await new Promise((res) => setTimeout(res, delay * (attempt + 1)));
        continue;
      }

      if (!r.ok) throw new Error(`Gemini: ${j.error?.message || r.status}`);
      return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((res) => setTimeout(res, delay));
    }
  }
}

// Vercel serverless fonksiyon süre sınırı
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Giriş yapmalısınız.' });
  
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user?.email || userData.user.email !== 'admin@yayinevi.com') {
    return res.status(403).json({ error: 'Yetkiniz yok.' });
  }

  const { provider, groups } = req.body || {};
  if (provider !== 'gemini' && provider !== 'claude') return res.status(400).json({ error: 'Geçersiz model.' });
  
  // 504 Zaman Aşımlarını önlemek için tek istekte maksimum 3-4 grup olmalı
  if (!Array.isArray(groups) || groups.length < 1 || groups.length > 5) {
    return res.status(400).json({ error: 'Zaman aşımını önlemek için bir istekte en fazla 5 grup gönderilebilir.' });
  }

  try {
    const prompt = PROMPT(groups);
    const text = await callGemini(prompt);
    
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Modelden anlaşılır bir cevap gelmedi.');
    
    const parsed = JSON.parse(m[0]);
    const out = {};
    
    groups.forEach((g) => {
      const known = new Set(g.items.map((q) => Number(q.id)));
      const hit = (parsed.groups || []).find((x) => String(x.key) === String(g.key));
      if (!hit) return;
      out[g.key] = (hit.clusters || []).map((c) => ({
        ids: (c.ids || []).map(Number).filter((id) => known.has(id)),
        verdict: ['ayni', 'benzer', 'farkli'].includes(c.verdict) ? c.verdict : 'farkli',
        reason: String(c.reason || '').slice(0, 300),
        keep: c.keep != null && known.has(Number(c.keep)) ? Number(c.keep) : null,
      })).filter((c) => c.ids.length > 0);
    });

    return res.status(200).json({ results: out });
  } catch (err) {
    const msg = err && err.name === 'TimeoutError' 
      ? 'Model zamanında cevap veremedi. Lütfen grup sayısını azaltıp tekrar deneyin.' 
      : (err.message || 'Yapay zekâ isteği başarısız.');
    return res.status(502).json({ error: msg });
  }
}
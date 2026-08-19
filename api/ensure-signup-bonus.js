import { createClient } from '@supabase/supabase-js';

// Service Role Key ile oluşturulan bu istemci RLS kurallarını atlayabilir,
// bu yüzden SADECE bu sunucu tarafı dosyada kullanılıyor, hiçbir zaman
// frontend'e (src/ klasörüne) gönderilmiyor.
const supabaseAdmin = createClient(
  'https://gzkqylheloxcgpcrftci.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Bu endpoint, bir öğrenci giriş yaptığında (ve özellikle kayıt olduktan
// hemen sonra) çağrılır. Öğrencinin "hediye bakiye"si YOKSA -- yani
// student_balances tablosunda hiç kaydı yoksa -- admin panelinde ayarlanmış
// güncel tutarı (signup_bonus_settings) bir kereliğine tanımlar ve
// döndürür. Kaydı zaten VARSA hiçbir şey değiştirmeden mevcut bakiyeyi
// döndürür -- yani bu endpoint her girişte çağrılsa bile bakiye asla
// tekrar tekrar verilmez (idempotent).
//
// ÖNEMLİ: Tutar hiçbir zaman client'tan alınmıyor -- her zaman
// veritabanındaki signup_bonus_settings'ten okunuyor. Bakiye tanımlama
// (insert) SADECE burada, Service Role ile yapılıyor; öğrenci kendi
// bakiyesini frontend'den asla artıramaz.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Oturum bulunamadı' });
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user?.email) {
    return res.status(401).json({ error: 'Geçersiz oturum' });
  }
  const studentEmail = userData.user.email;

  // 1) Zaten bir bakiye kaydı var mı?
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('student_balances')
    .select('balance')
    .eq('student_email', studentEmail)
    .maybeSingle();

  if (existingError) {
    console.error('Bakiye okunamadı:', existingError);
    return res.status(500).json({ error: 'Bakiye okunamadı' });
  }

  if (existing) {
    return res.status(200).json({ balance: Number(existing.balance) || 0, granted: false });
  }

  // 2) Kayıt yok -- admin panelindeki güncel hediye tutarını oku.
  const { data: settings, error: settingsError } = await supabaseAdmin
    .from('signup_bonus_settings')
    .select('amount')
    .eq('id', 1)
    .maybeSingle();

  if (settingsError) {
    console.error('Hediye bakiye ayarı okunamadı:', settingsError);
  }
  const bonusAmount = Number(settings?.amount) || 0;

  // 3) Tek seferlik olarak tanımla. student_email üzerinde UNIQUE/PRIMARY
  // KEY kısıtı olduğu varsayılıyor -- iki eşzamanlı istek aynı anda buraya
  // düşerse, ikincisi conflict hatası alır; o durumda satırı tekrar okuyup
  // (başka isteğin az önce oluşturduğu) gerçek bakiyeyi döndürüyoruz.
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('student_balances')
    .insert([{ student_email: studentEmail, balance: bonusAmount }])
    .select('balance')
    .single();

  if (insertError) {
    const { data: fallback } = await supabaseAdmin
      .from('student_balances')
      .select('balance')
      .eq('student_email', studentEmail)
      .maybeSingle();
    if (fallback) {
      return res.status(200).json({ balance: Number(fallback.balance) || 0, granted: false });
    }
    console.error('Hediye bakiye tanımlanamadı:', insertError);
    return res.status(500).json({ error: 'Bakiye tanımlanamadı' });
  }

  return res.status(200).json({ balance: Number(inserted.balance) || 0, granted: true });
}

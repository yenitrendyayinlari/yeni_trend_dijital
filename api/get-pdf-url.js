import { createClient } from '@supabase/supabase-js';

// Service Role Key ile oluşturulan bu istemci RLS kurallarını atlayabilir
// ve private storage bucket'larından imzalı URL üretebilir. SADECE bu
// sunucu tarafı dosyada kullanılıyor, hiçbir zaman frontend'e gönderilmiyor.
const supabaseAdmin = createClient(
  'https://gzkqylheloxcgpcrftci.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BUCKET = 'exam-files';

// SADECE bu sınav(lar) -- sosyal medyada paylaşılan ücretsiz deneme
// kampanyası için -- giriş yapmadan çözülebiliyor (bkz. App.jsx'teki
// aynı isimli FREE_TRIAL_EXAM_IDS sabiti). Başka HİÇBİR sınav bundan
// etkilenmiyor; onlar için giriş zorunluluğu aşağıda aynen devam ediyor.
const FREE_TRIAL_EXAM_IDS = ['81'];

// exams tablosundaki pdf_file / solution_pdf_file sütunları, eski
// kayıtlarda tam bir public URL olarak tutuluyor olabilir
// (https://.../storage/v1/object/public/exam-files/dosya.pdf).
// Yeni yüklemelerde artık sadece dosya adını (path) saklıyoruz.
// İkisini de destekleyelim ki eski sınavlar bozulmasın.
function extractStoragePath(value) {
  if (!value) return null;
  const marker = `/${BUCKET}/`;
  const idx = value.indexOf(marker);
  if (idx !== -1) return value.slice(idx + marker.length);
  return value;
}

// Kısa ömürlü imzalı URL süresi (saniye). Bir deneme sınavı oturumu
// boyunca geçerli kalsın diye biraz geniş tutuyoruz.
const SIGNED_URL_TTL = 4 * 60 * 60; // 4 saat
const PREVIEW_SIGNED_URL_TTL = 15 * 60; // 15 dakika (ücretsiz önizleme)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { examId, type } = req.body || {};
  if (!examId || !['exam', 'solution', 'exam-preview'].includes(type)) {
    return res.status(400).json({ error: 'Geçersiz istek' });
  }

  const { data: exam, error: examError } = await supabaseAdmin
    .from('exams')
    .select('id, parent_id, price, pdf_file, solution_pdf_file, is_published')
    .eq('id', examId)
    .single();

  if (examError || !exam) {
    return res.status(404).json({ error: 'Sınav bulunamadı' });
  }

  // Ücretsiz önizleme (pazarlama amaçlı, satın almadan gösterilen ilk
  // sayfa): giriş/satın alma gerektirmez, ama kısa ömürlü bir URL veririz.
  // Yayınlanmamış bir sınavın önizlemesi herkese açık gösterilmemeli.
  if (type === 'exam-preview') {
    if (!exam.is_published) {
      return res.status(404).json({ error: 'Sınav bulunamadı' });
    }
    const path = extractStoragePath(exam.pdf_file);
    if (!path) return res.status(404).json({ error: 'PDF bulunamadı' });

    const { data: signed, error: signError } = await supabaseAdmin
      .storage.from(BUCKET)
      .createSignedUrl(path, PREVIEW_SIGNED_URL_TTL);

    if (signError || !signed) {
      return res.status(500).json({ error: 'Dosya adresi oluşturulamadı' });
    }
    return res.status(200).json({ url: signed.signedUrl });
  }

  // ÜCRETSİZ DENEME SINAVI (ör. sosyal medyadan gelen ?exam=81 linki):
  // Sadece FREE_TRIAL_EXAM_IDS listesindeki, yayınlanmış ve fiyatı 0
  // olan sınavlar için 'exam' türü PDF'e giriş yapmadan erişim veriyoruz.
  // ÖNEMLİ: App.jsx'teki aynı kontrolle birebir aynı mantık -- oynanan
  // asıl test kendi id'sine sahip bir ALT test olabilir (parent_id, üst
  // paketi gösterir). Bu yüzden hem exam.id hem exam.parent_id kontrol
  // ediliyor. Bu blok yalnızca bu spesifik sınav(lar) için devreye girer
  // -- başka hiçbir sınav (ücretsiz olanlar dahil) bu daldan geçmez,
  // aşağıdaki normal giriş-zorunlu akışa düşmeye devam eder.
  const isFreeTrialExam = FREE_TRIAL_EXAM_IDS.includes(String(exam.id))
    || (exam.parent_id && FREE_TRIAL_EXAM_IDS.includes(String(exam.parent_id)));
  if (type === 'exam' && isFreeTrialExam) {
    if (!exam.is_published) {
      return res.status(404).json({ error: 'Sınav bulunamadı' });
    }
    const isFree = !exam.price || exam.price <= 0;
    if (isFree) {
      const path = extractStoragePath(exam.pdf_file);
      if (!path) return res.status(404).json({ error: 'PDF bulunamadı' });

      const { data: signed, error: signError } = await supabaseAdmin
        .storage.from(BUCKET)
        .createSignedUrl(path, SIGNED_URL_TTL);

      if (signError || !signed) {
        return res.status(500).json({ error: 'Dosya adresi oluşturulamadı' });
      }
      return res.status(200).json({ url: signed.signedUrl });
    }
    // Fiyatı sonradan 0'ın üzerine çıkarılırsa (ör. lansman bitip normal
    // fiyata dönerse), aşağıya düşüp normal giriş-zorunlu akışı izler --
    // yani bu istisna kendiliğinden devre dışı kalır, ekstra bir şey
    // yapmamıza gerek kalmaz.
  }

  // 'exam' ve 'solution' için giriş yapmış olmak şart.
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Bu içeriği görmek için giriş yapmalısınız.' });
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user?.email) {
    return res.status(401).json({ error: 'Geçersiz oturum, lütfen tekrar giriş yapın.' });
  }
  const studentEmail = userData.user.email;
  const isAdmin = studentEmail === 'admin@yayinevi.com';

  if (!isAdmin && !exam.is_published) {
    return res.status(404).json({ error: 'Sınav bulunamadı' });
  }

  if (!isAdmin) {
    if (type === 'exam') {
      // Ücretliyse satın alınmış olmalı.
      const isFree = !exam.price || exam.price <= 0;
      if (!isFree) {
        const checkIds = [exam.id];
        if (exam.parent_id) checkIds.push(exam.parent_id);
        const { data: purchase } = await supabaseAdmin
          .from('student_purchases')
          .select('exam_id')
          .eq('student_email', studentEmail)
          .in('exam_id', checkIds)
          .limit(1);

        if (!purchase || purchase.length === 0) {
          return res.status(403).json({ error: 'Bu sınava erişiminiz yok' });
        }
      }
    } else if (type === 'solution') {
      // Çözüm PDF'i, sınavı bitirmiş olan öğrenciye açılır (cevap
      // anahtarıyla aynı kural).
      const { data: resultRow } = await supabaseAdmin
        .from('student_exams')
        .select('is_finished')
        .eq('student_email', studentEmail)
        .eq('exam_id', examId)
        .maybeSingle();

      if (!resultRow || !resultRow.is_finished) {
        return res.status(403).json({ error: 'Bu sınavı henüz tamamlamadınız' });
      }
    }
  }

  const sourceValue = type === 'solution' ? exam.solution_pdf_file : exam.pdf_file;
  const path = extractStoragePath(sourceValue);
  if (!path) {
    return res.status(404).json({ error: 'PDF bulunamadı' });
  }

  const { data: signed, error: signError } = await supabaseAdmin
    .storage.from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);

  if (signError || !signed) {
    return res.status(500).json({ error: 'Dosya adresi oluşturulamadı' });
  }

  return res.status(200).json({ url: signed.signedUrl });
}

import { createClient } from '@supabase/supabase-js';

// Service Role Key ile oluşturulan bu istemci RLS kurallarını atlayabilir,
// bu yüzden SADECE bu sunucu tarafı dosyada kullanılıyor, hiçbir zaman
// frontend'e (src/ klasörüne) gönderilmiyor.
const supabaseAdmin = createClient(
  'https://gzkqylheloxcgpcrftci.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Bu endpoint, öğrenci sınavı bitirdiğinde çağrılır. Puanlama BURADA,
// sunucuda yapılır -- cevap anahtarı hiçbir zaman client'a önceden
// gönderilmez. Sadece bu istek sonucunda, sınav gerçekten bitirildikten
// SONRA, cevap anahtarı cevapla birlikte geri döner (inceleme ekranı için).
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { examId, answers, rating } = req.body || {};
  if (!examId) {
    return res.status(400).json({ error: 'examId gerekli' });
  }

  // 1) Kullanıcıyı doğrula (Authorization: Bearer <access_token>)
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

  // 2) Sınavı çek, ücretliyse satın alma kontrolü yap
  const { data: exam, error: examError } = await supabaseAdmin
    .from('exams')
    .select('id, parent_id, price, num_pages')
    .eq('id', examId)
    .single();

  if (examError || !exam) {
    return res.status(404).json({ error: 'Sınav bulunamadı' });
  }

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

  // 3) Cevap anahtarını (ayrı, korumalı tablodan) çek
  const { data: keyRow } = await supabaseAdmin
    .from('exam_answer_keys')
    .select('answer_key')
    .eq('exam_id', examId)
    .maybeSingle();

  const answerKey = keyRow?.answer_key || {};
  const studentAnswers = answers && typeof answers === 'object' ? answers : {};
  const numPages = exam.num_pages || Object.keys(answerKey).length;

  // 4) Puanlamayı burada, sunucuda hesapla
  let correct = 0, wrong = 0, empty = 0;
  for (let i = 1; i <= numPages; i++) {
    const studentAns = studentAnswers[i];
    const correctAns = answerKey[i];

    if (!studentAns) {
      empty++;
    } else if (correctAns && studentAns === correctAns) {
      correct++;
    } else if (correctAns && studentAns !== correctAns) {
      wrong++;
    } else {
      empty++;
    }
  }
  const net = Math.max(0, correct - wrong * 0.25);

  // 5) Sonucu kaydet
  const safeRating = Number.isFinite(Number(rating)) ? Number(rating) : 0;

  const { error: upsertError } = await supabaseAdmin
    .from('student_exams')
    .upsert([{
      student_email: studentEmail,
      exam_id: examId,
      answers: studentAnswers,
      correct_count: correct,
      wrong_count: wrong,
      empty_count: empty,
      net,
      is_finished: true,
      rating: safeRating
    }], { onConflict: 'student_email, exam_id' });

  if (upsertError) {
    console.error('Sonuç kaydedilemedi:', upsertError);
    return res.status(500).json({ error: 'Sonuç kaydedilemedi: ' + upsertError.message });
  }

  // Sınav artık gerçekten bitti -- cevap anahtarını incelemek için geri veriyoruz.
  return res.status(200).json({ correct, wrong, empty, net, answerKey });
}

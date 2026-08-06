import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  'https://gzkqylheloxcgpcrftci.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Bir öğrenci, DAHA ÖNCE bitirdiği bir sınavın sonucunu tekrar incelemek
// istediğinde (ör. "Sonucu İncele" butonu) bu endpoint çağrılır. Cevap
// anahtarı yalnızca öğrencinin o sınavı gerçekten bitirdiği student_exams
// tablosundan doğrulandıktan sonra döndürülür. Admin için bu kontrol atlanır.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { examId } = req.body || {};
  if (!examId) {
    return res.status(400).json({ error: 'examId gerekli' });
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
  const isAdmin = studentEmail === 'admin@yayinevi.com';

  if (!isAdmin) {
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

  const { data: keyRow, error: keyError } = await supabaseAdmin
    .from('exam_answer_keys')
    .select('answer_key')
    .eq('exam_id', examId)
    .maybeSingle();

  if (keyError) {
    console.error('Cevap anahtarı okunamadı:', keyError);
    return res.status(500).json({ error: 'Cevap anahtarı okunamadı' });
  }

  return res.status(200).json({ answerKey: keyRow?.answer_key || {} });
}

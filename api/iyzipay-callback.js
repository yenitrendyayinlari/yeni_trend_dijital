import Iyzipay from 'iyzipay';
import { createClient } from '@supabase/supabase-js';

const iyzipay = new Iyzipay({
  apiKey: process.env.IYZICO_API_KEY,
  secretKey: process.env.IYZICO_SECRET_KEY,
  uri: 'https://api.iyzipay.com'
});

// Service Role Key ile oluşturulan bu istemci RLS kurallarını atlayabilir,
// bu yüzden SADECE bu sunucu tarafı dosyada kullanılıyor, hiçbir zaman
// frontend'e (src/ klasörüne) gönderilmiyor.
const supabaseAdmin = createClient(
  'https://gzkqylheloxcgpcrftci.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// İyzico'nun checkout formu, sonucu bir iframe içinden bu adrese POST ediyor.
// HTTP redirect yerine küçük bir HTML sayfasıyla üst pencereyi (window.top)
// yönlendiriyoruz; aksi halde kullanıcı iframe'in içinde sıkışıp kalabiliyor.
const redirectPage = (siteUrl, status) => `<!DOCTYPE html>
<html lang="tr">
  <head><meta charset="utf-8" /><title>Ödeme Sonucu</title></head>
  <body style="font-family: sans-serif; text-align: center; padding-top: 80px; color: #334155;">
    <p>Yönlendiriliyorsunuz, lütfen bekleyin...</p>
    <script>
      window.top.location.href = "${siteUrl}/?payment=${status}";
    </script>
  </body>
</html>`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const siteUrl = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;
  const { token } = req.body || {};

  if (!token) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(redirectPage(siteUrl, 'error'));
  }

  const retrieveRequest = {
    locale: Iyzipay.LOCALE.TR,
    token
  };

  iyzipay.checkoutForm.retrieve(retrieveRequest, async (err, result) => {
    res.setHeader('Content-Type', 'text/html');

    if (err) {
      console.error('Iyzico sonuç sorgulama hatası:', err);
      return res.status(200).send(redirectPage(siteUrl, 'error'));
    }

    if (result.status === 'success' && result.paymentStatus === 'SUCCESS') {
      // conversationId -> alıcının e-postası, basketId -> satın alınan içerik ID'leri
      const studentEmail = result.conversationId;
      const examIds = (result.basketId || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      if (studentEmail && examIds.length > 0) {
        const rows = examIds.map((examId) => ({
          exam_id: examId,
          student_email: studentEmail
        }));

        // Aynı içerik daha önce kaydedilmişse tekrar eklememek için önce
        // mevcut kayıtları çekip, sadece eksik olanları ekliyoruz.
        const { data: existing } = await supabaseAdmin
          .from('student_purchases')
          .select('exam_id')
          .eq('student_email', studentEmail)
          .in('exam_id', examIds);

        const alreadyOwned = new Set((existing || []).map((r) => r.exam_id));
        const newRows = rows.filter((r) => !alreadyOwned.has(r.exam_id));

        if (newRows.length > 0) {
          const { error: insertError } = await supabaseAdmin
            .from('student_purchases')
            .insert(newRows);

          if (insertError) {
            console.error('Satın alma kaydedilemedi:', insertError);
            return res.status(200).send(redirectPage(siteUrl, 'db_error'));
          }
        }

        return res.status(200).send(redirectPage(siteUrl, 'success'));
      }

      console.error('Callback: e-posta veya içerik ID listesi eksik.', result);
      return res.status(200).send(redirectPage(siteUrl, 'error'));
    }

    // Ödeme başarısız / iptal
    return res.status(200).send(redirectPage(siteUrl, 'failed'));
  });
}

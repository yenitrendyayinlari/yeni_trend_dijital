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

// Bir ödeme başarıyla tamamlandığında içerikleri tanımlar (varsa) ve
// (varsa) uygulanmış hediye bakiyeyi ATOMİK olarak düşer. exam_id'ler
// zaten sahiplenilmişse tekrar eklemez (idempotent).
const grantPurchases = async (studentEmail, examIds) => {
  const { data: existing } = await supabaseAdmin
    .from('student_purchases')
    .select('exam_id')
    .eq('student_email', studentEmail)
    .in('exam_id', examIds);

  const alreadyOwned = new Set((existing || []).map((r) => r.exam_id));
  const newRows = examIds
    .filter((id) => !alreadyOwned.has(id))
    .map((id) => ({ exam_id: id, student_email: studentEmail }));

  if (newRows.length > 0) {
    const { error: insertError } = await supabaseAdmin.from('student_purchases').insert(newRows);
    if (insertError) {
      console.error('Satın alma kaydedilemedi:', insertError);
      return false;
    }
  }
  return true;
};

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
      // --- YENİ AKIŞ: iyzico'nun checkoutForm.retrieve uç noktası,
      // conversationId'yi SADECE bu sorgu isteğine siz gönderirseniz geri
      // döndürüyor -- CF-Initialize sırasında gönderdiğimiz conversationId'yi
      // otomatik hatırlayıp yanıta eklemiyor (ve burada, retrieve isteğini
      // atarken conversationId'yi zaten bilmiyoruz -- bulmaya çalıştığımız
      // şey bu). Bu yüzden eşleştirmeyi, iyzico'checkoutFormInitialize.js'in
      // token dönüşünde pending_checkouts kaydına yazdığımız 'iyzico_token'
      // üzerinden yapıyoruz -- bu değer güvenilir şekilde her zaman elimizde
      // (callback'e POST edilen 'token' ile birebir aynı).
      const { data: pending, error: pendingError } = await supabaseAdmin
        .from('pending_checkouts')
        .select('*')
        .eq('iyzico_token', token)
        .maybeSingle();

      if (pendingError) {
        console.error('Ödeme kaydı okunamadı:', pendingError);
      }

      if (pending) {
        if (pending.status === 'completed') {
          // İyzico aynı sonucu bir sebeple iki kez POST etmiş olabilir
          // (ör. ağ tekrar denemesi) -- tekrar bakiye düşüp içerik
          // eklemeden doğrudan başarı sayfasına dön.
          return res.status(200).send(redirectPage(siteUrl, 'success'));
        }

        const studentEmail = pending.student_email;
        const examIds = (pending.exam_ids || '').split(',').map((s) => s.trim()).filter(Boolean);
        const balanceApplied = Number(pending.balance_applied) || 0;

        const granted = await grantPurchases(studentEmail, examIds);
        if (!granted) {
          return res.status(200).send(redirectPage(siteUrl, 'db_error'));
        }

        if (balanceApplied > 0) {
          const { error: deductError } = await supabaseAdmin.rpc('deduct_balance', {
            p_email: studentEmail,
            p_amount: balanceApplied
          });
          if (deductError) {
            // Ödeme zaten iyzico'dan (indirimli tutar üzerinden) tahsil
            // edildi -- bakiye düşümü başarısız olsa bile içeriği geri
            // almıyoruz, sadece kayıt tutuyoruz. Bu durumda muhasebe
            // tutarsızlığı için manuel kontrol gerekebilir.
            console.error(
              `Bakiye düşülemedi (ödeme zaten tahsil edildi -- öğrenci: ${studentEmail}, tutar: ${balanceApplied}):`,
              deductError
            );
          }
        }

        await supabaseAdmin
          .from('pending_checkouts')
          .update({ status: 'completed' })
          .eq('id', pending.id);

        return res.status(200).send(redirectPage(siteUrl, 'success'));
      }

      // --- ESKİ AKIŞ (geriye dönük uyumluluk): pending_checkouts'ta kayıt
      // bulunamadıysa, bu ödeme bu özellik devreye girmeden ÖNCE başlatılmış
      // olabilir. O zaman conversationId doğrudan e-postaydı, basketId ise
      // içerik id listesiydi -- eski mantıkla devam ediyoruz.
      const conversationId = result.conversationId;
      const studentEmail = conversationId;
      const examIds = (result.basketId || '').split(',').map((s) => s.trim()).filter(Boolean);

      if (studentEmail && examIds.length > 0) {
        const granted = await grantPurchases(studentEmail, examIds);
        if (!granted) {
          return res.status(200).send(redirectPage(siteUrl, 'db_error'));
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

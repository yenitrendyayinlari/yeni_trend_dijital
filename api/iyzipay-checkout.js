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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1) Kullanıcıyı doğrula -- e-posta artık client'tan (req.body.email) DEĞİL,
  // gerçek oturum token'ından okunuyor. Böylece biri başkasının e-postasını
  // yazıp o kişi adına satın alma kaydı oluşturamaz.
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Ödeme yapabilmek için giriş yapmalısınız.' });
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user?.email) {
    return res.status(401).json({ error: 'Geçersiz oturum, lütfen tekrar giriş yapın.' });
  }
  const email = userData.user.email;

  // items: [{ id }, ...] -> sepetteki her içerik için gönderilir.
  // Geriye dönük uyumluluk için tek examId ile çalışan eski çağrılar da desteklenir.
  // ÖNEMLİ: client'ın gönderdiği price/name alanları TAMAMEN YOK SAYILIYOR.
  const { examId, examIds, items } = req.body || {};

  const requestedIds = Array.isArray(items) && items.length > 0
    ? items.map((it) => it.id)
    : (Array.isArray(examIds) && examIds.length > 0 ? examIds : (examId ? [examId] : []));

  if (requestedIds.length === 0) {
    return res.status(400).json({ error: 'Satın alınacak içerik belirtilmedi.' });
  }

  // 2) Gerçek fiyatları ve isimleri VERİTABANINDAN çekiyoruz -- client'ın
  // gönderdiği hiçbir fiyat değerine güvenmiyoruz.
  const { data: examRows, error: examsError } = await supabaseAdmin
    .from('exams')
    .select('id, name, price, is_published')
    .in('id', requestedIds);

  if (examsError) {
    return res.status(500).json({ error: 'Sınav bilgileri okunamadı: ' + examsError.message });
  }

  if (!examRows || examRows.length !== requestedIds.length) {
    return res.status(400).json({ error: 'Bazı içerikler bulunamadı.' });
  }

  const unpublished = examRows.filter((e) => !e.is_published);
  if (unpublished.length > 0) {
    return res.status(400).json({ error: 'Yayınlanmamış bir içerik satın alınamaz.' });
  }

  const zeroPriced = examRows.filter((e) => !e.price || Number(e.price) <= 0);
  if (zeroPriced.length > 0) {
    return res.status(400).json({ error: 'Ücretsiz bir içerik için ödeme başlatılamaz.' });
  }

  const totalPrice = examRows.reduce((sum, e) => sum + Number(e.price), 0);
  const idList = examRows.map((e) => e.id).join(',');

  // --- HEDİYE BAKİYE ---
  // Öğrencinin GÜNCEL bakiyesini veritabanından okuyoruz (client'tan asla
  // güven duyulmaz). Mevcutsa, toplam tutarı düşürmek için OTOMATİK olarak
  // (bakiye kadar, en fazla toplam tutar kadar) uygulanır -- öğrencinin ayrıca
  // bir şey seçmesi gerekmez.
  const { data: balanceRow, error: balanceError } = await supabaseAdmin
    .from('student_balances')
    .select('balance')
    .eq('student_email', email)
    .maybeSingle();

  if (balanceError) {
    console.error('Bakiye okunamadı, bakiyesiz devam ediliyor:', balanceError);
  }
  const currentBalance = Number(balanceRow?.balance) || 0;
  const balanceApplied = Math.min(currentBalance, totalPrice);
  const payableAmount = Number((totalPrice - balanceApplied).toFixed(2));

  // --- DURUM A: Bakiye toplam tutarı TAMAMEN karşılıyor ---
  // iyzico'ya hiç gitmeye gerek yok; bakiyeyi ATOMİK olarak düş (deduct_balance
  // fonksiyonu -- yetersiz bakiye/yarış durumuna karşı DB seviyesinde
  // korumalı) ve içerikleri doğrudan tanımla.
  if (payableAmount <= 0) {
    const { data: newBalance, error: deductError } = await supabaseAdmin.rpc('deduct_balance', {
      p_email: email,
      p_amount: totalPrice
    });

    if (deductError) {
      console.error('Bakiye düşülemedi:', deductError);
      return res.status(400).json({
        error: 'Bakiyeniz güncellendiği için işlem tamamlanamadı. Lütfen tekrar deneyin.'
      });
    }

    const { data: existing } = await supabaseAdmin
      .from('student_purchases')
      .select('exam_id')
      .eq('student_email', email)
      .in('exam_id', requestedIds);
    const alreadyOwned = new Set((existing || []).map((r) => r.exam_id));
    const newRows = requestedIds
      .filter((id) => !alreadyOwned.has(id))
      .map((id) => ({ exam_id: id, student_email: email }));

    if (newRows.length > 0) {
      const { error: insertError } = await supabaseAdmin.from('student_purchases').insert(newRows);
      if (insertError) {
        console.error('Satın alma kaydedilemedi (bakiyeli ödeme):', insertError);
        return res.status(500).json({ error: 'İçerik tanımlanamadı, lütfen destek ile iletişime geçin.' });
      }
    }

    return res.status(200).json({
      status: 'success',
      freeCheckout: true,
      balanceApplied: totalPrice,
      newBalance: Number(newBalance) || 0,
      purchasedExamIds: requestedIds
    });
  }

  // --- DURUM B: Bakiye toplamı KISMEN karşılıyor (ya da hiç bakiye yok) ---
  // Kalan tutar (payableAmount) için iyzico'ya gidiyoruz. Bakiyeyi HENÜZ
  // düşmüyoruz -- ödeme başarısız/iptal olursa bakiyeyi boşa harcamamak için
  // gerçek düşüm, ödeme onaylandığında callback'te yapılır. Bu yüzden
  // "ne kadar bakiye kullanılacağı" bilgisini, callback'in güvenle
  // okuyabilmesi için bir pending_checkouts kaydına yazıp, o kaydın id'sini
  // conversationId olarak iyzico'ya gönderiyoruz.
  const { data: pending, error: pendingError } = await supabaseAdmin
    .from('pending_checkouts')
    .insert([{
      student_email: email,
      exam_ids: idList,
      total_price: totalPrice,
      balance_applied: balanceApplied,
      status: 'pending'
    }])
    .select('id')
    .single();

  if (pendingError) {
    console.error('Ödeme kaydı oluşturulamadı:', pendingError);
    return res.status(500).json({ error: 'Ödeme başlatılamadı: ' + pendingError.message });
  }

  // ÖNEMLİ: iyzico, sepet kalemlerinin (basketItems) toplamının, tahsil
  // edilen tutarla (price) BİREBİR eşleşmesini bekliyor VE her kalemin
  // fiyatının sıfırdan BÜYÜK olmasını şart koşuyor (negatif/sıfır "indirim
  // kalemi" reddediliyor: "basketItemPrice sıfırdan küçük veya sıfıra eşit
  // olamaz"). Bu yüzden indirimi ayrı bir satır olarak eklemek yerine, her
  // ürünün fiyatını uyguladığımız bakiye oranında KÜÇÜLTÜP sepete öyle
  // yazıyoruz. Yuvarlama farkını son kalemde telafi ederek toplamın tam
  // olarak payableAmount'a eşit olmasını garanti ediyoruz.
  const scaleRatio = payableAmount / totalPrice;
  let runningSum = 0;
  const basketItems = examRows.map((e, idx) => {
    const isLast = idx === examRows.length - 1;
    let itemPrice;
    if (isLast) {
      itemPrice = Number((payableAmount - runningSum).toFixed(2));
      // Aşırı uçlarda (çok sayıda kalem + neredeyse tam bakiye kapsaması
      // gibi) yuvarlama son kalemi 0 ya da altına düşürebilir; iyzico
      // pozitif bekliyor, bu yüzden güvenli bir alt sınır koyuyoruz.
      if (itemPrice <= 0) itemPrice = 0.01;
    } else {
      itemPrice = Math.max(0.01, Number((Number(e.price) * scaleRatio).toFixed(2)));
      runningSum += itemPrice;
    }
    return {
      id: e.id.toString(),
      name: e.name || 'Dijital Sınav / Test',
      category1: 'Eğitim',
      itemType: Iyzipay.BASKET_ITEM_TYPE.VIRTUAL,
      price: itemPrice.toString()
    };
  });

  // Origin header bazı durumlarda (ör. tarayıcı/istemci farklılıkları) boş
  // gelebilir; bu yüzden host + proto üzerinden güvenli bir fallback
  // kullanıyoruz. Bu sayede callbackUrl hangi domainden istek gelirse
  // gelsin (sualink.com, www.sualink.com, önizleme domain'leri vb.)
  // doğru şekilde oluşuyor -- domain değiştiğinde kodda değişiklik gerekmez.
  const origin = req.headers.origin
    || `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;

  const request = {
    locale: Iyzipay.LOCALE.TR,
    // ÖNEMLİ: conversationId artık ham e-posta DEĞİL, yukarıda oluşturduğumuz
    // pending_checkouts kaydının id'si. Callback bu id üzerinden hem
    // e-postayı hem de (varsa) düşülecek bakiye tutarını güvenle bulur --
    // öğrenci bu değeri asla değiştiremez çünkü tamamen sunucuda üretiliyor.
    conversationId: pending.id,
    // Kullanıcıdan sadece KALAN tutar (bakiye düşüldükten sonra) tahsil edilir.
    price: payableAmount.toFixed(2),
    paidPrice: payableAmount.toFixed(2),
    currency: Iyzipay.CURRENCY.TRY,
    basketId: idList,
    paymentGroup: Iyzipay.PAYMENT_GROUP.PRODUCT,
    callbackUrl: `${origin}/api/iyzipay-callback`,
    // Kullanıcı iyzico'nun barındırdığı ödeme sayfasında "vazgeç" derse
    // buraya döner -- artık gömülü widget değil, tam sayfa yönlendirme
    // (paymentPageUrl) kullandığımız için bu geri dönüş yolu önemli.
    cancelUrl: `${origin}/?payment=cancelled`,
    buyer: {
      id: 'BY789',
      name: 'Öğrenci',
      surname: 'Kullanıcı',
      gsmNumber: '+905350000000',
      email,
      identityNumber: '74300864791',
      lastLoginDate: '2026-06-01 12:43:35',
      registrationDate: '2026-06-01 15:12:09',
      registrationAddress: 'Türkiye',
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      city: 'Ankara',
      country: 'Turkey',
      zipCode: '06000'
    },
    shippingAddress: {
      contactName: 'Öğrenci Kullanıcı',
      city: 'Ankara',
      country: 'Turkey',
      address: 'Türkiye',
      zipCode: '06000'
    },
    billingAddress: {
      contactName: 'Öğrenci Kullanıcı',
      city: 'Ankara',
      country: 'Turkey',
      address: 'Türkiye',
      zipCode: '06000'
    },
    basketItems
  };

  // Not: basketItems fiyatları yukarıda payableAmount'a göre orantılı olarak
  // küçültüldü, dolayısıyla toplamları price alanıyla (payableAmount)
  // birebir eşleşiyor -- iyzico'nun beklediği kural bu. Sistemdeki gerçek
  // ürün fiyatı (totalPrice) ve o siparişte kullanılan bakiye (balanceApplied)
  // ayrıca pending_checkouts kaydında saklandığı için muhasebe/rapor
  // amacıyla hâlâ eksiksiz olarak erişilebilir durumda.
  iyzipay.checkoutFormInitialize.create(request, (err, result) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.status(200).json({ ...result, balanceApplied, payableAmount });
  });
}

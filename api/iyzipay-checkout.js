import Iyzipay from 'iyzipay';
import { createClient } from '@supabase/supabase-js';

const iyzipay = new Iyzipay({
  apiKey: process.env.IYZICO_API_KEY,
  secretKey: process.env.IYZICO_SECRET_KEY,
  uri: 'https://sandbox-api.iyzipay.com' // Canlı ortama geçtiğinizde 'https://api.iyzipay.com' yapabilirsiniz
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

  const basketItems = examRows.map((e) => ({
    id: e.id.toString(),
    name: e.name || 'Dijital Sınav / Test',
    category1: 'Eğitim',
    itemType: Iyzipay.BASKET_ITEM_TYPE.VIRTUAL,
    price: Number(e.price).toString()
  }));

  const totalPrice = examRows
    .reduce((sum, e) => sum + Number(e.price), 0)
    .toFixed(2);

  // basketId'ye, ödeme başarılı olduğunda callback tarafında hangi içeriklerin
  // satın alındığını çözebilmek için tüm exam id'lerini virgülle ayırarak koyuyoruz.
  const idList = examRows.map((e) => e.id).join(',');

  // Origin header bazı durumlarda (ör. tarayıcı/istemci farklılıkları) boş
  // gelebilir; bu yüzden host + proto üzerinden güvenli bir fallback
  // kullanıyoruz. Bu sayede callbackUrl hangi domainden istek gelirse
  // gelsin (sualink.com, www.sualink.com, önizleme domain'leri vb.)
  // doğru şekilde oluşuyor -- domain değiştiğinde kodda değişiklik gerekmez.
  const origin = req.headers.origin
    || `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;

  const request = {
    locale: Iyzipay.LOCALE.TR,
    // conversationId'ye doğrulanmış kullanıcının e-postasını koyuyoruz;
    // callback bu sayede ödemeyi kimin yaptığını güvenilir şekilde çözebiliyor.
    conversationId: email,
    price: totalPrice.toString(),
    paidPrice: totalPrice.toString(),
    currency: Iyzipay.CURRENCY.TRY,
    basketId: idList,
    paymentGroup: Iyzipay.PAYMENT_GROUP.PRODUCT,
    callbackUrl: `${origin}/api/iyzipay-callback`,
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

  iyzipay.checkoutFormInitialize.create(request, (err, result) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.status(200).json(result);
  });
}

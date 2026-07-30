import Iyzipay from 'iyzipay';

const iyzipay = new Iyzipay({
  apiKey: process.env.IYZICO_API_KEY,
  secretKey: process.env.IYZICO_SECRET_KEY,
  uri: 'https://sandbox-api.iyzipay.com' // Canlı ortama geçtiğinizde 'https://api.iyzipay.com' yapabilirsiniz
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { price, email, examId } = req.body;

  const request = {
    locale: Iyzipay.LOCALE.TR,
    conversationId: examId ? examId.toString() : '123456789',
    price: price.toString(),
    paidPrice: price.toString(),
    currency: Iyzipay.CURRENCY.TRY,
    basketId: examId ? examId.toString() : 'B67832',
    paymentGroup: Iyzipay.PAYMENT_GROUP.PRODUCT,
    callbackUrl: `${req.headers.origin}/api/iyzipay-callback`,
    buyer: {
      id: 'BY789',
      name: 'Öğrenci',
      surname: 'Kullanıcı',
      gsmNumber: '+905350000000',
      email: email || 'ogrenci@yenitrend.com',
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
    basketItems: [
      {
        id: examId ? examId.toString() : 'BI101',
        name: 'Dijital Sınav / Test',
        category1: 'Eğitim',
        itemType: Iyzipay.BASKET_ITEM_TYPE.VIRTUAL,
        price: price.toString()
      }
    ]
  };

  iyzipay.checkoutFormInitialize.create(request, (err, result) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.status(200).json(result);
  });
}
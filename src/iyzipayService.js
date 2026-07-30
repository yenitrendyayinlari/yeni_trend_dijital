import Iyzipay from 'iyzipay';

// Not: Canlı ortamda bu bilgilerin backend'de olması gerekir, 
// ancak test/geliştirme aşamasında hızlıca denemek için buraya ekleyebiliriz.
const iyzipay = new Iyzipay({
  apiKey: 'SANDBOX-API-KEYIN',
  secretKey: 'SANDBOX-SECRET-KEYIN',
  uri: 'https://sandbox-api.iyzipay.com'
});

export const initializePayment = (paymentData, callback) => {
  const request = {
    locale: Iyzipay.LOCALE.TR,
    conversationId: '123456789',
    price: paymentData.price,
    paidPrice: paymentData.price,
    currency: Iyzipay.CURRENCY.TL,
    basketId: 'B67832',
    paymentGroup: Iyzipay.PAYMENT_GROUP.PRODUCT,
    callbackUrl: 'https://www.merchant.com/callback',
    buyer: {
      id: 'BY789',
      name: 'John',
      surname: 'Doe',
      gsmNumber: '+905350000000',
      email: 'email@email.com',
      identityNumber: '74300864791',
      lastLoginDate: '2015-10-05 12:43:35',
      registrationDate: '2013-04-21 15:12:09',
      registrationAddress: 'Nidakule Göztepe Mah. Merdivenköy Sok. No:57',
      ip: '85.34.78.112',
      city: 'Istanbul',
      country: 'Turkey',
      zipCode: '34732'
    },
    shippingAddress: {
      contactName: 'Jane Doe',
      city: 'Istanbul',
      country: 'Turkey',
      address: 'Nidakule Göztepe Mah. Merdivenköy Sok. No:57',
      zipCode: '34732'
    },
    billingAddress: {
      contactName: 'Jane Doe',
      city: 'Istanbul',
      country: 'Turkey',
      address: 'Nidakule Göztepe Mah. Merdivenköy Sok. No:57',
      zipCode: '34732'
    },
    basketItems: [
      {
        id: 'BI101',
        name: 'Dijital Sınav Paketi',
        category1: 'Eğitim',
        itemType: Iyzipay.BASKET_ITEM_TYPE.VIRTUAL,
        price: paymentData.price
      }
    ]
  };

  iyzipay.checkoutFormInitialize.create(request, function (err, result) {
    callback(err, result);
  });
};
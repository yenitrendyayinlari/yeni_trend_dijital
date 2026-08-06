export const initializePayment = async (paymentData, token, callback) => {
  try {
    const response = await fetch('/api/iyzipay-checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(paymentData),
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Ödeme başlatılamadı');
    }
    callback(null, result);
  } catch (error) {
    callback(error, null);
  }
};

import React, { useState } from 'react';
import { initializePayment } from './iyzipayService';

const PaymentButton = ({ price, examId }) => {
  const [loading, setLoading] = useState(false);

  const handlePayment = () => {
    setLoading(true);

    // Dışarıdan gelen gerçek fiyatı ve sınav ID'sini backend'e gönderiyoruz
    const paymentData = {
      price: price.toString(),
      examId: examId
    };

    initializePayment(paymentData, (err, result) => {
      setLoading(false);
      
      if (err) {
        console.error("Ödeme hatası:", err);
        alert("Ödeme başlatılırken bir hata oluştu.");
        return;
      }

      if (result.status === 'success') {
        const checkoutDiv = document.getElementById('iyzipay-checkout-form');
        if (checkoutDiv) {
          checkoutDiv.innerHTML = result.checkoutFormContent;
        }

        if (window.iyzipayCheckout && typeof window.iyzipayCheckout.show === 'function') {
          window.iyzipayCheckout.show();
        }
      } else {
        alert("İşlem başarısız: " + result.errorMessage);
      }
    });
  };

  return (
    <div style={{ textAlign: 'center' }}>
      <button 
        onClick={handlePayment} 
        disabled={loading}
        style={{
          padding: '10px 20px',
          backgroundColor: '#d97706',
          color: '#fff',
          border: 'none',
          borderRadius: '4px',
          fontSize: '15px',
          cursor: 'pointer'
        }}
      >
        {loading ? "Yükleniyor..." : `Satın Al (₺${price})`}
      </button>
    </div>
  );
};

export default PaymentButton;
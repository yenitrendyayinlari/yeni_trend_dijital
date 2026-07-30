import React, { useState } from 'react';
import { initializePayment } from './iyzipayService';

const PaymentButton = () => {
  const [loading, setLoading] = useState(false);

  const handlePayment = () => {
    setLoading(true);

    // Ödeme verileri (örneğin 100 TL)
    const paymentData = {
      price: "100.00"
    };

    initializePayment(paymentData, (err, result) => {
      setLoading(false);
      
      if (err) {
        console.error("Ödeme hatası:", err);
        alert("Ödeme başlatılırken bir hata oluştu.");
        return;
      }

      if (result.status === 'success') {
        // iyzico'nun döndürdüğü HTML/JS içeriğini index.html'deki div alanına yerleştiriyoruz
        const checkoutDiv = document.getElementById('iyzipay-checkout-form');
        if (checkoutDiv) {
          checkoutDiv.innerHTML = result.checkoutFormContent;
        }

        // iyzico formunun görünmesini sağlayan script tetiklemesi
        if (window.iyzipayCheckout && typeof window.iyzipayCheckout.show === 'function') {
          window.iyzipayCheckout.show();
        }
      } else {
        alert("İşlem başarısız: " + result.errorMessage);
      }
    });
  };

  return (
    <div style={{ textAlign: 'center', padding: '20px' }}>
      <button 
        onClick={handlePayment} 
        disabled={loading}
        style={{
          padding: '12px 24px',
          backgroundColor: '#00cc99',
          color: '#fff',
          border: 'none',
          borderRadius: '4px',
          fontSize: '16px',
          cursor: 'pointer'
        }}
      >
        {loading ? "Yükleniyor..." : "100 TL Öde"}
      </button>
    </div>
  );
};

export default PaymentButton;
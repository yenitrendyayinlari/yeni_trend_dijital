import { useEffect, useState } from 'react';

// Öğrencinin hediye bakiyesi olduğunu, oturum başına BİR KEZ, göze çarpan
// bir pencereyle hatırlatır. sessionStorage'a "gösterildi" yazıyoruz ki
// aynı oturumda sayfa değiştirdikçe/yenilendikçe tekrar tekrar açılmasın;
// yeni bir oturumda (örn. tarayıcıyı kapatıp tekrar girince) yeniden
// gösterilir. Bu App.jsx'teki hiçbir state'e dokunmaz, sadece `balance` ve
// `studentEmail` prop olarak alır.
export default function BalanceGiftModal({ balance, studentEmail }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!balance || balance <= 0 || !studentEmail) return;
    const key = `yt_balance_notice_${studentEmail}`;
    try {
      if (sessionStorage.getItem(key) === 'shown') return;
      sessionStorage.setItem(key, 'shown');
    } catch (e) {
      // sessionStorage kapalıysa (gizli sekme vb.) sessizce devam et.
    }
    setShow(true);
  }, [balance, studentEmail]);

  if (!show) return null;

  return (
    <div
      onClick={() => setShow(false)}
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1400, padding: '16px' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ backgroundColor: '#fff', borderRadius: '16px', padding: '32px 28px', width: '380px', maxWidth: '100%', textAlign: 'center', boxShadow: '0 20px 50px rgba(15,23,42,0.25)' }}
      >
        <div style={{ fontSize: '2.6rem', marginBottom: '10px' }}>🎁</div>
        <h2 style={{ margin: '0 0 8px 0', fontSize: '1.2rem', color: '#0f172a' }}>Hediye bakiyeniz var!</h2>
        <p style={{ margin: '0 0 22px 0', fontSize: '0.95rem', color: '#475569', lineHeight: 1.5 }}>
          Hesabınızda <strong>₺{balance}</strong> hediye bakiye tanımlandı.
        </p>
        <button
          onClick={() => setShow(false)}
          style={{ padding: '10px 24px', borderRadius: '8px', border: 'none', backgroundColor: '#0f172a', color: '#fff', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.9rem' }}
        >
          Harika, anladım
        </button>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// Yeni üyelere otomatik tanımlanan "hediye bakiye" miktarını yöneten
// panel. Ayar, `signup_bonus_settings` tablosunun TEK satırında (id=1)
// tutulur -- tıpkı TopBanner.jsx'teki `site_banner` deseni gibi.
//
// Gerçek bakiye GRANT işlemi (bir öğrenciye bu miktarın verilmesi)
// BURADA yapılmıyor -- güvenlik için sunucu tarafında, `/api/ensure-signup-bonus`
// endpoint'inde, Service Role ile yapılıyor (bkz. o dosyadaki not). Bu
// component sadece "yeni üyeye kaç TL verilsin" ayarını okuyup yazıyor.
//
// Bu dosya sadece ADMIN panelindeki YÖNETİM BUTONUNU export eder --
// TopBannerManageButton ile aynı model: buton + düzenleme penceresi.

const useSignupBonusSettings = () => {
  const [amount, setAmount] = useState(null); // number | null (henüz yüklenmedi)
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let isMounted = true;
    supabase
      .from('signup_bonus_settings')
      .select('amount')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error) console.error('Hediye bakiye ayarı okunamadı:', error);
        setAmount(data?.amount ?? 0);
        setLoaded(true);
      });
    return () => { isMounted = false; };
  }, []);

  const save = async (newAmount) => {
    const { data, error } = await supabase
      .from('signup_bonus_settings')
      .upsert({ id: 1, amount: newAmount })
      .select()
      .maybeSingle();
    if (error) {
      alert(
        'Kaydedilemedi: ' + error.message +
        '\n\n"signup_bonus_settings" tablosu veritabanında henüz yoksa, önce onu oluşturmak gerekir (id int8 PK, amount numeric).'
      );
      return false;
    }
    setAmount(data?.amount ?? newAmount);
    return true;
  };

  return { amount, loaded, save };
};

function SignupBonusEditorModal({ amount, onClose, onSave }) {
  const [draftAmount, setDraftAmount] = useState(amount ?? 0);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const parsed = Number(draftAmount);
    if (Number.isNaN(parsed) || parsed < 0) {
      alert('Geçerli bir tutar girin (0 veya üzeri).');
      return;
    }
    setSaving(true);
    const ok = await onSave(parsed);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1300, padding: '16px' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ backgroundColor: '#fff', borderRadius: '12px', padding: '22px', width: '400px', maxWidth: '100%' }}
      >
        <h3 style={{ margin: '0 0 6px 0', fontSize: '1.05rem', color: '#0f172a' }}>🎁 Hediye Bakiye</h3>
        <p style={{ margin: '0 0 14px 0', fontSize: '0.82rem', color: '#64748b' }}>
          Yeni kayıt olan her üyeye, ilk girişinde otomatik olarak bu tutarda bakiye tanımlanır. Mevcut üyeleri etkilemez, sadece bundan sonra kayıt olacaklara uygulanır.
        </p>

        <label style={{ fontSize: '0.8rem', color: '#475569', display: 'block', marginBottom: '4px' }}>Yeni üyeye tanımlanacak tutar (₺)</label>
        <input
          type="number"
          min="0"
          step="1"
          value={draftAmount}
          onChange={(e) => setDraftAmount(e.target.value)}
          style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', boxSizing: 'border-box', fontSize: '0.9rem', marginBottom: '16px' }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button type="button" onClick={onClose} style={{ padding: '8px 14px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#fff', cursor: 'pointer' }}>
            Vazgeç
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', backgroundColor: '#0f172a', color: '#fff', cursor: 'pointer', fontWeight: 'bold', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SignupBonusManageButton() {
  const { amount, loaded, save } = useSignupBonusSettings();
  const [showEditor, setShowEditor] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setShowEditor(true)}
        style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', cursor: 'pointer', color: '#0f172a', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}
      >
        🎁 Hediye Bakiye
        <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 'normal' }}>
          {loaded ? `(₺${amount})` : ''}
        </span>
      </button>

      {showEditor && (
        <SignupBonusEditorModal
          amount={amount}
          onClose={() => setShowEditor(false)}
          onSave={save}
        />
      )}
    </>
  );
}

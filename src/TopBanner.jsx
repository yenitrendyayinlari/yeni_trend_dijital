import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// Sitenin en üstünde gösterilen kampanya/duyuru şeridi (Praxis/ETS
// örneklerindeki gibi). Ayarlar `site_banner` tablosunun TEK satırında
// (id=1) tutulur.
//
// Bu dosya iki farklı şey export eder:
//   - TopBanner (default): Sadece ziyaretçiye gösterilen CANLI şerit.
//     Admin panelinde KULLANILMAZ -- oraya konursa panelin kendi bir
//     parçasıymış gibi görünüp kafa karıştırır.
//   - TopBannerManageButton (named): Admin panelindeki "📢 Duyuru Gönder"
//     gibi diğer butonların yanına konan, sadece bir DÜĞME + düzenleme
//     penceresi. Tıklanınca aynı ayarları (mesaj, açık/kapalı, geri sayım
//     bitiş zamanı) düzenleyip kaydedebiliyorsunuz -- ama admin panelinde
//     şeridin kendisi görünmez.
//
// İkisi de kendi verisini kendi çeker/yazar; App.jsx'teki hiçbir state'e
// dokunmaz.

const useBannerSettings = () => {
  const [banner, setBanner] = useState(null); // { id, enabled, message, ends_at }
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let isMounted = true;
    supabase
      .from('site_banner')
      .select('*')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error) console.error('Banner ayarları okunamadı:', error);
        setBanner(data || null);
        setLoaded(true);
      });
    return () => { isMounted = false; };
  }, []);

  const save = async (payload) => {
    const { data, error } = await supabase.from('site_banner').upsert({ id: 1, ...payload }).select().maybeSingle();
    if (error) {
      alert(
        'Kaydedilemedi: ' + error.message +
        '\n\n"site_banner" tablosu veritabanında henüz yoksa, önce onu oluşturmak gerekir.'
      );
      return false;
    }
    setBanner(data || { id: 1, ...payload });
    return true;
  };

  return { banner, loaded, save };
};

const toLocalInputValue = (iso) => {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const bannerStyles = `
  .yt-top-banner {
    width: 100vw;
    position: relative;
    left: 50%;
    right: 50%;
    margin-left: -50vw;
    margin-right: -50vw;
    box-sizing: border-box;
    background: #17213a;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    flex-wrap: wrap;
    padding: 8px 16px;
    font-family: var(--yt-font-body, inherit);
    font-size: 0.84rem;
  }
  .yt-top-banner .yt-banner-msg { font-weight: 600; text-align: center; }
  .yt-top-banner .yt-banner-countdown { display: flex; gap: 5px; align-items: center; }
  .yt-top-banner .yt-banner-unit {
    background: rgba(255,255,255,0.14);
    border-radius: 6px;
    padding: 3px 7px;
    text-align: center;
    font-family: var(--yt-font-mono, monospace);
    font-size: 0.72rem;
    font-weight: 700;
    min-width: 34px;
    line-height: 1.3;
  }
  .yt-top-banner .yt-banner-unit small { display: block; font-weight: 400; font-size: 0.55rem; opacity: 0.75; letter-spacing: 0.03em; }
`;

// --- Düzenleme penceresi (yönetim butonu tarafından kullanılır) ---
function BannerEditorModal({ banner, onClose, onSave }) {
  const [draftMessage, setDraftMessage] = useState(banner?.message || '');
  const [draftEnabled, setDraftEnabled] = useState(banner ? !!banner.enabled : true);
  const [draftEndsAt, setDraftEndsAt] = useState(banner?.ends_at ? toLocalInputValue(banner.ends_at) : '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const ok = await onSave({
      enabled: draftEnabled,
      message: draftMessage.trim(),
      ends_at: draftEndsAt ? new Date(draftEndsAt).toISOString() : null,
    });
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
        style={{ backgroundColor: '#fff', borderRadius: '12px', padding: '22px', width: '440px', maxWidth: '100%' }}
      >
        <h3 style={{ margin: '0 0 14px 0', fontSize: '1.05rem', color: '#0f172a' }}>🎯 Üst Duyuru Şeridi</h3>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', marginBottom: '12px', color: '#334155' }}>
          <input type="checkbox" checked={draftEnabled} onChange={(e) => setDraftEnabled(e.target.checked)} />
          Şerit sitede gösterilsin
        </label>

        <label style={{ fontSize: '0.8rem', color: '#475569', display: 'block', marginBottom: '4px' }}>Mesaj</label>
        <textarea
          value={draftMessage}
          onChange={(e) => setDraftMessage(e.target.value)}
          rows={2}
          placeholder="Örn: Tüm paketlerde %20 indirim! Fırsat kaçmasın."
          style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: '0.85rem', marginBottom: '12px', resize: 'vertical' }}
        />

        <label style={{ fontSize: '0.8rem', color: '#475569', display: 'block', marginBottom: '4px' }}>
          Geri sayım bitiş zamanı (opsiyonel — boş bırakılırsa sayaç gösterilmez)
        </label>
        <input
          type="datetime-local"
          value={draftEndsAt}
          onChange={(e) => setDraftEndsAt(e.target.value)}
          style={{ width: '100%', padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', boxSizing: 'border-box', fontSize: '0.85rem', marginBottom: '6px' }}
        />
        {draftEndsAt && (
          <button
            type="button"
            onClick={() => setDraftEndsAt('')}
            style={{ display: 'block', marginBottom: '14px', background: 'none', border: 'none', color: '#dc2626', fontSize: '0.76rem', cursor: 'pointer', padding: 0 }}
          >
            Bitiş tarihini temizle (sayaçsız, süresiz göster)
          </button>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
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

// --- Ziyaretçiye gösterilen CANLI şerit (sadece açık + mesajlı ise) ---
export default function TopBanner() {
  const { banner, loaded } = useBannerSettings();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!banner?.ends_at) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [banner?.ends_at]);

  if (!loaded || !banner?.enabled || !banner?.message) return null;

  const countdown = (() => {
    if (!banner?.ends_at) return null;
    const diff = new Date(banner.ends_at).getTime() - now;
    if (diff <= 0) return null;
    return {
      days: Math.floor(diff / 86400000),
      hours: Math.floor((diff % 86400000) / 3600000),
      mins: Math.floor((diff % 3600000) / 60000),
      secs: Math.floor((diff % 60000) / 1000),
    };
  })();

  return (
    <>
      <style>{bannerStyles}</style>
      <div className="yt-top-banner">
        <span className="yt-banner-msg">{banner.message}</span>
        {countdown && (
          <div className="yt-banner-countdown">
            <div className="yt-banner-unit">{countdown.days}<small>GÜN</small></div>
            <span>:</span>
            <div className="yt-banner-unit">{String(countdown.hours).padStart(2, '0')}<small>SAAT</small></div>
            <span>:</span>
            <div className="yt-banner-unit">{String(countdown.mins).padStart(2, '0')}<small>DK</small></div>
            <span>:</span>
            <div className="yt-banner-unit">{String(countdown.secs).padStart(2, '0')}<small>SN</small></div>
          </div>
        )}
      </div>
    </>
  );
}

// --- Admin panelindeki diğer butonların (Duyuru Gönder, Kategoriler...)
// yanına konan YÖNETİM BUTONU. Şeridin kendisini GÖSTERMEZ, sadece
// düzenleme penceresini açar. ---
export function TopBannerManageButton() {
  const { banner, loaded, save } = useBannerSettings();
  const [showEditor, setShowEditor] = useState(false);

  const isLive = loaded && banner?.enabled && banner?.message;

  return (
    <>
      <button
        type="button"
        onClick={() => setShowEditor(true)}
        style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', cursor: 'pointer', color: '#0f172a', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}
      >
        🎯 Üst Şerit
        <span
          title={isLive ? 'Şerit şu an sitede yayında' : 'Şerit şu an kapalı'}
          style={{
            display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%',
            backgroundColor: isLive ? '#22c55e' : '#cbd5e1'
          }}
        />
      </button>

      {showEditor && (
        <BannerEditorModal
          banner={banner}
          onClose={() => setShowEditor(false)}
          onSave={save}
        />
      )}
    </>
  );
}

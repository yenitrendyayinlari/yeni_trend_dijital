import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// Sitenin en üstünde gösterilen kampanya/duyuru şeridi (Praxis/ETS
// örneklerindeki gibi). Ayarlar `site_banner` tablosunun TEK satırında
// (id=1) tutulur. isAdmin=true iken şeridin üzerinde bir ✏️ butonu çıkar;
// tıklanınca mesaj, açık/kapalı durumu ve (opsiyonel) geri sayım bitiş
// zamanı buradan düzenlenip anında kaydedilir. Bu dosya App.jsx'teki
// hiçbir state'e dokunmaz -- kendi verisini kendi çeker/yazar.
export default function TopBanner({ isAdmin }) {
  const [banner, setBanner] = useState(null); // { id, enabled, message, ends_at }
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [showEditor, setShowEditor] = useState(false);
  const [draftMessage, setDraftMessage] = useState('');
  const [draftEnabled, setDraftEnabled] = useState(true);
  const [draftEndsAt, setDraftEndsAt] = useState(''); // datetime-local string
  const [saving, setSaving] = useState(false);

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

  // Geri sayım varsa saniyede bir tazele.
  useEffect(() => {
    if (!banner?.ends_at) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [banner?.ends_at]);

  const toLocalInputValue = (iso) => {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const openEditor = () => {
    setDraftMessage(banner?.message || '');
    setDraftEnabled(banner ? !!banner.enabled : true);
    setDraftEndsAt(banner?.ends_at ? toLocalInputValue(banner.ends_at) : '');
    setShowEditor(true);
  };

  const save = async () => {
    setSaving(true);
    const payload = {
      id: 1,
      enabled: draftEnabled,
      message: draftMessage.trim(),
      ends_at: draftEndsAt ? new Date(draftEndsAt).toISOString() : null,
    };
    const { data, error } = await supabase.from('site_banner').upsert(payload).select().maybeSingle();
    setSaving(false);
    if (error) {
      alert(
        'Kaydedilemedi: ' + error.message +
        '\n\n"site_banner" tablosu veritabanında henüz yoksa, önce onu oluşturmak gerekir.'
      );
      return;
    }
    setBanner(data || payload);
    setShowEditor(false);
  };

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

  if (!loaded) return null;

  const isLiveAndVisible = banner?.enabled && banner?.message;
  // Ziyaretçiye (isAdmin=false) sadece açık ve mesajlı şerit gösterilir.
  // Yöneticiye (isAdmin=true), boş/kapalıyken bile düzenleyebilmesi için
  // silik bir "şerit kapalı" çubuğu gösterilir.
  if (!isAdmin && !isLiveAndVisible) return null;

  return (
    <>
      <style>{`
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
          padding: 8px 44px 8px 16px;
          font-family: var(--yt-font-body, inherit);
          font-size: 0.84rem;
        }
        .yt-top-banner.yt-top-banner-off { background: #475569; }
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
        .yt-banner-edit-btn {
          position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
          background: rgba(255,255,255,0.16); border: none; color: #fff; border-radius: 5px;
          padding: 4px 8px; cursor: pointer; font-size: 0.8rem; line-height: 1;
        }
        .yt-banner-edit-btn:hover { background: rgba(255,255,255,0.26); }
      `}</style>

      {isLiveAndVisible ? (
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
          {isAdmin && (
            <button type="button" className="yt-banner-edit-btn" onClick={openEditor} title="Şeridi düzenle">✏️</button>
          )}
        </div>
      ) : (
        isAdmin && (
          <div className="yt-top-banner yt-top-banner-off">
            <span className="yt-banner-msg" style={{ opacity: 0.85, fontWeight: 400 }}>
              Üst duyuru şeridi şu an kapalı / boş.
            </span>
            <button type="button" className="yt-banner-edit-btn" onClick={openEditor} title="Şeridi düzenle">✏️</button>
          </div>
        )
      )}

      {showEditor && (
        <div
          onClick={() => setShowEditor(false)}
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
              <button type="button" onClick={() => setShowEditor(false)} style={{ padding: '8px 14px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#fff', cursor: 'pointer' }}>
                Vazgeç
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', backgroundColor: '#0f172a', color: '#fff', cursor: 'pointer', fontWeight: 'bold', opacity: saving ? 0.6 : 1 }}
              >
                {saving ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

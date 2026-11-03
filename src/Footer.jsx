import { useState } from 'react';

const COMPANY_NAME = 'Yeni Trend Yayıncılık Eğitim Sanayi Ticaret Limited Şirketi';
const COMPANY_EMAIL = 'info@sualink.com';
const COMPANY_ADDRESS = 'İvedik OSB Mahallesi 1485. Cadde No: 15/F Yenimahalle/ANKARA';
const COMPANY_MERSIS = '0167051078700013';
const COMPANY_TAX_OFFICE = 'İvedik V.D.';
const COMPANY_TAX_NO = '1670510787';
const SITE_NAME = 'Sualink';
const SITE_URL = 'sualink.com';
const ETBIS_URL = 'https://etbis.ticaret.gov.tr/tr/SiteSorgulamaSonuc?siteId=76f265d4-2848-47f6-8f9e-3fcadf226256';

// ------------------------------------------------------------------
// Yasal metinler — şirketin resmi bilgileriyle (unvan, adres, MERSİS,
// vergi dairesi/no) doldurulmuş standart şablon metinlerdir.
// ------------------------------------------------------------------
const LEGAL_CONTENT = {
  iletisim: {
    title: 'İletişim',
    body: (
      <>
        <p><strong>{COMPANY_NAME}</strong></p>
        <p>Adres: {COMPANY_ADDRESS}</p>
        <p>E-posta: <a href={`mailto:${COMPANY_EMAIL}`}>{COMPANY_EMAIL}</a></p>
        <p>Sorularınız, talepleriniz veya bir sınav/soruyla ilgili bildirimleriniz için
          bize yukarıdaki e-posta adresinden ulaşabilirsiniz. Talepleriniz en geç 3 iş
          günü içinde yanıtlanır.</p>
      </>
    )
  },
  sss: {
    title: 'Sıkça Sorulan Sorular',
    body: (
      <>
        <p><strong>Satın aldığım bir sınava/pakete ne kadar süre erişebilirim?</strong><br />
          Satın aldığınız içeriklere hesabınızın "Sınavlarım" bölümünden süresiz olarak
          erişebilirsiniz; aksi ürün sayfasında ayrıca belirtilmedikçe erişim süresi
          kısıtlanmaz.</p>
        <p><strong>Ödeme yaparken kartım nasıl korunuyor?</strong><br />
          Ödemeleriniz, PCI-DSS uyumlu bir ödeme kuruluşu olan iyzico altyapısı
          üzerinden 3D Secure ile işlenir. Kart bilgileriniz sitemizde saklanmaz.</p>
        <p><strong>Bir soruda/çözümde hata olduğunu düşünüyorum, ne yapmalıyım?</strong><br />
          Sınav ekranındaki "Hata / Geri Bildirim" butonunu kullanarak ilgili soruyu
          bize bildirebilirsiniz, ekibimiz en kısa sürede inceler.</p>
        <p><strong>Şifremi unuttum, ne yapmalıyım?</strong><br />
          Giriş ekranındaki ilgili bağlantıyı kullanarak şifrenizi sıfırlayabilir ya
          da bizimle {COMPANY_EMAIL} adresinden iletişime geçebilirsiniz.</p>
      </>
    )
  },
  kvkk: {
    title: 'KVKK Aydınlatma Metni',
    body: (
      <>
        <p>{COMPANY_NAME} ("{SITE_NAME}" / "Şirket") olarak, 6698 sayılı Kişisel
          Verilerin Korunması Kanunu ("KVKK") kapsamında veri sorumlusu sıfatıyla,
          kişisel verilerinizin güvenliğine önem veriyoruz.</p>
        <p><strong>Veri Sorumlusu:</strong> {COMPANY_NAME}<br />
          Adres: {COMPANY_ADDRESS}<br />
          MERSİS No: {COMPANY_MERSIS} · {COMPANY_TAX_OFFICE} {COMPANY_TAX_NO}</p>
        <p><strong>İşlenen Kişisel Veriler:</strong> Ad-soyad, e-posta adresi, hesap
          bilgileri, sipariş/ödeme işlem kayıtları, sınav performans ve kullanım
          verileri, iletişim talepleriniz kapsamında paylaştığınız bilgiler; ayrıca
          satın alma işleminiz için fatura düzenlenebilmesi amacıyla T.C. Kimlik
          Numaranız, fatura e-posta adresiniz ve adresiniz.</p>
        <p><strong>İşleme Amaçları:</strong> Üyelik ve hesap yönetiminin sağlanması,
          satın alma ve ödeme süreçlerinin yürütülmesi, sınav/soru içeriklerine
          erişimin sağlanması, müşteri destek taleplerinin karşılanması, yasal
          yükümlülüklerin yerine getirilmesi ve hizmet kalitesinin iyileştirilmesi.</p>
        <p><strong>Hukuki Sebep:</strong> Kişisel verileriniz, bir sözleşmenin
          kurulması veya ifasıyla doğrudan ilgili olması, hukuki yükümlülüğün yerine
          getirilmesi ve açık rızanızın bulunduğu hâllerde KVKK m.5 ve m.6 kapsamında
          işlenir. T.C. Kimlik Numaranız özelinde hukuki sebep, 213 sayılı Vergi Usul
          Kanunu uyarınca tarafımıza yüklenen fatura düzenleme yükümlülüğüdür.</p>
        <p><strong>Fatura Bilgileri ve Saklama Süresi:</strong> Satın alma
          işleminizi tamamlamadan önce sizden istenen Ad Soyad, T.C. Kimlik No,
          fatura e-posta adresi ve adres bilgileri, YALNIZCA yasal fatura
          düzenleme yükümlülüğümüzü yerine getirmek amacıyla toplanır; başka
          hiçbir ticari veya pazarlama amacıyla kullanılmaz. Bu veriler, Vergi
          Usul Kanunu'nun öngördüğü yasal saklama süresi boyunca saklanır ve bu
          sürenin sonunda imha edilir. T.C. Kimlik Numaranızın doğruluğundan siz
          sorumlusunuz; hatalı beyan edilen bilgilerden doğacak fatura/vergi
          sorunlarından {COMPANY_NAME} sorumlu tutulamaz.</p>
        <p><strong>Aktarım:</strong> Ödeme süreçlerinin yürütülmesi amacıyla iyzico
          ve altyapı/barındırma hizmeti aldığımız Supabase gibi hizmet
          sağlayıcılarla, yalnızca hizmetin gerektirdiği ölçüde ve mevzuata uygun
          şekilde paylaşılabilir.</p>
        <p><strong>Haklarınız:</strong> KVKK m.11 uyarınca kişisel verilerinizin
          işlenip işlenmediğini öğrenme, işlenmişse buna ilişkin bilgi talep etme,
          işlenme amacını öğrenme, yurt içinde/dışında aktarıldığı üçüncü kişileri
          bilme, eksik/yanlış işlenmişse düzeltilmesini isteme, silinmesini/yok
          edilmesini isteme ve itiraz etme haklarına sahipsiniz. Bu haklarınızı
          kullanmak için {COMPANY_EMAIL} adresine yazılı olarak başvurabilirsiniz.</p>
      </>
    )
  },
  gizlilik: {
    title: 'Gizlilik Politikası',
    body: (
      <>
        <p>Bu Gizlilik Politikası, {SITE_URL} ("Site") üzerinden sunulan hizmetler
          kapsamında toplanan kişisel verilerin nasıl kullanıldığını açıklar.</p>
        <p><strong>Toplanan Bilgiler:</strong> Hesap oluştururken verdiğiniz ad,
          e-posta gibi bilgiler; site kullanımınıza ilişkin teknik veriler (çerezler,
          cihaz/tarayıcı bilgisi); satın alma ve sınav çözüm geçmişiniz.</p>
        <p><strong>Fatura Bilgileri (T.C. Kimlik No):</strong> Satın aldığınız
          içerikler için size fatura düzenleyebilmemiz amacıyla, ödemeyi
          tamamlamadan önce Ad Soyad, T.C. Kimlik Numarası, fatura e-posta adresi
          ve adres bilgilerinizi sizden istiyoruz. Bu bilgiler yalnızca yasal
          fatura düzenleme yükümlülüğümüz için toplanır, işlenir ve mevzuatın
          öngördüğü süre boyunca saklanır; başka hiçbir amaçla kullanılmaz veya
          üçüncü taraflarla paylaşılmaz (fatura/muhasebe sürecinde hizmet
          aldığımız e-fatura/e-arşiv entegratörü hariç).</p>
        <p><strong>Kullanım Amacı:</strong> Bilgileriniz yalnızca hizmetin sunulması,
          hesabınızın güvenliğinin sağlanması, size destek olunması ve yasal
          yükümlülüklerin yerine getirilmesi amacıyla kullanılır; pazarlama amacıyla
          üçüncü taraflarla satılmaz veya kiralanmaz.</p>
        <p><strong>Çerezler:</strong> Site, oturumunuzu açık tutmak ve sepet
          bilgilerinizi hatırlamak gibi temel işlevler için tarayıcınızın yerel
          depolama alanını (localStorage) kullanır.</p>
        <p><strong>Veri Güvenliği:</strong> Verileriniz, yetkisiz erişime karşı
          makul teknik ve idari tedbirlerle korunur. Ödeme bilgileriniz Site
          tarafından değil, doğrudan iyzico altyapısı üzerinden işlenir.</p>
        <p><strong>İletişim:</strong> Gizlilik politikamızla ilgili sorularınız için
          {' '}{COMPANY_EMAIL} adresinden bize ulaşabilirsiniz.</p>
      </>
    )
  },
  kullanim: {
    title: 'Kullanım Şartları',
    body: (
      <>
        <p>{SITE_URL} adresini ("Site") kullanarak aşağıdaki şartları kabul etmiş
          sayılırsınız. Site, {COMPANY_NAME} tarafından işletilmektedir.</p>
        <p><strong>Hizmetin Kapsamı:</strong> Site üzerinden dijital sınav, soru
          bankası ve test çözüm içerikleri üyelere sunulur. Satın alınan içerikler
          yalnızca kişisel, ticari olmayan kullanım için lisanslanır.</p>
        <p><strong>Hesap Sorumluluğu:</strong> Hesabınızın güvenliğinden ve
          hesabınız üzerinden gerçekleştirilen işlemlerden siz sorumlusunuz. Hesap
          bilgilerinizi üçüncü kişilerle paylaşmamanız gerekir.</p>
        <p><strong>Fikri Mülkiyet:</strong> Sitedeki tüm sınav, soru, çözüm ve
          içerikler {COMPANY_NAME}'ne aittir veya Şirket tarafından lisanslanmıştır;
          izinsiz çoğaltılamaz, paylaşılamaz veya dağıtılamaz.</p>
        <p><strong>Değişiklikler:</strong> Şirket, bu şartları ve Site üzerindeki
          hizmetleri önceden bildirimde bulunmaksızın güncelleme hakkını saklı
          tutar.</p>
      </>
    )
  },
  mesafeli: {
    title: 'Mesafeli Satış Sözleşmesi',
    body: (
      <>
        <p>İşbu Mesafeli Satış Sözleşmesi ön bilgilendirme formu, 6502 sayılı
          Tüketicinin Korunması Hakkında Kanun ve Mesafeli Sözleşmeler Yönetmeliği
          uyarınca, {SITE_URL} üzerinden yapılan dijital içerik (sınav/soru bankası
          erişimi) satışlarına ilişkin tarafların hak ve yükümlülüklerini
          düzenler.</p>
        <p><strong>Satıcı:</strong> {COMPANY_NAME}<br />
          Adres: {COMPANY_ADDRESS}<br />
          MERSİS No: {COMPANY_MERSIS} · {COMPANY_TAX_OFFICE} {COMPANY_TAX_NO}<br />
          E-posta: {COMPANY_EMAIL}</p>
        <p><strong>Konu:</strong> Alıcının Site üzerinden elektronik ortamda satın
          aldığı dijital sınav/soru bankası içeriğine erişim hakkının, belirlenen
          satış fiyatı karşılığında sağlanmasıdır.</p>
        <p><strong>Teslimat:</strong> Satın alınan dijital içerik, ödemenin
          onaylanmasının ardından anında Alıcının hesabına tanımlanır ve "Sınavlarım"
          bölümünden erişime açılır; ayrıca bir kargo/teslimat süreci yoktur.</p>
        <p><strong>Cayma Hakkı:</strong> Elektronik ortamda anında ifa edilen dijital
          içerik satışlarında, Alıcının içeriğe erişimi (indirme/görüntüleme)
          başladıktan sonra Mesafeli Sözleşmeler Yönetmeliği m.15 uyarınca cayma
          hakkı kullanılamaz. İçeriğe erişilmeden önce iletilen iptal talepleri
          değerlendirilir.</p>
      </>
    )
  },
  iade: {
    title: 'İade ve İptal Koşulları',
    body: (
      <>
        <p>Sitemizde satışa sunulan içerikler dijital ürün niteliğinde olup, satın
          alma sonrası hesabınıza anında tanımlanır.</p>
        <p><strong>İçeriğe hiç erişilmediyse:</strong> Satın alma tarihinden
          itibaren 24 saat içinde ve içerik hiç görüntülenmemişse, {COMPANY_EMAIL}
          adresine yazarak iptal/iade talebinde bulunabilirsiniz.</p>
        <p><strong>İçeriğe erişildiyse:</strong> Sınav/test içeriği görüntülenmeye
          veya çözülmeye başlandıktan sonra, dijital içeriğin niteliği gereği iade
          yapılamaz.</p>
        <p><strong>Hatalı işlem/mükerrer ödeme:</strong> Sistemsel bir hata sonucu
          yapılan mükerrer veya hatalı tahsilatlar, tespit edilmesi hâlinde
          tarafımızca incelenir ve haklı bulunması durumunda ücret iade edilir.</p>
        <p>İade taleplerinizi {COMPANY_EMAIL} adresine sipariş bilgilerinizle
          birlikte iletebilirsiniz.</p>
      </>
    )
  }
};

function LegalModal({ docKey, onClose }) {
  const doc = LEGAL_CONTENT[docKey];
  if (!doc) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(23,33,58,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, padding: '16px'
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="yt-exam-shell"
        style={{
          width: '100%', maxWidth: '620px', maxHeight: '82vh', overflowY: 'auto',
          padding: '26px', position: 'relative', backgroundColor: '#fff'
        }}
      >
        <button
          onClick={onClose}
          className="yt-modal-close"
          style={{ position: 'absolute', top: '14px', right: '14px', color: 'var(--yt-graphite-soft)' }}
          aria-label="Kapat"
        >
          ✕
        </button>
        <h2 style={{ margin: '0 0 16px 0', fontSize: '1.15rem', fontFamily: 'var(--yt-font-display)', color: 'var(--yt-ink)', paddingRight: '30px' }}>
          {doc.title}
        </h2>
        <div className="yt-legal-body">
          {doc.body}
        </div>
      </div>
    </div>
  );
}

export default function Footer() {
  const [activeDoc, setActiveDoc] = useState(null);
  const [openMenu, setOpenMenu] = useState(null); // açık açılır menü: 'sualink' | 'Kurumsal' | ... 
  const year = new Date().getFullYear();

  const linkGroups = [
    {
      title: 'Kurumsal',
      items: [
        { label: 'İletişim', key: 'iletisim' },
        { label: 'Sıkça Sorulan Sorular', key: 'sss' },
      ]
    },
    {
      title: 'Yasal',
      items: [
        { label: 'KVKK Aydınlatma Metni', key: 'kvkk' },
        { label: 'Gizlilik Politikası', key: 'gizlilik' },
        { label: 'Kullanım Şartları', key: 'kullanim' },
      ]
    },
    {
      title: 'Sipariş',
      items: [
        { label: 'Mesafeli Satış Sözleşmesi', key: 'mesafeli' },
        { label: 'İade ve İptal Koşulları', key: 'iade' },
      ]
    }
  ];

  const linkBtn = (item) => (
    <button key={item.key} className="yt-fl-item" onClick={() => { setOpenMenu(null); setActiveDoc(item.key); }}>{item.label}</button>
  );
  const group = (title) => linkGroups.find((g) => g.title === title);

  // Açılır menü içerikleri (başlığa tıklayınca yukarı doğru açılır)
  const menus = {
    sualink: {
      title: SITE_NAME, side: 'left',
      body: (
        <>
          <p className="yt-fl-text">Dijital sınav ve soru bankası platformu. Sorularınızı çözün, performansınızı takip edin.</p>
        </>
      )
    },
    Kurumsal: {
      title: 'Kurumsal', side: 'left',
      body: (
        <>
          {group('Kurumsal').items.map(linkBtn)}
          <a className="yt-fl-item" href={`mailto:${COMPANY_EMAIL}`}>{COMPANY_EMAIL}</a>
        </>
      )
    },
    Yasal: {
      title: 'Yasal', side: 'left',
      body: (
        <>
          {group('Yasal').items.map(linkBtn)}
          <a href={ETBIS_URL} target="_blank" rel="noopener noreferrer" className="yt-footer-etbis-link" title="ETBİS kaydını doğrula">
            <img src="https://etbis-papi.ticaret.gov.tr/cms-api/MediaAndFile/GetFile?fileLink=etbis-cms/Settings/logo1.png" alt="e-ticaret Bilgi Platformu" loading="lazy" />
          </a>
        </>
      )
    },
    Sipariş: { title: 'Sipariş', side: 'left', body: <>{group('Sipariş').items.map(linkBtn)}</> },
    Sürdürülebilirlik: {
      title: 'Sürdürülebilirlik', side: 'center',
      body: (
        <div className="yt-eco-badge" style={{ margin: 0, maxWidth: 'none' }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 4.5 9.5 8.5h2.2v3H14v-3h2.3L12 4.5Z" fill="#2f7a3d" />
            <path d="M6 19.5l-1.7-3 1.1-1.9 1.9 3.3-1.3 1.6Z" fill="#2f7a3d" />
            <path d="M18 19.5l1.7-3-1.1-1.9-1.9 3.3 1.3 1.6Z" fill="#2f7a3d" />
            <path d="M12 4.5c-3.5 0-6.4 1.8-8 4.5M20 9c-1.6-2.7-4.5-4.5-8-4.5M6 19.5H18M4.3 16.5c-.8-1.4-1.3-3-1.3-4.7M19.7 16.5c.8-1.4 1.3-3 1.3-4.7" stroke="#2f7a3d" strokeWidth="1.6" strokeLinecap="round" fill="none" />
          </svg>
          <p>Kağıt kullanmıyoruz.<br />Kargo göndermiyoruz.<br />%100 dijital olarak karbon ayak izimizi azaltıyoruz.</p>
        </div>
      )
    },
    'Güvenli Alışveriş': {
      title: 'Güvenli Alışveriş', side: 'right',
      body: (
        <>
          <div className="yt-footer-badges" style={{ marginTop: 0 }}>
            <span className="yt-footer-badge">iyzico</span>
            <span className="yt-footer-badge">VISA</span>
            <span className="yt-footer-badge">Mastercard</span>
            <span className="yt-footer-badge">Troy</span>
            <span className="yt-footer-badge">3D Secure</span>
          </div>
          <p className="yt-footer-secure-note">Ödemeleriniz iyzico altyapısı üzerinden SSL ile şifrelenerek işlenir. Kart bilgileriniz sitemizde saklanmaz.</p>
        </>
      )
    },
  };

  const trigger = (key, label) => {
    const m = menus[key];
    return (
      <div className="yt-fl-wrap" key={key}>
        <button className={`yt-fl-head${openMenu === key ? ' open' : ''}`} onClick={() => setOpenMenu(openMenu === key ? null : key)} aria-expanded={openMenu === key}>
          {label || m.title}
        </button>
        {openMenu === key && (
          <div className={`yt-fl-pop yt-fl-pop-${m.side}`} role="dialog">
            <div className="yt-fl-pop-title">{m.title}</div>
            {m.body}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <style>{`
        .yt-footer { border-top: 1px solid var(--yt-line); background: var(--yt-paper-2); margin-top: 0; position: relative; }
        .yt-footer-bar { max-width: 1400px; margin: 0 auto; padding: 4px 20px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 2px 18px; min-height: 48px; }
        .yt-fl-group { display: flex; flex-wrap: wrap; align-items: center; gap: 0 4px; }
        .yt-fl-wrap { position: relative; }
        .yt-fl-head { background: none; border: none; cursor: pointer; font-family: var(--yt-font-body); font-size: 0.86rem; color: var(--yt-graphite); padding: 12px 10px; border-radius: 6px; }
        .yt-fl-head:hover, .yt-fl-head.open { color: var(--yt-ink); background: rgba(27,33,56,0.06); }
        .yt-fl-pop { position: absolute; bottom: calc(100% + 4px); z-index: 60; min-width: 240px; max-width: 320px; background: #fff; border: 1px solid var(--yt-line); border-radius: 12px; box-shadow: 0 6px 24px rgba(27,33,56,0.18); padding: 14px 16px; display: flex; flex-direction: column; gap: 4px; }
        .yt-fl-pop-left { left: 0; }
        .yt-fl-pop-right { right: 0; }
        .yt-fl-pop-center { left: 50%; transform: translateX(-50%); }
        .yt-fl-pop-title { font-family: var(--yt-font-mono); font-size: 0.7rem; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--yt-ink); margin-bottom: 6px; }
        .yt-fl-item { background: none; border: none; text-align: left; padding: 6px 0; cursor: pointer; font-family: var(--yt-font-body); font-size: 0.88rem; color: var(--yt-graphite); text-decoration: none; }
        .yt-fl-item:hover { color: var(--yt-ink); text-decoration: underline; }
        .yt-fl-text { font-size: 0.86rem; color: var(--yt-graphite); line-height: 1.55; margin: 0; }
        .yt-fl-copy { font-family: var(--yt-font-mono); font-size: 0.72rem; color: var(--yt-graphite-soft); padding: 0 10px; }
        .yt-footer-badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
        .yt-footer-badge { font-family: var(--yt-font-mono); font-size: 0.68rem; font-weight: 700; letter-spacing: 0.02em; padding: 5px 9px; border-radius: 5px; border: 1.5px solid var(--yt-line); color: var(--yt-ink-2); background: #fff; }
        .yt-footer-secure-note { font-size: 0.76rem; color: var(--yt-graphite-soft); margin: 10px 0 0; line-height: 1.5; }
        .yt-footer-etbis-link { display: inline-flex; align-items: center; margin-top: 8px; padding: 4px; border: 1px solid var(--yt-line); border-radius: 6px; background: #fff; align-self: flex-start; }
        .yt-footer-etbis-link img { height: 36px; width: auto; display: block; }
        .yt-legal-body p { font-size: 0.86rem; color: var(--yt-graphite); line-height: 1.65; margin: 0 0 14px; }
        .yt-eco-badge { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; padding: 12px 14px; border-radius: 8px; background: #eef6ee; border: 1px solid #d7ead9; }
        .yt-eco-badge p { font-size: 0.78rem; color: #2f7a3d; line-height: 1.5; font-weight: 600; margin: 0; }
        .yt-legal-body strong { color: var(--yt-ink); }
        @media (max-width: 700px) {
          .yt-footer-bar { justify-content: center; padding: 6px 10px; }
          .yt-fl-group { justify-content: center; }
          .yt-fl-wrap { position: static; }
          .yt-fl-pop { position: fixed; left: 12px !important; right: 12px !important; bottom: 12px; transform: none !important; max-width: none; z-index: 1100; }
        }
      `}</style>

      <footer className="yt-footer">
        {openMenu && <div onClick={() => setOpenMenu(null)} style={{ position: 'fixed', inset: 0, zIndex: 55 }} />}
        <div className="yt-footer-bar" style={{ position: 'relative', zIndex: 56 }}>
          <div className="yt-fl-group">
            {trigger('sualink')}
            {trigger('Kurumsal')}
            {trigger('Yasal')}
            {trigger('Sipariş')}
          </div>
          <div className="yt-fl-group">
            {trigger('Sürdürülebilirlik', '🌱 Sürdürülebilirlik')}
          </div>
          <div className="yt-fl-group">
            {trigger('Güvenli Alışveriş', '🔒 Güvenli Alışveriş')}
            <span className="yt-fl-copy">© {year} {SITE_URL}</span>
          </div>
        </div>
      </footer>

      {activeDoc && <LegalModal docKey={activeDoc} onClose={() => setActiveDoc(null)} />}
    </>
  );
}

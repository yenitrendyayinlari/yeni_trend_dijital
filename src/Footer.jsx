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
          verileri, iletişim talepleriniz kapsamında paylaştığınız bilgiler.</p>
        <p><strong>İşleme Amaçları:</strong> Üyelik ve hesap yönetiminin sağlanması,
          satın alma ve ödeme süreçlerinin yürütülmesi, sınav/soru içeriklerine
          erişimin sağlanması, müşteri destek taleplerinin karşılanması, yasal
          yükümlülüklerin yerine getirilmesi ve hizmet kalitesinin iyileştirilmesi.</p>
        <p><strong>Hukuki Sebep:</strong> Kişisel verileriniz, bir sözleşmenin
          kurulması veya ifasıyla doğrudan ilgili olması, hukuki yükümlülüğün yerine
          getirilmesi ve açık rızanızın bulunduğu hâllerde KVKK m.5 ve m.6 kapsamında
          işlenir.</p>
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

  return (
    <>
      <style>{`
        .yt-footer {
          border-top: 2px solid var(--yt-ink);
          background: var(--yt-paper-2);
          margin-top: 40px;
        }
        .yt-footer-inner {
          max-width: 1100px;
          margin: 0 auto;
          padding: 40px 24px 24px;
        }
        .yt-footer-grid {
          display: grid;
          grid-template-columns: 1.4fr 1fr 1fr 1fr 1.2fr;
          gap: 28px;
        }
        @media (max-width: 900px) {
          .yt-footer-grid {
            grid-template-columns: 1fr 1fr;
          }
        }
        @media (max-width: 520px) {
          .yt-footer-grid {
            grid-template-columns: 1fr;
          }
        }
        .yt-footer-brand-block img { height: 30px; width: auto; display: block; margin-bottom: 10px; }
        .yt-footer-brand-block p {
          font-size: 0.82rem; color: var(--yt-graphite); line-height: 1.6; max-width: 260px;
        }
        .yt-footer-col h4 {
          font-family: var(--yt-font-mono); font-size: 0.72rem; font-weight: 700; letter-spacing: 0.05em;
          text-transform: uppercase; color: var(--yt-ink); margin: 0 0 12px;
        }
        .yt-footer-col ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 9px; }
        .yt-footer-col button.yt-footer-link {
          background: none; border: none; padding: 0; cursor: pointer; text-align: left;
          font-family: var(--yt-font-body); font-size: 0.84rem; color: var(--yt-graphite);
        }
        .yt-footer-col button.yt-footer-link:hover { color: var(--yt-ink); text-decoration: underline; }
        .yt-footer-col a {
          font-family: var(--yt-font-body); font-size: 0.84rem; color: var(--yt-graphite); text-decoration: none;
        }
        .yt-footer-col a:hover { color: var(--yt-ink); text-decoration: underline; }
        .yt-footer-badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
        .yt-footer-badge {
          font-family: var(--yt-font-mono); font-size: 0.68rem; font-weight: 700; letter-spacing: 0.02em;
          padding: 5px 9px; border-radius: 5px; border: 1.5px solid var(--yt-line); color: var(--yt-ink-2);
          background: #fff;
        }
        .yt-footer-secure-note {
          font-size: 0.76rem; color: var(--yt-graphite-soft); margin-top: 10px; line-height: 1.5;
        }
        .yt-footer-bottom {
          border-top: 1px solid var(--yt-line); margin-top: 32px; padding-top: 18px;
          display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-between; align-items: center;
        }
        .yt-footer-bottom span {
          font-family: var(--yt-font-mono); font-size: 0.72rem; color: var(--yt-graphite-soft);
        }
        .yt-footer-etbis-link { display: inline-block; margin-top: 12px; }
        .yt-footer-etbis-link img { width: 40px; height: 40px; border: 1px solid var(--yt-line); border-radius: 4px; padding: 3px; background: #fff; display: block; }
        .yt-legal-body p { font-size: 0.86rem; color: var(--yt-graphite); line-height: 1.65; margin: 0 0 14px; }
        .yt-legal-body strong { color: var(--yt-ink); }
      `}</style>

      <footer className="yt-footer">
        <div className="yt-footer-inner">
          <div className="yt-footer-grid">
            <div className="yt-footer-brand-block">
              <div style={{ fontFamily: 'var(--yt-font-display)', fontWeight: 700, fontSize: '1.05rem', color: 'var(--yt-ink)', marginBottom: '8px' }}>
                {SITE_NAME}
              </div>
              <p>Dijital sınav ve soru bankası platformu. Sorularınızı çözün,
                performansınızı takip edin.</p>
            </div>

            {linkGroups.map(group => (
              <div className="yt-footer-col" key={group.title}>
                <h4>{group.title}</h4>
                <ul>
                  {group.items.map(item => (
                    <li key={item.key}>
                      <button className="yt-footer-link" onClick={() => setActiveDoc(item.key)}>
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ul>
                {group.title === 'Yasal' && (
                  <a
                    href={ETBIS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="yt-footer-etbis-link"
                    title="ETBİS kaydını doğrula"
                  >
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(ETBIS_URL)}`}
                      alt="ETBİS Doğrulama QR Kodu"
                      width="40"
                      height="40"
                      loading="lazy"
                    />
                  </a>
                )}
              </div>
            ))}

            <div className="yt-footer-col">
              <h4>Güvenli Alışveriş</h4>
              <p style={{ fontSize: '0.84rem', color: 'var(--yt-graphite)', margin: '0 0 4px' }}>
                <a href={`mailto:${COMPANY_EMAIL}`}>{COMPANY_EMAIL}</a>
              </p>
              <div className="yt-footer-badges">
                <span className="yt-footer-badge">iyzico</span>
                <span className="yt-footer-badge">VISA</span>
                <span className="yt-footer-badge">Mastercard</span>
                <span className="yt-footer-badge">Troy</span>
                <span className="yt-footer-badge">3D Secure</span>
              </div>
              <p className="yt-footer-secure-note">
                Ödemeleriniz iyzico altyapısı üzerinden SSL ile şifrelenerek işlenir.
                Kart bilgileriniz sitemizde saklanmaz.
              </p>
            </div>
          </div>

          <div className="yt-footer-bottom">
            <span>© {year} {SITE_URL} · Tüm hakları saklıdır.</span>
            <span>{SITE_URL}</span>
          </div>
        </div>
      </footer>

      {activeDoc && <LegalModal docKey={activeDoc} onClose={() => setActiveDoc(null)} />}
    </>
  );
}

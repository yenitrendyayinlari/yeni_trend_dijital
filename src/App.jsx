import { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist';
import SecurePdfViewer from './SecurePdfViewer';
import { supabase } from './supabase';
import { initializePayment } from './iyzipayService';
import sualinkLogo from './sualinklogo.png';
import TopBanner, { TopBannerManageButton } from './TopBanner';
import { SignupBonusManageButton } from './SignupBonus';
import BalanceGiftModal from './BalanceGiftModal';
import Footer from './Footer';

// Admin panelinde PDF yüklendiğinde sayfa sayısını (= soru sayısı, sistemde
// her PDF sayfası bir soruya karşılık geliyor) tarayıcıda otomatik okumak
// için PdfViewer.jsx'teki aynı kararlı CDN worker kurulumu kullanılıyor.
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

// Bir PDF File nesnesinden (henüz storage'a yüklenmeden, tarayıcıda) sayfa
// sayısını okur. Okunamazsa (bozuk dosya vb.) null döner -- çağıran taraf bu
// durumda eski manuel "Soru / Sayfa Sayısı" değerini korumalı.
// sharedWorker (opsiyonel): toplu içe aktarımda (bkz. runBulkImport) her PDF
// için ayrı bir PDF.js worker açıp bunu asla kapatmamak, tarayıcı sekmesinde
// worker/bellek sızıntısına yol açıyordu -- 10+ test arka arkaya işlenince
// kaynaklar tükenip Supabase'e giden fetch istekleri "Failed to fetch" ile
// çökmeye başlıyordu. Çözüm iki parçalı: (1) burada pdfDoc.destroy() ile o
// dokümanın kaynaklarını her zaman serbest bırakıyoruz, (2) çağıran taraf
// tüm döngü boyunca TEK bir worker'ı paylaşabilsin diye sharedWorker kabul
// ediyoruz (her PDF için CDN'den yeniden worker script indirmemek için).
async function readPdfPageCount(file, sharedWorker) {
  let pdfDoc = null;
  try {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer, worker: sharedWorker });
    pdfDoc = await loadingTask.promise;
    return pdfDoc.numPages;
  } catch (err) {
    console.error('PDF sayfa sayısı okunamadı:', err);
    return null;
  } finally {
    if (pdfDoc) {
      try { await pdfDoc.destroy(); } catch (_) { /* zaten kapanmışsa yoksay */ }
    }
  }
}

// İyzico'nun checkoutFormContent alanı içindeki <script> etiketi,
// innerHTML ile DOM'a eklendiğinde tarayıcı tarafından ÇALIŞTIRILMAZ
// (bu bilinen bir DOM kısıtlamasıdır). Bu yüzden script'i manuel olarak
// yeni bir <script> elementi olarak yeniden oluşturup DOM'a ekliyoruz,
// böylece iyzico'nun ödeme formu gerçekten render edilip görünür hale gelir.
function renderIyzicoCheckoutForm(container, htmlContent) {
  if (!container) return;
  container.innerHTML = htmlContent;
  const oldScripts = container.querySelectorAll('script');
  oldScripts.forEach((oldScript) => {
    const newScript = document.createElement('script');
    Array.from(oldScript.attributes).forEach((attr) => {
      newScript.setAttribute(attr.name, attr.value);
    });
    newScript.textContent = oldScript.textContent;
    oldScript.parentNode.replaceChild(newScript, oldScript);
  });
}

export default function App() {
  const [appMode, setAppMode] = useState('student'); 
  const [authMode, setAuthMode] = useState('login'); 
  const [showAuthModal, setShowAuthModal] = useState(false); 
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const [exams, setExams] = useState([]);
  const [activeAdminExamId, setActiveAdminExamId] = useState(null);
  const [activeSubExamId, setActiveSubExamId] = useState(null);
  // Yönetici panelinde sınav PDF önizlemesinde ileri/geri gezinmek için.
  // { examId, page } tutuyoruz; currentPreviewExam değiştiğinde (examId
  // eşleşmezse) otomatik olarak 1'e döner, ayrı bir useEffect gerekmez.
  const [adminPreviewPage, setAdminPreviewPage] = useState({ examId: null, page: 1 });
  const [newKazanimSoruNo, setNewKazanimSoruNo] = useState('');
  const [quickKazanimDers, setQuickKazanimDers] = useState('');
  const [quickKazanimKonu, setQuickKazanimKonu] = useState('');
  const [quickKazanimText, setQuickKazanimText] = useState('');
  const [copyKazanimSourceId, setCopyKazanimSourceId] = useState('');
  // Kazanım Haritası panelindeki üç araç kutusu (Excel/Tek Kazanım/Kopyala)
  // varsayılan KAPALI başlar -- böylece soru görüntüleyiciye bakarken kazanım
  // listesi ekrana daha yakın durur, araçlara ihtiyaç oldukça açılır.
  const [kazanimToolsOpen, setKazanimToolsOpen] = useState({ excel: false, quick: false, copy: false });
  const [isCreatingExam, setIsCreatingExam] = useState(false);
  // Sınav Türü / Ders Türü artık serbest metin değil, sabit bir listeden
  // seçiliyor (bkz. Yeni İçerik Ayarları formu). Bu iki state, o listeleri
  // Supabase'den çekip tutuyor; newExamForm.categoryExamType /
  // categoryLesson yine düz metin olarak saklanıyor (exams tablosunda
  // hiçbir şema değişikliği gerekmiyor), sadece artık bu metin SADECE bu
  // listeden seçilerek geliyor, elle yazılmıyor.
  const [examCategories, setExamCategories] = useState([]); // [{id, name}]
  const [lessonCategories, setLessonCategories] = useState([]); // [{id, name, exam_category_id}]
  const [topics, setTopics] = useState([]); // [{id, name, lesson_category_id}]
  const [learningOutcomes, setLearningOutcomes] = useState([]); // [{id, name, lesson_category_id, topic_id}]
  // Kazanım bazlı ders notu (PDF) / video kaynakları. Anahtar: learning_outcome_id.
  const [learningOutcomeResources, setLearningOutcomeResources] = useState({});
  // Admin "Kaynaklar" ekranı: hangi Ders Türü seçili, ve hangi kazanımın
  // video linki şu an düzenleniyor (kaydetmeden önce serbestçe yazabilsin diye).
  const [showResourceManager, setShowResourceManager] = useState(false);
  // Excel'den toplu test yükleme (bir üst ürüne onlarca test tek seferde
  // eklemek için). Kazanım haritası bu akışa dahil değil -- admin onu
  // sonradan tek tek/mevcut ekranlardan elle girecek.
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkImportParentId, setBulkImportParentId] = useState(null);
  const [bulkExcelRows, setBulkExcelRows] = useState([]); // [{name, numPages, sinavPdfName, cozumPdfName, cevapAnahtari}]
  const [bulkPdfFiles, setBulkPdfFiles] = useState(new Map()); // dosya adı (küçük harf) -> File
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkImportProgress, setBulkImportProgress] = useState({ current: 0, total: 0 });
  const [bulkImportErrors, setBulkImportErrors] = useState([]);
  const [resourceManagerDersId, setResourceManagerDersId] = useState(null);
  const [resourceVideoDrafts, setResourceVideoDrafts] = useState({}); // { [learning_outcome_id]: taslak metin }
  // Öğrenci sonuç ekranında hangi kazanımın video oynatıcısı açık (anahtar: learning_outcome_id ya da kazanım adı).
  const [expandedVideoKazanim, setExpandedVideoKazanim] = useState({});
  const [showNewExamCategoryInput, setShowNewExamCategoryInput] = useState(false);
  const [newExamCategoryName, setNewExamCategoryName] = useState('');
  const [showNewLessonCategoryInput, setShowNewLessonCategoryInput] = useState(false);
  const [newLessonCategoryName, setNewLessonCategoryName] = useState('');
  const [showNewOutcomeInput, setShowNewOutcomeInput] = useState(false);
  const [newOutcomeName, setNewOutcomeName] = useState('');
  const [showNewTopicInput, setShowNewTopicInput] = useState(false);
  const [newTopicName, setNewTopicName] = useState('');
  const [showNewDersForKazanimInput, setShowNewDersForKazanimInput] = useState(false);
  const [newDersForKazanimName, setNewDersForKazanimName] = useState('');
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  // Soru başı fiyat: admin panelinde ayarlanan, "Soru / Sayfa Sayısı"
  // değiştiğinde Fiyat/Eski Fiyat'ı otomatik hesaplamak için kullanılan
  // tek (global) katsayı. `pricing_settings` tablosunun TEK satırında
  // (id=1) tutulur.
  const [pricePerQuestion, setPricePerQuestion] = useState(0);
  // pricePerQuestion'ın kendisi 0 olabilir -- hem "hiç ayarlanmadı" (varsayılan
  // başlangıç durumu) hem de "admin BİLEREK 0 yazıp kaydetti" (örn. bugün tüm
  // ürünleri ücretsiz yapmak istiyor) AYNI sayısal değere denk düşer. Bu ikisini
  // ayırt etmek için ayrı bir bayrak tutuyoruz: veritabanında pricing_settings
  // satırı gerçekten VARSA (fetchPricingSettings) ya da admin panelden az önce
  // KAYDETTİYSE (savePricePerQuestion) true olur. Otomatik fiyat hesaplayan
  // her yer artık "pricePerQuestion > 0" yerine bunu kontrol ediyor -- böylece
  // 0 girip kaydetmek gerçekten "tüm fiyatları 0 yap" anlamına geliyor.
  const [pricePerQuestionConfigured, setPricePerQuestionConfigured] = useState(false);
  const [showPricingSettings, setShowPricingSettings] = useState(false);
  const [pricingDraft, setPricingDraft] = useState('0');
  // Kategori Yönetimi artık sekmeler yerine iç içe (Sınav Türü > Ders Türü >
  // Konu > Kazanım) açılır/kapanır bir akordiyon ağacı olarak gösteriliyor.
  // Her seviyenin kendi "hangi kayıtlar açık" haritası var (id -> boolean).
  const [expandedExamIds, setExpandedExamIds] = useState({});
  const [expandedLessonIds, setExpandedLessonIds] = useState({});
  const [expandedTopicIds, setExpandedTopicIds] = useState({});
  const [newExamForm, setNewExamForm] = useState({
    name: '',
    duration: '',
    examType: 'deneme',
    categoryExamType: '',
    categoryLesson: '',
    price: 0,
    originalPrice: 0,
    isParent: true,
    answerKey: {},
    sections: [],
    numPages: 0,
    description: ''
  });
  const [activeStudentExamId, setActiveStudentExamId] = useState(null);
  const [inspectingExamId, setInspectingExamId] = useState(null);
  // Paylaşılan bir ürün linkiyle (?exam=<id>) açıldıysak, id'yi mount anında
  // bir kere okuyup burada saklıyoruz. exams listesi Supabase'ten async
  // geldiği için birkaç render/efekt arada çalışabiliyor; window.location'ı
  // tekrar tekrar okumak yerine bu ref'e güveniyoruz.
  const pendingSharedExamIdRef = useRef(
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('exam') : null
  );

  // ÖNEMLİ (bug fix): Supabase istemcisi, sekme arka plandan öne alındığında
  // (visibilitychange) oturumu kontrol etmek için onAuthStateChange olayını
  // YENİDEN tetikleyebiliyor -- aynı kullanıcı için bile. Bu ref, o an için
  // "exams" listesinin hangi kullanıcı için zaten yüklendiğini tutar; aynı
  // kullanıcı için tekrar gelen olaylarda gereksiz/zararlı yeniden yüklemeyi
  // atlamak için kullanılır (bkz. aşağıdaki onAuthStateChange).
  const loadedUserIdRef = useRef(null);

  const [studentCurrentPage, setStudentCurrentPage] = useState(1);
  const [studentAnswers, setStudentAnswers] = useState({});
  const [timeLeft, setTimeLeft] = useState(0); 
  const [isPaused, setIsPaused] = useState(false);
  const [examStarted, setExamStarted] = useState(false); // Öğrenci "Başla"ya basana kadar süre işlemeye başlamaz
  // Odak Modu: soru çözüm ekranında site header'ını (logo/menü) gizleyip
  // soru alanına daha fazla yer açar. Sadece CSS/state ile çalışır --
  // native tarayıcı Fullscreen API'si kasıtlı olarak kullanılmıyor (bkz.
  // toggleFocusMode tanımındaki not).
  const [focusMode, setFocusMode] = useState(false);
  const [isExamFinished, setIsExamFinished] = useState(false);
  const [showResults, setShowResults] = useState(false);
  // Sonuç ekranındaki Kazanım Analizi'nde hangi Konu kartlarının açık
  // (kazanım detayı görünür) olduğunu tutar. Anahtar: "ders::konu".
  const [expandedKonular, setExpandedKonular] = useState({});
  
  const [viewingSolutionQ, setViewingSolutionQ] = useState(false);
  const solutionRef = useRef(null);
  const [studentResultsMap, setStudentResultsMap] = useState({});
  const [studentPurchases, setStudentPurchases] = useState({}); 
  const [studentBalance, setStudentBalance] = useState(null); // null: henüz yüklenmedi, number: yüklendi

  const [showReportModal, setShowReportModal] = useState(false);
  const [reportText, setReportText] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportedQuestions, setReportedQuestions] = useState({}); 

  const [showReportsAdmin, setShowReportsAdmin] = useState(false);
  const [adminReports, setAdminReports] = useState([]);
  const [adminReportsLoading, setAdminReportsLoading] = useState(false);
  const [adminReportsFilter, setAdminReportsFilter] = useState('open');
  const [openReportsCount, setOpenReportsCount] = useState(0);
  const [replyDrafts, setReplyDrafts] = useState({});

  // Fatura Bilgileri: öğrenci kendi TC Kimlik No / fatura e-postası / adres
  // bilgisini "Sınavlarım" sayfasından girip kaydediyor (billing_info
  // tablosu, RLS ile sadece kendi satırını okur/yazar). Admin panelinde
  // ise "Faturalar" bölümünden TÜM öğrencilerin girdiği bilgileri (yine RLS
  // ile, admin@yayinevi.com için ayrı bir SELECT politikasıyla) görüp
  // e-posta üzerinden arayabiliyor.
  const [myBillingInfo, setMyBillingInfo] = useState(null);
  const [billingDraft, setBillingDraft] = useState({ fullName: '', tcKimlikNo: '', invoiceEmail: '', address: '' });
  const [savingBillingInfo, setSavingBillingInfo] = useState(false);
  const [showBillingAdmin, setShowBillingAdmin] = useState(false);
  const [billingRecords, setBillingRecords] = useState([]);
  const [billingRecordsLoading, setBillingRecordsLoading] = useState(false);
  const [billingSearch, setBillingSearch] = useState('');
  // Ödeme öncesi ZORUNLU fatura bilgisi adımı: öğrenci fatura bilgisini
  // henüz girmemişse, ödemeye (iyzico'ya veya bakiye ile ücretsiz karşılamaya)
  // geçmeden ÖNCE bu bilgiyi istiyoruz -- aksi halde ödeme tamamlanıp fatura
  // kesilemeyen bir öğrenci ortaya çıkıyordu. pendingPaymentAction, fatura
  // bilgisi kaydedildikten HEMEN SONRA hangi ödeme işleminin devam edeceğini
  // tutar: { type: 'single', exam } ya da { type: 'cart' }.
  const [showBillingGateModal, setShowBillingGateModal] = useState(false);
  const [pendingPaymentAction, setPendingPaymentAction] = useState(null);

  const [showAnnounceModal, setShowAnnounceModal] = useState(false);
  const [announceTitle, setAnnounceTitle] = useState('');
  const [announceMessage, setAnnounceMessage] = useState('');
  const [announceAudience, setAnnounceAudience] = useState('all');
  const [announceExamId, setAnnounceExamId] = useState('');
  const [announceExamType, setAnnounceExamType] = useState('');
  const [announceStudentEmail, setAnnounceStudentEmail] = useState('');
  const [announceSending, setAnnounceSending] = useState(false);

  const [showStudentNotifs, setShowStudentNotifs] = useState(false);
  const [studentNotifItems, setStudentNotifItems] = useState([]);
  const [studentNotifLoading, setStudentNotifLoading] = useState(false);
  const [studentUnreadCount, setStudentUnreadCount] = useState(0);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Tümü');

  const [examRatingsMap, setExamRatingsMap] = useState({});
  const [examRatingBreakdownMap, setExamRatingBreakdownMap] = useState({});
  const [solvedCountMap, setSolvedCountMap] = useState({});
  const [sortOption, setSortOption] = useState('populer');
  const [cartItems, setCartItems] = useState(() => {
    try {
      const saved = localStorage.getItem('yt_cart_items');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [showCart, setShowCart] = useState(false);
  // İyzico ödeme penceresinin açık olup olmadığını React'in kendi kontrolünde
  // tutuyoruz -- bu sayede kapatma butonu, iyzico'nun kendi DOM içeriğinden
  // tamamen bağımsız, her zaman en üstte ve tıklanabilir kalıyor.
  const [showPaymentOverlay, setShowPaymentOverlay] = useState(false);
  const closePaymentOverlay = () => {
    const checkoutDiv = document.getElementById('iyzipay-checkout-form');
    if (checkoutDiv) checkoutDiv.innerHTML = '';
    setShowPaymentOverlay(false);
  };
  const [productReviews, setProductReviews] = useState([]);
  const [reviewTextInput, setReviewTextInput] = useState('');
  const [previewTestIndex, setPreviewTestIndex] = useState(0);

  const [showAccountPage, setShowAccountPage] = useState(false);
  const [accountTab, setAccountTab] = useState('exams');
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [passwordChangeLoading, setPasswordChangeLoading] = useState(false);
  const [passwordChangeMessage, setPasswordChangeMessage] = useState(null);

  useEffect(() => {
    // Sepet değiştikçe tarayıcıya kaydediyoruz ki oturum kapatılıp açılsa
    // ya da sayfa yenilense bile sepet içeriği kalıcı olsun.
    try {
      localStorage.setItem('yt_cart_items', JSON.stringify(cartItems));
    } catch {
      // localStorage kullanılamıyorsa (gizli sekme vb.) sessizce geç
    }
  }, [cartItems]);

  useEffect(() => {
    // Sınav listesi yüklendiğinde, localStorage'da kalmış ama artık mevcut
    // olmayan (silinmiş/değişmiş) sınav ID'lerini sepetten temizle. Bu,
    // sepet rozetinin gerçek içerikle tutarsız kalmasını önler.
    if (exams.length === 0) return;
    setCartItems((prev) => {
      const validIds = new Set(exams.map(e => e.id));
      const cleaned = prev.filter(id => validIds.has(id));
      return cleaned.length === prev.length ? prev : cleaned;
    });
  }, [exams]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        loadedUserIdRef.current = session.user.id;
        checkUserRoleAndSetMode(session.user);
      } else {
        fetchPublicExams();
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);

      if (session?.user) {
        // Aynı kullanıcı için tekrar gelen olayda (ör. sekmeye geri dönüldüğünde
        // Supabase'in tetiklediği oturum kontrolü) exams listesini yeniden
        // ÇEKMİYORUZ -- aksi halde veritabanındaki eski (henüz "Kaydet"
        // butonuna basılmamış) sürüm, o an ekranda doldurulmakta olan
        // kazanım/cevap gibi kaydedilmemiş yerel değişikliklerin üzerine
        // yazardı. Gerçek bir giriş (farklı kullanıcı ya da ilk yükleme)
        // olduğunda id değişeceği için normal şekilde yeniden yüklenir.
        if (loadedUserIdRef.current === session.user.id) return;
        loadedUserIdRef.current = session.user.id;
        checkUserRoleAndSetMode(session.user);
      } else {
        loadedUserIdRef.current = null;
        setAppMode('student');
        fetchPublicExams();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    // exams listesi (parent/child id eşleşmesi için) yüklendikten sonra puanları ve
    // çözülme sayılarını hesapla.
    if (exams.length > 0) {
      fetchAllRatings();
      fetchSolvedCounts();
    }
  }, [exams.length]);

  useEffect(() => {
    // Sayfa "?exam=<id>" parametresiyle açıldıysa (örn. paylaşılan bir ürün linki),
    // exams listesi yüklendikten sonra ilgili sınavın detay ekranını otomatik aç.
    // Not: examParam'ı window.location.search'ten HER seferinde yeniden okumuyoruz;
    // aşağıdaki URL-senkron efekti, exams henüz yüklenmeden "exam" parametresini
    // adres çubuğundan silebiliyordu (inspectingExamId henüz null olduğu için).
    // Bu yüzden paylaşılan id'yi mount anında bir kere yakalayıp pendingSharedExamIdRef'te tutuyoruz.
    if (pendingSharedExamIdRef.current === null) return;
    if (exams.length === 0) return;

    const examParam = pendingSharedExamIdRef.current;
    pendingSharedExamIdRef.current = null; // artık çözümlendi (bulunsun ya da bulunmasın), bir daha bekleme

    const found = exams.find(e => String(e.id) === examParam);
    if (found) {
      setInspectingExamId(found.id);
    } else {
      // Geçersiz/silinmiş bir exam id'si paylaşılmışsa adres çubuğundaki
      // "exam" parametresini temizleyelim.
      const params = new URLSearchParams(window.location.search);
      params.delete('exam');
      const newSearch = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (newSearch ? `?${newSearch}` : ''));
    }
  }, [exams.length]);

  useEffect(() => {
    // Detay ekranı açık/kapalıyken adres çubuğunu senkron tutuyoruz ki
    // ürün sayfası paylaşılabilir bir link olsun (?exam=<id>).
    // Paylaşılan bir link henüz çözümlenmeyi bekliyorsa (exams yüklenmedi),
    // "exam" parametresini silmiyoruz - yoksa yukarıdaki efekt exams
    // yüklendiğinde artık URL'de parametreyi bulamaz.
    if (inspectingExamId === null && pendingSharedExamIdRef.current !== null) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (inspectingExamId) {
      params.set('exam', inspectingExamId);
    } else {
      params.delete('exam');
    }
    const newSearch = params.toString();
    const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '');
    if (newUrl !== window.location.pathname + window.location.search) {
      window.history.replaceState({}, '', newUrl);
    }
  }, [inspectingExamId]);

  useEffect(() => {
    if (viewingSolutionQ && solutionRef.current) {
      solutionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [viewingSolutionQ]);

  useEffect(() => {
    if (!inspectingExamId) {
      setProductReviews([]);
      return;
    }
    setPreviewTestIndex(0);
    const childIds = exams.filter(e => e.parentId === inspectingExamId).map(e => e.id);
    fetchProductReviews(inspectingExamId, childIds);
  }, [inspectingExamId, exams.length]);

  useEffect(() => {
    // İyzico ödeme formundan siteye "?payment=success" gibi bir parametreyle
    // geri dönüldüğünde kullanıcıyı bilgilendirip satın alma listesini tazeliyoruz.
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get('payment');
    if (!paymentStatus) return;

    if (paymentStatus === 'success') {
      alert('✓ Ödemeniz başarıyla tamamlandı! Satın aldığınız içeriklere artık erişebilirsiniz.');
      if (user) {
        fetchUserPurchases(user.email).then((freshPurchases) => {
          // Az önce satın alınan içerikleri sepetten temizliyoruz (ödeme
          // başarıyla tamamlandıktan SONRA, önceden değil). fetchUserPurchases'ın
          // döndürdüğü TAZE veriyi kullanıyoruz -- state henüz güncellenmemiş
          // olabileceği için eski (stale) studentPurchases'a güvenmiyoruz.
          setCartItems((prev) => prev.filter((id) => !freshPurchases[id]));
        });
      }
    } else if (paymentStatus === 'cancelled') {
      // Kullanıcı iyzico'nun ödeme sayfasından vazgeçti -- sepeti olduğu gibi bırakıyoruz.
    } else if (paymentStatus === 'failed') {
      alert('Ödeme tamamlanamadı ya da iptal edildi.');
    } else {
      alert('Ödeme sırasında bir sorun oluştu. Lütfen tekrar deneyin ya da bizimle iletişime geçin.');
    }

    // "payment" parametresini temizleyip sayfa yenilendiğinde tekrar tetiklenmesini
    // önlüyoruz; ancak "exam" gibi diğer parametreleri (paylaşılan ürün linki) koruyoruz.
    params.delete('payment');
    const remaining = params.toString();
    const cleanUrl = window.location.origin + window.location.pathname + (remaining ? `?${remaining}` : '');
    window.history.replaceState({}, '', cleanUrl);
  }, [user]);

  useEffect(() => {
    if (appMode === 'admin' && user) {
      fetchAdminReports('open');
      fetchOpenReportsCount();
    }
  }, [appMode, user]);

  useEffect(() => {
    if (appMode === 'student' && user) {
      fetchStudentUnreadCount();
    }
  }, [appMode, user]);

  const fetchOpenReportsCount = async () => {
    const { count, error } = await supabase
      .from('question_reports')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'open');

    if (!error && typeof count === 'number') {
      setOpenReportsCount(count);
    }
  };

  const fetchAdminReports = async (filter) => {
    setAdminReportsLoading(true);
    let query = supabase
      .from('question_reports')
      .select('*')
      .order('created_at', { ascending: false });

    if (filter && filter !== 'all') {
      query = query.eq('status', filter);
    }

    const { data, error } = await query;
    setAdminReportsLoading(false);

    if (!error && data) {
      setAdminReports(data);
    } else if (error) {
      console.error("Bildirimler alınamadı:", error);
    }
  };

  const markReportStatus = async (reportId, status) => {
    const { error } = await supabase
      .from('question_reports')
      .update({ status })
      .eq('id', reportId);

    if (!error) {
      setAdminReports(prev => prev.filter(r => r.id !== reportId));
      fetchOpenReportsCount();
    } else {
      alert("İşlem başarısız oldu.");
    }
  };

  const deleteAdminReport = async (reportId) => {
    if (!window.confirm("Bu bildirimi kalıcı olarak silmek istiyor musunuz?")) return;
    const { error } = await supabase
      .from('question_reports')
      .delete()
      .eq('id', reportId);

    if (!error) {
      setAdminReports(prev => prev.filter(r => r.id !== reportId));
      fetchOpenReportsCount();
    } else {
      alert("Silme işlemi başarısız oldu.");
    }
  };

  const submitReportReply = async (reportId) => {
    const replyText = (replyDrafts[reportId] || '').trim();
    if (!replyText) return;

    const { error } = await supabase
      .from('question_reports')
      .update({
        admin_reply: replyText,
        replied_at: new Date().toISOString(),
        reply_seen: false,
        status: 'resolved'
      })
      .eq('id', reportId);

    if (!error) {
      setReplyDrafts(prev => { const next = { ...prev }; delete next[reportId]; return next; });
      setAdminReports(prev => prev.filter(r => r.id !== reportId));
      fetchOpenReportsCount();
    } else {
      alert("Yanıt gönderilemedi.");
    }
  };

  const sendAnnouncement = async () => {
    if (!announceTitle.trim() || !announceMessage.trim() || announceSending) return;
    if (announceAudience === 'buyers' && !announceExamId) { alert("Lütfen bir ürün/paket seçin."); return; }
    if (announceAudience === 'exam_type' && !announceExamType) { alert("Lütfen bir sınav türü seçin."); return; }
    if (announceAudience === 'single' && !announceStudentEmail.trim()) { alert("Lütfen öğrenci e-postasını girin."); return; }

    setAnnounceSending(true);
    const { error } = await supabase
      .from('notifications')
      .insert([{
        title: announceTitle.trim(),
        message: announceMessage.trim(),
        audience_type: announceAudience,
        audience_exam_id: announceAudience === 'buyers' ? announceExamId : null,
        audience_category_exam_type: announceAudience === 'exam_type' ? announceExamType : null,
        target_student_email: announceAudience === 'single' ? announceStudentEmail.trim() : null
      }]);
    setAnnounceSending(false);

    if (error) {
      console.error(error);
      alert("Duyuru gönderilemedi.");
      return;
    }

    setShowAnnounceModal(false);
    setAnnounceTitle('');
    setAnnounceMessage('');
    setAnnounceAudience('all');
    setAnnounceExamId('');
    setAnnounceExamType('');
    setAnnounceStudentEmail('');
    alert("✓ Duyuru gönderildi.");
  };

  const fetchStudentUnreadCount = async () => {
    if (!user) return;
    const lastSeen = localStorage.getItem('yt_notif_last_seen') || '1970-01-01T00:00:00.000Z';

    const [{ count: replyCount }, { count: notifCount }] = await Promise.all([
      supabase.from('question_reports').select('*', { count: 'exact', head: true }).eq('student_email', user.email).eq('reply_seen', false),
      supabase.from('notifications').select('*', { count: 'exact', head: true }).gt('created_at', lastSeen)
    ]);

    setStudentUnreadCount((replyCount || 0) + (notifCount || 0));
  };

  const fetchStudentNotifications = async () => {
    if (!user) return;
    setStudentNotifLoading(true);

    const [{ data: replies }, { data: notifs }] = await Promise.all([
      supabase.from('question_reports').select('*').eq('student_email', user.email).not('admin_reply', 'is', null).order('replied_at', { ascending: false }),
      supabase.from('notifications').select('*').order('created_at', { ascending: false })
    ]);

    const replyItems = (replies || []).map(r => ({
      kind: 'reply',
      id: `reply_${r.id}`,
      title: `${r.question_number}. Soru hakkındaki bildiriminize yanıt geldi`,
      message: r.admin_reply,
      originalMessage: r.message,
      date: r.replied_at || r.created_at
    }));
    const notifItems = (notifs || []).map(n => ({
      kind: 'announcement',
      id: `notif_${n.id}`,
      title: n.title,
      message: n.message,
      date: n.created_at
    }));

    const combined = [...replyItems, ...notifItems].sort((a, b) => new Date(b.date) - new Date(a.date));
    setStudentNotifItems(combined);
    setStudentNotifLoading(false);
  };

  const openStudentNotifs = async () => {
    setShowStudentNotifs(true);
    await fetchStudentNotifications();

    if (user) {
      await supabase.from('question_reports').update({ reply_seen: true }).eq('student_email', user.email).eq('reply_seen', false);
      localStorage.setItem('yt_notif_last_seen', new Date().toISOString());
    }
    setStudentUnreadCount(0);
  };

  const fetchAllRatings = async () => {
    const { data, error } = await supabase
      .from('public_exam_stats')
      .select('exam_id, rating')
      .gt('rating', 0);

    if (!error && data) {
      const map = {};
      const breakdown = {};
      data.forEach(item => {
        // Puan çoğu zaman alt sınava (child) ait olur, ama kartlarda üst paketin (parent)
        // puanı gösteriliyor. Bu yüzden alt sınav puanını üst paketin id'sine topluyoruz.
        const examInfo = exams.find(e => e.id === item.exam_id);
        const targetId = examInfo?.parentId || item.exam_id;

        if (!map[targetId]) {
          map[targetId] = { total: 0, count: 0 };
        }
        map[targetId].total += item.rating;
        map[targetId].count += 1;

        if (!breakdown[targetId]) {
          breakdown[targetId] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        }
        const star = Math.min(5, Math.max(1, Math.round(item.rating)));
        breakdown[targetId][star] += 1;
      });

      const formattedMap = {};
      Object.keys(map).forEach(id => {
        const avg = map[id].total / map[id].count;
        formattedMap[id] = {
          average: avg.toFixed(1).replace('.', ','),
          count: map[id].count.toLocaleString('tr-TR')
        };
      });
      setExamRatingsMap(formattedMap);
      setExamRatingBreakdownMap(breakdown);
    }
  };

  // Kaç öğrencinin bir içeriği tamamladığını (sosyal kanıt için) hesaplar.
  const fetchSolvedCounts = async () => {
    const { data, error } = await supabase
      .from('public_exam_stats')
      .select('exam_id, is_finished')
      .eq('is_finished', true);

    if (!error && data) {
      const map = {};
      data.forEach(item => {
        const examInfo = exams.find(e => e.id === item.exam_id);
        const targetId = examInfo?.parentId || item.exam_id;
        map[targetId] = (map[targetId] || 0) + 1;
      });
      setSolvedCountMap(map);
    }
  };

  // --- Kazanım Kaynakları (Ders Notu PDF + Video) ---
  // Bir YouTube URL'sini (izle/kısa/paylaş linki, hangi biçimde olursa
  // olsun) gömülebilir bir embed URL'ine çevirir. Tanınmayan bir video
  // servisi linkiyse null döner -- o durumda öğrenci tarafında "yeni
  // sekmede aç" davranışına düşülür.
  const getYoutubeEmbedUrl = (url) => {
    if (!url) return null;
    try {
      const u = new URL(url.trim());
      let videoId = null;
      if (u.hostname.includes('youtu.be')) {
        videoId = u.pathname.slice(1);
      } else if (u.hostname.includes('youtube.com')) {
        if (u.pathname === '/watch') videoId = u.searchParams.get('v');
        else if (u.pathname.startsWith('/shorts/')) videoId = u.pathname.split('/')[2];
        else if (u.pathname.startsWith('/embed/')) videoId = u.pathname.split('/')[2];
      }
      return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
    } catch {
      return null;
    }
  };

  const uploadKazanimPdf = async (learningOutcomeId, file) => {
    if (!file || !learningOutcomeId) return;
    setAuthLoading(true);
    const fileExt = file.name.split('.').pop();
    const fileName = `konu_${learningOutcomeId}_${Date.now()}.${fileExt}`;

    const { error: storageError } = await supabase.storage
      .from('kazanim-kaynaklari')
      .upload(fileName, file);

    if (storageError) {
      alert('Ders notu yüklenemedi: ' + storageError.message);
      setAuthLoading(false);
      return;
    }

    const { data: publicUrlData } = supabase.storage
      .from('kazanim-kaynaklari')
      .getPublicUrl(fileName);

    const { error: upsertError } = await supabase
      .from('learning_outcome_resources')
      .upsert([{
        learning_outcome_id: learningOutcomeId,
        pdf_url: publicUrlData.publicUrl,
        pdf_filename: file.name,
        updated_at: new Date().toISOString()
      }], { onConflict: 'learning_outcome_id' });

    setAuthLoading(false);
    if (upsertError) {
      alert('Ders notu kaydedilemedi: ' + upsertError.message);
      return;
    }

    setLearningOutcomeResources((prev) => ({
      ...prev,
      [learningOutcomeId]: { ...(prev[learningOutcomeId] || {}), learning_outcome_id: learningOutcomeId, pdf_url: publicUrlData.publicUrl, pdf_filename: file.name }
    }));
  };

  const removeKazanimPdf = async (learningOutcomeId) => {
    if (!window.confirm('Bu kazanımın ders notunu kaldırmak istediğinize emin misiniz?')) return;
    const { error } = await supabase
      .from('learning_outcome_resources')
      .upsert([{ learning_outcome_id: learningOutcomeId, pdf_url: null, pdf_filename: null, updated_at: new Date().toISOString() }], { onConflict: 'learning_outcome_id' });
    if (error) { alert('Kaldırılamadı: ' + error.message); return; }
    setLearningOutcomeResources((prev) => ({
      ...prev,
      [learningOutcomeId]: { ...(prev[learningOutcomeId] || {}), pdf_url: null, pdf_filename: null }
    }));
  };

  const saveKazanimVideoUrl = async (learningOutcomeId, url) => {
    const trimmed = (url || '').trim();
    const { error } = await supabase
      .from('learning_outcome_resources')
      .upsert([{ learning_outcome_id: learningOutcomeId, video_url: trimmed || null, updated_at: new Date().toISOString() }], { onConflict: 'learning_outcome_id' });
    if (error) { alert('Video linki kaydedilemedi: ' + error.message); return; }
    setLearningOutcomeResources((prev) => ({
      ...prev,
      [learningOutcomeId]: { ...(prev[learningOutcomeId] || {}), learning_outcome_id: learningOutcomeId, video_url: trimmed || null }
    }));
  };

  // "+ Yeni Kazanım Ekle" -- seçili Ders Türü'ne bağlı yeni bir kazanım oluşturur.
  // Bir kazanım artık doğrudan Ders Türü'ne değil, bir Konu'ya bağlanıyor.
  // lesson_category_id kolonunu da (geriye dönük uyumluluk ve "ders türü
  // sil" kademeli silme mantığı bozulmasın diye) topic üzerinden otomatik
  // dolduruyoruz.
  const handleAddLearningOutcome = async (topicId, name, onCreated) => {
    const trimmed = (name || '').trim();
    const topic = topics.find((t) => t.id === topicId);
    if (!trimmed || !topic) return;
    const { data, error } = await supabase
      .from('learning_outcomes')
      .insert([{ name: trimmed, topic_id: topicId, lesson_category_id: topic.lesson_category_id }])
      .select();
    if (error) {
      alert('Kazanım eklenemedi: ' + error.message);
      return;
    }
    const created = data[0];
    setLearningOutcomes((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, 'tr')));
    if (onCreated) onCreated(created);
  };

  // "+ Yeni Konu Ekle" -- seçili Ders Türü'ne bağlı yeni bir konu oluşturur.
  const addTopicForLessonCategoryId = async (lessonCategoryId, name, onCreated) => {
    const trimmed = (name || '').trim();
    if (!trimmed || !lessonCategoryId) {
      alert('Önce Ders Türü seçin.');
      return;
    }
    const { data, error } = await supabase
      .from('topics')
      .insert([{ name: trimmed, lesson_category_id: lessonCategoryId }])
      .select();
    if (error) {
      alert('Konu eklenemedi: ' + error.message);
      return;
    }
    const created = data[0];
    setTopics((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, 'tr')));
    if (onCreated) onCreated(created);
  };

  // Kazanım Haritası bölümünde "bu sınavın sınav türüne bağlı yeni bir ders
  // türü ekle" için kullanılan genel amaçlı yardımcı (exam oluşturma
  // formundaki handleAddLessonCategory'den bağımsız, çünkü orada
  // newExamForm state'i kullanılıyor, burada editingExam bağlamındayız).
  const addLessonCategoryForExamType = async (examTypeName, name, onCreated) => {
    const trimmed = (name || '').trim();
    const selectedExamCategory = examCategories.find((c) => c.name === examTypeName);
    if (!trimmed || !selectedExamCategory) {
      alert('Önce sınavın bir Sınav Türü kategorisi olmalı.');
      return;
    }
    const { data, error } = await supabase
      .from('lesson_categories')
      .insert([{ name: trimmed, exam_category_id: selectedExamCategory.id }])
      .select();
    if (error) {
      alert('Ders türü eklenemedi: ' + error.message);
      return;
    }
    const created = data[0];
    setLessonCategories((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, 'tr')));
    if (onCreated) onCreated(created);
  };

  // --- Kategori/Ders Türü/Kazanım listelerinden SİLME ---
  // ÖNEMLİ: Bu üç tablo (exam_categories, lesson_categories,
  // learning_outcomes) sadece dropdown'ları besleyen "ana liste"lerdir.
  // Sınavlarda (exams.category_exam_type / category_lesson) ve kazanım
  // haritasında (topicMap içindeki ders/kazanim) bu bilgi DÜZ METİN olarak
  // saklanıyor, foreign key ile bağlı değil. Yani buradan bir kayıt silmek,
  // daha önce o adla kaydedilmiş sınavları/kazanımları BOZMAZ -- sadece o
  // seçenek yeni seçimler için dropdown'dan kalkar. Alt kayıtları da (ders
  // türlerini ve kazanımları) elle sırayla siliyoruz ki veritabanındaki
  // foreign key kısıtı hataya sebep olmasın.
  const deleteLearningOutcome = async (id) => {
    const { error } = await supabase.from('learning_outcomes').delete().eq('id', id);
    if (error) { alert('Kazanım silinemedi: ' + error.message); return; }
    setLearningOutcomes((prev) => prev.filter((o) => o.id !== id));
  };

  const deleteTopic = async (id) => {
    const childOutcomeIds = learningOutcomes.filter((o) => o.topic_id === id).map((o) => o.id);
    if (childOutcomeIds.length > 0) {
      const { error: outcomeErr } = await supabase.from('learning_outcomes').delete().in('id', childOutcomeIds);
      if (outcomeErr) { alert('Konu silinemedi: ' + outcomeErr.message); return; }
    }
    const { error } = await supabase.from('topics').delete().eq('id', id);
    if (error) { alert('Konu silinemedi: ' + error.message); return; }
    setLearningOutcomes((prev) => prev.filter((o) => o.topic_id !== id));
    setTopics((prev) => prev.filter((t) => t.id !== id));
  };

  const deleteLessonCategory = async (id) => {
    const childOutcomeIds = learningOutcomes.filter((o) => o.lesson_category_id === id).map((o) => o.id);
    if (childOutcomeIds.length > 0) {
      const { error: outcomeErr } = await supabase.from('learning_outcomes').delete().in('id', childOutcomeIds);
      if (outcomeErr) { alert('Ders türü silinemedi: ' + outcomeErr.message); return; }
    }
    const { error } = await supabase.from('lesson_categories').delete().eq('id', id);
    if (error) { alert('Ders türü silinemedi: ' + error.message); return; }
    setLearningOutcomes((prev) => prev.filter((o) => o.lesson_category_id !== id));
    setTopics((prev) => prev.filter((t) => t.lesson_category_id !== id));
    setLessonCategories((prev) => prev.filter((lc) => lc.id !== id));
  };

  const deleteExamCategory = async (id) => {
    const childLessonIds = lessonCategories.filter((lc) => lc.exam_category_id === id).map((lc) => lc.id);
    if (childLessonIds.length > 0) {
      const { error: outcomeErr } = await supabase.from('learning_outcomes').delete().in('lesson_category_id', childLessonIds);
      if (outcomeErr) { alert('Sınav türü silinemedi: ' + outcomeErr.message); return; }
      const { error: lessonErr } = await supabase.from('lesson_categories').delete().in('id', childLessonIds);
      if (lessonErr) { alert('Sınav türü silinemedi: ' + lessonErr.message); return; }
    }
    const { error } = await supabase.from('exam_categories').delete().eq('id', id);
    if (error) { alert('Sınav türü silinemedi: ' + error.message); return; }
    setLearningOutcomes((prev) => prev.filter((o) => !childLessonIds.includes(o.lesson_category_id)));
    setTopics((prev) => prev.filter((t) => !childLessonIds.includes(t.lesson_category_id)));
    setLessonCategories((prev) => prev.filter((lc) => lc.exam_category_id !== id));
    setExamCategories((prev) => prev.filter((c) => c.id !== id));
  };

  // --- Kategori Yönetimi: ADI DÜZENLEME ---
  // ÖNEMLİ (bug fix): Bir Ders/Konu/Kazanım adı değiştirildiğinde, o adı
  // daha önce kullanan sorulardaki (topicMap içindeki düz metin) kayıt
  // GÜNCELLENMEZSE, o sorunun ilgili dropdown'ı artık hiçbir seçenekle
  // eşleşmediği için BOŞ görünür -- yani kazanım seçimi "kaybolmuş" gibi
  // olur (ve "Kaydet"e basılırsa gerçekten kaybolur). Bu yüzden bir isim
  // değiştirildiğinde, o ismi kullanan TÜM sınavlardaki TÜM sorularda
  // ilgili alanı da otomatik olarak yeni isme güncelliyoruz.
  const propagateCategoryRename = (field, oldName, newName) => {
    if (!oldName || oldName === newName) return;
    exams.forEach((ex) => {
      if (!ex.topicMap) return;
      const hasMatch = Object.values(ex.topicMap).some((entry) => entry[field] === oldName);
      if (!hasMatch) return;
      const newTopicMap = {};
      Object.entries(ex.topicMap).forEach(([soruNo, entry]) => {
        newTopicMap[soruNo] = entry[field] === oldName ? { ...entry, [field]: newName } : entry;
      });
      setExams((prev) => prev.map((e) => e.id === ex.id ? { ...e, topicMap: newTopicMap } : e));
      supabase.from('exams').update({ topic_map: newTopicMap }).eq('id', ex.id).then(({ error }) => {
        if (error) console.error(`"${ex.name}" sınavının kazanım haritası güncellenemedi:`, error);
      });
    });
  };

  // Sınav Türü adı, soru bazlı topicMap'te değil, doğrudan sınav paketinin
  // kendi "category_exam_type" alanında tutuluyor -- bu yüzden ayrı ele
  // alınıyor (üst düzey/parent sınavlar).
  const propagateExamTypeRename = (oldName, newName) => {
    if (!oldName || oldName === newName) return;
    exams.forEach((ex) => {
      if (ex.parentId || ex.categoryExamType !== oldName) return;
      setExams((prev) => prev.map((e) => e.id === ex.id ? { ...e, categoryExamType: newName } : e));
      supabase.from('exams').update({ category_exam_type: newName }).eq('id', ex.id).then(({ error }) => {
        if (error) console.error(`"${ex.name}" sınavının sınav türü güncellenemedi:`, error);
      });
    });
  };

  const renameExamCategory = async (id, currentName) => {
    const name = window.prompt('Sınav Türü adını düzenle:', currentName);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === currentName) return;
    const { error } = await supabase.from('exam_categories').update({ name: trimmed }).eq('id', id);
    if (error) { alert('Güncellenemedi: ' + error.message); return; }
    setExamCategories((prev) => prev.map((c) => c.id === id ? { ...c, name: trimmed } : c).sort((a, b) => a.name.localeCompare(b.name, 'tr')));
    propagateExamTypeRename(currentName, trimmed);
  };

  const renameLessonCategory = async (id, currentName) => {
    const name = window.prompt('Ders Türü adını düzenle:', currentName);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === currentName) return;
    const { error } = await supabase.from('lesson_categories').update({ name: trimmed }).eq('id', id);
    if (error) { alert('Güncellenemedi: ' + error.message); return; }
    setLessonCategories((prev) => prev.map((lc) => lc.id === id ? { ...lc, name: trimmed } : lc).sort((a, b) => a.name.localeCompare(b.name, 'tr')));
    propagateCategoryRename('ders', currentName, trimmed);
  };

  const renameTopic = async (id, currentName) => {
    const name = window.prompt('Konu adını düzenle:', currentName);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === currentName) return;
    const { error } = await supabase.from('topics').update({ name: trimmed }).eq('id', id);
    if (error) { alert('Güncellenemedi: ' + error.message); return; }
    setTopics((prev) => prev.map((t) => t.id === id ? { ...t, name: trimmed } : t).sort((a, b) => a.name.localeCompare(b.name, 'tr')));
    propagateCategoryRename('konu', currentName, trimmed);
  };

  const renameLearningOutcome = async (id, currentName) => {
    const name = window.prompt('Kazanım adını düzenle:', currentName);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === currentName) return;
    const { error } = await supabase.from('learning_outcomes').update({ name: trimmed }).eq('id', id);
    if (error) { alert('Güncellenemedi: ' + error.message); return; }
    setLearningOutcomes((prev) => prev.map((o) => o.id === id ? { ...o, name: trimmed } : o).sort((a, b) => a.name.localeCompare(b.name, 'tr')));
    propagateCategoryRename('kazanim', currentName, trimmed);
  };

  // --- Kategori Yönetimi: SİLMEDEN ÖNCE "kullanımda mı" KONTROLÜ ---
  // Bir Sınav Türü / Ders Türü / Konu / Kazanım, herhangi bir sınavın
  // Kazanım Haritası'nda (topicMap) bir SORUYA atanmışsa -- ya da (sadece
  // Sınav Türü için) doğrudan bir sınavın "Sınav Türü" alanına atanmışsa --
  // silinmesine İZİN VERMİYORUZ. Aksi halde o soru dersiz/konusuz/kazanımsız
  // kalırdı. "level" silinecek şeyin türünü belirtir; alt kademedeki (Ders
  // silinirken ona bağlı Konu/Kazanım'lar da; Konu silinirken ona bağlı
  // Kazanım'lar da) kullanım kontrolü otomatik olarak dahil edilir, çünkü bu
  // kayıtlar zaten kademeli olarak birlikte silinecek.
  const getCategoryUsageHits = (level, item) => {
    let dersNames = [];
    let konuNames = [];
    let kazanimNames = [];

    if (level === 'exam') {
      const childLessons = lessonCategories.filter((lc) => lc.exam_category_id === item.id);
      dersNames = childLessons.map((lc) => lc.name);
      const childLessonIds = childLessons.map((lc) => lc.id);
      konuNames = topics.filter((t) => childLessonIds.includes(t.lesson_category_id)).map((t) => t.name);
      kazanimNames = learningOutcomes.filter((o) => childLessonIds.includes(o.lesson_category_id)).map((o) => o.name);
    } else if (level === 'lesson') {
      dersNames = [item.name];
      konuNames = topics.filter((t) => t.lesson_category_id === item.id).map((t) => t.name);
      kazanimNames = learningOutcomes.filter((o) => o.lesson_category_id === item.id).map((o) => o.name);
    } else if (level === 'topic') {
      konuNames = [item.name];
      kazanimNames = learningOutcomes.filter((o) => o.topic_id === item.id).map((o) => o.name);
    } else if (level === 'outcome') {
      kazanimNames = [item.name];
    }

    const hits = [];
    exams.forEach((ex) => {
      if (ex.topicMap) {
        Object.entries(ex.topicMap).forEach(([soruNo, entry]) => {
          const usesDers = dersNames.length > 0 && dersNames.includes(entry.ders);
          const usesKonu = konuNames.length > 0 && konuNames.includes(entry.konu);
          const usesKazanim = kazanimNames.length > 0 && kazanimNames.includes(entry.kazanim);
          if (usesDers || usesKonu || usesKazanim) {
            hits.push({ examName: ex.name || 'İsimsiz test', soruNo, type: 'soru' });
          }
        });
      }
      if (level === 'exam' && !ex.parentId && ex.categoryExamType === item.name) {
        hits.push({ examName: ex.name || 'İsimsiz içerik', soruNo: null, type: 'sinav' });
      }
    });
    return hits;
  };

  // Kullanım varsa açıklayıcı bir uyarı gösterip true döner (silme işlemi bu
  // durumda İPTAL edilmeli); kullanım yoksa false döner (silmeye devam
  // edilebilir).
  const blockDeleteIfInUse = (level, item, label) => {
    const hits = getCategoryUsageHits(level, item);
    if (hits.length === 0) return false;
    const preview = hits.slice(0, 6).map((h) =>
      h.type === 'sinav' ? `• ${h.examName} (sınav türü olarak atanmış)` : `• ${h.examName} — Soru ${h.soruNo}`
    ).join('\n');
    const more = hits.length > 6 ? `\n...ve ${hits.length - 6} kayıt daha` : '';
    alert(
      `"${label}" şu anda kullanımda olduğu için silinemez:\n\n${preview}${more}\n\n` +
      `Önce Kazanım Haritası'ndan bu soru(ları) düzenleyip başka bir kazanıma taşıyın ` +
      `(ya da soruyu haritadan kaldırın), sonra tekrar deneyin.`
    );
    return true;
  };

  const fetchPricingSettings = async () => {
    const { data, error } = await supabase
      .from('pricing_settings')
      .select('price_per_question')
      .eq('id', 1)
      .maybeSingle();
    if (!error && data) {
      setPricePerQuestion(Number(data.price_per_question) || 0);
      setPricePerQuestionConfigured(true);
    } else if (error) {
      console.error('Soru başı fiyat ayarı okunamadı:', error);
    }
  };

  const savePricePerQuestion = async (newValue) => {
    const parsed = Number(newValue);
    if (Number.isNaN(parsed) || parsed < 0) {
      alert('Geçerli bir tutar girin (0 veya üzeri).');
      return;
    }
    const { error } = await supabase
      .from('pricing_settings')
      .upsert({ id: 1, price_per_question: parsed });
    if (error) {
      alert(
        'Kaydedilemedi: ' + error.message +
        '\n\n"pricing_settings" tablosu veritabanında henüz yoksa, önce onu oluşturmak gerekir (id int8 PK, price_per_question numeric).'
      );
      return;
    }
    setPricePerQuestion(parsed);
    setPricePerQuestionConfigured(true);
    setShowPricingSettings(false);
  };

  // Soru sayısı her değiştiğinde (elle ya da PDF'ten otomatik algılanarak),
  // Fiyat VE Eski Fiyat'ı "soru sayısı x soru başı fiyat" olarak YENİDEN
  // hesaplayıp üzerine yazar -- daha önce girilmiş manuel bir indirim varsa
  // bile (admin ile konuşulup onaylanan davranış budur). Soru başı fiyat
  // HİÇ AYARLANMAMIŞSA (pricePerQuestionConfigured false), fiyatlara hiç
  // dokunmuyoruz -- aksi halde daha admin panelden hiçbir katsayı
  // girilmemişken tüm fiyatlar sessizce 0'a düşerdi. Ama admin BİLEREK 0
  // girip kaydettiyse (pricePerQuestionConfigured true, pricePerQuestion 0),
  // bunu geçerli bir hesaplama olarak uyguluyoruz -- yani "bugün her şeyi
  // ücretsiz yap" isteniyorsa gerçekten 0'a çekiyoruz.
  const applyNumPagesWithAutoPrice = (examId, numPagesValue) => {
    const n = Number(numPagesValue) || 0;
    const exam = exams.find((e) => e.id === examId);
    if (pricePerQuestionConfigured) {
      const computedPrice = Number((n * pricePerQuestion).toFixed(2));
      updateExamInDb(examId, { numPages: n, price: computedPrice, originalPrice: computedPrice });
      // Bu bir ALT TEST ise, üst paketin (ana ürün) fiyatını da -- tüm
      // kardeş testlerin YENİ toplam soru sayısına göre -- hemen
      // güncelliyoruz. Aksi halde paket fiyatı, siz "Güncel Fiyata Göre
      // Tüm Testleri Yeniden Hesapla"yı elle çalıştırana kadar eski kalırdı.
      if (exam && exam.parentId) {
        const siblings = exams.filter((c) => c.parentId === exam.parentId);
        const newTotal = siblings.reduce((sum, c) => sum + (c.id === examId ? n : (c.numPages || 0)), 0);
        const parentPrice = Number((newTotal * pricePerQuestion).toFixed(2));
        updateExamInDb(exam.parentId, { price: parentPrice, originalPrice: parentPrice });
      }
    } else {
      updateExamInDb(examId, { numPages: n });
    }
  };

  // "Soru Başı Fiyat" penceresindeki "Tüm Testleri Yeniden Hesapla" butonu
  // için: mevcut TÜM testlerin/paketlerin Fiyat ve Eski Fiyat'ını, güncel
  // soru başı tutara göre yeniden hesaplar. Sadece yeni oluşturulan/soru
  // sayısı değiştirilen testler için değil, sistemde zaten var olan ve hiç
  // dokunulmamış testler için de -- hem bu özelliği ilk kurarken hem de
  // birim fiyatı SONRADAN artırdığınızda tekrar tekrar kullanılabilir.
  // Daha önce elle girilmiş fiyatlar (₺0 bırakılmış "pakete bağlı" alt
  // testler dahil) üzerine yazılır.
  const recalculateAllExamPrices = async () => {
    if (!pricePerQuestionConfigured) {
      alert('Önce soru başı bir tutar girip kaydedin.');
      return;
    }
    // Alt testler: kendi soru sayılarına göre.
    const childTargets = exams.filter((e) => e.parentId && (e.numPages || 0) > 0);

    // Üst ürünler (paketler): kendi numPages'i genelde 0'dır (paketin
    // "soru sayısı" kavramı yoktur) -- bu yüzden paket fiyatı, ALTINDAKİ
    // TÜM testlerin soru sayısı TOPLAMINA göre hesaplanır. Hiç alt testi
    // olmayan (tek başına/standalone) bir üst ürün varsa, o zaman kendi
    // numPages'i kullanılır.
    const parentExams = exams.filter((e) => !e.parentId);
    const parentTargets = parentExams
      .map((p) => {
        const children = exams.filter((c) => c.parentId === p.id);
        const totalQuestions = children.length > 0
          ? children.reduce((sum, c) => sum + (c.numPages || 0), 0)
          : (p.numPages || 0);
        return { exam: p, totalQuestions };
      })
      .filter((x) => x.totalQuestions > 0);

    const totalCount = childTargets.length + parentTargets.length;
    if (totalCount === 0) {
      alert('Soru sayısı girilmiş hiçbir test/paket bulunamadı.');
      return;
    }
    const confirmed = window.confirm(
      `${totalCount} test/paketin (paketler, altındaki testlerin TOPLAM soru sayısına göre) Fiyat ve Eski Fiyat'ı, güncel soru başı tutar (₺${pricePerQuestion}) ile yeniden hesaplanacak -- daha önce elle girilmiş fiyatlar (indirimler ve ₺0 bırakılmış pakete-bağlı alt testler dahil) üzerine yazılacak. Devam edilsin mi?`
    );
    if (!confirmed) return;
    for (const ex of childTargets) {
      const computedPrice = Number(((ex.numPages || 0) * pricePerQuestion).toFixed(2));
      await updateExamInDb(ex.id, { price: computedPrice, originalPrice: computedPrice });
    }
    for (const { exam, totalQuestions } of parentTargets) {
      const computedPrice = Number((totalQuestions * pricePerQuestion).toFixed(2));
      await updateExamInDb(exam.id, { price: computedPrice, originalPrice: computedPrice });
    }
    alert(`✓ ${totalCount} test/paketin fiyatı güncellendi.`);
  };

  const checkUserRoleAndSetMode = (currentUser) => {
    if (currentUser.email === 'admin@yayinevi.com') {
      setAppMode('admin');
      fetchPricingSettings();
    } else {
      setAppMode('student');
      ensureAndFetchStudentBalance();
      // Fatura bilgisini giriş anında çekiyoruz (sadece "Sınavlarım"
      // sayfasını açtığında değil) -- ödeme akışındaki zorunlu fatura
      // bilgisi kontrolü (bkz. handleIyzicoPayment/handleCartCheckout),
      // öğrenci daha o sayfayı hiç açmadan direkt ödemeye geçse bile
      // doğru çalışsın diye.
      fetchMyBillingInfo(currentUser.email);
    }
    // ÖNEMLİ: Bu listeler (Ders/Konu/Kazanım adları) sadece admin panelinde
    // DEĞİL, öğrenci sonuç ekranındaki Kazanım Analizi'nde de kullanılıyor
    // (bkz. resolveLiveKonuForEntry / getKazanimReport) -- bir kazanımın
    // Konu'su Kategori Yönetimi'nden değiştirildiğinde bunun öğrenci
    // tarafında da güncel görünmesi için bu listelerin öğrenci girişinde de
    // yüklenmesi şart. Eskiden sadece admin girişinde çağrılıyordu, bu
    // yüzden öğrenci tarafında hep boş kalıp donmuş/eski metne (ör. "Genel")
    // düşülüyordu.
    fetchCategoryLists();
    fetchExams(currentUser);
    fetchUserPurchases(currentUser.email);
  };

  // Sınav Türü ve Ders Türü'nün sabit (master) listelerini çeker.
  // Ders Türü, hangi Sınav Türü'ne ait olduğunu bilsin diye exam_categories
  // ile join'lenerek çekiliyor -- böylece "KPSS · Tarih" ile "TYT · Tarih"
  // ayrı, birbirinden bağımsız kayıtlar olarak kalıyor.
  const fetchCategoryLists = async () => {
    const { data: examCats, error: examCatsError } = await supabase
      .from('exam_categories')
      .select('id, name')
      .order('name');
    if (!examCatsError && examCats) setExamCategories(examCats);
    else if (examCatsError) console.error('exam_categories okunamadı:', examCatsError);

    const { data: lessonCats, error: lessonCatsError } = await supabase
      .from('lesson_categories')
      .select('id, name, exam_category_id')
      .order('name');
    if (!lessonCatsError && lessonCats) setLessonCategories(lessonCats);
    else if (lessonCatsError) console.error('lesson_categories okunamadı:', lessonCatsError);

    const { data: topicRows, error: topicRowsError } = await supabase
      .from('topics')
      .select('id, name, lesson_category_id')
      .order('name');
    if (!topicRowsError && topicRows) setTopics(topicRows);
    else if (topicRowsError) console.error('topics okunamadı:', topicRowsError);

    const { data: outcomes, error: outcomesError } = await supabase
      .from('learning_outcomes')
      .select('id, name, lesson_category_id, topic_id')
      .order('name');
    if (!outcomesError && outcomes) setLearningOutcomes(outcomes);
    else if (outcomesError) console.error('learning_outcomes okunamadı:', outcomesError);

    // Riskli kazanımların altında gösterilen ders notu (PDF) / video kaynakları.
    const { data: resourceRows, error: resourcesError } = await supabase
      .from('learning_outcome_resources')
      .select('learning_outcome_id, pdf_url, pdf_filename, video_url');
    if (!resourcesError && resourceRows) {
      const map = {};
      resourceRows.forEach((r) => { map[r.learning_outcome_id] = r; });
      setLearningOutcomeResources(map);
    } else if (resourcesError) console.error('learning_outcome_resources okunamadı:', resourcesError);
  };

  // "+ Yeni Sınav Türü Ekle" -- yeni bir kayıt oluşturur, listeye ekler ve
  // formda otomatik seçili hale getirir.
  const handleAddExamCategory = async () => {
    const trimmed = newExamCategoryName.trim();
    if (!trimmed) return;
    const { data, error } = await supabase
      .from('exam_categories')
      .insert([{ name: trimmed }])
      .select();
    if (error) {
      alert('Sınav türü eklenemedi: ' + error.message);
      return;
    }
    const created = data[0];
    setExamCategories((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, 'tr')));
    setNewExamForm((prev) => ({ ...prev, categoryExamType: created.name }));
    setNewExamCategoryName('');
    setShowNewExamCategoryInput(false);
  };

  // "+ Yeni Ders Türü Ekle" -- seçili Sınav Türü'ne bağlı yeni bir ders
  // türü oluşturur.
  const handleAddLessonCategory = async () => {
    const trimmed = newLessonCategoryName.trim();
    const selectedExamCategory = examCategories.find((c) => c.name === newExamForm.categoryExamType);
    if (!trimmed || !selectedExamCategory) return;
    const { data, error } = await supabase
      .from('lesson_categories')
      .insert([{ name: trimmed, exam_category_id: selectedExamCategory.id }])
      .select();
    if (error) {
      alert('Ders türü eklenemedi: ' + error.message);
      return;
    }
    const created = data[0];
    setLessonCategories((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, 'tr')));
    setNewExamForm((prev) => ({ ...prev, categoryLesson: created.name }));
    setNewLessonCategoryName('');
    setShowNewLessonCategoryInput(false);
  };

  const fetchUserPurchases = async (userEmail) => {
    const { data, error } = await supabase
      .from('student_purchases')
      .select('exam_id')
      .eq('student_email', userEmail);

    if (!error && data) {
      const purchasedMap = {};
      data.forEach(p => {
        purchasedMap[p.exam_id] = true;
      });
      setStudentPurchases(purchasedMap);
      return purchasedMap;
    }
    return {};
  };

  // Öğrencinin bakiyesini (hediye bakiye dahil) çeker. İlk kez giriş
  // yapıyorsa (henüz hiç bakiye kaydı yoksa), sunucu tarafındaki endpoint
  // admin panelinde ayarlanmış tutarı OTOMATİK olarak bir kereliğine
  // tanımlar -- bu yüzden bu fonksiyon her girişte çağrılsa bile güvenli
  // (idempotent). Tutar asla client'ta hesaplanmıyor/varsayılmıyor, her
  // zaman sunucudan geldiği gibi gösteriliyor.
  const ensureAndFetchStudentBalance = async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) return;
      const resp = await fetch('/api/ensure-signup-bonus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const result = await resp.json();
      if (resp.ok) {
        setStudentBalance(Number(result.balance) || 0);
      } else {
        console.error('Bakiye alınamadı:', result.error);
      }
    } catch (err) {
      console.error('Bakiye alınamadı:', err);
    }
  };

  const formatExamData = (item) => ({
    id: item.id,
    name: item.name,
    duration: item.duration,
    examType: item.exam_type || 'deneme',
    categoryExamType: item.category_exam_type || 'Genel',
    categoryLesson: item.category_lesson || 'Genel',
    pdfFile: item.pdf_file,
    solutionPdfFile: item.solution_pdf_file,
    // Güvenlik: answer_key artık genel sınav sorgusuyla hiç çekilmiyor
    // (bkz. EXAM_PUBLIC_COLUMNS), o yüzden burada her zaman boş başlıyor.
    // Sadece admin (kendi RLS yetkisiyle, fetchAndMergeAnswerKeys) veya
    // sınavı bitirmiş/erişimi olan öğrenci (sunucu API'si üzerinden,
    // saveAndFinishExam / fetchAnswerKeyForReview) bu alanı sonradan doldurur.
    answerKey: {},
    sections: item.sections || [],
    isPublished: item.is_published,
    numPages: item.num_pages || 0,
    price: item.price || 0,
    originalPrice: item.original_price || 0,
    isParent: item.is_parent || false,
    parentId: item.parent_id || null,
    sortOrder: item.sort_order ?? 0,
    topicMap: item.topic_map || {},
    description: item.description || '',
    campaignEndsAt: item.campaign_ends_at || null
  });

  // Güvenlik: answer_key sütununu KASITLI olarak bu listeye eklemiyoruz.
  // select('*') kullanırsak cevap anahtarı, sınavı satın almayan/bitirmeyen
  // herkesin tarayıcısına (Network sekmesinden okunabilir şekilde) gider.
  const EXAM_PUBLIC_COLUMNS = 'id,name,duration,exam_type,category_exam_type,category_lesson,pdf_file,solution_pdf_file,sections,is_published,num_pages,price,original_price,is_parent,parent_id,sort_order,topic_map,campaign_ends_at,description,created_at';

  // Hiç giriş yapmamış (anonim) ziyaretçiye gösterilen liste için ayrı bir
  // sütun seti: solution_pdf_file burada YOK. Anonim bir ziyaretçinin zaten
  // bitirdiği bir sınav olamaz, bu yüzden çözüm dosyasının yolunun ona
  // gönderilmesinin hiçbir işlevsel faydası yok -- gereksiz bilgi sızıntısı.
  // Giriş yapmış kullanıcı akışı ("Çözümü Gör" butonu solutionPdfFile'ın
  // varlığına bakıyor) yukarıdaki EXAM_PUBLIC_COLUMNS'u kullanmaya devam
  // ediyor, ona dokunmuyoruz.
  const EXAM_ANONYMOUS_COLUMNS = 'id,name,duration,exam_type,category_exam_type,category_lesson,pdf_file,sections,is_published,num_pages,price,original_price,is_parent,parent_id,sort_order,topic_map,campaign_ends_at,description,created_at';

  const fetchPublicExams = async () => {
    const { data, error } = await supabase
      .from('exams')
      .select(EXAM_ANONYMOUS_COLUMNS)
      .eq('is_published', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error("Sınavlar yüklenirken hata oluştu:", error);
    } else {
      setExams(data.map(formatExamData));
    }
  };

  const fetchExams = async (currentUser = user) => {
    const query = supabase.from('exams').select(EXAM_PUBLIC_COLUMNS).order('created_at', { ascending: false });
    if (!currentUser || currentUser.email !== 'admin@yayinevi.com') {
      query.eq('is_published', true);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Sınavlar yüklenirken hata oluştu:", error);
    } else {
      setExams(data.map(formatExamData));
    }

    if (currentUser && currentUser.email !== 'admin@yayinevi.com') {
      const { data: resultsData, error: resError } = await supabase
        .from('student_exams')
        .select('*')
        .eq('student_email', currentUser.email);

      if (resError) {
        console.error("Öğrenci sonuçları çekilemedi:", resError);
      } else if (resultsData) {
        const resultMap = {};
        resultsData.forEach(res => {
          resultMap[res.exam_id] = {
            is_finished: res.is_finished,
            answers: res.answers || {},
            correct: res.correct_count,
            wrong: res.wrong_count,
            empty: res.empty_count,
            net: res.net,
            rating: res.rating || 0,
            reviewText: res.review_text || '',
            timeLeft: res.time_left ?? null,
            currentPage: res.current_page ?? null,
            reset_count: res.reset_count || 0
          };
        });
        setStudentResultsMap(resultMap);
      }
    }
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    if (authMode === 'register' && password.length < 6) {
      alert("Şifre en az 6 haneli olmalıdır.");
      return;
    }
    setAuthLoading(true);

    if (authMode === 'register') {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        alert("Kayıt hatası: " + error.message);
      } else {
        alert("Kayıt başarılı! Lütfen e-postanızı kontrol edin veya giriş yapın.");
        setAuthMode('login');
      }
    } else if (authMode === 'login') {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        alert("Giriş hatası: " + error.message);
      } else {
        setUser(data.user);
        checkUserRoleAndSetMode(data.user);
        setShowAuthModal(false);
      }
    } else if (authMode === 'forgot') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (error) {
        alert("Şifre sıfırlama hatası: " + error.message);
      } else {
        alert("Şifre sıfırlama bağlantısı e-posta adresinize gönderildi.");
        setAuthMode('login');
      }
    }
    setAuthLoading(false);
  };

  const handleGoogleSignIn = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    });
    if (error) {
      alert("Google ile giriş başlatılamadı: " + error.message);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordChangeMessage(null);

    if (newPasswordInput.length < 6) {
      setPasswordChangeMessage({ type: 'error', text: 'Şifre en az 6 karakter olmalı.' });
      return;
    }
    if (newPasswordInput !== confirmPasswordInput) {
      setPasswordChangeMessage({ type: 'error', text: 'Şifreler birbiriyle eşleşmiyor.' });
      return;
    }

    setPasswordChangeLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPasswordInput });
    setPasswordChangeLoading(false);

    if (error) {
      setPasswordChangeMessage({ type: 'error', text: error.message });
    } else {
      setPasswordChangeMessage({ type: 'success', text: '✓ Şifreniz başarıyla güncellendi.' });
      setNewPasswordInput('');
      setConfirmPasswordInput('');
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setAppMode('student');
    setActiveAdminExamId(null);
    setActiveSubExamId(null);
    setIsCreatingExam(false);
    setActiveStudentExamId(null);
    setInspectingExamId(null);
    setShowAccountPage(false);
    setStudentResultsMap({});
    setStudentPurchases({});
    setStudentBalance(null);
    fetchPublicExams();
  };

  const updateExamInDb = async (id, updates) => {
    setExams((prev) => prev.map(ex => ex.id === id ? { ...ex, ...updates } : ex));

    const dbUpdates = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.duration !== undefined) dbUpdates.duration = updates.duration;
    if (updates.examType !== undefined) dbUpdates.exam_type = updates.examType;
    if (updates.categoryExamType !== undefined) dbUpdates.category_exam_type = updates.categoryExamType;
    if (updates.categoryLesson !== undefined) dbUpdates.category_lesson = updates.categoryLesson;
    if (updates.pdfFile !== undefined) dbUpdates.pdf_file = updates.pdfFile;
    if (updates.solutionPdfFile !== undefined) dbUpdates.solution_pdf_file = updates.solutionPdfFile;
    if (updates.sections !== undefined) dbUpdates.sections = updates.sections;
    if (updates.isPublished !== undefined) dbUpdates.is_published = updates.isPublished;
    if (updates.numPages !== undefined) dbUpdates.num_pages = updates.numPages;
    if (updates.price !== undefined) dbUpdates.price = updates.price;
    if (updates.originalPrice !== undefined) dbUpdates.original_price = updates.originalPrice;
    if (updates.description !== undefined) dbUpdates.description = updates.description;

    const { error } = await supabase
      .from('exams')
      .update(dbUpdates)
      .eq('id', id);

    if (error) {
      console.error("Güncelleme hatası:", error);
    }
  };

  // Cevap anahtarını artık ayrı bir tabloya (exam_answer_keys) yazıyoruz,
  // exams tablosuna değil — bu sayede genel sınav sorgusu hiçbir zaman
  // cevap anahtarını içermiyor.
  const updateAnswerKeyInDb = async (examId, newKey) => {
    setExams((prev) => prev.map(ex => ex.id === examId ? { ...ex, answerKey: newKey } : ex));
    const { error } = await supabase
      .from('exam_answer_keys')
      .upsert([{ exam_id: examId, answer_key: newKey }], { onConflict: 'exam_id' });
    if (error) {
      console.error("Cevap anahtarı kaydedilemedi:", error);
      alert("Cevap anahtarı kaydedilemedi: " + error.message);
    }
  };

  // Kazanım haritası güncellemesini ayrı tutuyoruz ki topic_map kolonu
  // henüz eklenmemişse diğer alanların kaydedilmesini etkilemesin.
  const updateTopicMapInDb = async (id, newTopicMap) => {
    // ÖNEMLİ (bug fix): Önceden burada state ÖNCE iyimser (kayıt başarılı
    // olacakmış gibi) güncelleniyordu, kayıt gerçekten başarısız olsa bile
    // ekranda geri alınmıyordu -- yani "✓ Kazanım" görünüp veritabanında
    // aslında eksik/eski veri kalabiliyordu. Şimdi önce eski değeri saklayıp,
    // kayıt BAŞARISIZ olursa ekranı o eski haline geri döndürüyoruz; başarılı
    // olursa zaten yeni değerde kalır. Ayrıca çağıran tarafın (ör. "kopyalandı"
    // mesajı) gerçek sonucu bilebilmesi için başarı/başarısızlık bilgisini
    // (true/false) geri döndürüyoruz.
    let previousTopicMap;
    setExams((prev) => prev.map(ex => {
      if (ex.id !== id) return ex;
      previousTopicMap = ex.topicMap;
      return { ...ex, topicMap: newTopicMap };
    }));
    const { error } = await supabase
      .from('exams')
      .update({ topic_map: newTopicMap })
      .eq('id', id);
    if (error) {
      console.error("Kazanım haritası kaydedilemedi (topic_map kolonu eksik olabilir):", error);
      setExams((prev) => prev.map(ex => ex.id === id ? { ...ex, topicMap: previousTopicMap } : ex));
      alert("Kazanım haritası kaydedilemedi, değişiklik ekrana yansıtılmadı. Veritabanına 'topic_map' kolonu eklenmiş mi kontrol edin ve tekrar deneyin.");
      return false;
    }
    return true;
  };

  // ÖNEMLİ (bug fix): Kazanım tablosundaki tek bir satırı güncellerken
  // ("Ders"/"Kazanım" seç, "+ Yeni Kazanım Ekle" vb.) topicMap'i doğrudan
  // o anki `editingExam.topicMap` üzerinden (closure ile) alıp spread
  // etmek yerine, React'in FONKSİYONEL state güncellemesini kullanıyoruz.
  // Neden: "+ Yeni Kazanım Ekle" / "+ Yeni Ders Türü Ekle" sunucuya istek
  // atıp cevap bekliyor (async). Kullanıcı bu bekleme sırasında başka
  // satırları doldurmaya devam ederse, closure'daki topicMap ARTIK BAYAT
  // (stale) olur; istek sonuçlandığında o eski haritanın üzerine tek
  // alanı ekleyip yazmak, aradaki tüm yeni girdileri SİLERDİ. Fonksiyonel
  // güncelleme her zaman state'in O ANKİ en güncel halini (`prev`) kullanır,
  // bu yüzden hiçbir girdi kaybolmaz.
  const applyTopicMapPatch = (examId, patchFn, { persist = false } = {}) => {
    let previousTopicMap;
    setExams((prev) => {
      const next = prev.map((ex) => {
        if (ex.id !== examId) return ex;
        previousTopicMap = ex.topicMap || {};
        return { ...ex, topicMap: patchFn(ex.topicMap || {}) };
      });
      if (persist) {
        const updatedExam = next.find((ex) => ex.id === examId);
        if (updatedExam) {
          supabase
            .from('exams')
            .update({ topic_map: updatedExam.topicMap })
            .eq('id', examId)
            .then(({ error }) => {
              if (error) {
                console.error("Kazanım haritası kaydedilemedi (topic_map kolonu eksik olabilir):", error);
                // ÖNEMLİ (bug fix): Kayıt başarısız olduysa ekranı bu
                // değişiklikten ÖNCEKİ haline geri döndürüyoruz -- aksi halde
                // ekranda "girilmiş" görünen ama veritabanına hiç yazılmamış
                // bir satır kalır, bu da listede yanlışlıkla "✓ Kazanım" gibi
                // görünmesine sebep olur.
                setExams((p2) => p2.map((ex) => ex.id === examId ? { ...ex, topicMap: previousTopicMap } : ex));
                alert("Kazanım haritası kaydedilemedi, bu değişiklik geri alındı. Lütfen tekrar deneyin.");
              }
            });
        }
      }
      return next;
    });
  };

  // Sıralama güncellemesini ayrı tutuyoruz ki sort_order kolonu
  // henüz eklenmemişse diğer alanların kaydedilmesini etkilemesin.
  const updateSortOrderInDb = async (id, newOrder) => {
    setExams((prev) => prev.map(ex => ex.id === id ? { ...ex, sortOrder: newOrder } : ex));
    const { error } = await supabase
      .from('exams')
      .update({ sort_order: newOrder })
      .eq('id', id);
    if (error) {
      console.error("Sıralama güncellenemedi (sort_order kolonu eksik olabilir):", error);
    }
  };

  const handleMoveSubTest = (childExamsSorted, examId, direction) => {
    const currentIndex = childExamsSorted.findIndex(e => e.id === examId);
    if (currentIndex === -1) return;
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= childExamsSorted.length) return;

    const reordered = [...childExamsSorted];
    [reordered[currentIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[currentIndex]];

    reordered.forEach((ex, i) => {
      updateSortOrderInDb(ex.id, i);
    });
  };

  const activeStudentExam = exams.find(e => e.id === activeStudentExamId);

  // PDF'te 1'den başlayan mutlak sayfa numarasını, sınavın Bölümler
  // ayarına göre öğrencinin GÖRDÜĞÜ soru numarasına çevirir (ör. mutlak
  // sayfa 120 ama "Genel Kültür" bölümünde 61-120 aralığındaysa -> 60.
  // Soru paletinde/başlıkta ne yazıyorsa, çözüm ekranında da AYNI numara
  // görünmeli -- bu yüzden ikisi de bu tek fonksiyonu kullanıyor.
  const getDisplayQuestionLabel = (exam, absolutePage) => {
    const secs = (exam && exam.sections) || [];
    const sec = secs.find(s => absolutePage >= s.start && absolutePage <= s.end);
    if (sec) {
      return { number: absolutePage - sec.start + 1, sectionName: sec.name };
    }
    return { number: absolutePage, sectionName: null };
  };

  
  useEffect(() => {
    if (user && appMode === 'student' && activeStudentExam && !isExamFinished && !showResults && !isPaused) {
      const timer = setInterval(() => {
        if (activeStudentExam.examType === 'deneme') {
          setTimeLeft((prev) => {
            if (prev <= 1) {
              clearInterval(timer);
              saveAndFinishExam(0);
              alert("Süre doldu! Sınavınız otomatik olarak tamamlanmıştır.");
              return 0;
            }
            return prev - 1;
          });
        } else {
          setTimeLeft((prev) => prev + 1);
        }
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [user, appMode, activeStudentExam, isExamFinished, showResults, isPaused]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Kampanya bitişine kalan süreyi "X gün Y saat" biçiminde döndürür; süre geçmişse null.
  const getCampaignCountdown = (exam) => {
    if (!exam.campaignEndsAt) return null;
    const end = new Date(exam.campaignEndsAt).getTime();
    const diff = end - Date.now();
    if (diff <= 0) return null;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (days > 0) return `${days} gün ${hours} saat kaldı`;
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours} saat ${mins} dk kaldı`;
  };

  const handleStartCreateExam = () => {
    setNewExamForm({
      name: '',
      duration: '',
      examType: 'deneme',
      categoryExamType: '',
      categoryLesson: '',
      price: 0,
      originalPrice: 0,
      isParent: true,
      answerKey: {},
      sections: [],
      numPages: 0,
      description: ''
    });
    setIsCreatingExam(true);
    setActiveAdminExamId(null);
    setActiveSubExamId(null);
  };

  const handleSaveNewExam = async () => {
    setAuthLoading(true);

    if (activeAdminExamId) {
      // Mevcut bir sınavın ayarlarını güncelliyoruz
      await updateExamInDb(activeAdminExamId, {
        name: newExamForm.name,
        duration: Number(newExamForm.duration) || 0,
        examType: newExamForm.examType,
        categoryExamType: newExamForm.categoryExamType,
        categoryLesson: newExamForm.categoryLesson,
        price: Number(newExamForm.price) || 0,
        originalPrice: Number(newExamForm.originalPrice) || 0,
        description: newExamForm.description || ''
      });
      setAuthLoading(false);
      setIsCreatingExam(false);
      setActiveAdminExamId(null);
      return;
    }

    const newExamData = {
      name: newExamForm.name,
      duration: Number(newExamForm.duration) || 0,
      exam_type: newExamForm.examType,
      category_exam_type: newExamForm.categoryExamType,
      category_lesson: newExamForm.categoryLesson,
      is_published: false,
      price: Number(newExamForm.price) || 0,
      original_price: Number(newExamForm.originalPrice) || 0,
      is_parent: true,
      sections: [],
      description: newExamForm.description || ''
    };

    const { data, error } = await supabase.from('exams').insert([newExamData]).select();
    setAuthLoading(false);

    if (error) {
      alert("Sınav oluşturulamadı: " + error.message);
    } else if (data && data.length > 0) {
      const formatted = formatExamData(data[0]);
      setExams(prev => [formatted, ...prev]);
      setIsCreatingExam(false);
    }
  };

  // Cevap anahtarı artık ayrı bir tabloda (exam_answer_keys) tutuluyor ve
  // genel sınav sorgusuyla hiç çekilmiyor. Admin bir ürünün alt testlerini
  // açtığında, o testlere ait cevap anahtarlarını burada ayrıca çekip
  // (sadece admin bu tabloyu okuyabiliyor) yerel `exams` state'ine işliyoruz.
  const fetchAndMergeAnswerKeys = async (examIds) => {
    if (!examIds || examIds.length === 0) return;
    const { data, error } = await supabase
      .from('exam_answer_keys')
      .select('exam_id, answer_key')
      .in('exam_id', examIds);

    if (error) {
      console.error("Cevap anahtarları çekilemedi:", error);
      return;
    }
    if (data && data.length > 0) {
      setExams(prev => prev.map(ex => {
        const found = data.find(k => k.exam_id === ex.id);
        return found ? { ...ex, answerKey: found.answer_key || {} } : ex;
      }));
    }
  };

  const handleOpenDefinitionScreen = (examId) => {
    setActiveAdminExamId(examId);
    setActiveSubExamId(null);
    setIsCreatingExam(false);
    const childIds = exams.filter(e => e.parentId === examId).map(e => e.id);
    fetchAndMergeAnswerKeys(childIds);
  };

  const handleOpenSettingsScreen = (examId) => {
    const exam = exams.find(e => e.id === examId);
    if (!exam) return;
    setNewExamForm({
      name: exam.name || '',
      duration: exam.duration || '',
      examType: exam.examType || 'deneme',
      categoryExamType: exam.categoryExamType || '',
      categoryLesson: exam.categoryLesson || '',
      price: exam.price || 0,
      originalPrice: exam.originalPrice || 0,
      isParent: true,
      answerKey: exam.answerKey || {},
      sections: exam.sections || [],
      numPages: exam.numPages || 0,
      description: exam.description || ''
    });
    setActiveAdminExamId(examId);
    setActiveSubExamId(null);
    setIsCreatingExam(true);
  };

  const handleExamPdfUploadForExam = (examId, e) => {
    const file = e.target.files[0];
    if (!file || !examId) return;

    const uploadPdf = async () => {
      setAuthLoading(true);
      const fileExt = file.name.split('.').pop();
      const fileName = `exam_${Math.random().toString(36).substring(2)}_${Date.now()}.${fileExt}`;

      const { error: storageError } = await supabase.storage
        .from('exam-files')
        .upload(fileName, file);

      if (storageError) {
        alert("Sınav PDF'i yüklenemedi: " + storageError.message);
        setAuthLoading(false);
        return;
      }

      // Soru / Sayfa Sayısı'nı elle girmeye gerek kalmasın diye, PDF'in
      // kendisinden otomatik okuyoruz (her sayfa = bir soru). Okunamazsa
      // (bozuk dosya vb.) mevcut değeri değiştirmeden bırakıyoruz.
      const detectedPages = await readPdfPageCount(file);

      // Storage artık private -- public URL yerine sadece dosya adını
      // (path) saklıyoruz; görüntülenirken /api/get-pdf-url ile erişim
      // hakkı doğrulanıp kısa ömürlü imzalı bir URL üretiliyor.
      setAuthLoading(false);
      const updates = { pdfFile: fileName };
      if (detectedPages) {
        updates.numPages = detectedPages;
        // Soru sayısı PDF'ten otomatik algılandığında da, manuel girişte
        // olduğu gibi, soru başı fiyat ayarlıysa Fiyat/Eski Fiyat'ı aynı
        // formülle yeniden hesaplıyoruz.
        if (pricePerQuestionConfigured) {
          const computedPrice = Number((detectedPages * pricePerQuestion).toFixed(2));
          updates.price = computedPrice;
          updates.originalPrice = computedPrice;
        }
      }
      await updateExamInDb(examId, updates);
    };
    uploadPdf();
  };

  const handleSolutionUploadForExam = (examId, e) => {
    const file = e.target.files[0];
    if (file && examId) {
      const uploadSolutionFile = async () => {
        setAuthLoading(true);
        const fileExt = file.name.split('.').pop();
        const fileName = `sol_${Math.random().toString(36).substring(2)}_${Date.now()}.${fileExt}`;

        const { error: storageError } = await supabase.storage
          .from('exam-files')
          .upload(fileName, file);

        if (storageError) {
          console.error("Çözüm storage yükleme hatası:", storageError);
          alert("Çözüm dosyası depolama alanına yüklenemedi: " + storageError.message);
          setAuthLoading(false);
          return;
        }

        // Storage artık private -- sadece dosya adını (path) saklıyoruz.
        setAuthLoading(false);
        await updateExamInDb(examId, { solutionPdfFile: fileName });
      };
      uploadSolutionFile();
    }
  };

  const handleFastKeyEntryForExam = (examId, text) => {
    const exam = exams.find(e => e.id === examId);
    if (!exam) return;
    const sanitizedText = text.toUpperCase().replace(/[^ABCDE]/g, '');
    const newKey = {};
    for (let i = 0; i < sanitizedText.length; i++) {
      if (i < (exam.numPages || 120)) {
        newKey[i + 1] = sanitizedText[i];
      }
    }
    updateAnswerKeyInDb(examId, newKey);
  };

  // Bir testin TÜM sorularının aynı Ders/Kazanım'ı kapsadığı durumlar için
  // (soru bankalarında konu konu bölünmüş testler gibi): Excel hazırlamadan,
  // tek bir Ders/Kazanım girip 1'den numPages'e kadar tüm soru numaralarına
  // aynı değeri uygular.
  const handleApplySingleTopicToAll = (examId, numPages, ders, konu, kazanim) => {
    const cleanDers = (ders || '').trim();
    const cleanKonu = (konu || '').trim();
    const cleanKazanim = (kazanim || '').trim();
    if (!cleanDers || !cleanKonu || !cleanKazanim) {
      alert("Ders, Konu ve Kazanım alanlarını doldurun.");
      return;
    }
    const total = Number(numPages) || 0;
    if (total < 1) {
      alert("Bu test için önce Soru / Sayfa Sayısı girilmeli.");
      return;
    }
    const newTopicMap = {};
    for (let i = 1; i <= total; i++) {
      newTopicMap[i] = { ders: cleanDers, konu: cleanKonu, kazanim: cleanKazanim };
    }
    updateTopicMapInDb(examId, newTopicMap).then((ok) => {
      if (ok) alert(`✓ ${total} sorunun tamamına "${cleanDers} / ${cleanKonu} / ${cleanKazanim}" uygulandı.`);
    });
  };

  // Aynı ürün altındaki (ör. "KPSS Tarih Son Tekrar" paketindeki 7 deneme
  // gibi) testlerin genelde SORU SIRASI ve KONU DAĞILIMI birebir aynı olur.
  // Bu yüzden bir testin kazanım haritasını, zaten kazanımı girilmiş başka
  // bir testten olduğu gibi kopyalayabilmek için: kaynak testin topicMap'ini
  // (derin kopya alarak) hedef teste yazıyoruz, mevcut haritanın üzerine.
  const handleCopyKazanimFromExam = (targetExamId, sourceExamId) => {
    // ÖNEMLİ (bug fix -- aynı sınıf hata Kategori Yönetimi'nde de vardı):
    // <select>'in e.target.value değeri DOM'da HER ZAMAN string gelir, ama
    // exams.id veritabanından sayısal olabilir. Katı eşitlik (===) bu yüzden
    // eşleşmeyip "kazanım haritası yok" hatasına sebep oluyordu -- oysa
    // dropdown'da (Object.keys(e.topicMap).length) doğru gösteriliyordu,
    // yani veri zaten oradaydı, sadece id karşılaştırması başarısız oluyordu.
    const sourceExam = exams.find((e) => String(e.id) === String(sourceExamId));
    if (!sourceExam || !sourceExam.topicMap || Object.keys(sourceExam.topicMap).length === 0) {
      alert('Seçilen testte henüz kazanım haritası yok.');
      return;
    }
    const targetExam = exams.find((e) => e.id === targetExamId);
    const targetCount = targetExam?.numPages || 0;
    const sourceCount = Object.keys(sourceExam.topicMap).length;
    const mismatchWarning = targetCount && sourceCount !== targetCount
      ? `\n\nUyarı: Kaynak testte ${sourceCount} soru için kazanım var, bu testte ise ${targetCount} soru var. Soru sayıları farklı olduğu için sondaki/eksik sorularda kazanım eşleşmesi yanlış olabilir, kopyaladıktan sonra listeyi gözden geçirin.`
      : '';
    if (!window.confirm(`"${sourceExam.name || 'İsimsiz Sınav'}" testinin kazanım haritası (${sourceCount} soru) bu teste kopyalanacak ve mevcut kazanım haritasının üzerine yazılacak. Devam edilsin mi?${mismatchWarning}`)) {
      return;
    }
    const copiedTopicMap = JSON.parse(JSON.stringify(sourceExam.topicMap));
    updateTopicMapInDb(targetExamId, copiedTopicMap).then((ok) => {
      if (ok) alert(`✓ ${Object.keys(copiedTopicMap).length} sorunun kazanımı kopyalandı.`);
    });
  };

  // Bir kazanım adının Kategori Yönetimi'ndeki master listeyle birebir
  // eşleşmediği durumlarda, admin'e "bunu mu demek istediniz?" ipucu vermek
  // için büyük/küçük harf ve fazla boşluk farkını göz ardı ederek arar.
  // NOT: Bu sadece bir ÖNERİDİR, otomatik uygulanmaz -- eşleştirme yine katı.
  const normalizeForSuggestion = (s) => (s || '').trim().toLocaleLowerCase('tr').replace(/\s+/g, ' ');
  const suggestClosestName = (list, raw) => {
    const norm = normalizeForSuggestion(raw);
    const hit = list.find((x) => normalizeForSuggestion(x.name) === norm);
    return hit ? ` (Bunu mu demek istediniz: "${hit.name}"?)` : '';
  };

  // Kazanım Referans Listesi: Kategori Yönetimi'ndeki tüm Ders/Konu/Kazanım
  // adlarını, Excel yüklemesinde beklenen sütun sırasıyla (Ders, Konu,
  // Kazanım) bir .xlsx dosyasına döker. Admin buradan kopyala-yapıştır
  // yaparak Excel'e yazım hatasız isim girebilir -- yükleme artık BİREBİR
  // eşleşme istediği için bu liste pratikte zorunlu bir yardımcı oldu.
  const downloadKazanimReferenceList = () => {
    const rows = [['Ders', 'Konu', 'Kazanım']];
    learningOutcomes
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
      .forEach((o) => {
        const topic = topics.find((t) => t.id === o.topic_id);
        const lesson = topic
          ? lessonCategories.find((lc) => lc.id === topic.lesson_category_id)
          : lessonCategories.find((lc) => lc.id === o.lesson_category_id);
        if (!topic) return; // konusuz kazanımlar Excel akışında kullanılamıyor, listeye eklemiyoruz
        rows.push([lesson?.name || '', topic.name, o.name]);
      });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Kazanımlar');
    XLSX.writeFile(wb, 'kazanim-referans-listesi.xlsx');
  };

  // Boş Excel Şablonu: toplu test yükleme ekranındaki sütun sırasıyla
  // (İçerik Adı, Sınav PDF, Çözüm PDF, Hızlı Cevap Anahtarı) sadece başlık
  // satırını içeren boş bir .xlsx indirir -- admin doğrudan bunun üzerine
  // yazabilsin diye.
  const downloadBulkImportTemplate = () => {
    const rows = [['İçerik Adı', 'Sınav PDF (dosya adı)', 'Çözüm PDF (dosya adı, opsiyonel)', 'Hızlı Cevap Anahtarı (opsiyonel)']];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Testler');
    XLSX.writeFile(wb, 'toplu-test-yukleme-sablonu.xlsx');
  };


  const handleTopicMapUpload = (examId, e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[firstSheetName];
        // header: 1 -> her satırı bir dizi olarak alır, başlık satırını (1. satır) atlıyoruz
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        const newTopicMap = {};
        const problems = [];
        let count = 0;

        for (let i = 1; i < rows.length; i++) { // 0. satır başlık, 1'den başla
          const row = rows[i];
          if (!row || row.length < 4) continue;
          const soruNo = Number(row[0]);
          const dersRaw = String(row[1] || '').trim();
          const konuRaw = String(row[2] || '').trim();
          const kazanimRaw = String(row[3] || '').trim();
          if (!soruNo || !dersRaw || !konuRaw || !kazanimRaw) continue;

          // ÖNEMLİ: Kazanım sistemi artık dropdown/master listeye dayanıyor
          // (bkz. resolveLiveKonuForEntry, Kazanım Referans Listesi). Excel'deki
          // Ders/Konu/Kazanım metinlerinin Kategori Yönetimi'ndeki kayıtlarla
          // BİREBİR eşleşmesi gerekir -- aksi halde o soru dropdown'larda
          // "seçili" görünmez, isim değişikliklerini otomatik yakalayamaz ve
          // ileride konu/kazanım id'sine dayalı test tavsiyesinde bu soru
          // SİSTEM TARAFINDAN GÖRÜLEMEZ. Bu yüzden eşleşmeyen satırları
          // sessizce kaydetmek yerine, TÜM yüklemeyi durdurup admin'e tam
          // olarak hangi satırda ne yazması gerektiğini gösteriyoruz.
          const lesson = lessonCategories.find((lc) => lc.name === dersRaw);
          const topic = lesson ? topics.find((t) => t.name === konuRaw && t.lesson_category_id === lesson.id) : null;
          const outcome = topic ? learningOutcomes.find((o) => o.name === kazanimRaw && o.topic_id === topic.id) : null;

          if (!lesson || !topic || !outcome) {
            let reason;
            if (!lesson) {
              reason = `Ders Türü "${dersRaw}" bulunamadı.${suggestClosestName(lessonCategories, dersRaw)}`;
            } else if (!topic) {
              reason = `"${lesson.name}" ders türünde "${konuRaw}" adında bir Konu bulunamadı.${suggestClosestName(topics.filter((t) => t.lesson_category_id === lesson.id), konuRaw)}`;
            } else {
              reason = `"${topic.name}" konusunda "${kazanimRaw}" adında bir Kazanım bulunamadı.${suggestClosestName(learningOutcomes.filter((o) => o.topic_id === topic.id), kazanimRaw)}`;
            }
            problems.push(`Soru ${soruNo}: ${reason}`);
            continue;
          }

          // Bulunan master kaydın ADINI (kendi yazdıkları değil) yazıyoruz --
          // böylece küçük bir boşluk farkı bile olsa kayıtta tam master metin durur.
          newTopicMap[soruNo] = { ders: lesson.name, konu: topic.name, kazanim: outcome.name };
          count++;
        }

        if (problems.length > 0) {
          alert(
            `Yükleme durduruldu -- ${problems.length} satırda Ders/Konu/Kazanım adı Kategori Yönetimi'ndeki kayıtlarla birebir eşleşmiyor:\n\n` +
            problems.slice(0, 15).join('\n') +
            (problems.length > 15 ? `\n...ve ${problems.length - 15} satır daha` : '') +
            `\n\nDoğru adları "Kazanım Referans Listesi İndir" ile alıp Excel'e kopyalayıp tekrar yükleyin.`
          );
          return;
        }

        if (count === 0) {
          alert("Excel dosyasında geçerli satır bulunamadı. Sütun sırasının Soru No / Ders / Konu / Kazanım olduğundan emin olun.");
          return;
        }

        updateTopicMapInDb(examId, newTopicMap).then((ok) => {
          if (ok) alert(`✓ ${count} soru için kazanım haritası yüklendi.`);
        });
      } catch (err) {
        console.error(err);
        alert("Excel dosyası okunamadı: " + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // ÖNEMLİ: Bir sorunun kazanım haritası girişi (topicMap[soruNo]) kaydedildiği
  // an "konu" metnini olduğu gibi kopyalar. Kategori Yönetimi'nden o kazanımın
  // bağlı olduğu Konu daha sonra değiştirilirse, bu eski metin KENDİLİĞİNDEN
  // güncellenmez. Bu fonksiyon, mevcut kazanım adını (entry.kazanim) master
  // learningOutcomes listesinde arayıp, bulursa Konu'yu oradan (o kazanımın
  // GÜNCEL topic_id'sinden) canlı olarak döndürür -- böylece Kategori
  // Yönetimi'nde bir kazanımın konusunu değiştirmek, o kazanımı kullanan tüm
  // sorularda otomatik yansır, tek tek soru düzenlemeye gerek kalmaz. Eşleşen
  // bir kazanım bulunamazsa (silinmiş/yeniden adlandırılmışsa) eski kayıtlı
  // metne geri döner.
  // Bir topicMap satırının (entry: {ders, konu, kazanim}) GÜNCEL master
  // kayıtlardaki gerçek ID'lerini çözer. Kazanım adı üzerinden
  // learningOutcomes'ta arayıp, oradan lessonCategoryId/topicId/outcomeId'yi
  // döndürür -- bulunamazsa (silinmiş/hiç eşleşmemiş) null'lar döner.
  // Hem bu sınavın kendi raporunu hem de ÖNERİ MOTORUNU (findKonuTesti,
  // findOnerilenDeneme) aynı ID'lere göre çalıştırmak için tek, ortak
  // bir yerden çözülüyor -- böylece "aynı kazanım farklı yazılmış" gibi
  // metin bazlı uyuşmazlıklar öneri motorunu etkilemiyor.
  const resolveEntryIds = (entry) => {
    if (!entry || !entry.kazanim) return { lessonCategoryId: null, topicId: null, outcomeId: null };
    const ders = lessonCategories.find((lc) => lc.name === entry.ders);
    const matchingOutcome = learningOutcomes.find((lo) =>
      lo.name === entry.kazanim && (!ders || lo.lesson_category_id === ders.id)
    );
    if (!matchingOutcome) return { lessonCategoryId: ders ? ders.id : null, topicId: null, outcomeId: null };
    return {
      lessonCategoryId: matchingOutcome.lesson_category_id,
      topicId: matchingOutcome.topic_id,
      outcomeId: matchingOutcome.id
    };
  };

  const resolveLiveKonuForEntry = (entry) => {
    if (!entry) return '';
    const { topicId } = resolveEntryIds(entry);
    if (topicId) {
      const liveTopic = topics.find((t) => t.id === topicId);
      if (liveTopic) return liveTopic.name;
    }
    return entry.konu || '';
  };

  // NOT: Kategori Yönetimi'ndeki "Konu Değiştir" dropdown'u kaldırıldı --
  // Konu artık sadece kazanım oluşturulurken seçiliyor, sonradan
  // değiştirilmiyor (bkz. kullanıcı talebi). resolveLiveKonuForEntry hâlâ
  // kullanışlı: bir Konu ya da Kazanım YENİDEN ADLANDIRILDIĞINDA, o adı
  // kullanan sorularda güncel adı otomatik gösterir.

  // --- Excel'den Toplu Test Yükleme ---
  // Sütun sırası: 1. İçerik Adı, 2. Sınav PDF (dosya adı), 3. Çözüm PDF
  // (dosya adı, opsiyonel), 4. Hızlı Cevap Anahtarı (opsiyonel).
  // İlk satır başlık kabul edilir. Soru/Sayfa Sayısı artık Excel'den
  // alınmıyor -- eşleşen Sınav PDF'inden otomatik okunuyor (bkz.
  // readPdfPageCount, runBulkImport içinde kullanılıyor).
  const handleBulkExcelSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        const parsed = [];
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;
          const name = String(row[0] || '').trim();
          if (!name) continue;
          parsed.push({
            name,
            sinavPdfName: String(row[1] || '').trim(),
            cozumPdfName: String(row[2] || '').trim(),
            cevapAnahtari: String(row[3] || '').trim()
          });
        }
        if (parsed.length === 0) {
          alert('Excel dosyasında geçerli satır bulunamadı. Sütun sırasının İçerik Adı / Sınav PDF / Çözüm PDF / Hızlı Cevap Anahtarı olduğundan emin olun.');
          return;
        }
        setBulkExcelRows(parsed);
      } catch (err) {
        alert('Excel dosyası okunamadı: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleBulkPdfSelect = (e) => {
    const files = Array.from(e.target.files || []);
    const map = new Map();
    files.forEach((f) => map.set(f.name.toLowerCase(), f));
    setBulkPdfFiles(map);
  };

  const runBulkImport = async () => {
    const parentExam = exams.find((ex) => ex.id === bulkImportParentId);
    if (!parentExam || bulkExcelRows.length === 0) return;

    setBulkImporting(true);
    setBulkImportErrors([]);
    setBulkImportProgress({ current: 0, total: bulkExcelRows.length });

    const existingChildren = exams.filter((ex) => ex.parentId === parentExam.id);
    let nextOrder = existingChildren.length > 0
      ? Math.max(...existingChildren.map((ex) => ex.sortOrder || 0)) + 1
      : 0;

    const errors = [];

    // ÖNEMLİ: readPdfPageCount her çağrıldığında yeni bir PDF.js worker
    // açıyordu ve hiç kapatılmıyordu -- 78 test arka arkaya işlenirken
    // onlarca worker açık kalıp tarayıcı sekmesini kaynak tükenmesine
    // sürüklüyor, bir noktadan sonra Supabase'e giden fetch istekleri
    // "Failed to fetch" ile çökmeye başlıyordu. Tüm döngü boyunca TEK bir
    // worker paylaşılıyor (performans için) ve döngü ne şekilde biterse
    // bitsin (hata dahil) finally'de mutlaka kapatılıyor.
    const pdfWorker = new pdfjsLib.PDFWorker({ name: 'bulk-import-worker' });

    try {
      for (let i = 0; i < bulkExcelRows.length; i++) {
        const row = bulkExcelRows[i];
        setBulkImportProgress({ current: i + 1, total: bulkExcelRows.length });

        try {
          // 1) Sınav PDF'ini önce eşleştir ve YÜKLEMEDEN ÖNCE sayfa sayısını
          // oku -- bu sayede kaydı oluştururken artık Excel'deki bir sütuna
          // değil, PDF'in kendisine güveniyoruz (her sayfa = bir soru).
          let sinavFile = null;
          let detectedPages = 0;
          if (row.sinavPdfName) {
            sinavFile = bulkPdfFiles.get(row.sinavPdfName.toLowerCase());
            if (sinavFile) {
              const pages = await readPdfPageCount(sinavFile, pdfWorker);
              if (pages) {
                detectedPages = pages;
              } else {
                errors.push(`${row.name}: "${row.sinavPdfName}" dosyasının sayfa sayısı okunamadı, elle girmen gerekecek.`);
              }
            } else {
              errors.push(`${row.name}: "${row.sinavPdfName}" adlı dosya seçilenler arasında bulunamadı.`);
            }
          }

          // 2) Test kaydını oluştur
          const insertPayload = {
            name: row.name,
            parent_id: parentExam.id,
            is_published: true,
            exam_type: parentExam.examType || 'test',
            category_exam_type: '',
            category_lesson: '',
            duration: parentExam.duration || 0,
            price: 0,
            sections: [],
            num_pages: detectedPages,
            sort_order: nextOrder
          };
          nextOrder++;

          const { data, error } = await supabase.from('exams').insert([insertPayload]).select();
          if (error) throw new Error('Kayıt oluşturulamadı: ' + error.message);
          const newExam = formatExamData(data[0]);
          setExams((prev) => [...prev, newExam]);

          // 3) Sınav PDF'ini storage'a yükle (sayfa sayısı yukarıda zaten okundu)
          if (sinavFile) {
            const fileExt = sinavFile.name.split('.').pop();
            const fileName = `exam_${Math.random().toString(36).substring(2)}_${Date.now()}.${fileExt}`;
            const { error: upErr } = await supabase.storage.from('exam-files').upload(fileName, sinavFile);
            if (upErr) throw new Error('Sınav PDF yüklenemedi: ' + upErr.message);
            await supabase.from('exams').update({ pdf_file: fileName }).eq('id', newExam.id);
            setExams((prev) => prev.map((ex) => ex.id === newExam.id ? { ...ex, pdfFile: fileName } : ex));
          }

          // 4) Çözüm PDF'i (opsiyonel) eşleştir ve yükle
          if (row.cozumPdfName) {
            const cozumFile = bulkPdfFiles.get(row.cozumPdfName.toLowerCase());
            if (cozumFile) {
              const fileExt = cozumFile.name.split('.').pop();
              const fileName = `sol_${Math.random().toString(36).substring(2)}_${Date.now()}.${fileExt}`;
              const { error: upErr } = await supabase.storage.from('exam-files').upload(fileName, cozumFile);
              if (upErr) throw new Error('Çözüm PDF yüklenemedi: ' + upErr.message);
              await supabase.from('exams').update({ solution_pdf_file: fileName }).eq('id', newExam.id);
              setExams((prev) => prev.map((ex) => ex.id === newExam.id ? { ...ex, solutionPdfFile: fileName } : ex));
            } else {
              errors.push(`${row.name}: "${row.cozumPdfName}" adlı çözüm dosyası seçilenler arasında bulunamadı.`);
            }
          }

          // 5) Hızlı cevap anahtarı (opsiyonel)
          if (row.cevapAnahtari) {
            const sanitized = row.cevapAnahtari.toUpperCase().replace(/[^ABCDE]/g, '');
            const key = {};
            for (let j = 0; j < sanitized.length && j < detectedPages; j++) key[j + 1] = sanitized[j];
            if (Object.keys(key).length > 0) {
              const { error: keyErr } = await supabase.from('exam_answer_keys').upsert([{ exam_id: newExam.id, answer_key: key }], { onConflict: 'exam_id' });
              if (keyErr) throw new Error('Cevap anahtarı kaydedilemedi: ' + keyErr.message);
              setExams((prev) => prev.map((ex) => ex.id === newExam.id ? { ...ex, answerKey: key } : ex));
            }
          }
        } catch (err) {
          errors.push(`${row.name || 'Satır ' + (i + 1)}: ${err.message}`);
        }
      }
    } finally {
      pdfWorker.destroy();
    }

    setBulkImportErrors(errors);
    setBulkImporting(false);

    if (errors.length === 0) {
      alert(`✓ ${bulkExcelRows.length} test başarıyla eklendi.`);
      setShowBulkImport(false);
      setBulkExcelRows([]);
      setBulkPdfFiles(new Map());
    } else {
      alert(`${bulkExcelRows.length - errors.length}/${bulkExcelRows.length} test eklendi. ${errors.length} satırda sorun oldu -- listeyi kontrol edin.`);
    }
  };

  const handleAddSubTest = async () => {
    const adminActiveExam = exams.find(e => e.id === activeAdminExamId);
    if (!adminActiveExam) return;
    setAuthLoading(true);
    const existingChildren = exams.filter(e => e.parentId === adminActiveExam.id);
    const nextOrder = existingChildren.length > 0
      ? Math.max(...existingChildren.map(e => e.sortOrder || 0)) + 1
      : 0;
    const newChildData = {
      name: '', 
      parent_id: adminActiveExam.id,
      is_published: true,
      exam_type: adminActiveExam.examType || 'test',
      category_exam_type: '', 
      category_lesson: '', 
      duration: adminActiveExam.duration || 0,
      price: 0,
      sections: [],
      num_pages: 0
    };
    const { data, error } = await supabase.from('exams').insert([newChildData]).select();
    setAuthLoading(false);
    if (error) {
      alert("Alt test eklenemedi: " + error.message);
    } else if (data && data.length > 0) {
      const formatted = formatExamData(data[0]);
      setExams(prev => [formatted, ...prev]);
      setActiveSubExamId(formatted.id);
      updateSortOrderInDb(formatted.id, nextOrder);
    }
  };

  const togglePublish = async (examId) => {
    const exam = exams.find(e => e.id === examId);
    if (exam) {
      await updateExamInDb(examId, { isPublished: !exam.isPublished });
    }
  };

  const deleteExam = async (examId) => {
    if (window.confirm("Bu içeriği silmek istediğinize emin misiniz?")) {
      await supabase.from('exams').delete().eq('parent_id', examId);
      const { error } = await supabase.from('exams').delete().eq('id', examId);

      if (error) {
        console.error("Silme hatası:", error);
      } else {
        setExams(prev => prev.filter(e => e.id !== examId && e.parentId !== examId));
        if (activeAdminExamId === examId) {
          setActiveAdminExamId(null);
          setActiveSubExamId(null);
        }
      }
    }
  };

  const startExam = (exam) => {
    if (!user) {
      alert("Sınava katılabilmek için lütfen giriş yapın veya üye olun.");
      setAuthMode('login');
      setShowAuthModal(true);
      return;
    }

    const isFree = !exam.price || exam.price <= 0;
    const isPurchased = studentPurchases[exam.id] || (exam.parentId && studentPurchases[exam.parentId]);

    if (!isFree && !isPurchased) {
      handleIyzicoPayment(exam);
      return;
    }

    // ÖNEMLİ: sınav şu an ücretsiz (isFree) olsa bile, öğrencinin buraya
    // eriştiğini KALICI bir student_purchases kaydına dönüştürüyoruz.
    // Sebep: bu satır olmadan, ücretsizken çözülen bir sınav daha sonra
    // admin panelinden ücretli hale getirilirse, öğrencinin hiçbir satın
    // alma kaydı olmadığı için (ücretsizken buna hiç ihtiyaç yoktu) bir
    // dahaki girişinde "erişiminiz yok" duvarına çarpıyordu -- daha önce
    // gerçekten çözmüş olmasına rağmen. Aynı güvenli sunucu uç noktasını
    // (initializePayment) kullanıyoruz; sunucu güncel fiyatı (şu an 0)
    // hesaplayıp bakiyeden hiçbir şey düşmeden "freeCheckout" olarak
    // kaydı oluşturuyor -- handleIyzicoPayment'taki freeCheckout dalıyla
    // birebir aynı mekanizma. Kullanıcıyı BEKLETMİYORUZ: arka planda
    // (fire-and-forget) çalışır, sınava giriş anında hiçbir gecikme olmaz.
    if (isFree && !isPurchased) {
      registerFreeExamAccess(exam);
    }

    // Yarım kalmış (bitirilmemiş) bir oturum varsa cevapları, süreyi ve sayfayı oradan geri yükle.
    const existingRes = studentResultsMap[exam.id];
    const hasUnfinishedSession = existingRes && !existingRes.is_finished && existingRes.answers && Object.keys(existingRes.answers).length > 0;

    setActiveStudentExamId(exam.id);
    setInspectingExamId(null);
    setIsExamFinished(false);
    setShowResults(false);
    setViewingSolutionQ(false);

    if (hasUnfinishedSession) {
      // Daha önce başlanmış bir oturuma dönüyor, süre kaldığı yerden akmaya devam etsin.
      setIsPaused(false);
      setExamStarted(true);
      setStudentAnswers(existingRes.answers || {});
      setStudentCurrentPage(existingRes.currentPage || 1);
      if (exam.examType === 'deneme') {
        setTimeLeft(existingRes.timeLeft != null ? existingRes.timeLeft : exam.duration * 60);
      } else {
        setTimeLeft(existingRes.timeLeft || 0);
      }
    } else {
      // Sıfırdan başlıyor: soru ekranı gelsin ama öğrenci "Başla"ya basana kadar süre işlemesin.
      setIsPaused(true);
      setExamStarted(false);
      setStudentAnswers({});
      setStudentCurrentPage(1);
      setTimeLeft(exam.examType === 'deneme' ? exam.duration * 60 : 0);
    }
  };

  // Ücretsiz bir sınava giren öğrenci için sunucuda KALICI bir satın alma
  // kaydı oluşturur (bkz. startExam içindeki açıklama). Sessizce çalışır --
  // hata olursa öğrencinin sınava girişini engellemez, sadece konsola
  // yazar (bu turdaki erişimi zaten isFree kontrolü karşılıyor; burada
  // amaç yalnızca GELECEKTEKİ erişimi güvenceye almak).
  const registerFreeExamAccess = async (exam) => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) return;
      initializePayment(
        { examIds: [exam.id], items: [{ id: exam.id }] },
        token,
        (err, result) => {
          if (err) {
            console.error('Ücretsiz erişim kaydı oluşturulamadı:', err);
            return;
          }
          if (result && result.freeCheckout) {
            setStudentPurchases(prev => ({ ...prev, [exam.id]: true }));
            if (typeof result.newBalance === 'number') setStudentBalance(result.newBalance);
          }
        }
      );
    } catch (err) {
      console.error('Ücretsiz erişim kaydı oluşturulamadı:', err);
    }
  };

  // Fatura bilgisinin TAM (dört alan da dolu) olup olmadığını kontrol eder.
  const hasCompleteBillingInfo = () => {
    return !!(myBillingInfo && myBillingInfo.full_name && myBillingInfo.tc_kimlik_no && myBillingInfo.invoice_email && myBillingInfo.address);
  };

  const handleIyzicoPayment = async (exam) => {
    if (!user) {
      alert("Ödeme yapabilmek ve sınava katılabilmek için lütfen giriş yapın.");
      setAuthMode('login');
      setShowAuthModal(true);
      return;
    }
    // ÖDEME ÖNCESİ ZORUNLU FATURA ADIMI: fatura bilgisi eksikse, ödemeyi
    // burada durdurup önce fatura formunu açıyoruz. Form kaydedilince
    // proceedIyzicoPayment aşağıda otomatik devam ettirilir.
    if (!hasCompleteBillingInfo()) {
      setPendingPaymentAction({ type: 'single', exam });
      setShowBillingGateModal(true);
      return;
    }
    proceedIyzicoPayment(exam);
  };

  const proceedIyzicoPayment = async (exam) => {
    // Not: Gerçek tutar her zaman sunucuda hesaplanır; burada sadece
    // onay mesajını daha bilgilendirici göstermek için varolan bakiyeyi
    // (studentBalance) kullanıyoruz.
    const estimatedApplied = Math.min(studentBalance || 0, exam.price);
    const estimatedPayable = exam.price - estimatedApplied;
    const confirmMsg = estimatedApplied > 0
      ? `"${exam.name}" isimli sınav ücretli (₺${exam.price}). ₺${estimatedApplied} bakiyenizden kullanılacak, kalan ₺${estimatedPayable} için iyzico ödeme formu açılacaktır. Onaylıyor musunuz?`
      : `"${exam.name}" isimli sınav ücretli (₺${exam.price}). İyzico ödeme formu açılacaktır. Onaylıyor musunuz?`;
    const confirmed = window.confirm(confirmMsg);
    if (!confirmed) return;

    // Not: price/email artık sunucuda (Authorization token'ı ve veritabanı
    // üzerinden) doğrulanıyor, burada gönderilenler sadece referans amaçlı.
    const paymentData = {
      examIds: [exam.id],
      items: [{ id: exam.id }]
    };

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) {
      alert("Oturumunuz bulunamadı, lütfen tekrar giriş yapın.");
      return;
    }

    initializePayment(paymentData, token, (err, result) => {
      if (err) {
        console.error("Ödeme hatası:", err);
        alert("Ödeme başlatılırken bir hata oluştu.");
        return;
      }

      // Toplam tutar tamamen hediye bakiyeden karşılandıysa iyzico'ya hiç
      // gidilmez -- içerik sunucu tarafında zaten tanımlandı, burada sadece
      // arayüzü güncelliyoruz.
      if (result.freeCheckout) {
        setStudentPurchases(prev => ({ ...prev, [exam.id]: true }));
        setStudentBalance(result.newBalance ?? 0);
        alert(`🎉 Ödeme bakiyenizden karşılandı! ₺${result.balanceApplied} bakiye kullanıldı. İçerik hesabınıza tanımlandı.`);
        return;
      }

      if (result.status === 'success' && result.paymentPageUrl) {
        // Artık gömülü widget yerine iyzico'nun kendi barındırdığı ödeme
        // sayfasına tam sayfa yönlendirme yapıyoruz -- iframe/overlay
        // karmaşasına gerek kalmadı.
        window.location.href = result.paymentPageUrl;
      } else {
        alert("İşlem başarısız: " + (result.errorMessage || 'Ödeme sayfası oluşturulamadı.'));
      }
    });
  };

  // --- Sepet ---
  const toggleCartItem = (examId) => {
    setCartItems(prev => prev.includes(examId) ? prev.filter(id => id !== examId) : [...prev, examId]);
  };

  const handleCartCheckout = async () => {
    if (!user) {
      alert("Ödeme yapabilmek için lütfen giriş yapın veya üye olun.");
      setAuthMode('login');
      setShowAuthModal(true);
      return;
    }
    if (cartItems.length === 0) return;
    // ÖDEME ÖNCESİ ZORUNLU FATURA ADIMI -- bkz. handleIyzicoPayment'taki not.
    if (!hasCompleteBillingInfo()) {
      setPendingPaymentAction({ type: 'cart' });
      setShowBillingGateModal(true);
      return;
    }
    proceedCartCheckout();
  };

  const proceedCartCheckout = async () => {
    const cartExams = exams.filter(e => cartItems.includes(e.id));
    if (cartExams.length === 0) return;

    // GÜVENLİK AĞI: Arayüz artık ücretsiz (₺0) ürünleri sepete hiç eklemiyor
    // (bkz. renderOneriTestSatiri'deki effectivelyFree düzeltmesi) -- ama
    // sepette eski/bozuk bir state kalmışsa diye burada AYRICA ayıklıyoruz.
    // SEBEP: sepette ₺50'lik bir ürünün yanında ₺0'lık bir ürün varken ödeme
    // "Ödeme başlatılırken bir hata oluştu" ile başarısız oluyordu -- iyzico
    // (veya sunucudaki ödeme fonksiyonu) sepette 0 tutarlı bir kalem olunca
    // TÜM işlemi reddediyor. Çözüm: ücretsiz olanları normal ödeme isteğine
    // HİÇ katmıyoruz, onları ayrı ve sorunsuz şekilde ücretsiz olarak
    // kaydediyoruz; sadece gerçekten ücretli olanlar iyzico'ya gidiyor.
    const payableExams = cartExams.filter(e => (e.price || 0) > 0);
    const freeExams = cartExams.filter(e => !((e.price || 0) > 0));

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) {
      alert("Oturumunuz bulunamadı, lütfen tekrar giriş yapın.");
      return;
    }

    // Önce (varsa) ücretsiz ürünleri sessizce kaydet -- kullanıcıyı ekstra
    // bir onay diyaloğuyla yormuyoruz, zaten ücretsiz oldukları belliydi.
    if (freeExams.length > 0) {
      await new Promise((resolve) => {
        initializePayment(
          { examIds: freeExams.map(e => e.id), items: freeExams.map(e => ({ id: e.id })) },
          token,
          (err, result) => {
            if (!err && result && result.freeCheckout) {
              setStudentPurchases(prev => {
                const updated = { ...prev };
                (result.purchasedExamIds || freeExams.map(e => e.id)).forEach(id => { updated[id] = true; });
                return updated;
              });
              if (typeof result.newBalance === 'number') setStudentBalance(result.newBalance);
            } else if (err) {
              console.error('Ücretsiz ürün(ler) kaydedilemedi:', err);
            }
            resolve();
          }
        );
      });
      setCartItems(prev => prev.filter(id => !freeExams.some(e => e.id === id)));
    }

    if (payableExams.length === 0) {
      if (freeExams.length > 0) alert('🎉 Ücretsiz içerik(ler) hesabınıza tanımlandı.');
      return;
    }

    const cartTotal = payableExams.reduce((sum, e) => sum + (e.price || 0), 0);

    // Not: Gerçek tutar her zaman sunucuda hesaplanır; burada sadece
    // onay mesajını daha bilgilendirici göstermek için varolan bakiyeyi
    // (studentBalance) kullanıyoruz.
    const estimatedApplied = Math.min(studentBalance || 0, cartTotal);
    const estimatedPayable = cartTotal - estimatedApplied;
    const confirmMsg = estimatedApplied > 0
      ? `Sepetinizdeki ${payableExams.length} içerik için toplam ₺${cartTotal.toLocaleString('tr-TR')}. ₺${estimatedApplied} bakiyenizden kullanılacak, kalan ₺${estimatedPayable} için iyzico ödeme formu açılacaktır. Onaylıyor musunuz?`
      : `Sepetinizdeki ${payableExams.length} içerik için toplam ₺${cartTotal.toLocaleString('tr-TR')} tutarında ödeme yapılacak. Onaylıyor musunuz?`;
    const confirmed = window.confirm(confirmMsg);
    if (!confirmed) return;

    // Not: price/email artık sunucuda (Authorization token'ı ve veritabanı
    // üzerinden) doğrulanıyor, burada gönderilenler sadece referans amaçlı.
    const paymentData = {
      examIds: payableExams.map(e => e.id),
      items: payableExams.map(e => ({ id: e.id }))
    };

    initializePayment(paymentData, token, (err, result) => {
      if (err) {
        console.error("Ödeme hatası:", err);
        alert("Ödeme başlatılırken bir hata oluştu.");
        return;
      }

      // Toplam tutar tamamen hediye bakiyeden karşılandıysa iyzico'ya hiç
      // gidilmez -- içerikler sunucu tarafında zaten tanımlandı, burada
      // sadece arayüzü (satın alınanlar + sepet + bakiye) güncelliyoruz.
      if (result.freeCheckout) {
        setStudentPurchases(prev => {
          const updated = { ...prev };
          (result.purchasedExamIds || []).forEach(id => { updated[id] = true; });
          return updated;
        });
        setStudentBalance(result.newBalance ?? 0);
        setCartItems(prev => prev.filter(id => !payableExams.some(e => e.id === id)));
        alert(`🎉 Ödeme bakiyenizden karşılandı! ₺${result.balanceApplied} bakiye kullanıldı. İçerikler hesabınıza tanımlandı.`);
        return;
      }

      if (result.status === 'success' && result.paymentPageUrl) {
        // Sepeti burada BOŞALTMIYORUZ -- ödeme henüz tamamlanmadı, sadece
        // iyzico'nun ödeme sayfasına yönlendiriyoruz. Sepet, ödeme
        // başarıyla bittiğinde ("?payment=success" ile geri dönüldüğünde)
        // temizlenecek.
        window.location.href = result.paymentPageUrl;
      } else {
        alert("İşlem başarısız: " + (result.errorMessage || 'Ödeme sayfası oluşturulamadı.'));
      }
    });
  };

  // Sınav sırasında (henüz bitmemişken) her cevap işaretlemesinde ilerlemeyi kaydeder.
  // Böylece bağlantı kopsa/sayfa kapansa bile öğrenci kaldığı yerden devam edebilir.
  const saveProgress = async (updatedAnswers, currentTimeLeft, currentPage) => {
    if (!user || !activeStudentExamId) return;
    try {
      const { error } = await supabase
        .from('student_exams')
        .upsert([
          {
            student_email: user.email,
            exam_id: activeStudentExamId,
            answers: updatedAnswers,
            time_left: currentTimeLeft,
            current_page: currentPage,
            is_finished: false
          }
        ], { onConflict: 'student_email, exam_id' });

      if (error) {
        console.error("İlerleme kaydedilemedi:", error);
      } else {
        setStudentResultsMap(prev => ({
          ...prev,
          [activeStudentExamId]: {
            ...(prev[activeStudentExamId] || {}),
            is_finished: false,
            answers: updatedAnswers,
            timeLeft: currentTimeLeft,
            currentPage: currentPage
          }
        }));
      }
    } catch (err) {
      console.error("İlerleme kaydedilemedi:", err);
    }
  };

  const handleAnswerSelect = (option) => {
    if (isExamFinished || isPaused) return;
    setStudentAnswers((prev) => {
      let updated;
      if (prev[studentCurrentPage] === option) {
        updated = { ...prev };
        delete updated[studentCurrentPage];
      } else {
        updated = { ...prev, [studentCurrentPage]: option };
      }
      saveProgress(updated, timeLeft, studentCurrentPage);
      return updated;
    });
  };

  const calculateResults = () => {
    if (!activeStudentExam) return { correct: 0, wrong: 0, empty: 0, net: 0 };
    let correct = 0, wrong = 0, empty = 0;
    const numP = activeStudentExam.numPages;

    for (let i = 1; i <= numP; i++) {
      const studentAns = studentAnswers[i];
      const correctAns = activeStudentExam.answerKey[i];

      if (!studentAns) {
        empty++;
      } else if (correctAns && studentAns === correctAns) {
        correct++;
      } else if (correctAns && studentAns !== correctAns) {
        wrong++;
      } else if (!correctAns && studentAns) {
        empty++; 
      }
    }
    const net = Math.max(0, correct - wrong * 0.25);
    return { correct, wrong, empty, net };
  };

  // Kazanım Analizi -- Ders > Konu > Kazanım hiyerarşisiyle çalışır.
  // topicMap zaten { ders, konu, kazanim } üçlüsünü tuttuğu için ek bir veri
  // toplamaya gerek yok, sadece raporlama katmanını Konu seviyesinde
  // gruplayacak şekilde genişletiyoruz.
  //
  // Ayrıca SADECE Ders (üst başlık) seviyesi için bir ek sinyal hesaplıyoruz:
  // "hedefDisi" -- öğrenci o dersten HİÇ soru cevaplamamışsa (tamamı boşsa),
  // bunu düşük performans (kırmızı/"Riskli") olarak göstermek yerine nötr bir
  // bilgi notuyla geçiyoruz: "Bu dersten hiç soru cevaplamamışsın." -- ne
  // test öneriyoruz ne kaynak. Konu seviyesinde bu ayrım YOK: bir dersin
  // içinde tek tük konular tamamen boş kalmış olsa bile (öğrenci o dersin
  // GENELİYLE ilgileniyor, sadece bir konuyu atlamış/unutmuş olabilir), bu
  // "bilerek hedefinde değil" sayılamaz -- normal barem'e göre (0 doğru ->
  // Riskli) değerlendirilip konu anlatımı/video önerilir.
  //
  // NOT: Bilerek bir "yetersiz veri / az soru var" eşiği YOK -- konuda tek
  // soru bile olsa, elimizdeki veriyle gerçek bir barem (Riskli/İyi/Harika)
  // veriyoruz. Hiçbir şey söylememek, öğrenciye yanlış bir şey söylemekten
  // daha kötü bir tercih değil.
  const getKazanimReport = () => {
    if (!activeStudentExam || !activeStudentExam.topicMap || Object.keys(activeStudentExam.topicMap).length === 0) {
      return null;
    }
    const numP = activeStudentExam.numPages;
    const byDers = {}; // { ders: { correct, total, empty, konular: { konu: { correct, total, empty, kazanimlar: {...} } } } }

    for (let i = 1; i <= numP; i++) {
      const topic = activeStudentExam.topicMap[i];
      if (!topic || !topic.ders || !topic.kazanim) continue;

      const studentAns = studentAnswers[i];
      const correctAns = activeStudentExam.answerKey[i];
      const isEmpty = !studentAns;
      const isCorrect = !!(studentAns && correctAns && studentAns === correctAns);
      // ÖNEMLİ: topic.konu, sınavın topicMap'inde DONMUŞ (Excel yüklendiği/
      // elle girildiği andaki) bir metin -- Kategori Yönetimi'nde bir kazanımın
      // konusu sonradan değiştirilirse burada otomatik güncellenmez. Bu yüzden
      // GÜNCEL ID'leri (resolveEntryIds) çözüp hem görünen adı hem de -- öneri
      // motorunun metne değil ID'ye göre çalışabilmesi için -- lessonCategoryId/
      // topicId/outcomeId'yi de saklıyoruz.
      const { lessonCategoryId, topicId, outcomeId } = resolveEntryIds(topic);
      const konuName = (topicId && topics.find((t) => t.id === topicId)?.name) || topic.konu || topic.kazanim;

      if (!byDers[topic.ders]) byDers[topic.ders] = { correct: 0, total: 0, empty: 0, konular: {}, lessonCategoryId };
      const dersEntry = byDers[topic.ders];
      dersEntry.total++;
      if (isCorrect) dersEntry.correct++;
      if (isEmpty) dersEntry.empty++;
      if (!dersEntry.lessonCategoryId && lessonCategoryId) dersEntry.lessonCategoryId = lessonCategoryId;

      if (!dersEntry.konular[konuName]) {
        dersEntry.konular[konuName] = { correct: 0, total: 0, empty: 0, kazanimlar: {}, topicId };
      }
      const konuEntry = dersEntry.konular[konuName];
      konuEntry.total++;
      if (isCorrect) konuEntry.correct++;
      if (isEmpty) konuEntry.empty++;
      if (!konuEntry.topicId && topicId) konuEntry.topicId = topicId;

      if (!konuEntry.kazanimlar[topic.kazanim]) {
        konuEntry.kazanimlar[topic.kazanim] = { correct: 0, total: 0, outcomeId };
      }
      konuEntry.kazanimlar[topic.kazanim].total++;
      if (isCorrect) konuEntry.kazanimlar[topic.kazanim].correct++;
      if (!konuEntry.kazanimlar[topic.kazanim].outcomeId && outcomeId) konuEntry.kazanimlar[topic.kazanim].outcomeId = outcomeId;
    }

    // Barem (3 kademe): Riskli <%40, İyi %40-%69, Harika >=%70 -- bilerek
    // sonuç ekranındaki oran renginin (getBaremTextColor) kırmızı/turuncu/
    // yeşil sınırlarıyla AYNI: rozet ve altındaki rakamın rengi hep tutarlı
    // olsun diye.
    // "Hedefte Değil" SADECE Ders seviyesinde: bir dersten HİÇ soru
    // cevaplanmamışsa (cevaplanan sayısı 0 ise), o dersi performans barem'i
    // dışında tutup nötr gösteriyoruz -- ne test ne kaynak öneriyoruz.
    const computeDersTier = (entry) => {
      const answered = entry.total - entry.empty;
      if (answered === 0) {
        return { tier: 'hedefDisi', oran: 0 };
      }
      const oran = entry.correct / entry.total;
      let tier;
      if (oran < 0.4) tier = 'riskli';
      else if (oran < 0.7) tier = 'iyi';
      else tier = 'harika';
      return { tier, oran };
    };
    const computeKonuTier = (entry) => {
      const oran = entry.total > 0 ? entry.correct / entry.total : 0;
      let tier;
      if (oran < 0.4) tier = 'riskli';
      else if (oran < 0.7) tier = 'iyi';
      else tier = 'harika';
      return { tier, oran };
    };

    // İkinci geçiş: her Ders VE her Konu için barem hesapla.
    Object.values(byDers).forEach((dersEntry) => {
      const dersTierResult = computeDersTier(dersEntry);
      dersEntry.tier = dersTierResult.tier;
      dersEntry.oran = dersTierResult.oran;

      Object.entries(dersEntry.konular).forEach(([konuName, konuEntry]) => {
        const konuTierResult = computeKonuTier(konuEntry);
        konuEntry.tier = konuTierResult.tier;
        konuEntry.oran = konuTierResult.oran;

        // Kazanım seviyesinde de "Hedefte Değil" yok, sadece doğru oranına
        // göre aynı 3 kademeli barem (Riskli/İyi/Harika). Bu, riskli
        // kazanımların altına kaynak (PDF/video) göstermek için yeterli.
        Object.values(konuEntry.kazanimlar).forEach((kzEntry) => {
          const oran = kzEntry.total > 0 ? kzEntry.correct / kzEntry.total : 0;
          if (oran < 0.4) kzEntry.tier = 'riskli';
          else if (oran < 0.7) kzEntry.tier = 'iyi';
          else kzEntry.tier = 'harika';
        });
      });
    });

    const hasData = Object.keys(byDers).length > 0;
    return { byDers, hasData };
  };

  // Bir sınavın gerçekten ÇÖZÜLEBİLİR olup olmadığını kontrol eder.
  // ÖNEMLİ: numPages (soru sayısı) tek başına yeterli değil -- kazanım
  // haritası hazırlanırken önceden girilmiş olabilir ama asıl PDF hiç
  // yüklenmemiş olabilir (tam bu yüzden "İdare" gibi boş bir sayfaya
  // düşülüyordu). isParent bayrağına da güvenmiyoruz (bazı eski
  // kayıtlarda tutarsız olabiliyor) -- bunun yerine doğrudan: ya kendi
  // PDF'i var mı, ya da en az bir yayınlanmış alt testi var mı diye
  // bakıyoruz. İkisi de yoksa öneri motoru bu sınavı asla önermez.
  const examHasPlayableContent = (exam) => {
    if (!exam) return false;
    const hasOwnPdf = !!exam.pdfFile;
    const hasPublishedChildren = exams.some((c) => c.parentId === exam.id && c.isPublished && c.pdfFile);
    return hasOwnPdf || hasPublishedChildren;
  };

  // Bir aday sınavın öneri motorunda GÖSTERİLEBİLİR olup olmadığını
  // kontrol eder.
  // ÖNEMLİ (bug fix): price=0 her zaman "ücretsiz" demek değil -- bir ALT
  // TEST (parentId dolu) için price=0, admin panelindeki notta da yazdığı
  // gibi "bu test tek başına satılmaz, sadece üst paketi satın alanlar
  // erişebilir" anlamına gelir. Eskiden bu ayrım yapılmıyordu: price=0 olan
  // HER alt test, paketi satın almamış öğrenciye bile doğrudan "Ücretsiz
  // Çöz" olarak öneriliyordu -- oysa öğrenci o teste hiç erişemiyordu.
  // Şimdi: üst seviye (paket) sınavlarda price=0 gerçekten ücretsizdir; alt
  // testlerde ise price=0 VE paket sahipliği yoksa bu test öneri listesine
  // hiç girmez (paketi satın almış bir öğrenciye "owned" üzerinden zaten
  // gösterilmeye devam eder).
  const examIsIndividuallyRecommendable = (exam) => {
    if (!examHasPlayableContent(exam)) return false;
    const owned = !!(studentPurchases[exam.id] || (exam.parentId && studentPurchases[exam.parentId]));
    if (owned) return true;
    const isFree = !exam.parentId && (!exam.price || exam.price <= 0);
    if (isFree) return true;
    return !!(exam.price && exam.price > 0);
  };

  // Bir konuda öğrenci zayıfsa/orta seviyedeyse, o konuya özel testleri
  // önerebilmek için: yayınlanmış sınavlar arasında, topicMap'inin en az
  // %80'i AYNI KONU ID'sine (topic_id) çözülen sınavları buluyoruz.
  // ÖNEMLİ: artık konu ADI değil, GÜNCEL ID karşılaştırılıyor -- bir
  // kazanımın konusu Kategoriler'den değiştirildiğinde, hem bu raporun
  // kendisi hem de burada taranan aday sınavlar aynı canlı ID'ye göre
  // çözüldüğü için öneri motoru asla eski/metin tabanlı bir uyuşmazlık
  // yüzünden doğru testi kaçırmaz.
  // Eskiden eşleşen TÜM testler gösteriliyordu -- artık öğrenciyi
  // boğmamak için TEK bir test öneriyoruz: soru sayısı en AZ olandan
  // başlıyoruz (kısa/kolay bir testle başlayıp pekiştirmesi için).
  const findKonuTestleri = (topicId, excludeExamId) => {
    if (!topicId) return [];
    const matches = exams
      .filter((e) => {
        if (!e.isPublished || e.id === excludeExamId || !e.topicMap) return false;
        // NOT: Burada kasıtlı olarak examIsIndividuallyRecommendable YERİNE
        // examHasPlayableContent kullanıyoruz. Amacımız öğrenciyi satın
        // almaya yönlendirmek -- öğrenci bu testin (veya üst paketinin)
        // sahibi olmasa bile konuya en uygun testi önermeliyiz.
        // renderOneriTestSatiri, sahip olunmayan ve tek başına satılmayan
        // (parentId dolu, price=0) bir alt-test için doğru şekilde üst
        // paketin fiyatını/satın alma linkini gösterir -- bkz. o fonksiyon.
        if (!examHasPlayableContent(e)) return false;
        const entries = Object.values(e.topicMap).filter((t) => t && t.kazanim);
        if (entries.length === 0) return false;
        const matchCount = entries.filter((t) => resolveEntryIds(t).topicId === topicId).length;
        return (matchCount / entries.length) >= 0.8;
      })
      .sort((a, b) => (a.numPages || 0) - (b.numPages || 0));
    return matches.slice(0, 1);
  };

  // AYNI mantık ama KAZANIM (outcome_id) seviyesinde: bir konunun içinde
  // birden fazla kazanım varsa (örn. "Anayasa, İnsan Hakları Hukuku"
  // konusunun altında Yasama/Yürütme/Yargı kazanımları gibi) ve bu
  // kazanımlardan HER BİRİNE ÖZEL, dar kapsamlı bir test varsa (ör. sadece
  // "Yargı" sorularından oluşan bir test), bunu genel konu testi yerine
  // (veya onunla birlikte) önerebilmek için kullanılır. findKonuTestleri
  // sadece TEK bir (konu geneline en uygun) test döndürüyordu -- bu yüzden
  // örn. Yasama/Yürütme/Yargı'nın hepsi aynı konunun altında olduğu için
  // öneri motoru bunlardan sadece birini (rastgele en az soru sayılı olanı)
  // gösterip diğer ikisini hiç önermiyordu. Bu fonksiyon çağrıldığı yerde
  // HER kazanım için AYRI AYRI çalıştırılıp sonuçlar birleştirilir.
  const findKazanimTestleri = (outcomeId, excludeExamId) => {
    if (!outcomeId) return [];
    const matches = exams
      .filter((e) => {
        if (!e.isPublished || e.id === excludeExamId || !e.topicMap) return false;
        if (!examHasPlayableContent(e)) return false;
        const entries = Object.values(e.topicMap).filter((t) => t && t.kazanim);
        if (entries.length === 0) return false;
        const matchCount = entries.filter((t) => resolveEntryIds(t).outcomeId === outcomeId).length;
        return (matchCount / entries.length) >= 0.8;
      })
      .sort((a, b) => (a.numPages || 0) - (b.numPages || 0));
    return matches.slice(0, 1);
  };

  // Bir öğrenci iyi/harika durumdaysa, aynı sınav türünden (ör. "deneme") VE
  // AYNI DERSE (artık ID ile, lessonCategoryId), henüz çözmediği TÜM
  // denemeleri buluyoruz.
  const findOnerilenDenemeler = (excludeExamId, examType, lessonCategoryId) => {
    return exams
      .filter((e) => {
        if (!e.isPublished || e.parentId || e.id === excludeExamId) return false;
        if (e.examType !== (examType || 'deneme')) return false;
        if (studentResultsMap[e.id] && studentResultsMap[e.id].is_finished) return false;
        if (!examIsIndividuallyRecommendable(e)) return false;
        if (!lessonCategoryId) return true;
        if (!e.topicMap) return false;
        const entries = Object.values(e.topicMap).filter((t) => t && t.kazanim);
        if (entries.length === 0) return false;
        const matchCount = entries.filter((t) => resolveEntryIds(t).lessonCategoryId === lessonCategoryId).length;
        return (matchCount / entries.length) >= 0.8;
      })
      .sort((a, b) => (a.price || 0) - (b.price || 0));
  };

  // Barem'e göre kısa, doğal dilde bir öneri cümlesi + aksiyon etiketi.
  // ("Hedefte Değil" konu seviyesinde artık hiç kullanılmıyor -- bkz.
  // computeKonuTier -- bu yüzden switch'te o case yok.)
  // - riskli: test/deneme önermiyoruz, konu anlatımı/videoya yönlendiriyoruz
  //   (asıl kaynak linki -- varsa -- kazanım kırılımında, en altta çıkar).
  // - iyi: bu konuya özel bir test öneriyoruz.
  // - harika: hiçbir şey önermiyoruz -- öğrenci bu konuda zaten iyi durumda.
  const getKonuTavsiyesi = (konuName, konuEntry) => {
    switch (konuEntry.tier) {
      case 'riskli':
        return {
          mesaj: `${konuName} konusunda ciddi bir eksiğin var. Önce konu anlatımı/video ile temelden tekrar etmeni öneririz. Daha sonra önerilen testi çözünüz.`,
          aksiyon: 'video',
        };
      case 'iyi':
        return {
          mesaj: `${konuName} konusuna hakimsin. Daha fazla test çözerek iyice sağlama alabilirsin.`,
          aksiyon: 'konuTesti',
        };
      case 'harika':
        return {
          mesaj: `${konuName} konusunda harikasın! Bu konuyla ilgili şu an için ek bir önerimiz yok.`,
          aksiyon: null,
        };
      default:
        // Normal şartlarda buraya hiç düşülmez (tier her zaman yukarıdakilerden
        // biri olarak atanıyor) -- sadece beklenmedik bir durum için güvenlik ağı.
        return {
          mesaj: `${konuName} konusu için bir değerlendirme oluşturulamadı.`,
          aksiyon: null,
        };
    }
  };

  // Ders (Türkçe/Matematik/Tarih...) seviyesindeki barem'e göre kısa bir
  // değerlendirme + (varsa) aksiyon.
  // - riskli: doğrudan bir kaynak önermek yerine aşağıdaki konu kırılımına
  //   bakmasını öneriyoruz -- aksiyon yok, sadece mesaj.
  // - iyi: aynı dersten yeni bir deneme öneriyoruz (findOnerilenDenemeler).
  // - harika: hiçbir şey önermiyoruz.
  // - hedefDisi: bu dersten HİÇ soru cevaplanmamış -- durumu net biçimde
  //   bildiriyoruz. Buna bir "cevap" beklercesine soru sormuyoruz (arayüzde
  //   bir yanıt alıp değerlendirecek bir mekanizma yok), sadece bilgi
  //   veriyoruz: bu ders hedefindeyse eksik, değilse sorun değil.
  const getDersTavsiyesi = (dersName, dersEntry) => {
    switch (dersEntry.tier) {
      case 'riskli':
        return {
          mesaj: `${dersName} dersinde genel olarak zorlanıyor gibisin. Ayrıntılı rapor ve öneriler için konu başlıklarına tıklayınız.`,
          aksiyon: null,
        };
      case 'iyi':
        return {
          mesaj: `${dersName} dersine genel olarak hakimsin. Daha fazla test çözerek iyice sağlama alabilirsin.`,
          aksiyon: 'deneme',
        };
      case 'harika':
        return {
          mesaj: `${dersName} dersinde harikasın! Bu dersle ilgili şu an için ek bir önerimiz yok.`,
          aksiyon: null,
        };
      case 'hedefDisi':
        return {
          mesaj: `${dersName} dersinden hiç soru cevaplamamışsın. Bu ders hedefinde değilse sorun değil; hedefindeyse en kısa sürede bu dersten de çalışmaya başlamalısın.`,
          aksiyon: null,
        };
      default:
        return { mesaj: `${dersName} dersi için bir değerlendirme oluşturulamadı.`, aksiyon: null };
    }
  };


  const KONU_TIER_META = {
    riskli: { label: 'Riskli', color: '#E24B4A', bg: '#FBE4E2' },
    iyi: { label: 'İyi', color: '#5B9A34', bg: '#EDF6E4' },
    harika: { label: 'Harika', color: '#FFFFFF', bg: '#639922' },
    hedefDisi: { label: 'Hedefte Değil', color: '#FFFFFF', bg: '#111111' },
  };

  // Çubuk her zaman kırmızı zemin üzerine, doğru oranı kadar yeşil dolgu (soldan sağa) şeklinde bölünür.
  const getBaremGreenWidth = (correct, total) => {
    if (!total) return 0;
    return Math.round((correct / total) * 100);
  };

  // Yandaki "doğru/toplam" rakamının rengi 3 kademeli: kırmızı (<%40), turuncu (%40-69), yeşil (>=%70)
  const getBaremTextColor = (correct, total) => {
    if (!total) return 'var(--yt-graphite)';
    const pct = correct / total;
    if (pct >= 0.7) return '#639922';
    if (pct >= 0.4) return '#FF9500';
    return '#E24B4A';
  };

  // Puanlama artık tarayıcıda değil, sunucuda (/api/finish-exam) yapılıyor.
  // Böylece cevap anahtarı sınav bitene kadar hiçbir zaman client'a inmiyor.
  const saveAndFinishExam = async (ratingVal = 0) => {
    const existingRes = studentResultsMap[activeStudentExamId] || {};
    const finalRating = ratingVal > 0 ? ratingVal : (existingRes.rating || 0);

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) {
      alert("Oturumunuz bulunamadı, lütfen tekrar giriş yapın.");
      return;
    }

    try {
      const resp = await fetch('/api/finish-exam', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          examId: activeStudentExamId,
          answers: studentAnswers,
          rating: finalRating
        })
      });
      const result = await resp.json();

      if (!resp.ok) {
        alert("Sonuç kaydedilemedi: " + (result.error || 'Bilinmeyen hata'));
        return;
      }

      // Sınav artık bitti, dönen cevap anahtarını (sadece bu sınav için)
      // yerel state'e işleyip doğru/yanlış tablosunun render edilmesini sağlıyoruz.
      setExams(prev => prev.map(ex => ex.id === activeStudentExamId ? { ...ex, answerKey: result.answerKey || {} } : ex));
      setIsExamFinished(true);
      setShowResults(true);
      setStudentResultsMap(prev => ({
        ...prev,
        [activeStudentExamId]: {
          ...(prev[activeStudentExamId] || {}), // reset_count gibi alanları koru, üzerine yazma
          is_finished: true,
          correct: result.correct,
          wrong: result.wrong,
          empty: result.empty,
          net: result.net,
          answers: studentAnswers,
          rating: finalRating
        }
      }));
      fetchAllRatings();
    } catch (err) {
      console.error("Sonuç kaydedilemedi:", err);
      alert("Sonuç kaydedilirken bir hata oluştu, lütfen tekrar deneyin.");
    }
  };

  // Daha önce bitirilmiş bir sınavın sonucunu tekrar incelerken, cevap
  // anahtarını sunucudan (/api/get-answer-key) çekip yerel state'e işliyoruz.
  // Sunucu, gerçekten bu sınavı bitirdiğinizi doğruladıktan sonra verir.
  const fetchAnswerKeyForReview = async (examId) => {
    const exam = exams.find(e => e.id === examId);
    if (exam && exam.answerKey && Object.keys(exam.answerKey).length > 0) return; // zaten yüklü

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) return;

    try {
      const resp = await fetch('/api/get-answer-key', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ examId })
      });
      const result = await resp.json();
      if (resp.ok) {
        setExams(prev => prev.map(ex => ex.id === examId ? { ...ex, answerKey: result.answerKey || {} } : ex));
      }
    } catch (err) {
      console.error("Cevap anahtarı alınamadı:", err);
    }
  };

  const finishExam = () => {
    const confirmText = activeStudentExam.examType === 'deneme'
      ? "Sınavı bitirmek istediğinize emin misiniz? Bitirdikten sonra cevaplarınızı değiştiremezsiniz, sadece sonuçlarınızı görüntüleyebilirsiniz."
      : "Testi bitirmek istediğinize emin misiniz? Bitirdikten sonra cevaplarınızı değiştiremezsiniz, sadece sonuçlarınızı görüntüleyebilirsiniz.";
    if (window.confirm(confirmText)) {
      saveAndFinishExam(0);
    }
  };

  // Öğrenci başına, bu sınav için izin verilen sıfırlama (baştan çözme) hakkı sayısı.
  const MAX_EXAM_RESETS = 1;

  // Sınavı sıfırlar: cevaplar, süre ve sonuç sunucuda temizlenir, öğrenci
  // 1. sorudan yeniden başlar. Kalan sıfırlama hakkı reset_count ile takip edilir.
  const resetExam = async () => {
    if (!user || !activeStudentExamId || !activeStudentExam) return;

    const existingRes = studentResultsMap[activeStudentExamId] || {};
    const usedResets = existingRes.reset_count || 0;
    if (usedResets >= MAX_EXAM_RESETS) return;

    const kalanHak = MAX_EXAM_RESETS - usedResets;
    const confirmed = window.confirm(
      `Sınavı sıfırlamak istediğinize emin misiniz? Önceki cevaplarınız ve sonucunuz silinecek, 1. sorudan yeniden başlayacaksınız. (Bu işlem sonrası kalan sıfırlama hakkınız: ${kalanHak - 1})`
    );
    if (!confirmed) return;

    const newResetCount = usedResets + 1;
    const freshTimeLeft = activeStudentExam.examType === 'deneme' ? activeStudentExam.duration * 60 : 0;

    try {
      const { error } = await supabase
        .from('student_exams')
        .upsert([
          {
            student_email: user.email,
            exam_id: activeStudentExamId,
            answers: {},
            correct_count: 0,
            wrong_count: 0,
            empty_count: 0,
            net: 0,
            is_finished: false,
            time_left: freshTimeLeft,
            current_page: 1,
            reset_count: newResetCount
          }
        ], { onConflict: 'student_email, exam_id' });

      if (error) {
        alert("Sınav sıfırlanamadı: " + error.message);
        return;
      }

      setStudentResultsMap(prev => ({
        ...prev,
        [activeStudentExamId]: {
          is_finished: false,
          correct: 0,
          wrong: 0,
          empty: 0,
          net: 0,
          answers: {},
          timeLeft: freshTimeLeft,
          currentPage: 1,
          reset_count: newResetCount,
          rating: existingRes.rating || 0,
          reviewText: existingRes.reviewText || ''
        }
      }));

      setStudentAnswers({});
      setStudentCurrentPage(1);
      setTimeLeft(freshTimeLeft);
      setIsExamFinished(false);
      setShowResults(false);
      setViewingSolutionQ(false);
      setIsPaused(true);
      setExamStarted(false);
    } catch (err) {
      console.error("Sınav sıfırlanamadı:", err);
      alert("Sınav sıfırlanırken bir hata oluştu, lütfen tekrar deneyin.");
    }
  };

  const handleRateExamInActiveScreen = async (rate) => {
    if (!user || !activeStudentExamId) return;

    const existingRes = studentResultsMap[activeStudentExamId] || {};
    const answersToSave = existingRes.answers || studentAnswers;
    const correctC = existingRes.correct ?? 0;
    const wrongC = existingRes.wrong ?? 0;
    const emptyC = existingRes.empty ?? 0;
    const netC = existingRes.net ?? 0;
    const isFin = existingRes.is_finished ?? false;

    const { error } = await supabase
      .from('student_exams')
      .upsert([
        {
          student_email: user.email,
          exam_id: activeStudentExamId,
          answers: answersToSave,
          correct_count: correctC,
          wrong_count: wrongC,
          empty_count: emptyC,
          net: netC,
          is_finished: isFin,
          rating: rate
        }
      ], { onConflict: 'student_email, exam_id' });

    if (!error) {
      setStudentResultsMap(prev => ({
        ...prev,
        [activeStudentExamId]: { ...existingRes, rating: rate }
      }));
      fetchAllRatings();
    }
  };

  const handleSubmitReview = async (reviewText) => {
    if (!user || !activeStudentExamId) return;

    const existingRes = studentResultsMap[activeStudentExamId] || {};
    const answersToSave = existingRes.answers || studentAnswers;
    const correctC = existingRes.correct ?? 0;
    const wrongC = existingRes.wrong ?? 0;
    const emptyC = existingRes.empty ?? 0;
    const netC = existingRes.net ?? 0;
    const isFin = existingRes.is_finished ?? false;
    const ratingC = existingRes.rating ?? 0;

    const { error } = await supabase
      .from('student_exams')
      .upsert([
        {
          student_email: user.email,
          exam_id: activeStudentExamId,
          answers: answersToSave,
          correct_count: correctC,
          wrong_count: wrongC,
          empty_count: emptyC,
          net: netC,
          is_finished: isFin,
          rating: ratingC,
          review_text: reviewText
        }
      ], { onConflict: 'student_email, exam_id' });

    if (error) {
      console.error("Yorum kaydedilemedi (review_text kolonu eksik olabilir):", error);
      alert("Yorum kaydedilemedi. Veritabanına 'review_text' kolonu eklenmiş mi kontrol edin.");
    } else {
      setStudentResultsMap(prev => ({
        ...prev,
        [activeStudentExamId]: { ...existingRes, reviewText: reviewText }
      }));
      alert("✓ Yorumunuz kaydedildi, teşekkürler!");
    }
  };

  const reportKey = (examId, qNum) => `${examId}_${qNum}`;

  const handleSubmitQuestionReport = async () => {
    const trimmed = reportText.trim();
    if (!trimmed || !activeStudentExamId || !user || reportSubmitting) return;

    setReportSubmitting(true);
    const { error } = await supabase
      .from('question_reports')
      .insert([
        {
          exam_id: activeStudentExamId,
          question_number: studentCurrentPage,
          student_email: user.email,
          message: trimmed.slice(0, 300)
        }
      ]);
    setReportSubmitting(false);

    if (error) {
      console.error("Bildirim gönderilemedi:", error);
      alert("Bildirim gönderilemedi. Lütfen daha sonra tekrar deneyin.");
      return;
    }

    setReportedQuestions(prev => ({ ...prev, [reportKey(activeStudentExamId, studentCurrentPage)]: true }));
    setReportText('');
    setShowReportModal(false);
    alert("✓ Bildiriminiz alındı, teşekkürler!");
  };

  const fetchProductReviews = async (parentId, childIds) => {
    const allIds = [parentId, ...childIds];
    const { data, error } = await supabase
      .from('student_exams')
      .select('student_email, rating, review_text')
      .in('exam_id', allIds)
      .not('review_text', 'is', null)
      .neq('review_text', '');

    if (!error && data) {
      setProductReviews(data);
    } else if (error) {
      // review_text kolonu henüz eklenmemiş olabilir, sessizce geç
      setProductReviews([]);
    }
  };

  // Giriş yapmış öğrencinin daha önce kaydettiği fatura bilgisini getirir
  // (varsa) ve düzenleme formunu onunla doldurur. checkUserRoleAndSetMode
  // içinden çağrıldığında `user` state'i henüz güncellenmemiş olabileceği
  // için e-postayı parametre olarak da kabul ediyoruz.
  const fetchMyBillingInfo = async (emailOverride) => {
    const email = emailOverride || user?.email;
    if (!email) return;
    const { data, error } = await supabase
      .from('billing_info')
      .select('*')
      .eq('student_email', email)
      .maybeSingle();
    if (!error && data) {
      setMyBillingInfo(data);
      setBillingDraft({
        fullName: data.full_name || '',
        tcKimlikNo: data.tc_kimlik_no || '',
        invoiceEmail: data.invoice_email || '',
        address: data.address || '',
      });
    } else if (error) {
      console.error('Fatura bilgisi okunamadı:', error);
    }
  };

  // Öğrenci "Fatura Bilgilerim" formunu kaydettiğinde çağrılır. TC Kimlik No
  // basit bir uzunluk/rakam kontrolünden geçiriliyor (11 haneli, sadece
  // rakam) -- gerçek bir algoritma doğrulaması (checksum) yapmıyoruz, sadece
  // bariz yanlış girişleri (harf, eksik hane) önlüyoruz.
  // `silent` true ise başarı alert'i göstermez -- ödeme akışındaki zorunlu
  // fatura adımından çağrıldığında (bkz. showBillingGateModal), kaydettikten
  // hemen sonra ödeme onayı diyaloğu açılacağı için ayrı bir "kaydedildi"
  // uyarısı gösterip akışı kesmek istemiyoruz. Başarılıysa true, değilse
  // false döner -- çağıran taraf buna göre bir sonraki adıma geçip
  // geçmeyeceğine karar verir.
  const saveMyBillingInfo = async (silent) => {
    if (!user) return false;
    const { fullName, tcKimlikNo, invoiceEmail, address } = billingDraft;
    if (!fullName.trim() || !tcKimlikNo.trim() || !invoiceEmail.trim() || !address.trim()) {
      alert('Lütfen tüm alanları doldurun.');
      return false;
    }
    if (!/^\d{11}$/.test(tcKimlikNo.trim())) {
      alert('TC Kimlik No 11 haneli ve sadece rakamlardan oluşmalıdır.');
      return false;
    }
    if (!/^\S+@\S+\.\S+$/.test(invoiceEmail.trim())) {
      alert('Geçerli bir fatura e-posta adresi girin.');
      return false;
    }
    setSavingBillingInfo(true);
    const { error } = await supabase
      .from('billing_info')
      .upsert({
        student_email: user.email,
        full_name: fullName.trim(),
        tc_kimlik_no: tcKimlikNo.trim(),
        invoice_email: invoiceEmail.trim(),
        address: address.trim(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'student_email' });
    setSavingBillingInfo(false);
    if (error) {
      alert('Kaydedilemedi: ' + error.message + '\n\n"billing_info" tablosu veritabanında henüz yoksa, önce onu oluşturmak gerekir.');
      return false;
    }
    setMyBillingInfo({
      student_email: user.email,
      full_name: fullName.trim(),
      tc_kimlik_no: tcKimlikNo.trim(),
      invoice_email: invoiceEmail.trim(),
      address: address.trim(),
    });
    if (!silent) alert('Fatura bilgileriniz kaydedildi.');
    return true;
  };

  // ADMIN: tüm öğrencilerin girdiği fatura bilgilerini (RLS admin@yayinevi.com
  // için ayrı bir SELECT politikasıyla tüm satırları görebiliyor) e-posta
  // üzerinden aranabilir şekilde listeler.
  const fetchAllBillingRecords = async (search) => {
    setBillingRecordsLoading(true);
    let query = supabase.from('billing_info').select('*').order('updated_at', { ascending: false });
    if (search && search.trim()) {
      query = query.ilike('student_email', `%${search.trim()}%`);
    }
    const { data, error } = await query;
    setBillingRecordsLoading(false);
    if (!error && data) {
      setBillingRecords(data);
    } else if (error) {
      console.error('Fatura kayıtları okunamadı:', error);
      setBillingRecords([]);
    }
  };

  // ==========================================
  // RENDER: YÖNETİCİ EKRANI
  // ==========================================
  if (user && appMode === 'admin') {
    const adminActiveExam = exams.find(e => e.id === activeAdminExamId);
    const childExams = adminActiveExam ? exams.filter(e => e.parentId === adminActiveExam.id).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)) : [];
    
    const currentPreviewExam = childExams.length > 0 
      ? (childExams.find(e => e.id === activeSubExamId) || childExams[0]) 
      : adminActiveExam;

    const editingExam = activeSubExamId ? childExams.find(e => e.id === activeSubExamId) : null;
    const editingIndex = activeSubExamId ? childExams.findIndex(e => e.id === activeSubExamId) : -1;

    return (
      <div style={{ fontFamily: "'Roboto', 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif", letterSpacing: '-0.01em', maxWidth: '1200px', margin: '0 auto', padding: '20px', color: '#1e293b' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #e2e8f0', paddingBottom: '12px', marginBottom: '20px' }}>
          <h1 style={{ margin: 0, fontSize: '1.4rem', color: '#0f172a' }}>⚙️ Yönetici Paneli ({user.email})</h1>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <TopBannerManageButton />
            <SignupBonusManageButton />
            <button
              onClick={() => { setPricingDraft(String(pricePerQuestion)); setShowPricingSettings(true); }}
              style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', cursor: 'pointer', color: '#0f172a', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              💲 Soru Başı Fiyat
              <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 'normal' }}>(₺{pricePerQuestion})</span>
            </button>
            <button
              onClick={() => setShowAnnounceModal(true)}
              style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', cursor: 'pointer', color: '#0f172a', fontWeight: 'bold' }}
            >
              📢 Duyuru Gönder
            </button>
            <button
              onClick={() => setShowCategoryManager(true)}
              style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', cursor: 'pointer', color: '#0f172a', fontWeight: 'bold' }}
            >
              🗂 Kategoriler
            </button>
            <button
              onClick={() => setShowResourceManager(true)}
              style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', cursor: 'pointer', color: '#0f172a', fontWeight: 'bold' }}
            >
              📚 Kaynaklar
            </button>
            <button
              onClick={() => { setShowReportsAdmin(true); fetchAdminReports(adminReportsFilter); }}
              style={{ position: 'relative', padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', cursor: 'pointer', color: '#0f172a', fontWeight: 'bold' }}
            >
              🚩 Bildirimler
              {openReportsCount > 0 && (
                <span style={{ position: 'absolute', top: '-8px', right: '-8px', backgroundColor: '#dc2626', color: '#fff', borderRadius: '999px', fontSize: '0.7rem', minWidth: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
                  {openReportsCount}
                </span>
              )}
            </button>
            <button
              onClick={() => { setShowBillingAdmin(true); fetchAllBillingRecords(billingSearch); }}
              style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', cursor: 'pointer', color: '#0f172a', fontWeight: 'bold' }}
            >
              🧾 Faturalar
            </button>
            <button onClick={handleLogout} style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', cursor: 'pointer', color: '#dc2626', fontWeight: 'bold' }}>Çıkış Yap</button>
          </div>
        </header>

        {showPricingSettings && (
          <div
            onClick={() => setShowPricingSettings(false)}
            style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ backgroundColor: '#fff', borderRadius: '12px', padding: '22px', width: '400px', maxWidth: '100%' }}
            >
              <h3 style={{ margin: '0 0 6px 0', fontSize: '1.05rem', color: '#0f172a' }}>💲 Soru Başı Fiyat</h3>
              <p style={{ margin: '0 0 14px 0', fontSize: '0.82rem', color: '#64748b' }}>
                Bu tutar, bir testin/paketin "Soru / Sayfa Sayısı" alanı her değiştiğinde (elle ya da PDF yüklenip otomatik algılandığında), Fiyat ve Eski Fiyat'ı <b>soru sayısı × bu tutar</b> olarak otomatik hesaplar -- daha önce girilmiş manuel bir indirim varsa bile üzerine yazar. İndirim uygulamak isterseniz, hesaplama sonrası Fiyat alanını elle düşürebilirsiniz; Eski Fiyat, listedeki referans fiyat olarak kalır.
              </p>
              <label style={{ fontSize: '0.8rem', color: '#475569', display: 'block', marginBottom: '4px' }}>Soru başına tutar (₺)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={pricingDraft}
                onChange={(e) => setPricingDraft(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', boxSizing: 'border-box', fontSize: '0.9rem', marginBottom: '16px' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" onClick={() => setShowPricingSettings(false)} style={{ padding: '8px 14px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#fff', cursor: 'pointer' }}>
                  Vazgeç
                </button>
                <button
                  type="button"
                  onClick={() => savePricePerQuestion(pricingDraft)}
                  style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', backgroundColor: '#0f172a', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }}
                >
                  Kaydet
                </button>
              </div>

              <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid #e2e8f0' }}>
                <button
                  type="button"
                  onClick={recalculateAllExamPrices}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', color: '#0f172a', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.84rem' }}
                >
                  🔄 Güncel Fiyata Göre Tüm Testleri Yeniden Hesapla
                </button>
                <p style={{ margin: '6px 0 0 0', fontSize: '0.72rem', color: '#94a3b8' }}>
                  Sistemde soru sayısı girilmiş TÜM test/paketlerin fiyatını, yukarıdaki güncel tutara göre yeniden hesaplar -- daha önce hiç dokunulmamış eski kayıtları da kapsar. Fiyatı sonradan artırırsanız/azaltırsanız da bunu kullanabilirsiniz.
                </p>
              </div>
            </div>
          </div>
        )}

        {showAnnounceModal && (
          <div
            onClick={() => !announceSending && setShowAnnounceModal(false)}
            style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }}
          >
            <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: '480px', backgroundColor: '#fff', borderRadius: '12px', padding: '22px' }}>
              <h3 style={{ margin: '0 0 14px 0', fontSize: '1.1rem', color: '#0f172a' }}>📢 Yeni Duyuru</h3>

              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', color: '#334155', marginBottom: '4px' }}>Başlık</label>
              <input
                type="text"
                value={announceTitle}
                onChange={(e) => setAnnounceTitle(e.target.value)}
                placeholder="Örn: Yeni TYT Deneme Sınavı Eklendi!"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', marginBottom: '12px', fontSize: '0.88rem' }}
              />

              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', color: '#334155', marginBottom: '4px' }}>Mesaj</label>
              <textarea
                value={announceMessage}
                onChange={(e) => setAnnounceMessage(e.target.value)}
                rows={3}
                placeholder="Duyuru içeriği..."
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', marginBottom: '12px', fontSize: '0.88rem', fontFamily: 'inherit', resize: 'vertical' }}
              />

              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', color: '#334155', marginBottom: '4px' }}>Kime Gönderilsin?</label>
              <select
                value={announceAudience}
                onChange={(e) => setAnnounceAudience(e.target.value)}
                style={{ width: '100%', padding: '9px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', marginBottom: '12px', fontSize: '0.88rem' }}
              >
                <option value="all">Tüm Üyelere</option>
                <option value="buyers">Belirli Bir Ürünü Alanlara</option>
                <option value="exam_type">Belirli Bir Sınav Türü Alanlara</option>
                <option value="single">Tek Bir Öğrenciye</option>
              </select>

              {announceAudience === 'buyers' && (
                <select
                  value={announceExamId}
                  onChange={(e) => setAnnounceExamId(e.target.value)}
                  style={{ width: '100%', padding: '9px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', marginBottom: '12px', fontSize: '0.88rem' }}
                >
                  <option value="">Ürün / Paket Seçin</option>
                  {exams.filter(e => !e.parentId).map(pe => (
                    <option key={pe.id} value={pe.id}>{pe.name || 'İsimsiz İçerik'}</option>
                  ))}
                </select>
              )}

              {announceAudience === 'exam_type' && (
                <select
                  value={announceExamType}
                  onChange={(e) => setAnnounceExamType(e.target.value)}
                  style={{ width: '100%', padding: '9px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', marginBottom: '12px', fontSize: '0.88rem' }}
                >
                  <option value="">Sınav Türü Seçin</option>
                  {Array.from(new Set(exams.filter(e => !e.parentId && e.categoryExamType).map(e => e.categoryExamType.trim()))).map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              )}

              {announceAudience === 'single' && (
                <input
                  type="email"
                  value={announceStudentEmail}
                  onChange={(e) => setAnnounceStudentEmail(e.target.value)}
                  placeholder="ogrenci@example.com"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', marginBottom: '12px', fontSize: '0.88rem' }}
                />
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
                <button onClick={() => setShowAnnounceModal(false)} disabled={announceSending} style={{ padding: '9px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#f1f5f9', cursor: 'pointer' }}>Vazgeç</button>
                <button
                  onClick={sendAnnouncement}
                  disabled={announceSending || !announceTitle.trim() || !announceMessage.trim()}
                  style={{ padding: '9px 16px', borderRadius: '6px', border: 'none', backgroundColor: '#0f172a', color: '#fff', cursor: 'pointer', fontWeight: 'bold', opacity: (announceSending || !announceTitle.trim() || !announceMessage.trim()) ? 0.5 : 1 }}
                >
                  {announceSending ? 'Gönderiliyor...' : 'Gönder'}
                </button>
              </div>
            </div>
          </div>
        )}


        {showReportsAdmin && (
          <div style={{ marginBottom: '20px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
              <h2 style={{ margin: 0, fontSize: '1.15rem' }}>🚩 Soru / Çözüm Bildirimleri</h2>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <select
                  value={adminReportsFilter}
                  onChange={(e) => { setAdminReportsFilter(e.target.value); fetchAdminReports(e.target.value); }}
                  style={{ padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                >
                  <option value="open">Açık Bildirimler</option>
                  <option value="resolved">Çözülenler</option>
                  <option value="all">Tümü</option>
                </select>
                <button onClick={() => setShowReportsAdmin(false)} style={{ padding: '7px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#f1f5f9', cursor: 'pointer' }}>Kapat</button>
              </div>
            </div>

            {adminReportsLoading ? (
              <p style={{ color: '#64748b' }}>Yükleniyor...</p>
            ) : adminReports.length === 0 ? (
              <p style={{ color: '#64748b' }}>Bu filtrede bildirim bulunmuyor.</p>
            ) : (
              <div style={{ display: 'grid', gap: '10px' }}>
                {adminReports.map(rep => {
                  const relatedExam = exams.find(e => e.id === rep.exam_id);
                  return (
                    <div key={rep.id} style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 14px', backgroundColor: '#f8fafc' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px', marginBottom: '6px' }}>
                        <span style={{ fontWeight: 'bold', fontSize: '0.88rem', color: '#0f172a' }}>
                          {relatedExam ? relatedExam.name : rep.exam_id} · {rep.question_number}. Soru
                        </span>
                        <span style={{ fontSize: '0.76rem', color: '#94a3b8' }}>
                          {new Date(rep.created_at).toLocaleString('tr-TR')}
                        </span>
                      </div>
                      <p style={{ margin: '0 0 8px 0', fontSize: '0.88rem', color: '#334155', whiteSpace: 'pre-wrap' }}>{rep.message}</p>

                      {rep.admin_reply && (
                        <div style={{ backgroundColor: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '6px', padding: '8px 10px', marginBottom: '8px' }}>
                          <span style={{ fontSize: '0.72rem', fontWeight: 'bold', color: '#047857' }}>Yanıtınız:</span>
                          <p style={{ margin: '2px 0 0 0', fontSize: '0.84rem', color: '#065f46', whiteSpace: 'pre-wrap' }}>{rep.admin_reply}</p>
                        </div>
                      )}

                      {rep.status === 'open' && (
                        <div style={{ marginBottom: '8px' }}>
                          <textarea
                            value={replyDrafts[rep.id] || ''}
                            onChange={(e) => setReplyDrafts(prev => ({ ...prev, [rep.id]: e.target.value }))}
                            placeholder="Öğrenciye yanıt yazın..."
                            rows={2}
                            style={{ width: '100%', boxSizing: 'border-box', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.84rem', fontFamily: 'inherit', resize: 'vertical' }}
                          />
                        </div>
                      )}

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                        <span style={{ fontSize: '0.76rem', color: '#64748b' }}>{rep.student_email || 'E-posta yok'}</span>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          {rep.status === 'open' && (
                            <button
                              onClick={() => submitReportReply(rep.id)}
                              disabled={!(replyDrafts[rep.id] || '').trim()}
                              style={{ padding: '6px 10px', borderRadius: '6px', border: 'none', backgroundColor: '#0f172a', color: '#fff', cursor: (replyDrafts[rep.id] || '').trim() ? 'pointer' : 'not-allowed', opacity: (replyDrafts[rep.id] || '').trim() ? 1 : 0.5, fontSize: '0.78rem', fontWeight: 'bold' }}
                            >
                              ✉ Yanıtla ve Çözüldü İşaretle
                            </button>
                          )}
                          {rep.status === 'open' ? (
                            <button onClick={() => markReportStatus(rep.id, 'resolved')} style={{ padding: '6px 10px', borderRadius: '6px', border: 'none', backgroundColor: '#16a34a', color: '#fff', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 'bold' }}>
                              ✓ Çözüldü İşaretle
                            </button>
                          ) : (
                            <button onClick={() => markReportStatus(rep.id, 'open')} style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#fff', color: '#0f172a', cursor: 'pointer', fontSize: '0.78rem' }}>
                              ↺ Tekrar Aç
                            </button>
                          )}
                          <button onClick={() => deleteAdminReport(rep.id)} style={{ padding: '6px 10px', borderRadius: '6px', border: 'none', backgroundColor: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 'bold' }}>
                            Sil
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}


        {showBillingAdmin && (
          <div style={{ marginBottom: '20px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
              <h2 style={{ margin: 0, fontSize: '1.15rem' }}>🧾 Fatura Bilgileri ({billingRecords.length})</h2>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  type="text"
                  value={billingSearch}
                  onChange={(e) => setBillingSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') fetchAllBillingRecords(billingSearch); }}
                  placeholder="E-posta ile ara..."
                  style={{ padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                />
                <button onClick={() => fetchAllBillingRecords(billingSearch)} style={{ padding: '7px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#f1f5f9', cursor: 'pointer' }}>Ara</button>
                <button onClick={() => setShowBillingAdmin(false)} style={{ padding: '7px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#f1f5f9', cursor: 'pointer' }}>Kapat</button>
              </div>
            </div>

            {billingRecordsLoading ? (
              <p style={{ color: '#64748b' }}>Yükleniyor...</p>
            ) : billingRecords.length === 0 ? (
              <p style={{ color: '#64748b' }}>Kayıt bulunamadı. (Öğrenciler "Sınavlarım" sayfasından fatura bilgilerini kendileri girer.)</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '2px solid #e2e8f0' }}>
                      <th style={{ padding: '8px' }}>Öğrenci E-posta</th>
                      <th style={{ padding: '8px' }}>Ad Soyad</th>
                      <th style={{ padding: '8px' }}>TC Kimlik No</th>
                      <th style={{ padding: '8px' }}>Fatura E-posta</th>
                      <th style={{ padding: '8px' }}>Adres</th>
                      <th style={{ padding: '8px' }}>Son Güncelleme</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billingRecords.map((rec) => (
                      <tr key={rec.student_email} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px' }}>{rec.student_email}</td>
                        <td style={{ padding: '8px' }}>{rec.full_name}</td>
                        <td style={{ padding: '8px', fontFamily: 'monospace' }}>{rec.tc_kimlik_no}</td>
                        <td style={{ padding: '8px' }}>{rec.invoice_email}</td>
                        <td style={{ padding: '8px', maxWidth: '260px', whiteSpace: 'pre-wrap' }}>{rec.address}</td>
                        <td style={{ padding: '8px', color: '#94a3b8', fontSize: '0.76rem' }}>
                          {rec.updated_at ? new Date(rec.updated_at).toLocaleString('tr-TR') : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}


        {showCategoryManager && (
          <div
            style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }}
            onClick={() => setShowCategoryManager(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ backgroundColor: '#ffffff', borderRadius: '12px', padding: '20px', width: '600px', maxWidth: '100%', maxHeight: '84vh', display: 'flex', flexDirection: 'column' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h2 style={{ margin: 0, fontSize: '1.15rem' }}>🗂 Kategori Yönetimi</h2>
                <button onClick={() => setShowCategoryManager(false)} style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#f1f5f9', cursor: 'pointer' }}>Kapat</button>
              </div>

              <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '10px' }}>
                Sınav Türü → Ders Türü → Konu → Kazanım sırasıyla, ok işaretine tıklayarak
                açıp kapatabilirsiniz. ✏️ ile adını düzeltebilir, 🗑 ile silebilirsiniz.
                Şu an bir soruya (Kazanım Haritası'na) atanmış bir kayıt silinemez -- önce
                o soru(lar)ın kazanımını değiştirmeniz gerekir.
              </div>

              <div style={{ overflowY: 'auto', flex: 1 }}>
                {examCategories.length === 0 ? (
                  <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Henüz sınav türü eklenmedi.</p>
                ) : (
                  examCategories.map((cat) => {
                    const isExamOpen = !!expandedExamIds[cat.id];
                    const childLessons = lessonCategories.filter((lc) => lc.exam_category_id === cat.id);
                    return (
                      <div key={cat.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 4px' }}>
                          <button
                            type="button"
                            onClick={() => setExpandedExamIds((prev) => ({ ...prev, [cat.id]: !prev[cat.id] }))}
                            style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.8rem', color: '#64748b', width: '18px', padding: 0 }}
                          >
                            {isExamOpen ? '▾' : '▸'}
                          </button>
                          <span style={{ fontSize: '0.9rem', fontWeight: 'bold', flex: 1, color: '#0f172a' }}>{cat.name}</span>
                          <button
                            type="button"
                            onClick={() => renameExamCategory(cat.id, cat.name)}
                            title="Adını düzenle"
                            style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.9rem', padding: '2px 5px' }}
                          >
                            ✏️
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (blockDeleteIfInUse('exam', cat, cat.name)) return;
                              const childCount = childLessons.length;
                              const warn = childCount > 0 ? `\n\nBu sınav türüne bağlı ${childCount} ders türü de (ve onlara bağlı konu/kazanımlar) birlikte silinecek.` : '';
                              if (window.confirm(`"${cat.name}" sınav türünü silmek istediğinize emin misiniz?${warn}`)) deleteExamCategory(cat.id);
                            }}
                            style={{ padding: '4px 9px', borderRadius: '6px', border: 'none', backgroundColor: '#fee2e2', color: '#dc2626', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 'bold' }}
                          >
                            🗑
                          </button>
                        </div>

                        {isExamOpen && (
                          <div style={{ paddingLeft: '24px', paddingBottom: '4px' }}>
                            {childLessons.length === 0 ? (
                              <p style={{ color: '#cbd5e1', fontSize: '0.78rem', padding: '4px 6px' }}>Bu sınav türüne bağlı ders türü yok.</p>
                            ) : (
                              childLessons.map((lc) => {
                                const isLessonOpen = !!expandedLessonIds[lc.id];
                                const childTopics = topics.filter((t) => t.lesson_category_id === lc.id);
                                return (
                                  <div key={lc.id} style={{ borderTop: '1px solid #f8fafc' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 4px' }}>
                                      <button
                                        type="button"
                                        onClick={() => setExpandedLessonIds((prev) => ({ ...prev, [lc.id]: !prev[lc.id] }))}
                                        style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.78rem', color: '#64748b', width: '18px', padding: 0 }}
                                      >
                                        {isLessonOpen ? '▾' : '▸'}
                                      </button>
                                      <span style={{ fontSize: '0.85rem', flex: 1, color: '#1e293b' }}>{lc.name}</span>
                                      <button
                                        type="button"
                                        onClick={() => renameLessonCategory(lc.id, lc.name)}
                                        title="Adını düzenle"
                                        style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.85rem', padding: '2px 5px' }}
                                      >
                                        ✏️
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (blockDeleteIfInUse('lesson', lc, lc.name)) return;
                                          const childCount = childTopics.length;
                                          const warn = childCount > 0 ? `\n\nBu ders türüne bağlı ${childCount} konu da (ve onlara bağlı kazanımlar) birlikte silinecek.` : '';
                                          if (window.confirm(`"${lc.name}" ders türünü silmek istediğinize emin misiniz?${warn}`)) deleteLessonCategory(lc.id);
                                        }}
                                        style={{ padding: '4px 8px', borderRadius: '6px', border: 'none', backgroundColor: '#fee2e2', color: '#dc2626', cursor: 'pointer', fontSize: '0.74rem', fontWeight: 'bold' }}
                                      >
                                        🗑
                                      </button>
                                    </div>

                                    {isLessonOpen && (
                                      <div style={{ paddingLeft: '24px', paddingBottom: '4px' }}>
                                        {childTopics.length === 0 ? (
                                          <p style={{ color: '#cbd5e1', fontSize: '0.76rem', padding: '4px 6px' }}>Bu ders türüne bağlı konu yok.</p>
                                        ) : (
                                          childTopics.map((t) => {
                                            const isTopicOpen = !!expandedTopicIds[t.id];
                                            const childOutcomes = learningOutcomes.filter((o) => o.topic_id === t.id);
                                            return (
                                              <div key={t.id} style={{ borderTop: '1px solid #f8fafc' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 4px' }}>
                                                  <button
                                                    type="button"
                                                    onClick={() => setExpandedTopicIds((prev) => ({ ...prev, [t.id]: !prev[t.id] }))}
                                                    style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.76rem', color: '#64748b', width: '18px', padding: 0 }}
                                                  >
                                                    {isTopicOpen ? '▾' : '▸'}
                                                  </button>
                                                  <span style={{ fontSize: '0.82rem', flex: 1, color: '#334155' }}>{t.name}</span>
                                                  <button
                                                    type="button"
                                                    onClick={() => renameTopic(t.id, t.name)}
                                                    title="Adını düzenle"
                                                    style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.82rem', padding: '2px 5px' }}
                                                  >
                                                    ✏️
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => {
                                                      if (blockDeleteIfInUse('topic', t, t.name)) return;
                                                      const childCount = childOutcomes.length;
                                                      const warn = childCount > 0 ? `\n\nBu konuya bağlı ${childCount} kazanım da birlikte silinecek.` : '';
                                                      if (window.confirm(`"${t.name}" konusunu silmek istediğinize emin misiniz?${warn}`)) deleteTopic(t.id);
                                                    }}
                                                    style={{ padding: '4px 8px', borderRadius: '6px', border: 'none', backgroundColor: '#fee2e2', color: '#dc2626', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 'bold' }}
                                                  >
                                                    🗑
                                                  </button>
                                                </div>

                                                {isTopicOpen && (
                                                  <div style={{ paddingLeft: '24px', paddingBottom: '6px' }}>
                                                    {childOutcomes.length === 0 ? (
                                                      <p style={{ color: '#cbd5e1', fontSize: '0.74rem', padding: '4px 6px' }}>Bu konuya bağlı kazanım yok.</p>
                                                    ) : (
                                                      childOutcomes.map((o) => (
                                                        <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 4px', borderTop: '1px solid #f8fafc' }}>
                                                          <span style={{ width: '18px', flexShrink: 0 }} />
                                                          <span style={{ fontSize: '0.8rem', flex: 1, color: '#475569' }}>{o.name}</span>
                                                          <button
                                                            type="button"
                                                            onClick={() => renameLearningOutcome(o.id, o.name)}
                                                            title="Adını düzenle"
                                                            style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.8rem', padding: '2px 5px' }}
                                                          >
                                                            ✏️
                                                          </button>
                                                          <button
                                                            type="button"
                                                            onClick={() => {
                                                              if (blockDeleteIfInUse('outcome', o, o.name)) return;
                                                              if (window.confirm(`"${o.name}" kazanımını silmek istediğinize emin misiniz?`)) deleteLearningOutcome(o.id);
                                                            }}
                                                            style={{ padding: '4px 8px', borderRadius: '6px', border: 'none', backgroundColor: '#fee2e2', color: '#dc2626', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 'bold' }}
                                                          >
                                                            🗑
                                                          </button>
                                                        </div>
                                                      ))
                                                    )}
                                                  </div>
                                                )}
                                              </div>
                                            );
                                          })
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {showResourceManager && (
          <div
            style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }}
            onClick={() => setShowResourceManager(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ backgroundColor: '#ffffff', borderRadius: '12px', padding: '20px', width: '760px', maxWidth: '100%', maxHeight: '84vh', display: 'flex', flexDirection: 'column' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h2 style={{ margin: 0, fontSize: '1.15rem' }}>📚 Kazanım Kaynakları</h2>
                <button onClick={() => setShowResourceManager(false)} style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#f1f5f9', cursor: 'pointer' }}>Kapat</button>
              </div>

              <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '10px' }}>
                Bir kazanıma ders notu (PDF) ve/veya video linki ekleyin -- öğrenci o kazanımda
                riskli çıkarsa, sonuç ekranında otomatik olarak burada eklediğiniz kaynak gösterilir.
                Önce bir Ders Türü seçin.
              </div>

              <select
                value={resourceManagerDersId || ''}
                onChange={(e) => setResourceManagerDersId(e.target.value ? Number(e.target.value) : null)}
                style={{ padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', marginBottom: '14px' }}
              >
                <option value="">Ders Türü seçin...</option>
                {lessonCategories.map((lc) => {
                  const cat = examCategories.find((c) => c.id === lc.exam_category_id);
                  return <option key={lc.id} value={lc.id}>{cat ? `${cat.name} · ${lc.name}` : lc.name}</option>;
                })}
              </select>

              <div style={{ overflowY: 'auto', flex: 1 }}>
                {!resourceManagerDersId ? (
                  <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Kazanımları görmek için önce bir Ders Türü seçin.</p>
                ) : (() => {
                  const dersTopics = topics.filter((t) => t.lesson_category_id === resourceManagerDersId);
                  const relevantOutcomes = learningOutcomes.filter((lo) => dersTopics.some((t) => t.id === lo.topic_id));
                  if (relevantOutcomes.length === 0) {
                    return <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Bu ders türünde henüz kazanım yok.</p>;
                  }
                  return dersTopics.map((topic) => {
                    const topicOutcomes = relevantOutcomes.filter((lo) => lo.topic_id === topic.id);
                    if (topicOutcomes.length === 0) return null;
                    return (
                      <div key={topic.id} style={{ marginBottom: '14px' }}>
                        <div style={{ fontSize: '0.82rem', fontWeight: 'bold', color: '#334155', marginBottom: '6px' }}>{topic.name}</div>
                        {topicOutcomes.map((lo) => {
                          const resource = learningOutcomeResources[lo.id] || {};
                          const draftVideo = resourceVideoDrafts[lo.id] !== undefined ? resourceVideoDrafts[lo.id] : (resource.video_url || '');
                          return (
                            <div key={lo.id} style={{ display: 'grid', gridTemplateColumns: '1fr 160px 220px', gap: '8px', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
                              <span style={{ fontSize: '0.84rem' }}>{lo.name}</span>

                              <div>
                                {resource.pdf_url ? (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                    <a href={resource.pdf_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.76rem', color: '#0f6e56' }}>📄 {resource.pdf_filename || 'Dosya'}</a>
                                    <label style={{ fontSize: '0.72rem', color: '#334155', cursor: 'pointer', textDecoration: 'underline' }}>
                                      Değiştir
                                      <input
                                        type="file"
                                        accept="application/pdf"
                                        style={{ display: 'none' }}
                                        onChange={(e) => { if (e.target.files[0]) uploadKazanimPdf(lo.id, e.target.files[0]); e.target.value = ''; }}
                                      />
                                    </label>
                                    <button onClick={() => removeKazanimPdf(lo.id)} style={{ border: 'none', background: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '0.76rem' }}>✕</button>
                                  </div>
                                ) : (
                                  <label style={{ fontSize: '0.76rem', color: '#0f6e56', cursor: 'pointer', border: '1px dashed #cbd5e1', borderRadius: '6px', padding: '4px 8px', display: 'inline-block' }}>
                                    + PDF Yükle
                                    <input
                                      type="file"
                                      accept="application/pdf"
                                      style={{ display: 'none' }}
                                      onChange={(e) => { if (e.target.files[0]) uploadKazanimPdf(lo.id, e.target.files[0]); e.target.value = ''; }}
                                    />
                                  </label>
                                )}
                              </div>

                              <div style={{ display: 'flex', gap: '4px' }}>
                                <input
                                  type="text"
                                  placeholder="YouTube linki..."
                                  value={draftVideo}
                                  onChange={(e) => setResourceVideoDrafts((prev) => ({ ...prev, [lo.id]: e.target.value }))}
                                  style={{ flex: 1, fontSize: '0.76rem', padding: '5px 6px', border: '1px solid #e2e8f0', borderRadius: '4px', boxSizing: 'border-box' }}
                                />
                                <button
                                  onClick={() => saveKazanimVideoUrl(lo.id, draftVideo)}
                                  style={{ fontSize: '0.72rem', padding: '5px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', backgroundColor: '#fff', cursor: 'pointer' }}
                                >Kaydet</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        )}


        {showBulkImport && (
          <div
            style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }}
            onClick={() => { if (!bulkImporting) setShowBulkImport(false); }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ backgroundColor: '#ffffff', borderRadius: '12px', padding: '20px', width: '760px', maxWidth: '100%', maxHeight: '84vh', display: 'flex', flexDirection: 'column' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h2 style={{ margin: 0, fontSize: '1.15rem' }}>📥 Excel'den Toplu Test Yükle</h2>
                {!bulkImporting && (
                  <button onClick={() => { setShowBulkImport(false); setBulkExcelRows([]); setBulkPdfFiles(new Map()); setBulkImportErrors([]); }} style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#f1f5f9', cursor: 'pointer' }}>Kapat</button>
                )}
              </div>

              <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '10px' }}>
                Sütun sırası: 1. İçerik Adı, 2. Sınav PDF (dosya adı), 3. Çözüm PDF (dosya adı, opsiyonel), 4. Hızlı Cevap Anahtarı (opsiyonel).
                İlk satır başlık kabul edilir. Soru/Sayfa sayısı artık PDF'ten otomatik okunur, Excel'e girmenize gerek yok. Kazanım haritası bu ekrandan girilmez -- testler eklendikten sonra "Testleri Yönet"ten tek tek elle eklersiniz.
              </div>

              <button
                type="button"
                onClick={downloadBulkImportTemplate}
                style={{ alignSelf: 'flex-start', marginBottom: '14px', padding: '6px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', color: '#334155', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 'bold' }}
              >
                📥 Boş Excel Şablonu İndir
              </button>

              <div style={{ display: 'flex', gap: '16px', marginBottom: '14px', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 300px' }}>
                  <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.8rem', marginBottom: '4px' }}>1. Excel Dosyası</label>
                  <input type="file" accept=".xlsx,.xls" onChange={handleBulkExcelSelect} disabled={bulkImporting} style={{ fontSize: '0.8rem', width: '100%' }} />
                  {bulkExcelRows.length > 0 && <div style={{ fontSize: '0.76rem', color: '#16a34a', marginTop: '4px' }}>✓ {bulkExcelRows.length} satır okundu.</div>}
                </div>
                <div style={{ flex: '1 1 300px' }}>
                  <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.8rem', marginBottom: '4px' }}>2. PDF Dosyaları (sınav + çözüm, hepsi bir arada)</label>
                  <input type="file" accept="application/pdf" multiple onChange={handleBulkPdfSelect} disabled={bulkImporting} style={{ fontSize: '0.8rem', width: '100%' }} />
                  {bulkPdfFiles.size > 0 && <div style={{ fontSize: '0.76rem', color: '#16a34a', marginTop: '4px' }}>✓ {bulkPdfFiles.size} dosya seçildi.</div>}
                </div>
              </div>

              {bulkExcelRows.length > 0 && (
                <div style={{ overflowY: 'auto', flex: 1, border: '1px solid #f1f5f9', borderRadius: '8px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f8fafc', position: 'sticky', top: 0 }}>
                        <th style={{ textAlign: 'left', padding: '6px 8px' }}>İçerik Adı</th>
                        <th style={{ textAlign: 'left', padding: '6px 8px' }}>Sınav PDF</th>
                        <th style={{ textAlign: 'left', padding: '6px 8px' }}>Çözüm PDF</th>
                        <th style={{ textAlign: 'left', padding: '6px 8px' }}>Cevap</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkExcelRows.map((row, i) => {
                        const sinavOk = row.sinavPdfName && bulkPdfFiles.has(row.sinavPdfName.toLowerCase());
                        const cozumOk = !row.cozumPdfName || bulkPdfFiles.has(row.cozumPdfName.toLowerCase());
                        return (
                          <tr key={i} style={{ borderTop: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '5px 8px' }}>{row.name}</td>
                            <td style={{ padding: '5px 8px', color: sinavOk ? '#16a34a' : '#dc2626' }}>
                              {row.sinavPdfName ? (sinavOk ? '✓ ' : '✗ ') + row.sinavPdfName : '—'}
                            </td>
                            <td style={{ padding: '5px 8px', color: cozumOk ? '#16a34a' : '#dc2626' }}>
                              {row.cozumPdfName ? (cozumOk ? '✓ ' : '✗ ') + row.cozumPdfName : '—'}
                            </td>
                            <td style={{ padding: '5px 8px', fontFamily: 'monospace' }}>{row.cevapAnahtari ? `${row.cevapAnahtari.length} harf` : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {bulkImportErrors.length > 0 && (
                <div style={{ marginTop: '10px', padding: '10px', backgroundColor: '#fef2f2', borderRadius: '6px', maxHeight: '120px', overflowY: 'auto' }}>
                  {bulkImportErrors.map((err, i) => (
                    <div key={i} style={{ fontSize: '0.74rem', color: '#dc2626' }}>{err}</div>
                  ))}
                </div>
              )}

              <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '10px' }}>
                {bulkImporting && (
                  <span style={{ fontSize: '0.82rem', color: '#334155' }}>
                    {bulkImportProgress.current} / {bulkImportProgress.total} işleniyor...
                  </span>
                )}
                <button
                  onClick={runBulkImport}
                  disabled={bulkImporting || bulkExcelRows.length === 0}
                  className="yt-btn yt-btn-primary"
                  style={{ opacity: (bulkImporting || bulkExcelRows.length === 0) ? 0.5 : 1 }}
                >
                  {bulkImporting ? 'Yükleniyor...' : `${bulkExcelRows.length || ''} Testi İçe Aktar`}
                </button>
              </div>
            </div>
          </div>
        )}


        {authLoading && (
          <div style={{ textAlign: 'center', padding: '10px', backgroundColor: 'var(--yt-mustard-bg)', color: 'var(--yt-mustard-deep)', marginBottom: '16px', borderRadius: '6px', fontWeight: 'bold' }}>
            ⏳ İşlem yapılıyor, lütfen bekleyin...
          </div>
        )}

        {!adminActiveExam && !isCreatingExam ? (
          <div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0 }}>Tüm Sınavlar ve Paketler</h2>
              <button onClick={handleStartCreateExam} className="yt-btn yt-btn-primary">
                + Yeni Sınav / Paket Oluştur
              </button>
            </div>

            {exams.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px', backgroundColor: '#f8fafc', borderRadius: '12px', border: '1px dashed #cbd5e1' }}>
                <p style={{ color: '#64748b' }}>Henüz sisteme yüklenmiş bir içerik yok.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '16px' }}>
                {exams.filter(e => !e.parentId).map(parentExam => (
                  <div key={parentExam.id} className="exam-card" style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                    
                    <div className="exam-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', backgroundColor: '#f8fafc' }}>
                      <div>
                        <h3 style={{ margin: '0 0 8px 0', color: '#0f172a' }}>
                          📦 {parentExam.name || 'İsimsiz İçerik'}
                        </h3>
                        <div style={{ display: 'flex', gap: '12px', fontSize: '0.85rem', color: '#64748b' }}>
                          <span style={{ color: parentExam.isPublished ? '#16a34a' : '#ef4444', fontWeight: 'bold' }}>
                            {parentExam.isPublished ? '● Yayında' : '○ Taslak'}
                          </span>
                          <span>₺{parentExam.price || 0}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button 
                          className="btn-define-exam" 
                          onClick={() => handleOpenDefinitionScreen(parentExam.id)}
                          style={{ padding: '8px 12px', borderRadius: '6px', backgroundColor: '#e0e7ff', color: '#4338ca', cursor: 'pointer', fontWeight: 'bold', border: '1px dashed #4338ca' }}
                        >
                          📝 Testleri Yönet
                        </button>
                        <button
                          onClick={() => { setBulkImportParentId(parentExam.id); setShowBulkImport(true); }}
                          style={{ padding: '8px 12px', borderRadius: '6px', backgroundColor: '#dcfce7', color: '#15803d', cursor: 'pointer', fontWeight: 'bold', border: '1px dashed #15803d' }}
                        >
                          📥 Excel'den Toplu Test Yükle
                        </button>
                        <button onClick={() => togglePublish(parentExam.id)} style={{ padding: '8px 12px', borderRadius: '6px', border: 'none', backgroundColor: parentExam.isPublished ? '#f59e0b' : '#16a34a', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }}>
                          {parentExam.isPublished ? 'Yayından Kaldır' : 'Yayınla'}
                        </button>
                        <button onClick={() => handleOpenSettingsScreen(parentExam.id)} style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#f1f5f9', cursor: 'pointer' }}>Ayarlar</button>
                        <button onClick={() => deleteExam(parentExam.id)} style={{ padding: '8px 12px', borderRadius: '6px', border: 'none', backgroundColor: '#ef4444', color: '#fff', cursor: 'pointer' }}>Sil</button>
                      </div>
                    </div>

                  </div>
                ))}
              </div>
            )}
          </div>
        ) : isCreatingExam ? (
          <div style={{ maxWidth: '600px', margin: '0 auto', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px' }}>
            <h3 style={{ margin: '0 0 16px 0', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>{activeAdminExamId ? 'İçerik Ayarları' : 'Yeni İçerik Ayarları'}</h3>
            
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '4px' }}>Sınav / Oturum Adı:</label>
              <input 
                type="text" 
                placeholder="Yeni Sınav / Paket"
                value={newExamForm.name} 
                onChange={(e) => setNewExamForm({ ...newExamForm, name: e.target.value })} 
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} 
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '4px' }}>
                Açıklama <span style={{ fontWeight: 'normal', color: '#64748b' }}>(sınav detay sayfasında, puanların altında gösterilir)</span>:
              </label>
              <textarea
                placeholder="Örn: Sınav öncesi son tekrar için hazırlanmış, gerçek sınav formatında 3 deneme."
                value={newExamForm.description}
                onChange={(e) => setNewExamForm({ ...newExamForm, description: e.target.value })}
                rows={3}
                maxLength={400}
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' }}
              />
              <div style={{ textAlign: 'right', fontSize: '0.72rem', color: '#94a3b8', marginTop: '2px' }}>
                {(newExamForm.description || '').length}/400
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
              <div>
                <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '4px' }}>Güncel Fiyat (₺):</label>
                <input 
                  type="number" 
                  min="0"
                  step="0.01"
                  value={newExamForm.price} 
                  onChange={(e) => setNewExamForm({ ...newExamForm, price: Number(e.target.value) })} 
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} 
                />
              </div>
              <div>
                <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '4px' }}>Eski Fiyat (Üstü Çizili):</label>
                <input 
                  type="number" 
                  min="0"
                  step="0.01"
                  placeholder="İsteğe bağlı"
                  value={newExamForm.originalPrice} 
                  onChange={(e) => setNewExamForm({ ...newExamForm, originalPrice: Number(e.target.value) })} 
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} 
                />
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '4px' }}>Sınav Türü (Kategori):</label>
              <select
                value={newExamForm.categoryExamType}
                onChange={(e) => {
                  if (e.target.value === '__new__') {
                    setShowNewExamCategoryInput(true);
                    return;
                  }
                  // Sınav türü değişince, önceki türe ait Ders Türü seçimi
                  // artık geçersiz olabileceği için temizliyoruz.
                  setNewExamForm({ ...newExamForm, categoryExamType: e.target.value, categoryLesson: '' });
                }}
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#fff', boxSizing: 'border-box' }}
              >
                <option value="">Sınav Türü Seçin</option>
                {examCategories.map((cat) => (
                  <option key={cat.id} value={cat.name}>{cat.name}</option>
                ))}
                <option value="__new__">+ Yeni Sınav Türü Ekle</option>
              </select>
              {showNewExamCategoryInput && (
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <input
                    type="text"
                    autoFocus
                    placeholder="Örn: KPSS"
                    value={newExamCategoryName}
                    onChange={(e) => setNewExamCategoryName(e.target.value)}
                    style={{ flex: 1, padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                  />
                  <button type="button" onClick={handleAddExamCategory} className="yt-btn yt-btn-primary" style={{ padding: '8px 14px' }}>Ekle</button>
                  <button type="button" onClick={() => { setShowNewExamCategoryInput(false); setNewExamCategoryName(''); }} className="yt-btn" style={{ padding: '8px 14px' }}>Vazgeç</button>
                </div>
              )}
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '4px' }}>Ders Türü (Kategori):</label>
              <select
                value={newExamForm.categoryLesson}
                disabled={!newExamForm.categoryExamType}
                onChange={(e) => {
                  if (e.target.value === '__new__') {
                    setShowNewLessonCategoryInput(true);
                    return;
                  }
                  setNewExamForm({ ...newExamForm, categoryLesson: e.target.value });
                }}
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: newExamForm.categoryExamType ? '#fff' : '#f1f5f9', boxSizing: 'border-box' }}
              >
                <option value="">{newExamForm.categoryExamType ? 'Ders Türü Seçin' : 'Önce Sınav Türü seçin'}</option>
                {lessonCategories
                  .filter((lc) => {
                    const selectedCat = examCategories.find((c) => c.name === newExamForm.categoryExamType);
                    return selectedCat && lc.exam_category_id === selectedCat.id;
                  })
                  .map((lc) => (
                    <option key={lc.id} value={lc.name}>{lc.name}</option>
                  ))}
                {newExamForm.categoryExamType && <option value="__new__">+ Yeni Ders Türü Ekle</option>}
              </select>
              {showNewLessonCategoryInput && (
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <input
                    type="text"
                    autoFocus
                    placeholder="Örn: Tarih"
                    value={newLessonCategoryName}
                    onChange={(e) => setNewLessonCategoryName(e.target.value)}
                    style={{ flex: 1, padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                  />
                  <button type="button" onClick={handleAddLessonCategory} className="yt-btn yt-btn-primary" style={{ padding: '8px 14px' }}>Ekle</button>
                  <button type="button" onClick={() => { setShowNewLessonCategoryInput(false); setNewLessonCategoryName(''); }} className="yt-btn" style={{ padding: '8px 14px' }}>Vazgeç</button>
                </div>
              )}
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '4px' }}>İçerik Formatı:</label>
              <select 
                value={newExamForm.examType} 
                onChange={(e) => setNewExamForm({ ...newExamForm, examType: e.target.value })}
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#fff', boxSizing: 'border-box' }}
              >
                <option value="deneme">Deneme Sınavı (Süreli Geri Sayım)</option>
                <option value="test">Test</option>
              </select>
            </div>

            {newExamForm.examType === 'deneme' && (
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '4px' }}>Süre (Dakika):</label>
                <input 
                  type="number" 
                  value={newExamForm.duration} 
                  onChange={(e) => setNewExamForm({ ...newExamForm, duration: Number(e.target.value) })} 
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} 
                />
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #e2e8f0' }}>
              <button
                type="button"
                onClick={handleSaveNewExam}
                className="yt-btn yt-btn-primary"
                style={{ flex: 1, padding: '12px', fontSize: '0.95rem' }}
              >
                Kaydet
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsCreatingExam(false);
                  setActiveAdminExamId(null);
                  setActiveSubExamId(null);
                }}
                style={{ flex: 1, padding: '12px', fontSize: '0.95rem', fontWeight: 'bold', color: '#334155', backgroundColor: '#f1f5f9', borderRadius: '6px', border: '1px solid #cbd5e1', cursor: 'pointer' }}
              >
                Listeye Dön
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: (activeSubExamId && currentPreviewExam?.pdfFile) ? '1fr 380px' : '1fr', gap: '24px', alignItems: 'start' }}>
            {activeSubExamId && currentPreviewExam?.pdfFile && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div style={{ backgroundColor: '#f1f5f9', padding: '16px', borderRadius: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '12px' }}>
                    <strong>Toplam Soru Sayısı/Sayfa: {currentPreviewExam.numPages || '0'}</strong>
                  </div>
                  {(() => {
                    const previewPageNum = adminPreviewPage.examId === currentPreviewExam.id ? adminPreviewPage.page : 1;
                    const totalPreviewPages = currentPreviewExam.numPages || 1;
                    const goToPreviewPage = (p) => {
                      const clamped = Math.min(Math.max(p, 1), totalPreviewPages);
                      setAdminPreviewPage({ examId: currentPreviewExam.id, page: clamped });
                    };
                    return (
                      <>
                        <SecurePdfViewer
                          examId={currentPreviewExam.id}
                          type="exam"
                          pageNumber={previewPageNum}
                        />
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
                          <button
                            type="button"
                            onClick={() => goToPreviewPage(previewPageNum - 1)}
                            disabled={previewPageNum <= 1}
                            className="yt-btn"
                            style={{
                              padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1',
                              backgroundColor: '#fff', cursor: previewPageNum <= 1 ? 'not-allowed' : 'pointer',
                              opacity: previewPageNum <= 1 ? 0.4 : 1, fontWeight: 'bold'
                            }}
                          >
                            ◀ Önceki Soru
                          </button>
                          <span style={{ fontFamily: 'monospace', fontWeight: 'bold', color: '#334155' }}>
                            {previewPageNum} / {totalPreviewPages}
                          </span>
                          <button
                            type="button"
                            onClick={() => goToPreviewPage(previewPageNum + 1)}
                            disabled={previewPageNum >= totalPreviewPages}
                            className="yt-btn"
                            style={{
                              padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1',
                              backgroundColor: '#fff', cursor: previewPageNum >= totalPreviewPages ? 'not-allowed' : 'pointer',
                              opacity: previewPageNum >= totalPreviewPages ? 0.4 : 1, fontWeight: 'bold'
                            }}
                          >
                            Sonraki Soru ▶
                          </button>
                        </div>
                      </>
                    );
                  })()}
                </div>
                {editingExam && (() => {
                  // ÖNEMLİ: Alt testlerde (Test 1, Test 2, Test 3...) kendi
                  // categoryExamType alanı boştur -- bu bilgi sadece üst
                  // pakette (ana sınavda) tutulur. Kazanım Haritası'ndaki
                  // Ders Türü listesi bu yüzden editingExam bir alt testse
                  // üst paketin Sınav Türü'nden (parentId üzerinden) miras
                  // alıyor; aksi halde dropdown boş kalıyordu.
                  const parentExam = editingExam.parentId
                    ? exams.find((e) => e.id === editingExam.parentId)
                    : null;
                  // ÖNEMLİ: formatExamData, veritabanında category_exam_type
                  // boş olan kayıtlara otomatik "Genel" varsayılan değeri
                  // veriyor (bkz. satır ~728). Alt testlerde bu alan
                  // veritabanında zaten hep boştur, yani editingExam.categoryExamType
                  // burada "" değil, hep "Genel" olarak gelir -- bu yüzden
                  // önceki "|| parentExam" mantığı hiç devreye girmiyordu.
                  // Bu alt test ekranında editingExam HER ZAMAN bir üst
                  // pakete bağlıdır, o yüzden üst paketin kategorisini
                  // önceliklendiriyoruz; kendi değerine sadece üst paket
                  // bulunamazsa (beklenmedik durum) geri dönüyoruz.
                  const effectiveExamType = parentExam?.categoryExamType || editingExam.categoryExamType || '';
                  return (
              <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px' }}>
                <h3 style={{ margin: '0 0 12px 0', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>📊 Kazanım Haritası</h3>

                <button
                  type="button"
                  onClick={() => setKazanimToolsOpen((prev) => ({ ...prev, excel: !prev.excel }))}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%', textAlign: 'left', padding: '8px 10px', marginBottom: kazanimToolsOpen.excel ? '0' : '4px', backgroundColor: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.82rem', color: '#0f172a' }}
                >
                  <span>{kazanimToolsOpen.excel ? '▾' : '▸'}</span> Excel ile Yükle
                </button>
                {kazanimToolsOpen.excel && (
                  <div style={{ padding: '10px', border: '1px solid #e2e8f0', borderTop: 'none', borderBottomLeftRadius: '6px', borderBottomRightRadius: '6px', marginBottom: '8px' }}>
                    <button
                      type="button"
                      onClick={downloadKazanimReferenceList}
                      style={{ marginBottom: '6px', padding: '5px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#fff', color: '#0f172a', cursor: 'pointer', fontSize: '0.76rem', fontWeight: 'bold' }}
                    >
                      📥 Kazanım Referans Listesi İndir
                    </button>
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={(e) => handleTopicMapUpload(editingExam.id, e)}
                      style={{ fontSize: '0.8rem', width: '100%' }}
                    />
                    <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '4px' }}>
                      Sütun sırası: 1. Soru No, 2. Ders, 3. Konu, 4. Kazanım (ilk satır başlık kabul edilir). Ders/Konu/Kazanım adları Kategori Yönetimi'ndeki kayıtlarla BİREBİR aynı olmalı -- farklı yazılmış bir satır varsa yükleme durdurulup hangi satırda ne yazmanız gerektiği gösterilir. Önce yukarıdaki referans listesini indirip oradan kopyalamanız önerilir. Yeniden yüklersen mevcut liste tamamen değişir.
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setKazanimToolsOpen((prev) => ({ ...prev, quick: !prev.quick }))}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%', textAlign: 'left', padding: '8px 10px', marginBottom: kazanimToolsOpen.quick ? '0' : '4px', backgroundColor: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.82rem', color: '#0f172a' }}
                >
                  <span>{kazanimToolsOpen.quick ? '▾' : '▸'}</span> ⚡ Tek Kazanım Uygula (bu testin tüm soruları aynı konuysa)
                </button>
                {kazanimToolsOpen.quick && (
                <div style={{ padding: '12px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', borderTop: 'none', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <select
                      value={quickKazanimDers}
                      onChange={(e) => {
                        if (e.target.value === '__new__') { setShowNewDersForKazanimInput(true); return; }
                        setQuickKazanimDers(e.target.value);
                        setQuickKazanimKonu('');
                        setQuickKazanimText('');
                      }}
                      style={{ flex: '1 1 160px', fontSize: '0.82rem', padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: '4px', boxSizing: 'border-box', backgroundColor: '#fff' }}
                    >
                      <option value="">Ders Türü Seçin</option>
                      {lessonCategories
                        .filter((lc) => {
                          const cat = examCategories.find((c) => c.name === effectiveExamType);
                          return cat && lc.exam_category_id === cat.id;
                        })
                        .map((lc) => (
                          <option key={lc.id} value={lc.name}>{lc.name}</option>
                        ))}
                      <option value="__new__">+ Yeni Ders Türü Ekle</option>
                    </select>
                    <select
                      value={quickKazanimKonu}
                      disabled={!quickKazanimDers}
                      onChange={(e) => {
                        if (e.target.value === '__new__') { setShowNewTopicInput(true); return; }
                        setQuickKazanimKonu(e.target.value);
                        setQuickKazanimText('');
                      }}
                      style={{ flex: '1 1 160px', fontSize: '0.82rem', padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: '4px', boxSizing: 'border-box', backgroundColor: quickKazanimDers ? '#fff' : '#f1f5f9' }}
                    >
                      <option value="">{quickKazanimDers ? 'Konu Seçin' : 'Önce Ders Türü seçin'}</option>
                      {topics
                        .filter((t) => {
                          const ders = lessonCategories.find((lc) => lc.name === quickKazanimDers);
                          return ders && t.lesson_category_id === ders.id;
                        })
                        .map((t) => (
                          <option key={t.id} value={t.name}>{t.name}</option>
                        ))}
                      {quickKazanimDers && <option value="__new__">+ Yeni Konu Ekle</option>}
                    </select>
                    <select
                      value={quickKazanimText}
                      disabled={!quickKazanimKonu}
                      onChange={(e) => {
                        if (e.target.value === '__new__') { setShowNewOutcomeInput(true); return; }
                        setQuickKazanimText(e.target.value);
                      }}
                      style={{ flex: '1 1 160px', fontSize: '0.82rem', padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: '4px', boxSizing: 'border-box', backgroundColor: quickKazanimKonu ? '#fff' : '#f1f5f9' }}
                    >
                      <option value="">{quickKazanimKonu ? 'Kazanım Seçin' : 'Önce Konu seçin'}</option>
                      {learningOutcomes
                        .filter((lo) => {
                          const ders = lessonCategories.find((lc) => lc.name === quickKazanimDers);
                          const konu = ders && topics.find((t) => t.name === quickKazanimKonu && t.lesson_category_id === ders.id);
                          return konu && lo.topic_id === konu.id;
                        })
                        .map((lo) => (
                          <option key={lo.id} value={lo.name}>{lo.name}</option>
                        ))}
                      {quickKazanimKonu && <option value="__new__">+ Yeni Kazanım Ekle</option>}
                    </select>
                    <button
                      type="button"
                      onClick={() => handleApplySingleTopicToAll(editingExam.id, editingExam.numPages, quickKazanimDers, quickKazanimKonu, quickKazanimText)}
                      className="yt-btn"
                      style={{ fontSize: '0.8rem', padding: '6px 14px', whiteSpace: 'nowrap' }}
                    >
                      Tüm Sorulara Uygula ({editingExam.numPages || 0} soru)
                    </button>
                  </div>

                  {showNewDersForKazanimInput && (
                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                      <input
                        type="text"
                        autoFocus
                        placeholder="Örn: Anayasa Hukuku"
                        value={newDersForKazanimName}
                        onChange={(e) => setNewDersForKazanimName(e.target.value)}
                        style={{ flex: 1, fontSize: '0.82rem', padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: '4px', boxSizing: 'border-box' }}
                      />
                      <button
                        type="button"
                        onClick={() => addLessonCategoryForExamType(effectiveExamType, newDersForKazanimName, (created) => {
                          setQuickKazanimDers(created.name);
                          setQuickKazanimKonu('');
                          setQuickKazanimText('');
                        }).then(() => { setNewDersForKazanimName(''); setShowNewDersForKazanimInput(false); })}
                        className="yt-btn yt-btn-primary"
                        style={{ padding: '6px 14px', fontSize: '0.8rem' }}
                      >Ekle</button>
                      <button type="button" onClick={() => { setShowNewDersForKazanimInput(false); setNewDersForKazanimName(''); }} className="yt-btn" style={{ padding: '6px 14px', fontSize: '0.8rem' }}>Vazgeç</button>
                    </div>
                  )}

                  {showNewTopicInput && (
                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                      <input
                        type="text"
                        autoFocus
                        placeholder="Örn: Temel Hak ve Ödevler"
                        value={newTopicName}
                        onChange={(e) => setNewTopicName(e.target.value)}
                        style={{ flex: 1, fontSize: '0.82rem', padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: '4px', boxSizing: 'border-box' }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const ders = lessonCategories.find((lc) => lc.name === quickKazanimDers);
                          if (!ders) { alert('Önce Ders Türü seçin.'); return; }
                          addTopicForLessonCategoryId(ders.id, newTopicName, (created) => {
                            setQuickKazanimKonu(created.name);
                            setQuickKazanimText('');
                          });
                          setNewTopicName('');
                          setShowNewTopicInput(false);
                        }}
                        className="yt-btn yt-btn-primary"
                        style={{ padding: '6px 14px', fontSize: '0.8rem' }}
                      >Ekle</button>
                      <button type="button" onClick={() => { setShowNewTopicInput(false); setNewTopicName(''); }} className="yt-btn" style={{ padding: '6px 14px', fontSize: '0.8rem' }}>Vazgeç</button>
                    </div>
                  )}

                  {showNewOutcomeInput && (
                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                      <input
                        type="text"
                        autoFocus
                        placeholder="Örn: Yürütme"
                        value={newOutcomeName}
                        onChange={(e) => setNewOutcomeName(e.target.value)}
                        style={{ flex: 1, fontSize: '0.82rem', padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: '4px', boxSizing: 'border-box' }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const ders = lessonCategories.find((lc) => lc.name === quickKazanimDers);
                          const konu = ders && topics.find((t) => t.name === quickKazanimKonu && t.lesson_category_id === ders.id);
                          if (!konu) { alert('Önce Konu seçin.'); return; }
                          handleAddLearningOutcome(konu.id, newOutcomeName, (created) => setQuickKazanimText(created.name));
                          setNewOutcomeName('');
                          setShowNewOutcomeInput(false);
                        }}
                        className="yt-btn yt-btn-primary"
                        style={{ padding: '6px 14px', fontSize: '0.8rem' }}
                      >Ekle</button>
                      <button type="button" onClick={() => { setShowNewOutcomeInput(false); setNewOutcomeName(''); }} className="yt-btn" style={{ padding: '6px 14px', fontSize: '0.8rem' }}>Vazgeç</button>
                    </div>
                  )}

                  <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '6px' }}>
                    1'den {editingExam.numPages || 0}'e kadar tüm sorulara aynı Ders/Kazanım atanır ve mevcut kazanım haritasının üzerine yazılır.
                  </div>
                </div>
                )}

                {(() => {
                  // Kopyalama kaynağı olarak önce AYNI ürün altındaki kardeş
                  // testleri (parentId aynı), sonra kazanımı dolu diğer tüm
                  // testleri listeliyoruz -- en olası kullanım "aynı paketteki
                  // 7 deneme" senaryosu olduğu için kardeşler üstte çıkıyor.
                  const copyCandidates = exams
                    .filter((e) => e.id !== editingExam.id && e.topicMap && Object.keys(e.topicMap).length > 0)
                    .sort((a, b) => {
                      const aSibling = a.parentId && a.parentId === editingExam.parentId;
                      const bSibling = b.parentId && b.parentId === editingExam.parentId;
                      if (aSibling !== bSibling) return aSibling ? -1 : 1;
                      return (a.name || '').localeCompare(b.name || '', 'tr');
                    });
                  return (
                    <>
                      <button
                        type="button"
                        onClick={() => setKazanimToolsOpen((prev) => ({ ...prev, copy: !prev.copy }))}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%', textAlign: 'left', padding: '8px 10px', marginBottom: kazanimToolsOpen.copy ? '0' : '4px', backgroundColor: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.82rem', color: '#0f172a' }}
                      >
                        <span>{kazanimToolsOpen.copy ? '▾' : '▸'}</span> 📋 Başka Testten Kazanım Kopyala (soru sayısı/sırası aynıysa)
                      </button>
                      {kazanimToolsOpen.copy && (
                    <div style={{ padding: '12px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', borderTop: 'none', marginBottom: '8px' }}>
                      {copyCandidates.length === 0 ? (
                        <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>Kazanım haritası dolu başka bir test bulunamadı.</div>
                      ) : (
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          <select
                            value={copyKazanimSourceId}
                            onChange={(e) => setCopyKazanimSourceId(e.target.value)}
                            style={{ flex: '1 1 260px', fontSize: '0.82rem', padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: '4px', boxSizing: 'border-box', backgroundColor: '#fff' }}
                          >
                            <option value="">Kaynak Test Seçin</option>
                            {copyCandidates.map((e) => {
                              const isSibling = e.parentId && e.parentId === editingExam.parentId;
                              const parentName = !isSibling && e.parentId ? exams.find((p) => p.id === e.parentId)?.name : null;
                              const label = `${parentName ? parentName + ' · ' : ''}${e.name || 'İsimsiz Test'} (${Object.keys(e.topicMap).length} soru)`;
                              return <option key={e.id} value={e.id}>{label}</option>;
                            })}
                          </select>
                          <button
                            type="button"
                            onClick={() => {
                              if (!copyKazanimSourceId) { alert('Önce kaynak test seçin.'); return; }
                              handleCopyKazanimFromExam(editingExam.id, copyKazanimSourceId);
                            }}
                            className="yt-btn"
                            style={{ fontSize: '0.8rem', padding: '6px 14px', whiteSpace: 'nowrap' }}
                          >
                            Kopyala
                          </button>
                        </div>
                      )}
                      <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '6px' }}>
                        Seçilen testin kazanım haritası olduğu gibi bu teste kopyalanır ve mevcut kazanım haritasının üzerine yazılır.
                      </div>
                    </div>
                      )}
                    </>
                  );
                })()}

                {editingExam.topicMap && Object.keys(editingExam.topicMap).length > 0 && (
                  <div style={{ marginTop: '14px' }}>
                    <div style={{ marginBottom: '8px' }}>
                      <span style={{ fontSize: '0.8rem', color: '#16a34a', fontWeight: 'bold' }}>
                        ✓ {Object.keys(editingExam.topicMap).length} soru için kazanım eklendi.
                      </span>
                    </div>

                    <div style={{ maxHeight: '420px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                        <thead style={{ position: 'sticky', top: 0, backgroundColor: '#f8fafc' }}>
                          <tr>
                            <th style={{ padding: '6px 10px', textAlign: 'left', width: '60px' }}>Soru</th>
                            <th style={{ padding: '6px 10px', textAlign: 'left', width: '28%' }}>Ders</th>
                            <th style={{ padding: '6px 10px', textAlign: 'left', width: '28%' }}>Konu</th>
                            <th style={{ padding: '6px 10px', textAlign: 'left' }}>Kazanım</th>
                            <th style={{ width: '36px' }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.keys(editingExam.topicMap)
                            .map(Number)
                            .sort((a, b) => a - b)
                            .map((soruNo) => {
                              const entry = editingExam.topicMap[soruNo];
                              // Konu, kazanımın Kategori Yönetimi'ndeki GÜNCEL kaydından
                              // canlı okunuyor -- entry.konu sadece eşleşme bulunamazsa
                              // (kazanım silinmiş/adı değişmişse) yedek olarak kullanılır.
                              const liveKonu = resolveLiveKonuForEntry(entry);
                              return (
                                <tr key={soruNo} style={{ borderTop: '1px solid #f1f5f9' }}>
                                  <td style={{ padding: '5px 10px', fontWeight: 'bold' }}>{soruNo}</td>
                                  <td style={{ padding: '5px 6px' }}>
                                    <select
                                      value={entry.ders}
                                      onChange={(e) => {
                                        if (e.target.value === '__new__') {
                                          const name = window.prompt('Yeni Ders Türü adı:');
                                          if (name && name.trim()) {
                                            addLessonCategoryForExamType(effectiveExamType, name, (created) => {
                                              applyTopicMapPatch(editingExam.id, (tm) => ({
                                                ...tm,
                                                [soruNo]: { ders: created.name, konu: '', kazanim: '' }
                                              }), { persist: true });
                                            });
                                          }
                                          return;
                                        }
                                        applyTopicMapPatch(editingExam.id, (tm) => ({
                                          ...tm,
                                          [soruNo]: { ders: e.target.value, konu: '', kazanim: '' }
                                        }), { persist: true });
                                      }}
                                      style={{ width: '100%', fontSize: '0.82rem', padding: '5px 6px', border: '1px solid #e2e8f0', borderRadius: '4px', boxSizing: 'border-box', backgroundColor: '#fff' }}
                                    >
                                      <option value="">Ders Seçin</option>
                                      {lessonCategories
                                        .filter((lc) => {
                                          const cat = examCategories.find((c) => c.name === effectiveExamType);
                                          return cat && lc.exam_category_id === cat.id;
                                        })
                                        .map((lc) => (
                                          <option key={lc.id} value={lc.name}>{lc.name}</option>
                                        ))}
                                      <option value="__new__">+ Yeni Ders Türü Ekle</option>
                                    </select>
                                  </td>
                                  <td style={{ padding: '5px 6px' }}>
                                    <select
                                      value={liveKonu}
                                      disabled={!entry.ders}
                                      onChange={(e) => {
                                        if (e.target.value === '__new__') {
                                          const ders = lessonCategories.find((lc) => lc.name === entry.ders);
                                          if (!ders) { alert('Önce Ders seçin.'); return; }
                                          const name = window.prompt('Yeni Konu adı:');
                                          if (name && name.trim()) {
                                            addTopicForLessonCategoryId(ders.id, name, (created) => {
                                              applyTopicMapPatch(editingExam.id, (tm) => ({
                                                ...tm,
                                                [soruNo]: { ...tm[soruNo], konu: created.name, kazanim: '' }
                                              }), { persist: true });
                                            });
                                          }
                                          return;
                                        }
                                        applyTopicMapPatch(editingExam.id, (tm) => ({
                                          ...tm,
                                          [soruNo]: { ...tm[soruNo], konu: e.target.value, kazanim: '' }
                                        }), { persist: true });
                                      }}
                                      style={{ width: '100%', fontSize: '0.82rem', padding: '5px 6px', border: '1px solid #e2e8f0', borderRadius: '4px', boxSizing: 'border-box', backgroundColor: entry.ders ? '#fff' : '#f1f5f9' }}
                                    >
                                      <option value="">{entry.ders ? 'Konu Seçin' : 'Önce Ders seçin'}</option>
                                      {topics
                                        .filter((t) => {
                                          const ders = lessonCategories.find((lc) => lc.name === entry.ders);
                                          return ders && t.lesson_category_id === ders.id;
                                        })
                                        .map((t) => (
                                          <option key={t.id} value={t.name}>{t.name}</option>
                                        ))}
                                      {entry.ders && <option value="__new__">+ Yeni Konu Ekle</option>}
                                    </select>
                                  </td>
                                  <td style={{ padding: '5px 6px' }}>
                                    <select
                                      value={entry.kazanim}
                                      disabled={!liveKonu}
                                      onChange={(e) => {
                                        if (e.target.value === '__new__') {
                                          const ders = lessonCategories.find((lc) => lc.name === entry.ders);
                                          const konu = ders && topics.find((t) => t.name === liveKonu && t.lesson_category_id === ders.id);
                                          if (!konu) { alert('Önce Konu seçin.'); return; }
                                          const name = window.prompt('Yeni Kazanım adı:');
                                          if (name && name.trim()) {
                                            handleAddLearningOutcome(konu.id, name, (created) => {
                                              applyTopicMapPatch(editingExam.id, (tm) => ({
                                                ...tm,
                                                [soruNo]: { ...tm[soruNo], kazanim: created.name }
                                              }), { persist: true });
                                            });
                                          }
                                          return;
                                        }
                                        applyTopicMapPatch(editingExam.id, (tm) => ({
                                          ...tm,
                                          [soruNo]: { ...tm[soruNo], kazanim: e.target.value }
                                        }), { persist: true });
                                      }}
                                      style={{ width: '100%', fontSize: '0.82rem', padding: '5px 6px', border: '1px solid #e2e8f0', borderRadius: '4px', boxSizing: 'border-box', backgroundColor: liveKonu ? '#fff' : '#f1f5f9' }}
                                    >
                                      <option value="">{liveKonu ? 'Kazanım Seçin' : 'Önce Konu seçin'}</option>
                                      {learningOutcomes
                                        .filter((lo) => {
                                          const ders = lessonCategories.find((lc) => lc.name === entry.ders);
                                          const konu = ders && topics.find((t) => t.name === liveKonu && t.lesson_category_id === ders.id);
                                          return konu && lo.topic_id === konu.id;
                                        })
                                        .map((lo) => (
                                          <option key={lo.id} value={lo.name}>{lo.name}</option>
                                        ))}
                                      {liveKonu && <option value="__new__">+ Yeni Kazanım Ekle</option>}
                                    </select>
                                  </td>
                                  <td style={{ padding: '5px 10px', textAlign: 'center' }}>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        applyTopicMapPatch(editingExam.id, (tm) => {
                                          const next = { ...tm };
                                          delete next[soruNo];
                                          return next;
                                        }, { persist: true });
                                      }}
                                      style={{ border: 'none', background: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '0.95rem' }}
                                      title="Bu soruyu kazanım listesinden sil"
                                    >
                                      ✕
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', marginTop: '10px', alignItems: 'center' }}>
                      <input
                        type="number"
                        value={newKazanimSoruNo}
                        onChange={(e) => setNewKazanimSoruNo(e.target.value)}
                        placeholder="Soru No"
                        style={{ width: '100px', fontSize: '0.82rem', padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: '4px' }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const soruNo = Number(newKazanimSoruNo);
                          if (!soruNo || soruNo < 1) { alert("Geçerli bir soru numarası girin."); return; }
                          if (editingExam.topicMap[soruNo]) { alert("Bu soru numarası zaten listede var."); return; }
                          applyTopicMapPatch(editingExam.id, (tm) => {
                            if (tm[soruNo]) return tm;
                            return { ...tm, [soruNo]: { ders: '', konu: '', kazanim: '' } };
                          }, { persist: true });
                          setNewKazanimSoruNo('');
                        }}
                        className="yt-btn"
                        style={{ fontSize: '0.8rem', padding: '6px 14px' }}
                      >
                        + Soru Ekle
                      </button>
                    </div>
                  </div>
                )}
              </div>
                  );
                })()}
              </div>
            )}

            {/* Sağ Panel - İçerik ve PDF Tanımlama Ayarları */}
            <div className="sidebar-content-settings" style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', position: 'sticky', top: '20px', maxHeight: '85vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
                <h3 style={{ margin: 0 }}>İçerik Ayarları</h3>
              </div>
              
              {activeSubExamId && childExams.find(e => e.id === activeSubExamId) ? (
                (() => {
                  return (
                    <div style={{ marginBottom: '16px' }}>
                      <button
                        type="button"
                        onClick={() => setActiveSubExamId(null)}
                        className="yt-btn yt-btn-outline"
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '16px' }}
                      >
                        ◀ Test Listesine Dön
                      </button>

                      <div className="yt-admin-panel" style={{ padding: '14px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                          <strong style={{ color: '#0f172a', fontSize: '0.95rem' }}>Test {editingIndex + 1}</strong>
                          <button
                            onClick={() => { deleteExam(editingExam.id); setActiveSubExamId(null); }}
                            style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold' }}
                          >
                            Sil ✕
                          </button>
                        </div>

                        <div className="form-group" style={{ marginBottom: '10px' }}>
                          <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.8rem', marginBottom: '4px' }}>İçerik Adı:</label>
                          <input
                            type="text"
                            value={editingExam.name}
                            onChange={(e) => updateExamInDb(editingExam.id, { name: e.target.value })}
                            style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box', fontSize: '0.85rem' }}
                          />
                        </div>

                        <div className="form-group" style={{ marginBottom: '10px' }}>
                          <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.8rem', marginBottom: '4px' }}>
                            Soru / Sayfa Sayısı <span style={{ fontWeight: 'normal', color: '#64748b' }}>(PDF yüklenince otomatik dolar{pricePerQuestionConfigured ? `, fiyat soru başı ₺${pricePerQuestion} üzerinden otomatik hesaplanır` : ''})</span>:
                          </label>
                          <input
                            type="number"
                            value={editingExam.numPages || 0}
                            onChange={(e) => applyNumPagesWithAutoPrice(editingExam.id, e.target.value)}
                            style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box', fontSize: '0.85rem' }}
                          />
                        </div>

                        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                          <div className="form-group" style={{ flex: 1 }}>
                            <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.8rem', marginBottom: '4px' }}>Tekil Fiyat (₺):</label>
                            <input
                              type="number"
                              value={editingExam.price || 0}
                              onChange={(e) => updateExamInDb(editingExam.id, { price: Number(e.target.value) })}
                              style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box', fontSize: '0.85rem' }}
                            />
                          </div>
                          <div className="form-group" style={{ flex: 1 }}>
                            <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.8rem', marginBottom: '4px' }}>Eski Fiyat (₺):</label>
                            <input
                              type="number"
                              value={editingExam.originalPrice || 0}
                              onChange={(e) => updateExamInDb(editingExam.id, { originalPrice: Number(e.target.value) })}
                              style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box', fontSize: '0.85rem' }}
                            />
                          </div>
                        </div>
                        <p style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '-4px', marginBottom: '10px' }}>
                          0 bırakılırsa bu test tek başına satılmaz, sadece üst paketi satın alanlar erişebilir.
                        </p>

                        {adminActiveExam.examType === 'deneme' && (
                          <div className="form-group" style={{ marginBottom: '10px' }}>
                            <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.8rem', marginBottom: '4px' }}>⏱️ Süre (Dakika) — Deneme Sınavı:</label>
                            <input
                              type="number"
                              value={editingExam.duration || 0}
                              onChange={(e) => updateExamInDb(editingExam.id, { duration: Number(e.target.value) })}
                              style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box', fontSize: '0.85rem' }}
                            />
                          </div>
                        )}

                        <div className="form-group" style={{ marginBottom: '10px' }}>
                          <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.8rem', marginBottom: '4px' }}>
                            📑 Bölümler (Opsiyonel — sınav içinde soru numarası tekrar 1&apos;den başlıyorsa kullanın):
                          </label>
                          {(editingExam.sections || []).map((sec, secIdx) => (
                            <div key={secIdx} style={{ display: 'flex', gap: '6px', marginBottom: '6px', alignItems: 'center' }}>
                              <input
                                type="text"
                                placeholder="Bölüm adı (Örn: Genel Yetenek)"
                                value={sec.name}
                                onChange={(e) => {
                                  const updated = [...(editingExam.sections || [])];
                                  updated[secIdx] = { ...updated[secIdx], name: e.target.value };
                                  updateExamInDb(editingExam.id, { sections: updated });
                                }}
                                style={{ flex: 2, minWidth: 0, padding: '6px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.8rem', boxSizing: 'border-box' }}
                              />
                              <input
                                type="number"
                                placeholder="Başl."
                                value={sec.start}
                                onChange={(e) => {
                                  const updated = [...(editingExam.sections || [])];
                                  updated[secIdx] = { ...updated[secIdx], start: Number(e.target.value) };
                                  updateExamInDb(editingExam.id, { sections: updated });
                                }}
                                style={{ width: '52px', padding: '6px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.8rem', boxSizing: 'border-box' }}
                              />
                              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>-</span>
                              <input
                                type="number"
                                placeholder="Bit."
                                value={sec.end}
                                onChange={(e) => {
                                  const updated = [...(editingExam.sections || [])];
                                  updated[secIdx] = { ...updated[secIdx], end: Number(e.target.value) };
                                  updateExamInDb(editingExam.id, { sections: updated });
                                }}
                                style={{ width: '52px', padding: '6px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.8rem', boxSizing: 'border-box' }}
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const updated = (editingExam.sections || []).filter((_, i) => i !== secIdx);
                                  updateExamInDb(editingExam.id, { sections: updated });
                                }}
                                style={{ padding: '6px 8px', borderRadius: '6px', border: 'none', backgroundColor: '#fee2e2', color: '#dc2626', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 'bold' }}
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => {
                              const updated = [...(editingExam.sections || []), { name: '', start: 1, end: editingExam.numPages || 1 }];
                              updateExamInDb(editingExam.id, { sections: updated });
                            }}
                            style={{ padding: '6px 10px', borderRadius: '6px', border: '1px dashed #94a3b8', backgroundColor: '#f8fafc', color: '#475569', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 'bold' }}
                          >
                            + Bölüm Ekle
                          </button>
                          <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '4px' }}>
                            Örn: &quot;Genel Yetenek&quot; 1-60, &quot;Genel Kültür&quot; 61-120. Hiç bölüm eklenmezse soru numaraları PDF sayfa numarasıyla aynı gösterilir (mevcut davranış).
                          </div>
                        </div>

                        <div className="form-group" style={{ marginBottom: '10px' }}>
                          <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.8rem', marginBottom: '4px' }}>Sınav PDF&apos;i:</label>
                          <input
                            type="file"
                            accept="application/pdf"
                            onChange={(e) => handleExamPdfUploadForExam(editingExam.id, e)}
                            style={{ fontSize: '0.8rem', width: '100%' }}
                          />
                          {editingExam.pdfFile && (
                            <div style={{ fontSize: '0.75rem', color: '#16a34a', marginTop: '4px', fontWeight: 'bold' }}>
                              ✓ Sınav PDF&apos;i eklendi.
                            </div>
                          )}
                        </div>

                        <div className="form-group" style={{ marginBottom: '10px' }}>
                          <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.8rem', marginBottom: '4px' }}>💡 Açıklamalı Çözüm PDF&apos;i:</label>
                          <input
                            type="file"
                            accept="application/pdf"
                            onChange={(e) => handleSolutionUploadForExam(editingExam.id, e)}
                            style={{ fontSize: '0.8rem', width: '100%' }}
                          />
                          {editingExam.solutionPdfFile && (
                            <div style={{ fontSize: '0.75rem', color: '#16a34a', marginTop: '4px', fontWeight: 'bold' }}>
                              ✓ Çözüm PDF eklendi.
                            </div>
                          )}
                        </div>

                        <div className="form-group">
                          <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.8rem', marginBottom: '4px' }}>Hızlı Cevap Anahtarı</label>
                          <textarea
                            placeholder="ÖRN: ABCDECAD..."
                            value={
                              Array.from(
                                { length: editingExam.numPages || 120 },
                                (_, i) => (editingExam.answerKey && editingExam.answerKey[i + 1]) ? editingExam.answerKey[i + 1] : ''
                              ).join('').toUpperCase()
                            }
                            onChange={(e) => handleFastKeyEntryForExam(editingExam.id, e.target.value)}
                            style={{
                              width: '100%',
                              height: '80px',
                              padding: '8px',
                              borderRadius: '6px',
                              border: '1px solid #cbd5e1',
                              fontSize: '0.85rem',
                              letterSpacing: '2px',
                              fontFamily: 'monospace',
                              textTransform: 'uppercase',
                              resize: 'none',
                              boxSizing: 'border-box'
                            }}
                          />
                          <div style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: 'bold', marginTop: '4px', textAlign: 'right' }}>
                            Girilen: {Object.keys(editingExam.answerKey || {}).length} / {editingExam.numPages || 0}
                          </div>
                        </div>

                      </div>

                      <button
                        type="button"
                        onClick={() => setActiveSubExamId(null)}
                        style={{ width: '100%', padding: '10px', fontSize: '0.9rem', fontWeight: 'bold', color: '#ffffff', backgroundColor: '#16a34a', borderRadius: '6px', border: 'none', cursor: 'pointer', marginTop: '16px' }}
                      >
                        ✓ Kaydet ve Listeye Dön
                      </button>
                    </div>
                  );
                })()
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
                  {childExams.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '24px 12px', color: '#94a3b8', fontSize: '0.85rem', border: '1px dashed #cbd5e1', borderRadius: '8px' }}>
                      Bu ürünün altında henüz test eklenmedi.<br />Başlamak için aşağıdaki &quot;+ Yeni Test Ekle&quot; butonuna tıklayın.
                    </div>
                  )}
                  {childExams.map((subExam, index) => {
                    const answeredCount = Object.keys(subExam.answerKey || {}).length;
                    // Bir sorunun kazanımı "tam" sayılması için Ders/Konu/Kazanım
                    // üçünün de dolu olması gerekir -- sadece konu seçilip kazanım
                    // boş bırakılmışsa (ya da hiç satırı yoksa) eksik sayılır.
                    const kazanimCompleteCount = Object.values(subExam.topicMap || {})
                      .filter((e) => e && e.ders && e.konu && e.kazanim).length;
                    const kazanimTotal = subExam.numPages || 0;
                    const kazanimOk = kazanimTotal > 0 && kazanimCompleteCount === kazanimTotal;
                    return (
                      <div
                        key={subExam.id}
                        onClick={() => setActiveSubExamId(subExam.id)}
                        style={{
                          padding: '12px 14px',
                          borderRadius: '8px',
                          border: '1px solid #e2e8f0',
                          backgroundColor: '#f8fafc',
                          cursor: 'pointer',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '10px'
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0 }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleMoveSubTest(childExams, subExam.id, 'up'); }}
                            disabled={index === 0}
                            title="Yukarı Taşı"
                            style={{ width: '22px', height: '18px', lineHeight: '18px', padding: 0, border: '1px solid #cbd5e1', borderRadius: '4px', backgroundColor: index === 0 ? '#f1f5f9' : '#ffffff', color: index === 0 ? '#cbd5e1' : '#334155', cursor: index === 0 ? 'not-allowed' : 'pointer', fontSize: '0.7rem' }}
                          >
                            ▲
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleMoveSubTest(childExams, subExam.id, 'down'); }}
                            disabled={index === childExams.length - 1}
                            title="Aşağı Taşı"
                            style={{ width: '22px', height: '18px', lineHeight: '18px', padding: 0, border: '1px solid #cbd5e1', borderRadius: '4px', backgroundColor: index === childExams.length - 1 ? '#f1f5f9' : '#ffffff', color: index === childExams.length - 1 ? '#cbd5e1' : '#334155', cursor: index === childExams.length - 1 ? 'not-allowed' : 'pointer', fontSize: '0.7rem' }}
                          >
                            ▼
                          </button>
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontWeight: 'bold', fontSize: '0.9rem', color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            Test {index + 1}: {subExam.name || 'İsimsiz'}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '2px' }}>
                            {subExam.pdfFile ? '✓ PDF' : '✗ PDF yok'} · Cevap {answeredCount}/{subExam.numPages || 0}
                            {subExam.solutionPdfFile ? ' · ✓ Çözüm' : ''}
                            {' · '}
                            <span style={{ color: kazanimOk ? '#16a34a' : '#dc2626', fontWeight: kazanimOk ? 'normal' : 'bold' }}>
                              {kazanimOk ? '✓ Kazanım' : `✗ Kazanım ${kazanimCompleteCount}/${kazanimTotal}`}
                            </span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                          <span className="yt-edit-link">Düzenle ▸</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteExam(subExam.id); }}
                            style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold' }}
                          >
                            Sil ✕
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Yeni Test Ekle Butonu - sadece liste görünümünde */}
              {!activeSubExamId && (
                <button
                  type="button"
                  onClick={handleAddSubTest}
                  className="yt-btn-add-dashed"
                >
                  + Yeni Test Ekle
                </button>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', paddingTop: '16px', borderTop: '1px solid #e2e8f0' }}>
                <button
                  type="button"
                  onClick={() => {
                    setActiveAdminExamId(null);
                    setActiveSubExamId(null);
                  }}
                  className="yt-btn-full-primary"
                >
                  Listeye Dön
                </button>
              </div>

            </div>
          </div>
        )}
      </div>
    );
  }

  // ==========================================
  // RENDER: ÖĞRENCİ EKRANI
  // ==========================================
  if (appMode === 'student') {
    
    const renderAuthModal = () => {
    if (!showAuthModal) return null;
    return (
      <div className="yt-modal-overlay">
        <div className="yt-modal-card">
          <button onClick={() => setShowAuthModal(false)} className="yt-modal-close">✕</button>

          <h2 className="yt-modal-title">
            {authMode === 'login' && '🔑 Kullanıcı Girişi'}
            {authMode === 'register' && '📝 Yeni Hesap Oluştur'}
            {authMode === 'forgot' && '🔒 Şifremi Unuttum'}
          </h2>

          {authMode !== 'forgot' && (
            <>
              <button type="button" onClick={handleGoogleSignIn} className="yt-google-btn">
                <span style={{ fontSize: '1.1rem' }}>G</span> Google ile Devam Et
              </button>
              <div className="yt-divider-row">
                <div className="line"></div>
                <span className="word">veya</span>
                <div className="line"></div>
              </div>
            </>
          )}

          <form onSubmit={handleAuth}>
            <div className="yt-field">
              <label className="yt-label">E-posta Adresi:</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ornek@mail.com" className="yt-input" />
            </div>

            {authMode !== 'forgot' && (
              <div className="yt-field">
                <div className="yt-field-row">
                  <label className="yt-label" style={{ marginBottom: 0 }}>Şifre:</label>
                  {authMode === 'login' && (
                    <button type="button" onClick={() => setAuthMode('forgot')} className="yt-link-btn" style={{ fontSize: '0.75rem' }}>Şifremi Unuttum?</button>
                  )}
                </div>
                <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="yt-input" />
              </div>
            )}

            <button type="submit" disabled={authLoading} className="yt-btn yt-btn-primary yt-btn-block">
              {authLoading ? 'İşleniyor...' : (authMode === 'login' ? 'Giriş Yap' : authMode === 'register' ? 'Kayıt Ol' : 'Sıfırlama Bağlantısı Gönder')}
            </button>
          </form>

          <div className="yt-form-foot">
            {authMode === 'login' && (
              <span>Hesabınız yok mu? <button onClick={() => setAuthMode('register')} className="yt-link-btn">Kayıt Olun</button></span>
            )}
            {authMode === 'register' && (
              <span>Zaten hesabınız var mı? <button onClick={() => setAuthMode('login')} className="yt-link-btn">Giriş Yapın</button></span>
            )}
            {authMode === 'forgot' && (
              <span><button onClick={() => setAuthMode('login')} className="yt-link-btn">◀ Giriş Ekranına Dön</button></span>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Sepet çekmecesi -- daha önce sadece ana sayfa listesinde render
  // ediliyordu, bu yüzden ürün detay sayfasındayken sepet ikonuna
  // basınca (showCart true oluyordu ama çekmece hiç DOM'a girmiyordu)
  // hiçbir şey görünmüyordu. Artık paylaşılan bir fonksiyon, her sayfada
  // çağrılıyor.
  // Kazanım Analizi'ndeki öneri kartlarında tek bir test satırı --
  // sahip olunan/ücretsiz bir testse direkt "Çöz", değilse fiyat +
  // "Sepete Ekle" gösterir. Hem konu hem ders seviyesindeki öneri
  // listelerinde ortak kullanılıyor.
  const renderOneriTestSatiri = (ex) => {
    const owned = !!(studentPurchases[ex.id] || (ex.parentId && studentPurchases[ex.parentId]));
    // ÖNEMLİ (bug fix): price=0 sadece ÜST SEVİYE (paketsiz) sınavlarda
    // gerçekten "ücretsiz" demektir. Bir alt testte price=0, "tek başına
    // satılmaz, sadece üst paketi satın alan erişir" demektir.
    const free = !ex.parentId && (!ex.price || ex.price <= 0);
    // Öneri motoru artık öğrencinin sahip olmadığı, tek başına satılamayan
    // (parentId dolu + price=0) alt testleri de önerebiliyor -- amaç
    // öğrenciyi satın almaya yönlendirmek. Bu durumda "Sepete Ekle" butonu,
    // kendi (anlamsız ₺0) fiyatı yerine ÜST PAKETİN fiyatını göstermeli ve
    // sepete üst paketi eklemeli -- öğrenci gerçekte üst paketi satın alarak
    // bu alt teste erişebiliyor.
    const needsParentForPurchase = !owned && !free && ex.parentId && (!ex.price || ex.price <= 0);
    const parentExam = needsParentForPurchase ? exams.find((e) => e.id === ex.parentId) : null;
    // Üst paket bulunamazsa (veri tutarsızlığı gibi beklenmedik bir durum)
    // eski davranışa dönüyoruz -- hiç buton göstermemek yerine, en azından
    // kendi fiyatıyla (varsa) göstermeye devam ediyoruz.
    const purchaseTargetId = parentExam ? parentExam.id : ex.id;
    const purchaseTargetPrice = parentExam ? parentExam.price : ex.price;
    // BUG FİX: `free` yukarıda SADECE ex'in KENDİ fiyatına bakarak
    // hesaplanıyordu -- bir alt test üst pakete yönlendirildiğinde (yukarıki
    // needsParentForPurchase dalı), üst paketin GÜNCEL fiyatı da (örn. o gün
    // "Soru Başı Fiyat" 0'a çekildiği için) 0 olabiliyordu. Böyle bir durumda
    // sistem hâlâ "ücretli" sanıp sepete ekletiyordu -- oysa gerçek satın
    // alma hedefinin (purchaseTargetPrice) kendisi 0 ise, bu KESİNLİKLE
    // ücretsizdir ve sepete hiç girmeden direkt çözülebilmelidir.
    const effectivelyFree = free || !purchaseTargetPrice || purchaseTargetPrice <= 0;
    const inCart = cartItems.includes(purchaseTargetId);
    return (
      <div key={ex.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', border: '1px solid var(--yt-line)', borderRadius: '8px', backgroundColor: '#fff' }}>
        <span style={{ flex: 1, fontSize: '0.8rem', color: 'var(--yt-ink)' }}>
          {ex.name || 'İsimsiz Test'}
          {ex.numPages > 0 && (
            <span style={{ color: 'var(--yt-graphite-soft)', fontWeight: 'normal' }}> · {ex.numPages} soru</span>
          )}
        </span>
        {owned || effectivelyFree ? (
          <button
            onClick={() => { setShowResults(false); startExam(ex); }}
            className="yt-btn yt-btn-primary"
            style={{ fontSize: '0.74rem', padding: '5px 10px' }}
          >
            ▶ {owned ? 'Çöz' : 'Ücretsiz Çöz'}
          </button>
        ) : (
          <>
            <span style={{ fontFamily: 'var(--yt-font-mono)', fontSize: '0.76rem', fontWeight: 'bold', color: 'var(--yt-mustard-deep)' }}>₺{purchaseTargetPrice}</span>
            <button
              onClick={() => toggleCartItem(purchaseTargetId)}
              className={`yt-add-cart-btn${inCart ? ' in-cart' : ''}`}
              style={{ fontSize: '0.74rem', padding: '5px 10px' }}
            >
              {inCart ? '✓ Sepette' : '+ Sepete Ekle'}
            </button>
          </>
        )}
      </div>
    );
  };

  const renderCartDrawer = () => {
    const cartExams = exams.filter(e => cartItems.includes(e.id));
    const cartTotal = cartExams.reduce((sum, e) => sum + (e.price || 0), 0);
    return showCart && (
      <div className="yt-cart-overlay" onClick={() => setShowCart(false)}>
        <div className="yt-cart-drawer" onClick={(e) => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Sepetim</h3>
            <button onClick={() => setShowCart(false)} className="yt-btn yt-btn-ghost">✕</button>
          </div>

          {cartExams.length === 0 ? (
            <p style={{ color: 'var(--yt-graphite)', fontSize: '0.9rem' }}>Sepetiniz boş. Ücretli içeriklerin yanındaki "Sepete Ekle" butonuyla ekleyebilirsiniz.</p>
          ) : (
            <>
              {cartExams.map(ce => (
                <div key={ce.id} className="yt-cart-item">
                  <span style={{ fontSize: '0.88rem', color: 'var(--yt-ink)', flex: 1 }}>{ce.name || 'İsimsiz İçerik'}</span>
                  <span style={{ fontFamily: 'var(--yt-font-mono)', fontSize: '0.85rem', color: 'var(--yt-ink)' }}>₺{ce.price}</span>
                  <button onClick={() => toggleCartItem(ce.id)} className="yt-btn yt-btn-ghost" style={{ padding: '4px 8px' }}>✕</button>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '18px 0' }}>
                <span style={{ fontFamily: 'var(--yt-font-mono)', fontSize: '0.8rem', color: 'var(--yt-graphite)' }}>TOPLAM</span>
                <span style={{ fontFamily: 'var(--yt-font-mono)', fontSize: '1.2rem', fontWeight: '600', color: 'var(--yt-ink)' }}>₺{cartTotal.toLocaleString('tr-TR')}</span>
              </div>
              <button onClick={handleCartCheckout} className="yt-btn yt-btn-buy" style={{ width: '100%' }}>Ödemeye Geç →</button>
            </>
          )}
        </div>
      </div>
    );
  };

  // ÖDEME ÖNCESİ ZORUNLU FATURA MODALI: showBillingGateModal true olduğunda
  // (hasCompleteBillingInfo false iken ödeme başlatılmaya çalışıldığında)
  // açılır. Form kaydedilince pendingPaymentAction neyse (tekli sınav ya da
  // sepet) o ödeme akışı otomatik devam eder. Kapatma (✕) butonu YOK --
  // bilerek: fatura bilgisi olmadan ödemeye izin vermiyoruz; öğrenci
  // "Vazgeç" ile modalı kapatıp ödemeden tamamen vazgeçebilir ama fatura
  // bilgisini atlayıp direkt ödemeye geçemez.
  const renderBillingGateModal = () => showBillingGateModal && (
    <div className="yt-cart-overlay" onClick={() => { setShowBillingGateModal(false); setPendingPaymentAction(null); }}>
      <div className="yt-cart-drawer" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Fatura Bilgileriniz Gerekli</h3>
        </div>
        <p style={{ color: 'var(--yt-graphite)', fontSize: '0.86rem', margin: '0 0 18px' }}>
          Satın aldığınız içerik için size fatura kesebilmemiz için ödemeden önce
          aşağıdaki bilgileri doldurmanız gerekiyor. Bu bilgiler yalnızca fatura
          düzenlemek amacıyla kullanılır.
        </p>
        <div style={{ display: 'grid', gap: '12px', marginBottom: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 'bold', color: 'var(--yt-ink)', marginBottom: '4px' }}>Ad Soyad</label>
            <input
              type="text"
              value={billingDraft.fullName}
              onChange={(e) => setBillingDraft(prev => ({ ...prev, fullName: e.target.value }))}
              className="yt-input"
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 'bold', color: 'var(--yt-ink)', marginBottom: '4px' }}>TC Kimlik No</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={11}
              value={billingDraft.tcKimlikNo}
              onChange={(e) => setBillingDraft(prev => ({ ...prev, tcKimlikNo: e.target.value.replace(/\D/g, '').slice(0, 11) }))}
              className="yt-input"
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 'bold', color: 'var(--yt-ink)', marginBottom: '4px' }}>Fatura E-posta Adresi</label>
            <input
              type="email"
              value={billingDraft.invoiceEmail}
              onChange={(e) => setBillingDraft(prev => ({ ...prev, invoiceEmail: e.target.value }))}
              className="yt-input"
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 'bold', color: 'var(--yt-ink)', marginBottom: '4px' }}>Adres</label>
            <textarea
              value={billingDraft.address}
              onChange={(e) => setBillingDraft(prev => ({ ...prev, address: e.target.value }))}
              rows={2}
              className="yt-input"
              style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => { setShowBillingGateModal(false); setPendingPaymentAction(null); }}
            className="yt-btn yt-btn-outline"
            style={{ flex: 1 }}
          >
            Vazgeç
          </button>
          <button
            onClick={async () => {
              const ok = await saveMyBillingInfo(true);
              if (!ok) return;
              setShowBillingGateModal(false);
              const action = pendingPaymentAction;
              setPendingPaymentAction(null);
              if (action?.type === 'single') proceedIyzicoPayment(action.exam);
              else if (action?.type === 'cart') proceedCartCheckout();
            }}
            disabled={savingBillingInfo}
            className="yt-btn yt-btn-buy"
            style={{ flex: 1 }}
          >
            {savingBillingInfo ? 'Kaydediliyor...' : 'Kaydet ve Devam Et'}
          </button>
        </div>
      </div>
    </div>
  );

  const renderNotifDrawer = () => showStudentNotifs && (
    <div className="yt-cart-overlay" onClick={() => setShowStudentNotifs(false)}>
      <div className="yt-cart-drawer" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem' }}>🔔 Bildirimler</h3>
          <button onClick={() => setShowStudentNotifs(false)} className="yt-btn yt-btn-ghost">✕</button>
        </div>

        {studentNotifLoading ? (
          <p style={{ color: 'var(--yt-graphite)', fontSize: '0.9rem' }}>Yükleniyor...</p>
        ) : studentNotifItems.length === 0 ? (
          <p style={{ color: 'var(--yt-graphite)', fontSize: '0.9rem' }}>Henüz bir bildiriminiz yok.</p>
        ) : (
          <div style={{ display: 'grid', gap: '10px' }}>
            {studentNotifItems.map(item => (
              <div key={item.id} style={{ border: '1px solid var(--yt-line)', borderRadius: '8px', padding: '12px', backgroundColor: item.kind === 'reply' ? 'var(--yt-mustard-bg)' : 'var(--yt-paper-2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 'bold', color: 'var(--yt-ink)' }}>
                    {item.kind === 'reply' ? '↩ ' : '📢 '}{item.title}
                  </span>
                </div>
                {item.kind === 'reply' && (
                  <p style={{ margin: '0 0 6px 0', fontSize: '0.78rem', color: 'var(--yt-graphite)', fontStyle: 'italic' }}>"{item.originalMessage}"</p>
                )}
                <p style={{ margin: '0 0 6px 0', fontSize: '0.86rem', color: 'var(--yt-ink)', whiteSpace: 'pre-wrap' }}>{item.message}</p>
                <span style={{ fontSize: '0.72rem', color: 'var(--yt-graphite-soft)' }}>{new Date(item.date).toLocaleString('tr-TR')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // Tüm sayfalarda aynı şekilde görünen üst menü: Sınavlarım, Sepet, Bildirim, Hesap (e-posta) menüsü
  const renderHeaderRight = () => (
    <>
      {user && (
        <button
          onClick={() => { setInspectingExamId(null); setActiveStudentExamId(null); setAccountTab('exams'); setShowAccountPage(true); setShowAccountMenu(false); fetchMyBillingInfo(); }}
          className="yt-btn yt-btn-ghost"
        >
          Sınavlarım
        </button>
      )}
      {user && appMode !== 'admin' && studentBalance !== null && (
        <div
          title="Bakiyeniz -- ödemelerde kullanılabilir"
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '8px', border: '1.5px solid var(--yt-line)', backgroundColor: 'var(--yt-paper-2)', whiteSpace: 'nowrap' }}
        >
          <span style={{ fontSize: '1rem' }}>🎁</span>
          <span style={{ fontFamily: 'var(--yt-font-mono)', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--yt-ink)' }}>₺{studentBalance}</span>
          <BalanceGiftModal balance={studentBalance} studentEmail={user.email} />
        </div>
      )}
      <button onClick={() => setShowCart(true)} className="yt-cart-btn yt-cart-btn-wide" title="Sepet">
        <span style={{ fontSize: '1.15rem' }}>🛒</span>
        <span>Sepet{cartItems.length > 0 ? ` (${cartItems.length})` : ''}</span>
      </button>
      {user && (
        <button onClick={openStudentNotifs} className="yt-cart-btn" title="Bildirimler">
          🔔
          {studentUnreadCount > 0 && <span className="yt-cart-badge">{studentUnreadCount}</span>}
        </button>
      )}
      {user ? (
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowAccountMenu(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'var(--yt-paper)', padding: '6px 12px', borderRadius: '20px', border: '1px solid var(--yt-line)', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            <span style={{ fontSize: '0.95rem' }}>👤</span>
            <span style={{ fontSize: '0.85rem', fontWeight: '500', color: 'var(--yt-ink)' }}>{user.email}</span>
          </button>
          {showAccountMenu && (
            <>
              <div onClick={() => setShowAccountMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }}></div>
              <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: '280px', backgroundColor: 'var(--yt-paper-2)', border: '1px solid var(--yt-line)', borderRadius: '10px', boxShadow: 'var(--yt-shadow)', padding: '16px', zIndex: 50 }}>
                <h4 className="yt-admin-section-title" style={{ marginTop: 0 }}>Şifre Değiştir</h4>
                <form onSubmit={handleChangePassword}>
                  <div className="yt-field">
                    <label className="yt-label">Yeni Şifre</label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={newPasswordInput}
                      onChange={(e) => setNewPasswordInput(e.target.value)}
                      placeholder="••••••••"
                      className="yt-input"
                    />
                  </div>
                  <div className="yt-field">
                    <label className="yt-label">Yeni Şifre (Tekrar)</label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={confirmPasswordInput}
                      onChange={(e) => setConfirmPasswordInput(e.target.value)}
                      placeholder="••••••••"
                      className="yt-input"
                    />
                  </div>
                  {passwordChangeMessage && (
                    <div style={{
                      padding: '10px 12px', borderRadius: '8px', fontSize: '0.85rem', marginBottom: '12px',
                      backgroundColor: passwordChangeMessage.type === 'success' ? 'var(--yt-correct-bg)' : 'var(--yt-wrong-bg)',
                      color: passwordChangeMessage.type === 'success' ? 'var(--yt-correct)' : 'var(--yt-wrong)'
                    }}>
                      {passwordChangeMessage.text}
                    </div>
                  )}
                  <button type="submit" disabled={passwordChangeLoading} className="yt-btn yt-btn-primary yt-btn-block">
                    {passwordChangeLoading ? 'Güncelleniyor...' : 'Şifreyi Güncelle'}
                  </button>
                </form>
                <div style={{ borderTop: '1px solid var(--yt-line)', margin: '14px 0' }}></div>
                <button onClick={handleLogout} className="yt-btn yt-btn-ghost yt-btn-block" style={{ color: 'var(--yt-wrong)' }}>
                  Çıkış Yap
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <button onClick={() => { setAuthMode('login'); setShowAuthModal(true); }} className="yt-btn yt-btn-outline">
          Giriş Yap
        </button>
      )}
    </>
  );

  if (showAccountPage && user) {
    const myPurchases = exams.filter(e => studentPurchases[e.id]);
    const mySolved = exams.filter(e => studentResultsMap[e.id]?.is_finished);

    return (
      <div className="yt-shell">
        <TopBanner />
        <header className="yt-header">
          <div className="yt-header-inner">
            <div className="yt-brand" style={{ cursor: 'pointer' }} onClick={() => setShowAccountPage(false)}>
              <img src={sualinkLogo} alt="Sualink" className="yt-brand-logo" />
            </div>
            <div style={{ flex: 1 }}></div>
            {renderHeaderRight()}
          </div>
        </header>

        <div className="wrap" style={{ maxWidth: '840px', margin: '0 auto', padding: '32px 24px 60px' }}>
          <h1 style={{ fontFamily: 'var(--yt-font-display)', fontWeight: '600', fontSize: '1.5rem', color: 'var(--yt-ink)', margin: '0 0 4px' }}>Sınavlarım</h1>
          <p style={{ color: 'var(--yt-graphite)', fontSize: '0.88rem', margin: '0 0 24px' }}>{user.email}</p>

          <div>
            <div className="yt-session-card" style={{ marginBottom: '20px' }}>
              <h3 className="yt-admin-section-title">Satın Aldıklarım ({myPurchases.length})</h3>
              {myPurchases.length === 0 ? (
                <div style={{ color: 'var(--yt-graphite-soft)', fontSize: '0.9rem', textAlign: 'center', padding: '20px 0' }}>
                  Henüz satın aldığınız bir içerik yok.
                </div>
              ) : (
                <div className="yt-subtest-list">
                  {myPurchases.map(e => (
                    <div key={e.id} className="yt-subtest-row">
                      <div style={{ flex: 1, minWidth: '160px' }}>
                        <strong style={{ color: 'var(--yt-ink)' }}>{e.name || 'İsimsiz'}</strong>
                        <div style={{ fontFamily: 'var(--yt-font-mono)', fontSize: '0.74rem', color: 'var(--yt-graphite)', marginTop: '3px' }}>
                          {e.categoryLesson} · {e.categoryExamType}
                        </div>
                      </div>
                      <button
                        onClick={() => { setInspectingExamId(e.id); setShowAccountPage(false); }}
                        className="yt-btn yt-btn-outline"
                      >
                        İçeriği Gör
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="yt-session-card">
              <h3 className="yt-admin-section-title">Çözdüğüm Testler ({mySolved.length})</h3>
              {mySolved.length === 0 ? (
                <div style={{ color: 'var(--yt-graphite-soft)', fontSize: '0.9rem', textAlign: 'center', padding: '20px 0' }}>
                  Henüz tamamladığınız bir test yok.
                </div>
              ) : (
                <div className="yt-subtest-list">
                  {mySolved.map(e => {
                    const res = studentResultsMap[e.id];
                    return (
                      <div key={e.id} className="yt-subtest-row">
                        <div className="yt-subtest-bubble done">✓</div>
                        <div style={{ flex: 1, minWidth: '160px' }}>
                          <strong style={{ color: 'var(--yt-ink)' }}>{e.name || 'İsimsiz Test'}</strong>
                          <div style={{ fontFamily: 'var(--yt-font-mono)', fontSize: '0.74rem', color: 'var(--yt-graphite)', marginTop: '3px', display: 'flex', gap: '10px' }}>
                            <span style={{ color: 'var(--yt-correct)' }}>D: {res.correct}</span>
                            <span style={{ color: 'var(--yt-wrong)' }}>Y: {res.wrong}</span>
                            <span>Net: {res.net}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            setActiveStudentExamId(e.id);
                            setInspectingExamId(null);
                            setStudentAnswers(res.answers || {});
                            setStudentCurrentPage(1);
                            setIsExamFinished(true);
                            setShowResults(true);
                            setViewingSolutionQ(false);
                            setShowAccountPage(false);
                            fetchAnswerKeyForReview(e.id);
                          }}
                          className="yt-btn yt-btn-outline"
                        >
                          Sonucu İncele
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="yt-session-card" style={{ marginTop: '20px' }}>
              <h3 className="yt-admin-section-title">Fatura Bilgilerim</h3>
              <p style={{ color: 'var(--yt-graphite)', fontSize: '0.84rem', margin: '0 0 16px' }}>
                Satın aldığınız içerikler için fatura kesilebilmesi amacıyla bu bilgileri
                doldurmanız gerekiyor. Bilgileriniz yalnızca fatura düzenlemek için kullanılır.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginBottom: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 'bold', color: 'var(--yt-ink)', marginBottom: '4px' }}>Ad Soyad</label>
                  <input
                    type="text"
                    value={billingDraft.fullName}
                    onChange={(e) => setBillingDraft(prev => ({ ...prev, fullName: e.target.value }))}
                    className="yt-input"
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 'bold', color: 'var(--yt-ink)', marginBottom: '4px' }}>TC Kimlik No</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={11}
                    value={billingDraft.tcKimlikNo}
                    onChange={(e) => setBillingDraft(prev => ({ ...prev, tcKimlikNo: e.target.value.replace(/\D/g, '').slice(0, 11) }))}
                    className="yt-input"
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 'bold', color: 'var(--yt-ink)', marginBottom: '4px' }}>Fatura E-posta Adresi</label>
                  <input
                    type="email"
                    value={billingDraft.invoiceEmail}
                    onChange={(e) => setBillingDraft(prev => ({ ...prev, invoiceEmail: e.target.value }))}
                    className="yt-input"
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 'bold', color: 'var(--yt-ink)', marginBottom: '4px' }}>Adres</label>
                  <textarea
                    value={billingDraft.address}
                    onChange={(e) => setBillingDraft(prev => ({ ...prev, address: e.target.value }))}
                    rows={2}
                    className="yt-input"
                    style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
                  />
                </div>
              </div>
              <button
                onClick={() => saveMyBillingInfo(false)}
                disabled={savingBillingInfo}
                className="yt-btn yt-btn-primary"
              >
                {savingBillingInfo ? 'Kaydediliyor...' : (myBillingInfo ? 'Bilgilerimi Güncelle' : 'Kaydet')}
              </button>
            </div>
          </div>
        </div>
      <Footer />
      {renderCartDrawer()}
      {renderBillingGateModal()}
      {renderNotifDrawer()}
      {renderAuthModal()}
      </div>
    );
  }

  if (inspectingExamId) {
      const inspectExam = exams.find(e => e.id === inspectingExamId);
      if (!inspectExam) return null;

      const childExams = exams.filter(e => e.parentId === inspectingExamId).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      const ratingInfo = examRatingsMap[inspectExam.id] || { average: '0,0', count: '0' };
      const ratingBreakdown = examRatingBreakdownMap[inspectExam.id] || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      const totalRatingCount = Object.values(ratingBreakdown).reduce((a, b) => a + b, 0);
      const solvedCount = solvedCountMap[inspectExam.id] || 0;
      const campaignCountdown = getCampaignCountdown(inspectExam);
      const isPaid = inspectExam.price && inspectExam.price > 0;
      const isPurchased = studentPurchases[inspectExam.id];
      const resData = studentResultsMap[inspectExam.id];
      const isCompleted = resData?.is_finished;
      const inCart = cartItems.includes(inspectExam.id);
      // ÖNEMLİ (bug fix): Bu sayfa şimdiye kadar SADECE "alt testleri olan
      // paket" senaryosunu destekliyordu (childExams.length > 0). Kendi
      // PDF'i/soru sayısı olan, hiç alt testi olmayan TEK BAŞINA bir sınav
      // (childExams.length === 0 ama inspectExam'in kendi numPages/pdfFile'ı
      // var) için ne satın alma butonu ne de "Teste Başla" seçeneği hiç
      // gösterilmiyordu -- her zaman "henüz test eklenmedi" mesajı çıkıyordu,
      // satın alınmış olsa bile. Bu bayrak, aşağıdaki üç noktada bu durumu
      // ayırt edip doğru arayüzü göstermek için kullanılıyor.
      const isStandalone = childExams.length === 0 && !!(inspectExam.pdfFile || (inspectExam.numPages && inspectExam.numPages > 0));
      const relatedExams = exams
        .filter(e => e.isPublished && !e.parentId && e.id !== inspectExam.id && e.categoryLesson === inspectExam.categoryLesson)
        .slice(0, 3);

      return (
        <div className="yt-shell">
          <TopBanner />
          <header className="yt-header">
            <div className="yt-header-inner">
              <div className="yt-brand" style={{ cursor: 'pointer' }} onClick={() => setInspectingExamId(null)}>
                <img src={sualinkLogo} alt="Sualink" className="yt-brand-logo" />
              </div>
              <div style={{ flex: 1 }}></div>
              <button
                onClick={() => {
                  const shareUrl = `${window.location.origin}${window.location.pathname}?exam=${inspectExam.id}`;
                  navigator.clipboard.writeText(shareUrl)
                    .then(() => alert('Bağlantı kopyalandı: ' + shareUrl))
                    .catch(() => prompt('Bağlantıyı kopyalayın:', shareUrl));
                }}
                className="yt-btn yt-btn-ghost"
                title="Bu ürünün linkini kopyala"
              >
                🔗 Paylaş
              </button>
              {renderHeaderRight()}
            </div>
          </header>

          <main style={{ maxWidth: '760px', margin: '40px auto', padding: '0 24px' }}>
            <div className="yt-detail-panel">

              <div style={{ marginBottom: '12px' }}>
                <span className="yt-tag">{inspectExam.categoryExamType} · {inspectExam.categoryLesson}</span>
              </div>

              <h1 style={{ margin: '0 0 12px 0', fontSize: '1.6rem' }}>
                {inspectExam.name || 'İsimsiz İçerik'}
              </h1>

              {(() => {
                const totalQuestions = childExams.length > 0
                  ? childExams.reduce((sum, t) => sum + (t.numPages || 0), 0)
                  : (inspectExam.numPages || 0);
                return (
                  <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
                    <span className="yt-chip">{totalQuestions} SORU</span>
                    {childExams.length > 0 && <span className="yt-chip">{childExams.length} TEST</span>}
                  </div>
                );
              })()}

              <div style={{ marginBottom: '10px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                <div className="yt-rating" style={{ fontSize: '0.85rem' }}>
                  <span className="stars">
                    {'★'.repeat(Math.round(Number(ratingInfo.average.replace(',', '.')))).padEnd(5, '☆')}
                  </span>
                  {ratingInfo.average} <span className="count">({ratingInfo.count} değerlendirme)</span>
                </div>
                {solvedCount > 0 && (
                  <span style={{ fontFamily: 'var(--yt-font-mono)', fontSize: '0.78rem', color: 'var(--yt-graphite)' }}>
                    · {solvedCount.toLocaleString('tr-TR')} kişi çözdü
                  </span>
                )}
                {campaignCountdown && <span className="yt-countdown">⏳ Kampanya: {campaignCountdown}</span>}
              </div>

              {totalRatingCount > 0 && (
                <details style={{ marginBottom: '16px' }}>
                  <summary style={{ cursor: 'pointer', fontSize: '0.75rem', color: 'var(--yt-mustard-deep)', fontFamily: 'var(--yt-font-mono)', width: 'fit-content' }}>
                    Puan dağılımını gör
                  </summary>
                  <div className="yt-rating-histogram" style={{ marginTop: '10px', maxWidth: '280px' }}>
                    {[5, 4, 3, 2, 1].map(star => {
                      const pct = totalRatingCount > 0 ? Math.round((ratingBreakdown[star] / totalRatingCount) * 100) : 0;
                      return (
                        <div key={star} className="yt-hist-row">
                          <span>{star}★</span>
                          <div className="yt-hist-track"><div className="yt-hist-fill" style={{ width: `${pct}%` }}></div></div>
                          <span>{pct}%</span>
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}

              {inspectExam.description && (
                <p style={{ fontSize: '0.9rem', color: 'var(--yt-graphite)', lineHeight: 1.6, margin: '0 0 20px', paddingBottom: '20px', borderBottom: '1px solid var(--yt-line)' }}>
                  {inspectExam.description}
                </p>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--yt-graphite)', marginBottom: '4px', fontFamily: 'var(--yt-font-mono)' }}>SINAV FİYATI</div>
                  <div className="yt-price" style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                    {isPaid ? (
                      <>
                        <span className="now" style={{ fontSize: '1.5rem' }}>
                          ₺{inspectExam.price.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        {inspectExam.originalPrice && inspectExam.originalPrice > inspectExam.price ? (
                          <span className="old">
                            ₺{inspectExam.originalPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="free" style={{ fontSize: '1.3rem' }}>Ücretsiz</span>
                    )}
                  </div>
                </div>

                {isPaid && !isPurchased && (childExams.length > 0 || isStandalone) && (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => toggleCartItem(inspectExam.id)} className={`yt-add-cart-btn${inCart ? ' in-cart' : ''}`}>
                      {inCart ? '✓ Sepette' : '+ Sepete Ekle'}
                    </button>
                    <button
                      onClick={() => {
                        if (!user) {
                          alert("Satın alabilmek için lütfen giriş yapın veya üye olun.");
                          setAuthMode('login');
                          setShowAuthModal(true);
                          return;
                        }
                        handleIyzicoPayment(inspectExam);
                      }}
                      className="yt-btn yt-btn-buy"
                    >
                      Hemen Satın Al (₺{inspectExam.price}) →
                    </button>
                  </div>
                )}

                {childExams.length === 0 && !isStandalone && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--yt-graphite-soft)', fontStyle: 'italic' }}>
                    Test eklendiğinde burada &quot;Teste Başla&quot; seçeneği görünecek.
                  </div>
                )}
              </div>


              {productReviews.length > 0 && (
                <div style={{ marginBottom: '24px' }}>
                  <h3 style={{ margin: '0 0 12px 0', fontSize: '0.95rem' }}>Öğrenci Yorumları ({productReviews.length})</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {productReviews.map((rev, idx) => {
                      const namePart = (rev.student_email || 'ogrenci').split('@')[0];
                      const maskedName = namePart.length > 2
                        ? namePart.slice(0, 2) + '*'.repeat(Math.max(3, namePart.length - 2))
                        : namePart + '***';
                      return (
                        <div key={idx} style={{ backgroundColor: 'var(--yt-paper-2)', border: '1px solid var(--yt-line)', borderRadius: '10px', padding: '12px 14px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                            <span style={{ fontWeight: '600', fontSize: '0.85rem', color: 'var(--yt-ink)', textTransform: 'capitalize' }}>{maskedName}</span>
                            <span style={{ color: 'var(--yt-mustard-deep)', fontSize: '0.85rem' }}>{'★'.repeat(rev.rating)}{'☆'.repeat(5 - rev.rating)}</span>
                          </div>
                          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--yt-graphite)', lineHeight: 1.5 }}>{rev.review_text}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {(() => {
                if (!isPaid || isPurchased || childExams.length === 0) {
                  // Tek testlik / eski tip ürünlerde eski davranış: tek önizleme paneli
                  const previewSourceExam = childExams.length > 0 ? childExams[0] : inspectExam;
                  return isPaid && !isPurchased && previewSourceExam.pdfFile ? (
                    <div className="yt-preview-panel" style={{ marginBottom: '24px' }}>
                      <span className="yt-preview-label">Ücretsiz Önizleme — 1. Soru</span>
                      <SecurePdfViewer examId={previewSourceExam.id} type="exam-preview" pageNumber={1} />
                    </div>
                  ) : null;
                }

                // Çoklu test varsa, farklı testlerden örnek gösterecek şekilde
                // 3 test seçiyoruz (baştan, ortadan, sondan) — kalite sürekliliğini
                // göstermek için tek testten değil, çeşitli testlerden örnek.
                const sampleCount = Math.min(3, childExams.length);
                const sampleIndexes = sampleCount === 1
                  ? [0]
                  : Array.from({ length: sampleCount }, (_, i) => Math.round(i * (childExams.length - 1) / (sampleCount - 1)));
                const uniqueIndexes = [...new Set(sampleIndexes)];
                const sampleTests = uniqueIndexes.map(i => childExams[i]).filter(t => t.pdfFile);

                if (sampleTests.length === 0) return null;

                const activeIdx = Math.min(previewTestIndex, sampleTests.length - 1);
                const activeTest = sampleTests[activeIdx];

                return (
                  <div className="yt-preview-panel" style={{ marginBottom: '24px' }}>
                    <span className="yt-preview-label">Ücretsiz Önizleme — Farklı Testlerden Örnek Sorular</span>
                    {sampleTests.length > 1 && (
                      <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
                        {sampleTests.map((t, idx) => (
                          <button
                            key={t.id}
                            onClick={() => setPreviewTestIndex(idx)}
                            className={`yt-chip${idx === activeIdx ? ' active' : ''}`}
                            style={{ fontSize: '0.7rem', padding: '5px 10px' }}
                          >
                            {t.name || `Test ${idx + 1}`}
                          </button>
                        ))}
                      </div>
                    )}
                    <SecurePdfViewer examId={activeTest.id} type="exam-preview" pageNumber={1} />
                  </div>
                );
              })()}


              <div style={{ marginBottom: '24px' }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '0.95rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Testler</h3>

                {inspectExam.sections && inspectExam.sections.length > 0 ? (
                  <div className="yt-subtest-list">
                    {inspectExam.sections.map((sec, index) => (
                      <div key={index} className="yt-subtest-row">
                        <strong style={{ color: 'var(--yt-ink)', flex: 1 }}>{sec.name}</strong>
                        <span style={{ fontFamily: 'var(--yt-font-mono)', fontSize: '0.78rem', color: 'var(--yt-graphite)' }}>
                          Soru Aralığı: {sec.start} - {sec.end}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : childExams.length > 0 ? (
                  <div className="yt-subtest-list">
                    {childExams.map((child, index) => {
                      const childRes = studentResultsMap[child.id];
                      const childCompleted = childRes?.is_finished;
                      const answeredCount = childRes?.answers ? Object.keys(childRes.answers).length : 0;
                      const childInProgress = !childCompleted && answeredCount > 0;
                      const totalQ = child.numPages || 0;
                      const progressPct = totalQ > 0 ? Math.round((answeredCount / totalQ) * 100) : 0;

                      // Bir alt test, üst paket satın alınmışsa YA DA kendisi ayrı
                      // ayrı satın alınmışsa erişilebilir. Kendi fiyatı (price) 0
                      // ise tek başına satılmıyor demektir -- sadece üst paket
                      // yoluyla açılır.
                      const childOwnPrice = child.price || 0;
                      const childIndividuallyPurchased = !!studentPurchases[child.id];
                      const childUnlocked = !isPaid || isPurchased || childIndividuallyPurchased;
                      const childIndividuallySellable = childOwnPrice > 0;
                      const childInCart = cartItems.includes(child.id);

                      const ctaClass = childCompleted ? 'yt-btn-ghost' : (childInProgress ? 'yt-btn-primary' : (childUnlocked ? 'yt-btn-outline' : 'yt-btn-locked'));
                      return (
                        <div key={child.id} className="yt-subtest-row">
                          <div className={`yt-subtest-bubble${childCompleted ? ' done' : (childInProgress ? ' in-progress' : '')}`}>
                            {childCompleted ? '✓' : (childInProgress ? '…' : index + 1)}
                          </div>
                          <div style={{ flex: 1, minWidth: '160px' }}>
                            <strong style={{ color: 'var(--yt-ink)' }}>{child.name || 'İsimsiz Test'}</strong>
                            <div style={{ fontFamily: 'var(--yt-font-mono)', fontSize: '0.74rem', color: 'var(--yt-graphite)', marginTop: '3px', display: 'flex', gap: '12px' }}>
                              <span>{child.numPages || '?'} SORU</span>
                              {childCompleted && <span style={{ color: 'var(--yt-correct)' }}>Net: {childRes.net}</span>}
                              {childInProgress && <span style={{ color: 'var(--yt-mustard-deep)' }}>{answeredCount}/{totalQ} soru yapıldı</span>}
                              {!childUnlocked && childIndividuallySellable && (
                                <span style={{ color: 'var(--yt-mustard-deep)', fontWeight: 'bold' }}>₺{childOwnPrice}</span>
                              )}
                            </div>
                            {childInProgress && (
                              <div className="yt-subtest-progress-track">
                                <div className="yt-subtest-progress-fill" style={{ width: `${progressPct}%` }} />
                              </div>
                            )}
                          </div>

                          {!childUnlocked && childIndividuallySellable ? (
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <button
                                onClick={() => toggleCartItem(child.id)}
                                className={`yt-add-cart-btn${childInCart ? ' in-cart' : ''}`}
                                style={{ fontSize: '0.76rem', padding: '6px 10px' }}
                              >
                                {childInCart ? '✓ Sepette' : '+ Sepete Ekle'}
                              </button>
                              <button
                                onClick={() => {
                                  if (!user) {
                                    alert("Satın alabilmek için lütfen giriş yapın veya üye olun.");
                                    setAuthMode('login');
                                    setShowAuthModal(true);
                                    return;
                                  }
                                  handleIyzicoPayment(child);
                                }}
                                className="yt-btn yt-btn-buy"
                                style={{ fontSize: '0.76rem', padding: '6px 10px' }}
                              >
                                Satın Al →
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                if (!user) {
                                  alert("Sınava katılabilmek için lütfen giriş yapın veya üye olun.");
                                  setAuthMode('login');
                                  setShowAuthModal(true);
                                  return;
                                }
                                if (childUnlocked) {
                                  if (childCompleted) {
                                    setActiveStudentExamId(child.id);
                                    setInspectingExamId(null);
                                    setStudentAnswers(childRes.answers || {});
                                    setStudentCurrentPage(1);
                                    setIsExamFinished(true);
                                    setShowResults(true);
                                    setViewingSolutionQ(false);
                                    fetchAnswerKeyForReview(child.id);
                                  } else {
                                    startExam(child);
                                  }
                                } else {
                                  // Bu test tek başına satılmıyor (fiyatı 0) -- tek
                                  // seçenek üst paketin tamamını satın almak.
                                  handleIyzicoPayment(inspectExam);
                                }
                              }}
                              className={`yt-btn ${ctaClass}`}
                            >
                              {childCompleted ? 'Sonucu İncele' : (childInProgress ? 'Devam Et →' : (childUnlocked ? 'Teste Başla →' : '🔒 Kilitli'))}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : isStandalone ? (
                  // ÖNEMLİ (bug fix): Alt testi olmayan, kendi PDF'i/soru
                  // sayısı olan TEK BAŞINA bir sınav -- mantığı yukarıdaki
                  // alt test satırıyla birebir aynı (tamamlandı/devam
                  // ediyor/kilitli), sadece `child` yerine `inspectExam`
                  // üzerinden çalışıyor.
                  (() => {
                    const ownRes = studentResultsMap[inspectExam.id];
                    const ownCompleted = ownRes?.is_finished;
                    const ownAnsweredCount = ownRes?.answers ? Object.keys(ownRes.answers).length : 0;
                    const ownInProgress = !ownCompleted && ownAnsweredCount > 0;
                    const ownTotalQ = inspectExam.numPages || 0;
                    const ownProgressPct = ownTotalQ > 0 ? Math.round((ownAnsweredCount / ownTotalQ) * 100) : 0;
                    const ownUnlocked = !isPaid || isPurchased;
                    const ctaClass = ownCompleted ? 'yt-btn-ghost' : (ownInProgress ? 'yt-btn-primary' : (ownUnlocked ? 'yt-btn-outline' : 'yt-btn-locked'));
                    return (
                      <div className="yt-subtest-list">
                        <div className="yt-subtest-row">
                          <div className={`yt-subtest-bubble${ownCompleted ? ' done' : (ownInProgress ? ' in-progress' : '')}`}>
                            {ownCompleted ? '✓' : (ownInProgress ? '…' : 1)}
                          </div>
                          <div style={{ flex: 1, minWidth: '160px' }}>
                            <strong style={{ color: 'var(--yt-ink)' }}>{inspectExam.name || 'İsimsiz Test'}</strong>
                            <div style={{ fontFamily: 'var(--yt-font-mono)', fontSize: '0.74rem', color: 'var(--yt-graphite)', marginTop: '3px', display: 'flex', gap: '12px' }}>
                              <span>{inspectExam.numPages || '?'} SORU</span>
                              {ownCompleted && <span style={{ color: 'var(--yt-correct)' }}>Net: {ownRes.net}</span>}
                              {ownInProgress && <span style={{ color: 'var(--yt-mustard-deep)' }}>{ownAnsweredCount}/{ownTotalQ} soru yapıldı</span>}
                            </div>
                            {ownInProgress && (
                              <div className="yt-subtest-progress-track">
                                <div className="yt-subtest-progress-fill" style={{ width: `${ownProgressPct}%` }} />
                              </div>
                            )}
                          </div>

                          <button
                            onClick={() => {
                              if (!user) {
                                alert("Sınava katılabilmek için lütfen giriş yapın veya üye olun.");
                                setAuthMode('login');
                                setShowAuthModal(true);
                                return;
                              }
                              if (ownUnlocked) {
                                if (ownCompleted) {
                                  setActiveStudentExamId(inspectExam.id);
                                  setInspectingExamId(null);
                                  setStudentAnswers(ownRes.answers || {});
                                  setStudentCurrentPage(1);
                                  setIsExamFinished(true);
                                  setShowResults(true);
                                  setViewingSolutionQ(false);
                                  fetchAnswerKeyForReview(inspectExam.id);
                                } else {
                                  setShowResults(false);
                                  startExam(inspectExam);
                                }
                              } else {
                                handleIyzicoPayment(inspectExam);
                              }
                            }}
                            className={`yt-btn ${ctaClass}`}
                          >
                            {ownCompleted ? 'Sonucu İncele' : (ownInProgress ? 'Devam Et →' : (ownUnlocked ? 'Teste Başla →' : '🔒 Kilitli'))}
                          </button>
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  <div style={{ textAlign: 'center', padding: '20px', color: 'var(--yt-graphite-soft)', fontSize: '0.9rem' }}>
                    Bu içerik için henüz test eklenmedi. Yakında yayında olacak.
                  </div>
                )}
              </div>

            </div>

            {relatedExams.length > 0 && (
              <div style={{ marginTop: '32px' }}>
                <h3 style={{ margin: '0 0 14px 0', fontSize: '1rem', color: 'var(--yt-ink)', fontFamily: 'var(--yt-font-display)' }}>Bunlar da İlgini Çekebilir</h3>
                <div className="yt-related-scroll">
                  {relatedExams.map((re, idx) => {
                    const reRating = examRatingsMap[re.id] || { average: '0,0', count: '0' };
                    const reChildren = exams.filter(e => e.parentId === re.id);
                    const reQuestions = reChildren.length > 0
                      ? reChildren.reduce((sum, t) => sum + (t.numPages || 0), 0)
                      : (re.numPages || 0);
                    const reIsFree = !re.price || re.price <= 0;
                    const reOnCampaign = re.originalPrice && re.originalPrice > re.price;
                    const tileTone = ['ink', 'mustard', 'graphite'][idx % 3];
                    return (
                      <div key={re.id} className="yt-related-card-v2" onClick={() => setInspectingExamId(re.id)}>
                        <div className={`yt-related-tile tone-${tileTone}`}>
                          {reIsFree && <span className="yt-related-badge free">ÜCRETSİZ</span>}
                          {!reIsFree && reOnCampaign && <span className="yt-related-badge sale">İNDİRİMDE</span>}
                          <div className="yt-related-rating">
                            <span className="stars">{'★'.repeat(Math.round(Number(reRating.average.replace(',', '.')))).padEnd(5, '☆')}</span>
                            <span>{reRating.average} ({reRating.count})</span>
                          </div>
                        </div>
                        <div className="yt-related-body">
                          <div className="yt-related-name">{re.name || 'İsimsiz İçerik'}</div>
                          <div className="yt-related-meta">{reQuestions} soru{reChildren.length > 0 ? ` · ${reChildren.length} test` : ''}</div>
                          <div className="yt-related-price">
                            {reIsFree ? (
                              <span className="free">Ücretsiz</span>
                            ) : (
                              <>
                                {reOnCampaign && <span className="old">₺{re.originalPrice}</span>}
                                <span className="now">₺{re.price}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </main>
          <Footer />
          {renderCartDrawer()}
      {renderBillingGateModal()}
          {renderNotifDrawer()}
          {renderAuthModal()}
        </div>
      );
    }

    if (!activeStudentExamId) {
      const publishedExams = exams.filter(e => {
        if (!e.isPublished) return false;
        if (e.parentId) return false;
        if (selectedCategory !== 'Tümü' && e.categoryExamType !== selectedCategory) {
          return false;
        }
        if (searchQuery && e.name && !e.name.toLowerCase().includes(searchQuery.toLowerCase())) {
          return false;
        }
        return true;
      }).sort((a, b) => {
        if (sortOption === 'ucuz') return (a.price || 0) - (b.price || 0);
        if (sortOption === 'pahali') return (b.price || 0) - (a.price || 0);
        if (sortOption === 'cozulen') return (solvedCountMap[b.id] || 0) - (solvedCountMap[a.id] || 0);
        if (sortOption === 'yeni') return 0; // liste zaten created_at'e göre yeniden eskiye geliyor
        // varsayılan: populer (puan ortalamasına göre)
        const avgA = Number((examRatingsMap[a.id]?.average || '0').replace(',', '.'));
        const avgB = Number((examRatingsMap[b.id]?.average || '0').replace(',', '.'));
        return avgB - avgA;
      });

      // Ana sayfa hero'sundaki "X Test · Y Soru" güven göstergesi -- gerçekten
      // çözülebilir (yayında ve kendi PDF'i olan) her sınavı sayıyoruz; salt
      // klasör görevi gören, kendi PDF'i olmayan üst paketler dahil edilmiyor
      // ki sayı şişirilmiş görünmesin.
      const solvableExams = exams.filter(e => e.isPublished && e.pdfFile);
      const totalTestCount = solvableExams.length;
      const totalSoruCount = solvableExams.reduce((sum, e) => sum + (e.numPages || 0), 0);

      const uniqueExamTypes = Array.from(
        new Set(
          exams
            .filter(e => e.isPublished && !e.parentId && e.categoryExamType)
            .map(e => e.categoryExamType.trim())
        )
      );
      
      const allCategories = ['Tümü', ...uniqueExamTypes];

      const cartExams = exams.filter(e => cartItems.includes(e.id));
      const cartTotal = cartExams.reduce((sum, e) => sum + (e.price || 0), 0);

      return (
        <div className="yt-shell">
          <TopBanner />

          <style>{`
            .yt-header-modern {
              box-shadow: 0 1px 0 rgba(27, 33, 56, 0.08), 0 2px 8px rgba(27, 33, 56, 0.04);
            }
          `}</style>
          <header className="yt-header yt-header-modern">
            <div className="yt-header-inner">
              <div className="yt-brand">
                <img src={sualinkLogo} alt="Sualink" className="yt-brand-logo" />
              </div>

              <div style={{ flex: '1 1 300px', maxWidth: '450px', display: 'flex', minWidth: '200px', border: '1.5px solid var(--yt-line)', borderRadius: '8px', overflow: 'hidden', backgroundColor: 'var(--yt-paper-2)' }}>
                <input
                  type="text"
                  placeholder="Ne çözmek istiyorsunuz?"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ flex: 1, minWidth: 0, padding: '10px 14px', border: 'none', backgroundColor: 'transparent', outline: 'none', fontSize: '0.9rem', fontFamily: 'var(--yt-font-body)', color: 'var(--yt-ink)', boxSizing: 'border-box' }}
                />
                <button
                  type="button"
                  onClick={() => {}}
                  aria-label="Ara"
                  style={{ flexShrink: 0, width: '42px', border: 'none', backgroundColor: 'var(--yt-ink)', color: '#fff', cursor: 'pointer', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  🔍
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, marginLeft: 'auto' }}>
                {renderHeaderRight()}
              </div>
            </div>
          </header>

          <div className="yt-hero">
            <div className="yt-hero-blob one"></div>
            <div className="yt-hero-blob two"></div>
            <div className="yt-hero-inner">
              <div className="yt-hero-text">
                <h1 className="yt-hero-title">Sual buradan başlıyor!</h1>
                {totalTestCount > 0 && (
                  <p style={{ margin: '8px 0 20px', fontSize: '1.15rem', fontWeight: '700', color: 'var(--yt-ink)', lineHeight: 1.4 }}>
                    {totalTestCount.toLocaleString('tr-TR')}+ test ve {totalSoruCount.toLocaleString('tr-TR')}+ soruluk içerikle hazırız.
                  </p>
                )}
                <div className="yt-hero-actions">
                  <button
                    type="button"
                    className="yt-hero-btn yt-hero-btn-primary"
                    style={{ whiteSpace: 'normal', lineHeight: 1.3, textAlign: 'center' }}
                    onClick={() => {
                      // "Test İhtiyacını Belirle" -> ihtiyaç belirleme sınavı olarak
                      // ayrılan ürüne (id: 81) götürür. Sınav zaten bellekte
                      // yüklüyse (public/öğrenci listesi) uygulama içi geçiş
                      // yaparız -- URL otomatik olarak ?exam=81 olur (bkz.
                      // inspectingExamId <-> URL senkron efekti). Herhangi bir
                      // sebeple henüz yüklenmemişse (ör. çok erken tıklanmışsa)
                      // doğrudan paylaşım linkine yönlendiririz.
                      const targetExam = exams.find(e => String(e.id) === '81');
                      if (targetExam) {
                        setInspectingExamId(targetExam.id);
                      } else {
                        window.location.href = 'https://sualink.com/?exam=81';
                      }
                    }}
                  >
                    <span style={{ display: 'block' }}>KPSS Denemesi</span>
                    <span style={{ display: 'block', fontWeight: 500, fontSize: '0.85em' }}>Hemen Katıl !</span>
                  </button>
                  <button
                    type="button"
                    className="yt-hero-btn yt-hero-btn-outline"
                    onClick={() => document.getElementById('yt-urun-listesi')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  >
                    Test Satın Al
                  </button>
                </div>
              </div>
              <div className="yt-hero-visual">
                <div className="yt-hero-visual-circle">
                  <svg viewBox="0 0 120 120" width="72%" height="72%" aria-hidden="true">
                    <rect x="14" y="10" width="92" height="100" rx="8" fill="var(--yt-paper-2)" stroke="var(--yt-ink)" strokeWidth="2.5" />
                    {[0, 1, 2, 3].map((row) => (
                      <g key={row} transform={`translate(0, ${row * 22})`}>
                        <rect x="26" y="30" width="34" height="5" rx="2.5" fill="var(--yt-line)" />
                        {[0, 1, 2].map((col) => (
                          <circle
                            key={col}
                            cx={72 + col * 12}
                            cy="32.5"
                            r="4.5"
                            fill={row === 1 && col === 1 ? 'var(--yt-mustard)' : 'none'}
                            stroke="var(--yt-ink)"
                            strokeWidth="1.6"
                          />
                        ))}
                      </g>
                    ))}
                  </svg>
                </div>
                <div className="yt-hero-sticker check" aria-hidden="true">✓</div>
                <div className="yt-hero-sticker star" aria-hidden="true">★</div>
                <div className="yt-hero-sticker pencil" aria-hidden="true">✎</div>
              </div>
            </div>
          </div>

          <div className="wrap" style={{ maxWidth: '920px', margin: '0 auto', padding: '0 24px' }}>
            <div id="yt-kategori-filtre" className="yt-chip-row" style={{ padding: '18px 0' }}>
              {allCategories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`yt-chip${selectedCategory === cat ? ' active' : ''}`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <main id="yt-urun-listesi" style={{ maxWidth: '920px', margin: '0 auto', padding: '0 24px 60px' }}>
            {publishedExams.length > 0 && (
              <div className="yt-toolbar">
                <span style={{ fontFamily: 'var(--yt-font-mono)', fontSize: '0.76rem', color: 'var(--yt-graphite)' }}>{publishedExams.length} içerik listeleniyor</span>
                <select className="yt-select" value={sortOption} onChange={(e) => setSortOption(e.target.value)}>
                  <option value="populer">En Popüler</option>
                  <option value="yeni">En Yeni</option>
                  <option value="cozulen">En Çok Çözülen</option>
                  <option value="ucuz">Fiyat: Artan</option>
                  <option value="pahali">Fiyat: Azalan</option>
                </select>
              </div>
            )}
            {publishedExams.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', backgroundColor: 'var(--yt-paper-2)', borderRadius: '12px', border: '1.5px dashed var(--yt-line)' }}>
                <h3 style={{ margin: '0 0 6px 0', color: 'var(--yt-ink)', fontSize: '1.1rem' }}>Aktif İçerik Bulunmuyor</h3>
                <p style={{ margin: 0, color: 'var(--yt-graphite)', fontSize: '0.9rem' }}>Seçilen kriterlere uygun aktif bir sınav veya paket bulunmamaktadır.</p>
              </div>
            ) : (
              <>
              <style>{`
                .yt-card-grid {
                  display: grid;
                  grid-template-columns: 1fr 1fr;
                  gap: 14px;
                }
                @media (max-width: 640px) {
                  .yt-card-grid {
                    grid-template-columns: 1fr;
                  }
                }
                .yt-exam-card {
                  background-color: #fff;
                  border: 1px solid var(--yt-line);
                  border-radius: 12px;
                  padding: 18px;
                  display: flex;
                  flex-direction: column;
                  gap: 11px;
                  cursor: pointer;
                  min-height: 258px;
                }
                .yt-exam-card h3 {
                  font-size: 1.02rem;
                  font-weight: 700;
                  line-height: 1.3;
                  min-height: 3.9em;
                  display: -webkit-box;
                  -webkit-line-clamp: 3;
                  -webkit-box-orient: vertical;
                  overflow: hidden;
                }
                .yt-exam-card .yt-rating {
                  display: flex;
                  align-items: center;
                  gap: 6px;
                }
                .yt-exam-card .yt-rating .avg {
                  font-weight: 700;
                  font-size: 0.88rem;
                  color: #B8860B;
                }
                .yt-exam-card .yt-rating .stars {
                  font-size: 1rem;
                  letter-spacing: 1px;
                  color: #E0A526;
                }
                .yt-exam-card .yt-rating .stars.empty {
                  color: var(--yt-line);
                }
                .yt-exam-card .yt-rating .count {
                  color: var(--yt-graphite);
                  font-size: 0.78rem;
                }
                .yt-exam-card .yt-meta-box {
                  display: flex;
                  gap: 8px;
                  flex-wrap: wrap;
                }
                .yt-exam-card .yt-meta-box span {
                  background-color: #F3F0E7;
                  color: #5C594C;
                  font-family: var(--yt-font-mono);
                  font-size: 0.72rem;
                  font-weight: 600;
                  padding: 5px 10px;
                  border-radius: 6px;
                }
                .yt-exam-card .yt-btn-explore {
                  background-color: #2F5D8A;
                  color: #fff;
                  border: none;
                  padding: 9px 14px;
                  border-radius: 7px;
                  font-size: 0.78rem;
                  font-weight: 600;
                  cursor: pointer;
                }
                .yt-exam-card .yt-btn-cart {
                  background-color: #FFF4E0;
                  color: #8A5A00;
                  border: 1px solid #E8C87A;
                  padding: 9px 10px;
                  border-radius: 7px;
                  font-size: 0.78rem;
                  font-weight: 600;
                  cursor: pointer;
                }
                .yt-exam-card .yt-btn-cart.in-cart {
                  background-color: #E8F3EC;
                  color: #1F6B44;
                  border-color: #9FCFB2;
                }
              `}</style>
              <div className="yt-card-grid">
                {publishedExams.map(exam => {
                  const resData = studentResultsMap[exam.id];
                  const isCompleted = resData?.is_finished;
                  const isDeneme = exam.examType === 'deneme';
                  const ratingInfo = examRatingsMap[exam.id] || { average: '0,0', count: '0' };
                  const isPaid = !!(exam.price && exam.price > 0);
                  const childTests = exams.filter(e => e.parentId === exam.id);
                  const totalQuestions = childTests.length > 0
                    ? childTests.reduce((sum, t) => sum + (t.numPages || 0), 0)
                    : (exam.numPages || 0);
                  const completedChildCount = childTests.length > 0
                    ? childTests.filter(t => studentResultsMap[t.id]?.is_finished).length
                    : 0;
                  const childProgressPct = childTests.length > 0 ? Math.round((completedChildCount / childTests.length) * 100) : 0;
                  const allChildDone = childTests.length > 0 && completedChildCount === childTests.length;

                  return (
                    <div
                      key={exam.id}
                      onClick={() => setInspectingExamId(exam.id)}
                      className="yt-exam-card"
                    >
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className="yt-tag">{exam.categoryExamType} · {exam.categoryLesson}</span>
                        <span className={`yt-tag ${isDeneme ? 'deneme' : 'test'}`}>
                          {isDeneme ? 'Deneme Sınavı' : 'Test'}
                        </span>
                        {user && (isCompleted || allChildDone) ? (
                          <span className="yt-tag done">Çözüldü</span>
                        ) : null}
                      </div>

                      <h3 style={{ margin: 0 }}>{exam.name || 'İsimsiz İçerik'}</h3>

                      <div className="yt-rating">
                        <span className="avg">{ratingInfo.average}</span>
                        <span className={`stars${Number(ratingInfo.count) === 0 ? ' empty' : ''}`}>
                          {'★'.repeat(Math.round(Number(ratingInfo.average.replace(',', '.')))).padEnd(5, '☆')}
                        </span>
                        <span className="count">({ratingInfo.count})</span>
                      </div>

                      <div className="yt-meta-box">
                        <span>{totalQuestions} SORU</span>
                        {childTests.length > 0 && <span>{childTests.length} TEST</span>}
                        {getCampaignCountdown(exam) && <span className="yt-countdown">⏳ {getCampaignCountdown(exam)}</span>}
                      </div>

                      {user && childTests.length > 0 && completedChildCount > 0 && (
                        <div style={{ marginTop: '2px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', fontFamily: 'var(--yt-font-mono)', color: 'var(--yt-graphite)', marginBottom: '4px' }}>
                            <span>{completedChildCount}/{childTests.length} test tamamlandı</span>
                            <span>%{childProgressPct}</span>
                          </div>
                          <div className="yt-subtest-progress-track" style={{ maxWidth: 'none' }}>
                            <div
                              className="yt-subtest-progress-fill"
                              style={{ width: `${childProgressPct}%`, backgroundColor: allChildDone ? 'var(--yt-correct)' : 'var(--yt-mustard)' }}
                            />
                          </div>
                        </div>
                      )}

                      <div style={{ flex: 1 }} />

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                        <div className="yt-price">
                          {isPaid ? (
                            <>
                              {exam.originalPrice && exam.originalPrice > exam.price ? (
                                <span className="old">₺{exam.originalPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                              ) : null}
                              <span className="now">₺{exam.price.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </>
                          ) : (
                            <span className="free">Ücretsiz</span>
                          )}
                          {isCompleted && <span className="net"> · Net: {resData.net}</span>}
                        </div>

                        <div style={{ display: 'flex', gap: '8px' }}>
                          {isPaid && !isCompleted && !studentPurchases[exam.id] && (
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleCartItem(exam.id); }}
                              className={`yt-btn-cart${cartItems.includes(exam.id) ? ' in-cart' : ''}`}
                            >
                              {cartItems.includes(exam.id) ? '✓ Sepette' : '+ Sepete Ekle'}
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setInspectingExamId(exam.id);
                            }}
                            className="yt-btn-explore"
                          >
                            {isCompleted ? 'Sonucu İncele →' : 'İçeriği İncele →'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              </>
            )}
          </main>

          <Footer />
          {renderCartDrawer()}
      {renderBillingGateModal()}
          {renderNotifDrawer()}
          {renderAuthModal()}
        </div>
      );
    }

    // Odak Modu aç/kapa: soru çözüm ekranında site header'ını (logo, menü,
    // sepet vb.) gizleyip soru alanına daha fazla dikey yer açar. Bilerek
    // native tarayıcı Fullscreen API'sini KULLANMIYORUZ -- o API elementi
    // gerçekten tam ekran genişlik/yükseklikte büyütmediği durumlarda
    // (ör. max-width sınırlı container'larda) geri kalan alanı siyah
    // bırakıyor ve tarayıcıdan tarayıcıya tutarsız davranıyor. Bu CSS
    // tabanlı yöntem her cihazda (iOS dahil) aynı ve öngörülebilir çalışır.
    const toggleFocusMode = () => setFocusMode((f) => !f);

    // Sınav / Test Çözüm Ekranı
    if (!activeStudentExam) return null;

    const answeredCount = Object.keys(studentAnswers).length;
    const emptyCount = activeStudentExam.numPages - answeredCount;
    const results = showResults ? (studentResultsMap[activeStudentExamId] || calculateResults()) : null;
    const kazanimReport = showResults ? getKazanimReport() : null;
    const isDeneme = activeStudentExam.examType === 'deneme';
    const myActiveRating = studentResultsMap[activeStudentExamId]?.rating || 0;

    return (
      <div className="yt-shell" style={{ maxWidth: '1300px', margin: '0 auto', padding: focusMode ? '12px' : '24px' }}>
        {!focusMode && (
          <header className="yt-header" style={{ marginBottom: '20px' }}>
            <div className="yt-header-inner">
              <div
                className="yt-brand"
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  const targetId = activeStudentExam.parentId || activeStudentExam.id;
                  setActiveStudentExamId(null);
                  setInspectingExamId(targetId);
                }}
              >
                <img src={sualinkLogo} alt="Sualink" className="yt-brand-logo" />
              </div>
              {!showResults && (
                <h1 style={{ margin: 0, fontSize: '1.1rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{activeStudentExam.name || 'İsimsiz İçerik'}</h1>
              )}
              <div style={{ flex: 1 }}></div>
              <button
                onClick={() => {
                  const targetId = activeStudentExam.parentId || activeStudentExam.id;
                  setActiveStudentExamId(null);
                  setInspectingExamId(targetId);
                }}
                className="yt-btn yt-btn-ghost"
              >
                İçerik Listesine Dön
              </button>
              {renderHeaderRight()}
            </div>
          </header>
        )}

        {showResults && results ? (
          <div className="yt-session-card" style={{ maxWidth: '700px', margin: '0 auto 24px auto' }}>

            <h2 style={{ fontFamily: 'var(--yt-font-display)', fontWeight: '600', fontSize: '1.2rem', color: 'var(--yt-ink)', textAlign: 'center', margin: '0 0 20px' }}>{activeStudentExam.name || 'İsimsiz İçerik'}</h2>

            {user && (
              <div style={{ marginBottom: '20px', padding: '16px', backgroundColor: 'var(--yt-paper)', borderRadius: '10px', border: '1px solid var(--yt-line)', textAlign: 'center' }}>
                <div style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--yt-ink)', marginBottom: '8px' }}>Bu içeriği nasıl buldunuz? Puanlayın:</div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '6px' }}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <span
                      key={star}
                      onClick={() => handleRateExamInActiveScreen(star)}
                      style={{
                        cursor: 'pointer',
                        fontSize: '2.2rem',
                        color: myActiveRating >= star ? 'var(--yt-mustard)' : 'var(--yt-line)',
                        padding: '0 4px',
                        userSelect: 'none',
                        display: 'inline-block'
                      }}
                      title={`${star} Yıldız Ver`}
                    >
                      ★
                    </span>
                  ))}
                </div>
                {myActiveRating > 0 && (
                  <div style={{ fontSize: '0.82rem', color: 'var(--yt-correct)', fontWeight: '600', marginTop: '8px', fontFamily: 'var(--yt-font-mono)' }}>
                    Puanınız kaydedildi ({myActiveRating} Yıldız)
                  </div>
                )}

                <div style={{ marginTop: '14px', textAlign: 'left' }}>
                  <textarea
                    value={reviewTextInput || studentResultsMap[activeStudentExamId]?.reviewText || ''}
                    onChange={(e) => setReviewTextInput(e.target.value)}
                    placeholder="İsteğe bağlı: bu içerik hakkında kısa bir yorum bırakın..."
                    style={{ width: '100%', minHeight: '60px', padding: '8px', borderRadius: '8px', border: '1px solid var(--yt-line)', fontFamily: 'var(--yt-font-body)', fontSize: '0.85rem', boxSizing: 'border-box', resize: 'vertical' }}
                  />
                  <button
                    onClick={() => handleSubmitReview(reviewTextInput || studentResultsMap[activeStudentExamId]?.reviewText || '')}
                    className="yt-btn yt-btn-outline"
                    style={{ marginTop: '8px', fontSize: '0.8rem' }}
                  >
                    Yorumu Kaydet
                  </button>
                </div>
              </div>
            )}

            <h2 style={{ textAlign: 'center', marginTop: 0 }}>Sonuçlar</h2>
            <div className="yt-stat-grid">
              <div className="yt-stat-box correct"><span className="lbl">DOĞRU</span><div className="val">{results.correct}</div></div>
              <div className="yt-stat-box wrong"><span className="lbl">YANLIŞ</span><div className="val">{results.wrong}</div></div>
              <div className="yt-stat-box"><span className="lbl">BOŞ</span><div className="val">{results.empty}</div></div>
              <div className="yt-stat-box net"><span className="lbl">NET</span><div className="val">{results.net}</div></div>
            </div>

            {user && (() => {
              const usedResets = results.reset_count || 0;
              const kalanHak = MAX_EXAM_RESETS - usedResets;
              return kalanHak > 0 ? (
                <div style={{ textAlign: 'center', marginTop: '16px' }}>
                  <button onClick={resetExam} className="yt-btn yt-btn-outline" style={{ fontSize: '0.82rem' }}>
                    ↺ Sınavı Sıfırla ve Baştan Çöz ({kalanHak} hak kaldı)
                  </button>
                </div>
              ) : (
                <div style={{ textAlign: 'center', marginTop: '16px', fontSize: '0.78rem', color: 'rgba(0,0,0,0.5)' }}>
                  Bu sınav için sıfırlama hakkınızı kullandınız.
                </div>
              );
            })()}

            {kazanimReport && kazanimReport.hasData && (
              <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid var(--yt-line)' }}>
                <div style={{
                  backgroundColor: '#E24B4A',
                  color: '#fff',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  lineHeight: 1.45,
                  marginBottom: '14px'
                }}>
                  Uyarı: Gelişiminizi hızlandırmak için aşağıda yer alan soru paletinden yanlış cevapladığınız soruları ve cevaplarını inceleyiniz.
                </div>
                <h2 style={{
                  margin: '0 0 4px 0',
                  textAlign: 'center',
                  fontFamily: 'var(--yt-font-display)',
                  fontWeight: '700',
                  background: 'linear-gradient(90deg, #1d4e89 0%, #2f7bc4 40%, #f2a93b 75%, #f28c1e 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text'
                }}>
                  Sualink Raporu
                </h2>
                <p style={{ margin: '0 0 16px 0', fontSize: '0.85rem', color: 'var(--yt-graphite)', textAlign: 'center' }}>
                  Önce derse, sonra içindeki bir konuya tıkla -- kazanım bazlı ayrıntıyı ve sana özel önerimizi orada görürsün.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {Object.entries(kazanimReport.byDers).map(([ders, dersData]) => {
                    const dersIsHedefDisi = dersData.tier === 'hedefDisi';
                    const dersGreenWidth = getBaremGreenWidth(dersData.correct, dersData.total);
                    const dersTextColor = dersIsHedefDisi ? '#94A3B8' : getBaremTextColor(dersData.correct, dersData.total);
                    const dersMeta = KONU_TIER_META[dersData.tier] || { label: dersData.tier || '-', color: '#64748B', bg: '#F1F5F9' };
                    const dersTavsiye = getDersTavsiyesi(ders, dersData);
                    let dersCtaExams = [];
                    if (dersTavsiye.aksiyon === 'deneme') {
                      dersCtaExams = findOnerilenDenemeler(activeStudentExam.id, activeStudentExam.examType, dersData.lessonCategoryId);
                    }
                    return (
                      <div key={ders} className="yt-kazanim-box">
                        <div className="head" style={{ display: 'grid', gridTemplateColumns: '1fr auto 150px', alignItems: 'center', gap: '12px' }}>
                          <span>{ders}</span>
                          <span style={{ fontSize: '0.7rem', fontWeight: 'bold', padding: '3px 8px', borderRadius: '999px', color: dersMeta.color, backgroundColor: dersMeta.bg, whiteSpace: 'nowrap' }}>
                            {dersMeta.label}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {/* "Hedefte Değil" (hiç cevaplanmamış) tamamen kırmızı bir çubukla
                                gösterilirse "başarısız oldu" izlenimi verir -- oysa hiç denenmemiş.
                                Bu yüzden bu durumda çubuğu nötr gri yapıyoruz, kırmızı/yeşil sadece
                                gerçekten cevaplanmış (riskli/iyi/harika) derslerde kullanılıyor. */}
                            <div style={{ flex: 1, height: '16px', border: '1.5px solid #111', borderRadius: '3px', overflow: 'hidden', backgroundColor: dersIsHedefDisi ? 'var(--yt-line)' : '#E24B4A' }}>
                              {!dersIsHedefDisi && <div style={{ height: '100%', width: `${dersGreenWidth}%`, backgroundColor: '#639922' }}></div>}
                            </div>
                            <span style={{ fontFamily: 'var(--yt-font-mono)', fontSize: '0.8rem', fontWeight: 'bold', width: '38px', textAlign: 'right', color: dersTextColor }}>
                              {dersData.correct}/{dersData.total}
                            </span>
                          </div>
                        </div>

                        <p style={{ margin: '8px 0 0 0', fontSize: '0.8rem', color: 'var(--yt-ink)' }}>{dersTavsiye.mesaj}</p>
                        {dersTavsiye.aksiyon === 'deneme' && dersCtaExams.length > 0 && (
                          <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {dersCtaExams.map((ex) => renderOneriTestSatiri(ex))}
                          </div>
                        )}

                        <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {Object.entries(dersData.konular).map(([konuName, konuEntry]) => {
                            const konuKey = `${ders}::${konuName}`;
                            const isOpen = !!expandedKonular[konuKey];
                            const meta = KONU_TIER_META[konuEntry.tier] || { label: konuEntry.tier || '-', color: '#64748B', bg: '#F1F5F9' };
                            const kGreenWidth = getBaremGreenWidth(konuEntry.correct, konuEntry.total);
                            const tavsiye = getKonuTavsiyesi(konuName, konuEntry);

                            let ctaExams = [];
                            // "Riskli" konularda da (video/konu anlatımı önerisinin YANINDA)
                            // aynı konuya özel test(ler) öneriyoruz.
                            // ÖNEMLİ: önce KAZANIM bazında deniyoruz -- bir konunun içinde
                            // birden fazla kazanım varsa (örn. "Anayasa, İnsan Hakları
                            // Hukuku" konusunun altında Yasama/Yürütme/Yargı gibi) ve
                            // bunlardan bazılarına/hepsine özel dar kapsamlı testler varsa,
                            // her biri İÇİN AYRI test göstermek istiyoruz -- eskiden sadece
                            // konu genelinde TEK bir test seçilip diğer kazanımlara özel
                            // testler hiç önerilmiyordu. Riskli/İyi olan HER kazanım için
                            // findKazanimTestleri çalıştırıp sonuçları (aynı test iki kez
                            // görünmesin diye tekilleştirerek) birleştiriyoruz. Hiçbir
                            // kazanıma özel test bulunamazsa, eskisi gibi konu geneline en
                            // uygun TEK teste (findKonuTestleri) düşüyoruz.
                            if (tavsiye.aksiyon === 'konuTesti' || tavsiye.aksiyon === 'video') {
                              const kazanimEntries = Object.values(konuEntry.kazanimlar)
                                .filter((k) => k.tier === 'riskli' || k.tier === 'iyi');
                              const seenIds = new Set();
                              const perKazanimExams = [];
                              kazanimEntries.forEach((k) => {
                                findKazanimTestleri(k.outcomeId, activeStudentExam.id).forEach((ex) => {
                                  if (!seenIds.has(ex.id)) {
                                    seenIds.add(ex.id);
                                    perKazanimExams.push(ex);
                                  }
                                });
                              });
                              ctaExams = perKazanimExams.length > 0
                                ? perKazanimExams
                                : findKonuTestleri(konuEntry.topicId, activeStudentExam.id);
                            } else if (tavsiye.aksiyon === 'deneme') {
                              ctaExams = findOnerilenDenemeler(activeStudentExam.id, activeStudentExam.examType, dersData.lessonCategoryId);
                            }

                            return (
                              <div key={konuKey} style={{ border: '1px solid var(--yt-line)', borderRadius: '8px', overflow: 'hidden' }}>
                                <button
                                  onClick={() => setExpandedKonular((prev) => ({ ...prev, [konuKey]: !prev[konuKey] }))}
                                  style={{
                                    width: '100%',
                                    display: 'grid',
                                    gridTemplateColumns: '18px 1fr auto 110px',
                                    alignItems: 'center',
                                    gap: '10px',
                                    padding: '9px 12px',
                                    backgroundColor: '#fff',
                                    border: 'none',
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                    fontFamily: 'inherit',
                                    fontSize: '0.85rem'
                                  }}
                                >
                                  <span style={{ display: 'inline-block', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', fontSize: '0.7rem', color: 'var(--yt-graphite)' }}>▶</span>
                                  <span>{konuName}</span>
                                  <span style={{ fontSize: '0.7rem', fontWeight: 'bold', padding: '3px 8px', borderRadius: '999px', color: meta.color, backgroundColor: meta.bg, whiteSpace: 'nowrap' }}>
                                    {meta.label}
                                  </span>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <div style={{ flex: 1, height: '10px', border: '1.5px solid #111', borderRadius: '3px', overflow: 'hidden', backgroundColor: '#E24B4A' }}>
                                      <div style={{ height: '100%', width: `${kGreenWidth}%`, backgroundColor: '#639922' }}></div>
                                    </div>
                                    <span style={{ fontFamily: 'var(--yt-font-mono)', fontSize: '0.72rem', fontWeight: 'bold', width: '32px', textAlign: 'right' }}>
                                      {konuEntry.correct}/{konuEntry.total}
                                    </span>
                                  </div>
                                </button>

                                {isOpen && (
                                  <div style={{ padding: '12px 14px', backgroundColor: '#FAFAF7', borderTop: '1px solid var(--yt-line)' }}>
                                    <p style={{ margin: '0 0 10px 0', fontSize: '0.82rem', color: 'var(--yt-ink)' }}>{tavsiye.mesaj}</p>

                                    {(tavsiye.aksiyon === 'konuTesti' || tavsiye.aksiyon === 'deneme' || tavsiye.aksiyon === 'video') && ctaExams.length > 0 && (
                                      <div style={{ marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        {ctaExams.map((ex) => renderOneriTestSatiri(ex))}
                                      </div>
                                    )}

                                    <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
                                      {Object.entries(konuEntry.kazanimlar).map(([kazanim, k]) => {
                                        const kzGreenWidth = getBaremGreenWidth(k.correct, k.total);
                                        const kzTextColor = getBaremTextColor(k.correct, k.total);
                                        const resource = k.outcomeId ? learningOutcomeResources[k.outcomeId] : null;
                                        const hasPdf = !!resource?.pdf_url;
                                        const hasVideo = !!resource?.video_url;
                                        const videoKey = `${konuKey}::${kazanim}`;
                                        const isVideoOpen = !!expandedVideoKazanim[videoKey];
                                        const embedUrl = hasVideo ? getYoutubeEmbedUrl(resource.video_url) : null;
                                        const showResources = k.tier === 'riskli' && (hasPdf || hasVideo);
                                        return (
                                          <li key={kazanim} style={{ padding: '4px 0' }}>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', alignItems: 'center', gap: '10px' }}>
                                              <span style={{ fontSize: '0.78rem' }}>{kazanim}</span>
                                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <div style={{ flex: 1, height: '11px', border: '1.5px solid #111', borderRadius: '3px', overflow: 'hidden', backgroundColor: '#E24B4A' }}>
                                                  <div style={{ height: '100%', width: `${kzGreenWidth}%`, backgroundColor: '#639922' }}></div>
                                                </div>
                                                <span style={{ fontFamily: 'var(--yt-font-mono)', fontSize: '0.7rem', fontWeight: 'bold', width: '32px', textAlign: 'right', color: kzTextColor }}>
                                                  {k.correct}/{k.total}
                                                </span>
                                              </div>
                                            </div>

                                            {showResources && (
                                              <div style={{ marginTop: '5px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                                {hasPdf && (
                                                  <a
                                                    href={resource.pdf_url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="yt-resource-pill"
                                                  >
                                                    📄 Ders Notu
                                                  </a>
                                                )}
                                                {hasVideo && (
                                                  <button
                                                    type="button"
                                                    onClick={() => setExpandedVideoKazanim((prev) => ({ ...prev, [videoKey]: !prev[videoKey] }))}
                                                    className="yt-resource-pill"
                                                  >
                                                    {isVideoOpen ? '▲ Videoyu Kapat' : '🎥 Video Anlatım'}
                                                  </button>
                                                )}
                                              </div>
                                            )}

                                            {showResources && isVideoOpen && hasVideo && (
                                              embedUrl ? (
                                                <div style={{ marginTop: '8px', position: 'relative', paddingBottom: '56.25%', height: 0, borderRadius: '8px', overflow: 'hidden' }}>
                                                  <iframe
                                                    src={embedUrl}
                                                    title={`${kazanim} video anlatım`}
                                                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
                                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                                    allowFullScreen
                                                  />
                                                </div>
                                              ) : (
                                                <p style={{ margin: '6px 0 0 0', fontSize: '0.76rem' }}>
                                                  <a href={resource.video_url} target="_blank" rel="noopener noreferrer">▶ Videoyu izlemek için tıkla</a>
                                                </p>
                                              )
                                            )}
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : null}

        <style>{`
          .exam-layout {
            display: grid;
            grid-template-columns: 1fr 240px;
            gap: 16px;
            align-items: start;
          }
          @media (max-width: 900px) {
            .exam-layout {
              grid-template-columns: 1fr !important;
            }
          }

          /* Önceki/Sonraki Soru butonları: masaüstünde şıklarla (A-E) aynı
             satırda, dar ekranlarda (telefon) şıkların altında ayrı satırda. */
          .yt-nav-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin: 20px 0;
            flex-wrap: wrap;
          }
          .yt-nav-row .yt-nav-middle {
            flex: 1 1 auto;
            display: flex;
            justify-content: center;
            min-width: 0;
          }
          .yt-nav-row .yt-nav-btn {
            flex-shrink: 0;
            white-space: nowrap;
          }
          @media (max-width: 640px) {
            .yt-nav-row .yt-nav-middle {
              order: 1;
              flex-basis: 100%;
            }
            .yt-nav-row .yt-nav-btn-prev {
              order: 2;
            }
            .yt-nav-row .yt-nav-btn-next {
              order: 3;
            }
          }
        `}</style>

        <div className="exam-layout">

          <div>
            {!showResults && !examStarted && (
              <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                padding: '12px 16px',
                marginBottom: '12px',
                borderRadius: '8px',
                backgroundColor: 'var(--yt-mustard-bg)',
                color: 'var(--yt-mustard-deep)',
                fontSize: '0.85rem',
                lineHeight: 1.5,
                fontWeight: 600
              }}>
                <span style={{ fontSize: '1.1rem', lineHeight: 1 }}>ℹ️</span>
                <span>
                  Sınav sırasında istediğin zaman çıkabilirsin — cevapların otomatik olarak kaydedilir, geri döndüğünde tam kaldığın yerden devam edersin.
                  Süre, aşağıdaki <b>"Başla"</b> butonuna bastığında işlemeye başlar.
                </span>
              </div>
            )}

            <div className="yt-exam-shell" style={{ padding: '14px 20px', marginBottom: '12px' }}>
              <div className="yt-topbar" style={{ marginBottom: 0 }}>
                <span>
                  {(() => {
                    const { number, sectionName } = getDisplayQuestionLabel(activeStudentExam, studentCurrentPage);
                    if (sectionName) {
                      const secs = activeStudentExam.sections || [];
                      const sec = secs.find(s => studentCurrentPage >= s.start && studentCurrentPage <= s.end);
                      return `${sectionName} · SORU ${number} / ${sec.end - sec.start + 1}`;
                    }
                    return `SORU ${number} / ${activeStudentExam.numPages}`;
                  })()}
                </span>
                {!showResults && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      onClick={() => {
                        if (!examStarted) {
                          setExamStarted(true);
                          setIsPaused(false);
                        } else {
                          setIsPaused(p => !p);
                        }
                      }}
                      style={{
                        padding: '5px 12px',
                        fontSize: '0.8rem',
                        fontWeight: 'bold',
                        borderRadius: '6px',
                        border: '1px solid rgba(251,249,243,0.45)',
                        backgroundColor: (isPaused || !examStarted) ? 'var(--yt-mustard)' : 'transparent',
                        color: (isPaused || !examStarted) ? '#1a1a2e' : '#FBF9F3',
                        cursor: 'pointer'
                      }}
                    >
                      {!examStarted ? '▶ Başla' : (isPaused ? '▶ Devam Et' : '⏸ Mola Ver')}
                    </button>
                    <div className={`yt-timer${(examStarted && !isPaused && timeLeft < 300) ? ' urgent' : ''}`} style={{ fontSize: '1.15rem', padding: '5px 12px', opacity: (examStarted && isPaused) ? 0.6 : 1 }}>
                      {examStarted && isPaused ? 'MOLADA' : formatTime(timeLeft)}
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span>İŞARETLENEN: <b style={{ color: studentAnswers[studentCurrentPage] ? 'var(--yt-mustard)' : 'rgba(251,249,243,0.5)' }}>{studentAnswers[studentCurrentPage] || 'BOŞ'}</b></span>
                  <button
                    onClick={toggleFocusMode}
                    title={focusMode ? 'Odak Modundan Çık' : 'Odak Modu (Tam Ekran)'}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '26px',
                      height: '26px',
                      padding: 0,
                      borderRadius: '6px',
                      border: '1px solid rgba(251,249,243,0.45)',
                      backgroundColor: focusMode ? 'var(--yt-mustard)' : 'transparent',
                      color: focusMode ? '#1a1a2e' : '#FBF9F3',
                      fontSize: '0.9rem',
                      cursor: 'pointer',
                      lineHeight: 1
                    }}
                  >
                    {focusMode ? '⤡' : '⤢'}
                  </button>
                </div>
              </div>
            </div>

            <SecurePdfViewer
              examId={activeStudentExamId}
              type="exam"
              pageNumber={studentCurrentPage}
            />

            <div className="yt-nav-row">
              <button
                disabled={studentCurrentPage <= 1}
                onClick={() => { setStudentCurrentPage(p => p - 1); setViewingSolutionQ(false); }}
                className="yt-btn yt-btn-outline yt-nav-btn yt-nav-btn-prev"
                style={studentCurrentPage <= 1 ? { opacity: 0.4, cursor: 'not-allowed' } : {}}
              >
                ◀ Önceki Soru
              </button>

              <div className="yt-nav-middle">
                {!isExamFinished && examStarted && (
                  isPaused ? (
                    <div style={{ textAlign: 'center', padding: '10px 14px', borderRadius: '8px', backgroundColor: 'var(--yt-mustard-bg)', color: 'var(--yt-mustard-deep)', fontWeight: 'bold', fontSize: '0.85rem' }}>
                      Moladasın, cevap işaretleyemezsin. Devam etmek için "Devam Et"e bas.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
                      {['A', 'B', 'C', 'D', 'E'].map(option => {
                        const isSelected = studentAnswers[studentCurrentPage] === option;
                        return (
                          <button key={option} onClick={() => handleAnswerSelect(option)} className={`yt-abub${isSelected ? ' picked' : ''}`}>
                            {option}
                          </button>
                        );
                      })}
                    </div>
                  )
                )}
              </div>

              <button
                disabled={studentCurrentPage >= activeStudentExam.numPages}
                onClick={() => { setStudentCurrentPage(p => p + 1); setViewingSolutionQ(false); }}
                className="yt-btn yt-btn-primary yt-nav-btn yt-nav-btn-next"
                style={studentCurrentPage >= activeStudentExam.numPages ? { opacity: 0.4, cursor: 'not-allowed' } : {}}
              >
                Sonraki Soru ▶
              </button>
            </div>
          </div>

          <div className="yt-exam-shell" style={{ padding: '16px' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '0.78rem', fontFamily: 'var(--yt-font-mono)', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(251,249,243,0.6)', textAlign: 'center' }}>Soru Paleti</h3>

            {!showResults ? (
              <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: '12px', padding: '6px', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: '6px', fontSize: '0.72rem', fontFamily: 'var(--yt-font-mono)' }}>
                <span style={{ color: 'var(--yt-mustard)', fontWeight: 'bold' }}>ÇÖZÜLDÜ: {answeredCount}</span>
                <span style={{ color: 'rgba(251,249,243,0.5)', fontWeight: 'bold' }}>BOŞ: {emptyCount}</span>
              </div>
            ) : null}

            <div style={{ maxHeight: '420px', overflowY: 'auto', paddingRight: '2px', marginBottom: '14px' }}>
              {(() => {
                const secs = (activeStudentExam.sections && activeStudentExam.sections.length > 0)
                  ? activeStudentExam.sections
                  : [{ name: null, start: 1, end: activeStudentExam.numPages }];

                return secs.map((sec, secIndex) => (
                  <div key={secIndex} style={{ marginBottom: '10px' }}>
                    {sec.name && (
                      <div style={{ fontSize: '0.7rem', fontWeight: 'bold', color: 'rgba(251,249,243,0.55)', marginBottom: '4px', paddingLeft: '2px', fontFamily: 'var(--yt-font-mono)' }}>
                        {sec.name}
                      </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px' }}>
                      {Array.from({ length: sec.end - sec.start + 1 }, (_, i) => {
                        const qNum = sec.start + i;
                        const localNum = i + 1;
                        const isAnswered = !!studentAnswers[qNum];
                        const isCurrent = studentCurrentPage === qNum;
                        let cellClass = 'yt-pcell';

                        if (showResults) {
                          const studentAns = studentAnswers[qNum];
                          const correctAns = activeStudentExam.answerKey[qNum];
                          if (studentAns && studentAns === correctAns) {
                            cellClass += ' correct';
                          } else if (studentAns && studentAns !== correctAns) {
                            cellClass += ' wrong';
                          }
                        } else {
                          if (isAnswered) { cellClass += ' answered'; }
                        }
                        if (isCurrent) { cellClass += ' current'; }

                        return (
                          <button key={qNum} onClick={() => { setStudentCurrentPage(qNum); setViewingSolutionQ(false); }} className={cellClass} style={{ height: '26px', padding: 0 }}>
                            {localNum}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ));
              })()}
            </div>

            {showResults && activeStudentExam.solutionPdfFile && (
              <button onClick={() => setViewingSolutionQ(v => !v)} className={`yt-btn yt-btn-correct${viewingSolutionQ ? ' active' : ''}`} style={{ width: '100%', marginBottom: '10px' }}>
                {viewingSolutionQ ? '✕ Çözümü Gizle' : `${getDisplayQuestionLabel(activeStudentExam, studentCurrentPage).number}. Çözümü Gör`}
              </button>
            )}

            {!isExamFinished && (
              <button onClick={finishExam} className="yt-btn yt-btn-buy" style={{ width: '100%' }}>
                {isDeneme ? 'Sınavı Bitir' : 'Testi Bitir'}
              </button>
            )}
          </div>

        </div>

        {(showResults && viewingSolutionQ) && activeStudentExam.solutionPdfFile && (
          <div ref={solutionRef} className="yt-session-card" style={{ marginTop: '20px', borderColor: 'var(--yt-correct)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--yt-correct)', padding: '10px 14px', borderRadius: '8px', fontWeight: '600', marginBottom: '12px', color: '#fff', fontSize: '0.88rem' }}>
              <span>{getDisplayQuestionLabel(activeStudentExam, studentCurrentPage).number}. Soru Çözümü Aşağıda</span>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {reportedQuestions[reportKey(activeStudentExamId, studentCurrentPage)] ? (
                  <button disabled style={{ padding: '4px 10px', borderRadius: '4px', border: 'none', backgroundColor: 'rgba(255,255,255,0.18)', color: '#fff', fontSize: '0.78rem', fontWeight: 'bold', cursor: 'not-allowed' }}>
                    ✓ Bildirildi
                  </button>
                ) : (
                  <button onClick={() => setShowReportModal(true)} style={{ padding: '4px 10px', borderRadius: '4px', border: 'none', backgroundColor: 'var(--yt-mustard)', color: '#1a1a2e', fontSize: '0.78rem', fontWeight: 'bold', cursor: 'pointer' }}>
                    ⚠ Hata / Geri Bildirim
                  </button>
                )}
                <button onClick={() => setViewingSolutionQ(false)} style={{ padding: '4px 10px', borderRadius: '4px', border: 'none', backgroundColor: 'rgba(0,0,0,0.2)', color: '#fff', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 'bold' }}>Kapat</button>
              </div>
            </div>
            <SecurePdfViewer examId={activeStudentExamId} type="solution" pageNumber={studentCurrentPage} />
          </div>
        )}

        {showReportModal && (
          <div
            onClick={() => !reportSubmitting && setShowReportModal(false)}
            style={{
              position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.55)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px'
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="yt-exam-shell"
              style={{ width: '100%', maxWidth: '440px', padding: '20px' }}
            >
              <h3 style={{ margin: '0 0 6px 0', fontSize: '1rem' }}>
                {getDisplayQuestionLabel(activeStudentExam, studentCurrentPage).number}. Soru İçin Bildirim
              </h3>
              <p style={{ margin: '0 0 12px 0', fontSize: '0.82rem', color: 'rgba(251,249,243,0.6)' }}>
                Soruda veya çözümde bir hata mı var? Görüşünüzü kısaca yazın, ekibimiz inceleyecek.
              </p>
              <textarea
                value={reportText}
                onChange={(e) => setReportText(e.target.value.slice(0, 300))}
                maxLength={300}
                rows={4}
                placeholder="Örn: C şıkkındaki çözüm hatalı, doğru cevap D olmalı..."
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '10px', borderRadius: '8px',
                  border: '1px solid rgba(251,249,243,0.25)', backgroundColor: 'rgba(255,255,255,0.06)',
                  color: '#FBF9F3', fontSize: '0.88rem', resize: 'vertical', fontFamily: 'inherit'
                }}
              />
              <div style={{ textAlign: 'right', fontSize: '0.72rem', color: 'rgba(251,249,243,0.5)', margin: '4px 0 14px' }}>
                {reportText.length}/300
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => { setShowReportModal(false); setReportText(''); }}
                  disabled={reportSubmitting}
                  className="yt-btn yt-btn-outline"
                >
                  Vazgeç
                </button>
                <button
                  onClick={handleSubmitQuestionReport}
                  disabled={reportSubmitting || !reportText.trim()}
                  className="yt-btn yt-btn-primary"
                  style={(reportSubmitting || !reportText.trim()) ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
                >
                  {reportSubmitting ? 'Gönderiliyor...' : 'Gönder'}
                </button>
              </div>
            </div>
          </div>
        )}
      {renderCartDrawer()}
      {renderBillingGateModal()}
      {renderNotifDrawer()}
      </div>
    );
  }

  return null;
}
import { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import SecurePdfViewer from './SecurePdfViewer';
import { supabase } from './supabase';
import { initializePayment } from './iyzipayService';

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
  const [newKazanimSoruNo, setNewKazanimSoruNo] = useState('');
  const [isCreatingExam, setIsCreatingExam] = useState(false);
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

  const [studentCurrentPage, setStudentCurrentPage] = useState(1);
  const [studentAnswers, setStudentAnswers] = useState({});
  const [timeLeft, setTimeLeft] = useState(0); 
  const [isPaused, setIsPaused] = useState(false);
  const [isExamFinished, setIsExamFinished] = useState(false);
  const [showResults, setShowResults] = useState(false);
  
  const [viewingSolutionQ, setViewingSolutionQ] = useState(false);
  const solutionRef = useRef(null);
  const [studentResultsMap, setStudentResultsMap] = useState({});
  const [studentPurchases, setStudentPurchases] = useState({}); 

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
  const [productReviews, setProductReviews] = useState([]);
  const [reviewTextInput, setReviewTextInput] = useState('');
  const [previewTestIndex, setPreviewTestIndex] = useState(0);

  const [showAccountPage, setShowAccountPage] = useState(false);
  const [accountTab, setAccountTab] = useState('exams');
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
        checkUserRoleAndSetMode(session.user);
      } else {
        fetchPublicExams();
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        checkUserRoleAndSetMode(session.user);
      } else {
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
      if (user) fetchUserPurchases(user.email);
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

  const checkUserRoleAndSetMode = (currentUser) => {
    if (currentUser.email === 'admin@yayinevi.com') {
      setAppMode('admin');
    } else {
      setAppMode('student');
    }
    fetchExams(currentUser);
    fetchUserPurchases(currentUser.email);
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

  const fetchPublicExams = async () => {
    const { data, error } = await supabase
      .from('exams')
      .select(EXAM_PUBLIC_COLUMNS)
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
            currentPage: res.current_page ?? null
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

  // Kazanım tablosunda yazarken her tuş vuruşunda veritabanına yazmamak için
  // sadece yerel state'i güncelliyoruz; kayıt "Kaydet" butonuna basınca olur.
  const updateTopicMapLocal = (id, newTopicMap) => {
    setExams((prev) => prev.map(ex => ex.id === id ? { ...ex, topicMap: newTopicMap } : ex));
  };

  // Kazanım haritası güncellemesini ayrı tutuyoruz ki topic_map kolonu
  // henüz eklenmemişse diğer alanların kaydedilmesini etkilemesin.
  const updateTopicMapInDb = async (id, newTopicMap) => {
    setExams((prev) => prev.map(ex => ex.id === id ? { ...ex, topicMap: newTopicMap } : ex));
    const { error } = await supabase
      .from('exams')
      .update({ topic_map: newTopicMap })
      .eq('id', id);
    if (error) {
      console.error("Kazanım haritası kaydedilemedi (topic_map kolonu eksik olabilir):", error);
      alert("Kazanım haritası kaydedilemedi. Veritabanına 'topic_map' kolonu eklenmiş mi kontrol edin.");
    }
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

      // Storage artık private -- public URL yerine sadece dosya adını
      // (path) saklıyoruz; görüntülenirken /api/get-pdf-url ile erişim
      // hakkı doğrulanıp kısa ömürlü imzalı bir URL üretiliyor.
      setAuthLoading(false);
      await updateExamInDb(examId, { pdfFile: fileName });
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
        let count = 0;
        for (let i = 1; i < rows.length; i++) { // 0. satır başlık, 1'den başla
          const row = rows[i];
          if (!row || row.length < 3) continue;
          const soruNo = Number(row[0]);
          const ders = String(row[1] || '').trim();
          const kazanim = String(row[2] || '').trim();
          if (!soruNo || !ders || !kazanim) continue;
          newTopicMap[soruNo] = { ders, kazanim };
          count++;
        }

        if (count === 0) {
          alert("Excel dosyasında geçerli satır bulunamadı. Sütun sırasının Soru No / Ders / Kazanım olduğundan emin olun.");
          return;
        }

        updateTopicMapInDb(examId, newTopicMap);
        alert(`✓ ${count} soru için kazanım haritası yüklendi.`);
      } catch (err) {
        console.error(err);
        alert("Excel dosyası okunamadı: " + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
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

    // Yarım kalmış (bitirilmemiş) bir oturum varsa cevapları, süreyi ve sayfayı oradan geri yükle.
    const existingRes = studentResultsMap[exam.id];
    const hasUnfinishedSession = existingRes && !existingRes.is_finished && existingRes.answers && Object.keys(existingRes.answers).length > 0;

    setActiveStudentExamId(exam.id);
    setInspectingExamId(null);
    setIsExamFinished(false);
    setShowResults(false);
    setViewingSolutionQ(false);
    setIsPaused(false);

    if (hasUnfinishedSession) {
      setStudentAnswers(existingRes.answers || {});
      setStudentCurrentPage(existingRes.currentPage || 1);
      if (exam.examType === 'deneme') {
        setTimeLeft(existingRes.timeLeft != null ? existingRes.timeLeft : exam.duration * 60);
      } else {
        setTimeLeft(existingRes.timeLeft || 0);
      }
    } else {
      setStudentAnswers({});
      setStudentCurrentPage(1);
      setTimeLeft(exam.examType === 'deneme' ? exam.duration * 60 : 0);
    }
  };

  const handleIyzicoPayment = async (exam) => {
    if (!user) {
      alert("Ödeme yapabilmek ve sınava katılabilmek için lütfen giriş yapın.");
      setAuthMode('login');
      setShowAuthModal(true);
      return;
    }

    const confirmed = window.confirm(`"${exam.name}" isimli sınav ücretli (₺${exam.price}). İyzico ödeme formu açılacaktır. Onaylıyor musunuz?`);
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

    const cartExams = exams.filter(e => cartItems.includes(e.id));
    if (cartExams.length === 0) return;
    const cartTotal = cartExams.reduce((sum, e) => sum + (e.price || 0), 0);

    const confirmed = window.confirm(`Sepetinizdeki ${cartExams.length} içerik için toplam ₺${cartTotal.toLocaleString('tr-TR')} tutarında ödeme yapılacak. Onaylıyor musunuz?`);
    if (!confirmed) return;

    // Not: price/email artık sunucuda (Authorization token'ı ve veritabanı
    // üzerinden) doğrulanıyor, burada gönderilenler sadece referans amaçlı.
    const paymentData = {
      examIds: cartExams.map(e => e.id),
      items: cartExams.map(e => ({ id: e.id }))
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

      if (result.status === 'success') {
        const checkoutDiv = document.getElementById('iyzipay-checkout-form');
        if (checkoutDiv) {
          checkoutDiv.innerHTML = result.checkoutFormContent;
        }
        if (window.iyzipayCheckout && typeof window.iyzipayCheckout.show === 'function') {
          window.iyzipayCheckout.show();
        }
        setCartItems([]);
        setShowCart(false);
      } else {
        alert("İşlem başarısız: " + result.errorMessage);
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

  const getKazanimReport = () => {
    if (!activeStudentExam || !activeStudentExam.topicMap || Object.keys(activeStudentExam.topicMap).length === 0) {
      return null;
    }
    const numP = activeStudentExam.numPages;
    const byDers = {}; // { ders: { correct, total, kazanimlar: { kazanim: { correct, total } } } }

    for (let i = 1; i <= numP; i++) {
      const topic = activeStudentExam.topicMap[i];
      if (!topic || !topic.ders || !topic.kazanim) continue;

      const studentAns = studentAnswers[i];
      const correctAns = activeStudentExam.answerKey[i];
      const isCorrect = !!(studentAns && correctAns && studentAns === correctAns);

      if (!byDers[topic.ders]) byDers[topic.ders] = { correct: 0, total: 0, kazanimlar: {} };
      byDers[topic.ders].total++;
      if (isCorrect) byDers[topic.ders].correct++;

      if (!byDers[topic.ders].kazanimlar[topic.kazanim]) {
        byDers[topic.ders].kazanimlar[topic.kazanim] = { correct: 0, total: 0 };
      }
      byDers[topic.ders].kazanimlar[topic.kazanim].total++;
      if (isCorrect) byDers[topic.ders].kazanimlar[topic.kazanim].correct++;
    }

    const hasData = Object.keys(byDers).length > 0;
    return { byDers, hasData };
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
    const confirmText = activeStudentExam.examType === 'deneme' ? "Sınavı bitirmek istediğinize emin misiniz?" : "Testi bitirmek ve sonuçları görmek istediğinize emin misiniz?";
    if (window.confirm(confirmText)) {
      saveAndFinishExam(0);
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
            <button
              onClick={() => setShowAnnounceModal(true)}
              style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', cursor: 'pointer', color: '#0f172a', fontWeight: 'bold' }}
            >
              📢 Duyuru Gönder
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
            <button onClick={handleLogout} style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', cursor: 'pointer', color: '#dc2626', fontWeight: 'bold' }}>Çıkış Yap</button>
          </div>
        </header>

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
              <input 
                type="text" 
                placeholder="Örn: KPSS, LGS, YKS"
                value={newExamForm.categoryExamType} 
                onChange={(e) => setNewExamForm({ ...newExamForm, categoryExamType: e.target.value })} 
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} 
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '4px' }}>Ders Türü (Kategori):</label>
              <input 
                type="text" 
                placeholder="Örn: Genel Yetenek - Genel Kültür"
                value={newExamForm.categoryLesson} 
                onChange={(e) => setNewExamForm({ ...newExamForm, categoryLesson: e.target.value })} 
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} 
              />
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
                  <SecurePdfViewer
                    examId={currentPreviewExam.id}
                    type="exam"
                    pageNumber={1}
                  />
                </div>
                {editingExam && (
              <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px' }}>
                <h3 style={{ margin: '0 0 12px 0', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>📊 Kazanım Haritası</h3>

                <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.8rem', marginBottom: '4px' }}>Excel ile Yükle:</label>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => handleTopicMapUpload(editingExam.id, e)}
                  style={{ fontSize: '0.8rem', width: '100%' }}
                />
                <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '4px' }}>
                  Sütun sırası: 1. Soru No, 2. Ders, 3. Kazanım (ilk satır başlık kabul edilir). Yeniden yüklersen mevcut liste tamamen değişir.
                </div>

                {editingExam.topicMap && Object.keys(editingExam.topicMap).length > 0 && (
                  <div style={{ marginTop: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ fontSize: '0.8rem', color: '#16a34a', fontWeight: 'bold' }}>
                        ✓ {Object.keys(editingExam.topicMap).length} soru için kazanım eklendi.
                      </span>
                      <button
                        type="button"
                        onClick={() => { updateTopicMapInDb(editingExam.id, editingExam.topicMap); alert('Kazanım haritası kaydedildi.'); }}
                        className="yt-btn"
                        style={{ fontSize: '0.8rem', padding: '6px 14px' }}
                      >
                        💾 Kaydet
                      </button>
                    </div>

                    <div style={{ maxHeight: '420px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                        <thead style={{ position: 'sticky', top: 0, backgroundColor: '#f8fafc' }}>
                          <tr>
                            <th style={{ padding: '6px 10px', textAlign: 'left', width: '60px' }}>Soru</th>
                            <th style={{ padding: '6px 10px', textAlign: 'left', width: '35%' }}>Ders</th>
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
                              return (
                                <tr key={soruNo} style={{ borderTop: '1px solid #f1f5f9' }}>
                                  <td style={{ padding: '5px 10px', fontWeight: 'bold' }}>{soruNo}</td>
                                  <td style={{ padding: '5px 6px' }}>
                                    <input
                                      type="text"
                                      value={entry.ders}
                                      onChange={(e) => {
                                        const updated = { ...editingExam.topicMap, [soruNo]: { ...entry, ders: e.target.value } };
                                        updateTopicMapLocal(editingExam.id, updated);
                                      }}
                                      style={{ width: '100%', fontSize: '0.82rem', padding: '5px 6px', border: '1px solid #e2e8f0', borderRadius: '4px', boxSizing: 'border-box' }}
                                    />
                                  </td>
                                  <td style={{ padding: '5px 6px' }}>
                                    <input
                                      type="text"
                                      value={entry.kazanim}
                                      onChange={(e) => {
                                        const updated = { ...editingExam.topicMap, [soruNo]: { ...entry, kazanim: e.target.value } };
                                        updateTopicMapLocal(editingExam.id, updated);
                                      }}
                                      style={{ width: '100%', fontSize: '0.82rem', padding: '5px 6px', border: '1px solid #e2e8f0', borderRadius: '4px', boxSizing: 'border-box' }}
                                    />
                                  </td>
                                  <td style={{ padding: '5px 10px', textAlign: 'center' }}>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const updated = { ...editingExam.topicMap };
                                        delete updated[soruNo];
                                        updateTopicMapInDb(editingExam.id, updated);
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
                          const updated = { ...editingExam.topicMap, [soruNo]: { ders: '', kazanim: '' } };
                          updateTopicMapInDb(editingExam.id, updated);
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
            )}
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
                          <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.8rem', marginBottom: '4px' }}>Soru / Sayfa Sayısı:</label>
                          <input
                            type="number"
                            value={editingExam.numPages || 0}
                            onChange={(e) => updateExamInDb(editingExam.id, { numPages: Number(e.target.value) })}
                            style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box', fontSize: '0.85rem' }}
                          />
                        </div>

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

  if (showAccountPage && user) {
    const myPurchases = exams.filter(e => studentPurchases[e.id]);
    const mySolved = exams.filter(e => studentResultsMap[e.id]?.is_finished);

    return (
      <div className="yt-shell">
        <header className="yt-header">
          <div className="yt-header-inner">
            <div className="yt-brand">
              <span className="yt-brand-mark">YT</span>
              Yeni Trend
            </div>
            <div style={{ flex: 1 }}></div>
            <button onClick={() => setShowAccountPage(false)} className="yt-btn yt-btn-ghost">
              ◀ Kataloğa Dön
            </button>
          </div>
          <div className="yt-perf"></div>
        </header>

        <div className="wrap" style={{ maxWidth: '840px', margin: '0 auto', padding: '32px 24px 60px' }}>
          <h1 style={{ fontFamily: 'var(--yt-font-display)', fontWeight: '600', fontSize: '1.5rem', color: 'var(--yt-ink)', margin: '0 0 4px' }}>Hesabım</h1>
          <p style={{ color: 'var(--yt-graphite)', fontSize: '0.88rem', margin: '0 0 24px' }}>{user.email}</p>

          <div className="yt-chip-row" style={{ padding: '0 0 20px' }}>
            <button className={`yt-chip${accountTab === 'exams' ? ' active' : ''}`} onClick={() => setAccountTab('exams')}>Sınavlarım</button>
            <button className={`yt-chip${accountTab === 'settings' ? ' active' : ''}`} onClick={() => setAccountTab('settings')}>Ayarlar</button>
          </div>

          {accountTab === 'exams' ? (
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
            </div>
          ) : (
            <div className="yt-session-card" style={{ maxWidth: '440px' }}>
              <h3 className="yt-admin-section-title">Şifre Değiştir</h3>
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
                    padding: '10px 12px', borderRadius: '8px', fontSize: '0.85rem', marginBottom: '16px',
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
            </div>
          )}
        </div>
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
      const relatedExams = exams
        .filter(e => e.isPublished && !e.parentId && e.id !== inspectExam.id && e.categoryLesson === inspectExam.categoryLesson)
        .slice(0, 3);

      return (
        <div className="yt-shell">
          <header className="yt-header">
            <div className="yt-header-inner">
              <button onClick={() => setInspectingExamId(null)} className="yt-btn yt-btn-ghost">
                ◀ Tüm Listeye Dön
              </button>
              <div style={{ flex: 1, fontFamily: 'var(--yt-font-display)', fontWeight: '600', fontSize: '1.05rem', color: 'var(--yt-ink)' }}>İçerik Detayları</div>
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
              {user ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button onClick={() => setShowAccountPage(true)} className="yt-btn yt-btn-ghost">
                    👤 Hesabım
                  </button>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'var(--yt-paper)', padding: '6px 12px', borderRadius: '20px', border: '1px solid var(--yt-line)' }}>
                    <span style={{ width: '8px', height: '8px', backgroundColor: 'var(--yt-correct)', borderRadius: '50%' }}></span>
                    <span style={{ fontSize: '0.85rem', fontWeight: '500', color: 'var(--yt-ink)' }}>{user.email}</span>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => { setAuthMode('login'); setShowAuthModal(true); }} className="yt-btn yt-btn-outline">
                    Giriş Yap
                  </button>
                  <button onClick={() => { setAuthMode('register'); setShowAuthModal(true); }} className="yt-btn yt-btn-primary">
                    Kayıt Ol
                  </button>
                </div>
              )}
            </div>
            <div className="yt-perf"></div>
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

                {isPaid && !isPurchased && childExams.length > 0 && (
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

                {childExams.length === 0 && (
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
                      const ctaClass = childCompleted ? 'yt-btn-ghost' : (!isPaid || isPurchased ? 'yt-btn-outline' : 'yt-btn-locked');
                      return (
                        <div key={child.id} className="yt-subtest-row">
                          <div className={`yt-subtest-bubble${childCompleted ? ' done' : ''}`}>{childCompleted ? '✓' : index + 1}</div>
                          <div style={{ flex: 1, minWidth: '160px' }}>
                            <strong style={{ color: 'var(--yt-ink)' }}>{child.name || 'İsimsiz Test'}</strong>
                            <div style={{ fontFamily: 'var(--yt-font-mono)', fontSize: '0.74rem', color: 'var(--yt-graphite)', marginTop: '3px', display: 'flex', gap: '12px' }}>
                              <span>{child.numPages || '?'} SORU</span>
                              {childCompleted && <span style={{ color: 'var(--yt-correct)' }}>Net: {childRes.net}</span>}
                            </div>
                          </div>
                          <button
                            onClick={() => {
                              if (!user) {
                                alert("Sınava katılabilmek için lütfen giriş yapın veya üye olun.");
                                setAuthMode('login');
                                setShowAuthModal(true);
                                return;
                              }
                              if (!isPaid || isPurchased) {
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
                                handleIyzicoPayment(inspectExam);
                              }
                            }}
                            className={`yt-btn ${ctaClass}`}
                          >
                            {childCompleted ? 'Sonucu İncele' : (!isPaid || isPurchased ? 'Teste Başla →' : '🔒 Kilitli')}
                          </button>
                        </div>
                      );
                    })}
                  </div>
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

          <style>{`
            .yt-header-modern {
              box-shadow: 0 1px 0 rgba(27, 33, 56, 0.08), 0 2px 8px rgba(27, 33, 56, 0.04);
            }
            .yt-header-modern .yt-perf {
              display: none;
            }
          `}</style>
          <header className="yt-header yt-header-modern">
            <div className="yt-header-inner">
              <div className="yt-brand">
                <span className="yt-brand-mark">YT</span>
                Yeni Trend
              </div>

              <div style={{ flex: '1 1 300px', maxWidth: '450px', position: 'relative', minWidth: '200px' }}>
                <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--yt-graphite-soft)', fontSize: '0.9rem' }}>○</span>
                <input
                  type="text"
                  placeholder="Ne öğrenmek veya çözmek istiyorsunuz?"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ width: '100%', padding: '10px 14px 10px 36px', borderRadius: '8px', border: '1.5px solid var(--yt-line)', backgroundColor: 'var(--yt-paper-2)', outline: 'none', fontSize: '0.9rem', fontFamily: 'var(--yt-font-body)', color: 'var(--yt-ink)', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                {user && (
                  <button onClick={openStudentNotifs} className="yt-cart-btn" title="Bildirimler">
                    🔔
                    {studentUnreadCount > 0 && <span className="yt-cart-badge">{studentUnreadCount}</span>}
                  </button>
                )}
                <button onClick={() => setShowCart(true)} className="yt-cart-btn" title="Sepet">
                  🛒
                  {cartExams.length > 0 && <span className="yt-cart-badge">{cartExams.length}</span>}
                </button>
                {user ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'var(--yt-paper)', padding: '6px 12px', borderRadius: '20px', border: '1px solid var(--yt-line)' }}>
                      <span style={{ width: '8px', height: '8px', backgroundColor: 'var(--yt-correct)', borderRadius: '50%' }}></span>
                      <span style={{ fontSize: '0.85rem', fontWeight: '500', color: 'var(--yt-ink)' }}>{user.email}</span>
                    </div>
                    <button onClick={() => setShowAccountPage(true)} className="yt-btn yt-btn-ghost">
                      👤 Hesabım
                    </button>
                    <button onClick={handleLogout} className="yt-btn yt-btn-ghost">
                      Çıkış Yap
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => { setAuthMode('login'); setShowAuthModal(true); }} className="yt-btn yt-btn-outline">
                      Giriş Yap
                    </button>
                    <button onClick={() => { setAuthMode('register'); setShowAuthModal(true); }} className="yt-btn yt-btn-primary">
                      Kayıt Ol
                    </button>
                  </>
                )}
              </div>
            </div>
          </header>

          <div className="wrap" style={{ maxWidth: '920px', margin: '0 auto', padding: '0 24px' }}>
            <div className="yt-chip-row" style={{ padding: '18px 0' }}>
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

          <main style={{ maxWidth: '920px', margin: '0 auto', padding: '0 24px 60px' }}>
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
                        {user && isCompleted ? (
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

          {showCart && (
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
          )}

          {showStudentNotifs && (
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
          )}

          {renderAuthModal()}
        </div>
      );
    }

    // Sınav / Test Çözüm Ekranı
    if (!activeStudentExam) return null;

    const answeredCount = Object.keys(studentAnswers).length;
    const emptyCount = activeStudentExam.numPages - answeredCount;
    const results = showResults ? (studentResultsMap[activeStudentExamId] || calculateResults()) : null;
    const kazanimReport = showResults ? getKazanimReport() : null;
    const isDeneme = activeStudentExam.examType === 'deneme';
    const myActiveRating = studentResultsMap[activeStudentExamId]?.rating || 0;

    return (
      <div className="yt-shell" style={{ maxWidth: '1300px', margin: '0 auto', padding: '24px' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid var(--yt-ink)', paddingBottom: '14px', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
          <h1 style={{ margin: 0, fontSize: '1.3rem' }}>{activeStudentExam.name || 'İsimsiz İçerik'}</h1>
          <button onClick={() => setActiveStudentExamId(null)} className="yt-btn yt-btn-ghost">İçerik Listesine Dön</button>
        </header>

        {showResults && results ? (
          <div className="yt-session-card" style={{ maxWidth: '700px', margin: '0 auto 24px auto' }}>

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

            {kazanimReport && kazanimReport.hasData && (
              <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid var(--yt-line)' }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem' }}>Kazanım Analizi</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {Object.entries(kazanimReport.byDers).map(([ders, dersData]) => {
                    const dersGreenWidth = getBaremGreenWidth(dersData.correct, dersData.total);
                    const dersTextColor = getBaremTextColor(dersData.correct, dersData.total);
                    return (
                      <div key={ders} className="yt-kazanim-box">
                        <div className="head" style={{ display: 'grid', gridTemplateColumns: '1fr 150px', alignItems: 'center', gap: '12px' }}>
                          <span>{ders}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ flex: 1, height: '16px', border: '1.5px solid #111', borderRadius: '3px', overflow: 'hidden', backgroundColor: '#E24B4A' }}>
                              <div style={{ height: '100%', width: `${dersGreenWidth}%`, backgroundColor: '#639922' }}></div>
                            </div>
                            <span style={{ fontFamily: 'var(--yt-font-mono)', fontSize: '0.8rem', fontWeight: 'bold', width: '38px', textAlign: 'right', color: dersTextColor }}>
                              {dersData.correct}/{dersData.total}
                            </span>
                          </div>
                        </div>
                        <ul style={{ margin: '10px 0 0 0', paddingLeft: 0, listStyle: 'none' }}>
                          {Object.entries(dersData.kazanimlar).map(([kazanim, k]) => {
                            const kGreenWidth = getBaremGreenWidth(k.correct, k.total);
                            const kTextColor = getBaremTextColor(k.correct, k.total);
                            return (
                              <li key={kazanim} style={{ display: 'grid', gridTemplateColumns: '1fr 150px', alignItems: 'center', gap: '12px', padding: '5px 0' }}>
                                <span>{kazanim}</span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <div style={{ flex: 1, height: '13px', border: '1.5px solid #111', borderRadius: '3px', overflow: 'hidden', backgroundColor: '#E24B4A' }}>
                                    <div style={{ height: '100%', width: `${kGreenWidth}%`, backgroundColor: '#639922' }}></div>
                                  </div>
                                  <span style={{ fontFamily: 'var(--yt-font-mono)', fontSize: '0.74rem', fontWeight: 'bold', width: '38px', textAlign: 'right', color: kTextColor }}>
                                    {k.correct}/{k.total}
                                  </span>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
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
        `}</style>

        <div className="exam-layout">

          <div>
            <div className="yt-exam-shell" style={{ padding: '14px 20px', marginBottom: '12px' }}>
              <div className="yt-topbar" style={{ marginBottom: 0 }}>
                <span>
                  {(() => {
                    const secs = activeStudentExam.sections || [];
                    const sec = secs.find(s => studentCurrentPage >= s.start && studentCurrentPage <= s.end);
                    if (sec) {
                      return `${sec.name} · SORU ${studentCurrentPage - sec.start + 1} / ${sec.end - sec.start + 1}`;
                    }
                    return `SORU ${studentCurrentPage} / ${activeStudentExam.numPages}`;
                  })()}
                </span>
                {!showResults && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      onClick={() => setIsPaused(p => !p)}
                      style={{
                        padding: '5px 12px',
                        fontSize: '0.8rem',
                        fontWeight: 'bold',
                        borderRadius: '6px',
                        border: '1px solid rgba(251,249,243,0.45)',
                        backgroundColor: isPaused ? 'var(--yt-mustard)' : 'transparent',
                        color: isPaused ? '#1a1a2e' : '#FBF9F3',
                        cursor: 'pointer'
                      }}
                    >
                      {isPaused ? '▶ Devam Et' : '⏸ Mola Ver'}
                    </button>
                    <div className={`yt-timer${(!isPaused && timeLeft < 300) ? ' urgent' : ''}`} style={{ fontSize: '1.15rem', padding: '5px 12px', opacity: isPaused ? 0.6 : 1 }}>
                      {isPaused ? 'MOLADA' : formatTime(timeLeft)}
                    </div>
                  </div>
                )}
                <span>İŞARETLENEN: <b style={{ color: studentAnswers[studentCurrentPage] ? 'var(--yt-mustard)' : 'rgba(251,249,243,0.5)' }}>{studentAnswers[studentCurrentPage] || 'BOŞ'}</b></span>
              </div>
            </div>

            <SecurePdfViewer
              examId={activeStudentExamId}
              type="exam"
              pageNumber={studentCurrentPage}
            />

            {!isExamFinished && (
              isPaused ? (
                <div style={{ textAlign: 'center', margin: '20px 0', padding: '14px', borderRadius: '8px', backgroundColor: 'var(--yt-mustard-bg)', color: 'var(--yt-mustard-deep)', fontWeight: 'bold' }}>
                  Moladasın, cevap işaretleyemezsin. Devam etmek için "Devam Et"e bas.
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', margin: '20px 0' }}>
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

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px', gap: '10px' }}>
              <button disabled={studentCurrentPage <= 1} onClick={() => { setStudentCurrentPage(p => p - 1); setViewingSolutionQ(false); }} className="yt-btn yt-btn-outline" style={studentCurrentPage <= 1 ? { opacity: 0.4, cursor: 'not-allowed' } : {}}>◀ Önceki Soru</button>
              <button disabled={studentCurrentPage >= activeStudentExam.numPages} onClick={() => { setStudentCurrentPage(p => p + 1); setViewingSolutionQ(false); }} className="yt-btn yt-btn-primary" style={studentCurrentPage >= activeStudentExam.numPages ? { opacity: 0.4, cursor: 'not-allowed' } : {}}>Sonraki Soru ▶</button>
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
                {viewingSolutionQ ? '✕ Çözümü Gizle' : `${studentCurrentPage}. Çözümü Gör`}
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
              <span>{studentCurrentPage}. Soru Çözümü Aşağıda</span>
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
                {studentCurrentPage}. Soru İçin Bildirim
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
      </div>
    );
  }

  return null;
}
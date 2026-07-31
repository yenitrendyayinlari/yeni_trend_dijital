import { useState, useEffect } from 'react';
import PdfViewer from './PdfViewer';
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
  const [activeStudentExamId, setActiveStudentExamId] = useState(null);
  
  const [inspectingExamId, setInspectingExamId] = useState(null);

  const [studentCurrentPage, setStudentCurrentPage] = useState(1);
  const [studentAnswers, setStudentAnswers] = useState({});
  const [timeLeft, setTimeLeft] = useState(0); 
  const [isExamFinished, setIsExamFinished] = useState(false);
  const [showResults, setShowResults] = useState(false);
  
  const [viewingSolutionQ, setViewingSolutionQ] = useState(false);
  const [studentResultsMap, setStudentResultsMap] = useState({});
  const [studentPurchases, setStudentPurchases] = useState({}); 
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Tümü');

  const [examRatingsMap, setExamRatingsMap] = useState({});

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

    fetchAllRatings();

    return () => subscription.unsubscribe();
  }, []);

  const fetchAllRatings = async () => {
    const { data, error } = await supabase
      .from('student_exams')
      .select('exam_id, rating')
      .gt('rating', 0);

    if (!error && data) {
      const map = {};
      data.forEach(item => {
        if (!map[item.exam_id]) {
          map[item.exam_id] = { total: 0, count: 0 };
        }
        map[item.exam_id].total += item.rating;
        map[item.exam_id].count += 1;
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
    answerKey: item.answer_key || {},
    sections: item.sections || [],
    isPublished: item.is_published,
    numPages: item.num_pages || 0,
    price: item.price || 0,
    originalPrice: item.original_price || 0,
    isParent: item.is_parent || false,
    parentId: item.parent_id || null
  });

  const fetchPublicExams = async () => {
    const { data, error } = await supabase
      .from('exams')
      .select('*')
      .eq('is_published', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error("Sınavlar yüklenirken hata oluştu:", error);
    } else {
      setExams(data.map(formatExamData));
    }
  };

  const fetchExams = async (currentUser = user) => {
    const query = supabase.from('exams').select('*').order('created_at', { ascending: false });
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
            rating: res.rating || 0
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

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setAppMode('student');
    setActiveAdminExamId(null);
    setActiveStudentExamId(null);
    setInspectingExamId(null);
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
    if (updates.answerKey !== undefined) dbUpdates.answer_key = updates.answerKey;
    if (updates.sections !== undefined) dbUpdates.sections = updates.sections;
    if (updates.isPublished !== undefined) dbUpdates.is_published = updates.isPublished;
    if (updates.numPages !== undefined) dbUpdates.num_pages = updates.numPages;
    if (updates.price !== undefined) dbUpdates.price = updates.price;
    if (updates.originalPrice !== undefined) dbUpdates.original_price = updates.originalPrice;

    const { error } = await supabase
      .from('exams')
      .update(dbUpdates)
      .eq('id', id);

    if (error) {
      console.error("Güncelleme hatası:", error);
    }
  };

  const activeStudentExam = exams.find(e => e.id === activeStudentExamId);
  
  useEffect(() => {
    if (user && appMode === 'student' && activeStudentExam && !isExamFinished && !showResults) {
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
  }, [user, appMode, activeStudentExam, isExamFinished, showResults, studentAnswers]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleCreateExam = async () => {
    setAuthLoading(true);
    const newExamData = {
      name: "Yeni Sınav / Paket",
      duration: 130,
      exam_type: 'deneme',
      category_exam_type: 'KPSS',
      category_lesson: 'Genel Yetenek - Genel Kültür',
      is_published: false,
      price: 0,
      original_price: 0,
      is_parent: true,
      sections: []
    };

    const { data, error } = await supabase.from('exams').insert([newExamData]).select();
    setAuthLoading(false);

    if (error) {
      alert("Sınav oluşturulamadı: " + error.message);
    } else if (data && data.length > 0) {
      const formatted = formatExamData(data[0]);
      setExams(prev => [formatted, ...prev]);
      setActiveAdminExamId(formatted.id);
    }
  };

  const handleChildFileUpload = (e, parentId) => {
    const file = e.target.files[0];
    if (!file) return;

    const uploadChild = async () => {
      setAuthLoading(true);
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random().toString(36).substring(2)}_${Date.now()}.${fileExt}`;

      const { error: storageError } = await supabase.storage.from('exam-files').upload(fileName, file);

      if (storageError) {
        alert("Dosya yüklenemedi: " + storageError.message);
        setAuthLoading(false);
        return;
      }

      const { data: publicURLData } = supabase.storage.from('exam-files').getPublicUrl(fileName);

      const newChildData = {
        name: file.name.replace('.pdf', ''),
        duration: 40, 
        exam_type: 'deneme',
        pdf_file: publicURLData.publicUrl,
        is_published: true,
        is_parent: false,
        parent_id: parentId
      };

      const { data, error } = await supabase.from('exams').insert([newChildData]).select();
      setAuthLoading(false);

      if (error) {
        alert("Oturum kaydedilemedi: " + error.message);
      } else if (data && data.length > 0) {
        setExams(prev => [...prev, formatExamData(data[0])]);
      }
    };
    uploadChild();
  };

  const handleSolutionUpload = (e) => {
    const file = e.target.files[0];
    if (file && activeAdminExamId) {
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

        const { data: publicURLData } = supabase.storage
          .from('exam-files')
          .getPublicUrl(fileName);

        setAuthLoading(false);
        await updateExamInDb(activeAdminExamId, { solutionPdfFile: publicURLData.publicUrl });
      };
      uploadSolutionFile();
    }
  };

  const handleFastKeyEntry = (text) => {
    const exam = exams.find(e => e.id === activeAdminExamId);
    if (!exam) return;
    const sanitizedText = text.toUpperCase().replace(/[^ABCDE]/g, '');
    const newKey = {};
    for (let i = 0; i < sanitizedText.length; i++) {
      if (i < (exam.numPages || 120)) {
        newKey[i + 1] = sanitizedText[i];
      }
    }
    updateExamInDb(activeAdminExamId, { answerKey: newKey });
  };

  const togglePublish = async (examId) => {
    const exam = exams.find(e => e.id === examId);
    if (exam) {
      if (!exam.isPublished && Object.keys(exam.answerKey).length === 0 && exam.pdfFile) {
         if(!window.confirm("Hiç cevap anahtarı girmediniz! Yine de yayınlamak istiyor musunuz?")) return;
      }
      await updateExamInDb(examId, { isPublished: !exam.isPublished });
    }
  };

  const deleteExam = async (examId) => {
    if (window.confirm("Bu içeriği silmek istediğinize emin misiniz?")) {
      const { error } = await supabase.from('exams').delete().eq('id', examId);
      if (error) {
        console.error("Silme hatası:", error);
      } else {
        setExams(exams.filter(e => e.id !== examId && e.parentId !== examId));
        if (activeAdminExamId === examId) setActiveAdminExamId(null);
      }
    }
  };

  const startExam = (exam) => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }

    const isFree = !exam.price || exam.price <= 0;
    const isPurchased = studentPurchases[exam.id];

    if (!isFree && !isPurchased) {
      handleIyzicoPayment(exam);
      return;
    }

    setActiveStudentExamId(exam.id);
    setInspectingExamId(null);
    setStudentAnswers({});
    setStudentCurrentPage(1);
    setIsExamFinished(false);
    setShowResults(false);
    setViewingSolutionQ(false);
    setTimeLeft(exam.examType === 'deneme' ? exam.duration * 60 : 0);
  };

  const handleIyzicoPayment = (exam) => {
    const confirmed = window.confirm(`"${exam.name}" isimli sınav ücretli (₺${exam.price}). İyzico ödeme formu açılacaktır. Onaylıyor musunuz?`);
    if (!confirmed) return;

    const paymentData = {
      price: exam.price.toString()
    };

    initializePayment(paymentData, (err, result) => {
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

  const handleAnswerSelect = (option) => {
    if (isExamFinished) return;
    setStudentAnswers((prev) => {
      if (prev[studentCurrentPage] === option) {
        const updated = { ...prev };
        delete updated[studentCurrentPage];
        return updated;
      }
      return { ...prev, [studentCurrentPage]: option };
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

  const saveAndFinishExam = async (ratingVal = 0) => {
    const results = calculateResults();
    setIsExamFinished(true);
    setShowResults(true);

    const existingRes = studentResultsMap[activeStudentExamId] || {};
    const finalRating = ratingVal > 0 ? ratingVal : (existingRes.rating || 0);

    const { error } = await supabase
      .from('student_exams')
      .upsert([
        {
          student_email: user.email,
          exam_id: activeStudentExamId,
          answers: studentAnswers,
          correct_count: results.correct,
          wrong_count: results.wrong,
          empty_count: results.empty,
          net: results.net,
          is_finished: true,
          rating: finalRating
        }
      ], { onConflict: 'student_email, exam_id' });

    if (error) {
      console.error("Sonuç kaydedilemedi:", error);
    } else {
      setStudentResultsMap(prev => ({
        ...prev,
        [activeStudentExamId]: { is_finished: true, ...results, answers: studentAnswers, rating: finalRating }
      }));
      fetchAllRatings();
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

  // ==========================================
  // RENDER: YÖNETİCİ EKRANI
  // ==========================================
  if (user && appMode === 'admin') {
    const adminActiveExam = exams.find(e => e.id === activeAdminExamId);

    return (
      <div style={{ fontFamily: "'Roboto', 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif", letterSpacing: '-0.01em', maxWidth: '1200px', margin: '0 auto', padding: '20px', color: '#1e293b' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #e2e8f0', paddingBottom: '12px', marginBottom: '20px' }}>
          <h1 style={{ margin: 0, fontSize: '1.4rem', color: '#0f172a' }}>⚙️ Yönetici Paneli ({user.email})</h1>
          <button onClick={handleLogout} style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', cursor: 'pointer', color: '#dc2626', fontWeight: 'bold' }}>Çıkış Yap</button>
        </header>

        {authLoading && (
          <div style={{ textAlign: 'center', padding: '10px', backgroundColor: '#eff6ff', color: '#1e40af', marginBottom: '16px', borderRadius: '6px', fontWeight: 'bold' }}>
            ⏳ Dosya depolama alanına yükleniyor, lütfen bekleyin...
          </div>
        )}

        {!adminActiveExam ? (
          <div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0 }}>Tüm Sınavlar ve Paketler</h2>
              <button onClick={handleCreateExam} style={{ padding: '10px 20px', backgroundColor: '#2563eb', color: '#fff', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', border: 'none' }}>
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
                  <div key={parentExam.id} style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', backgroundColor: '#f8fafc' }}>
                      <div>
                        <h3 style={{ margin: '0 0 8px 0', color: '#0f172a' }}>
                          📦 {parentExam.name}
                        </h3>
                        <div style={{ display: 'flex', gap: '12px', fontSize: '0.85rem', color: '#64748b' }}>
                          <span style={{ color: parentExam.isPublished ? '#16a34a' : '#ef4444', fontWeight: 'bold' }}>
                            {parentExam.isPublished ? '● Yayında' : '○ Taslak'}
                          </span>
                          <span>₺{parentExam.price || 0}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <label style={{ padding: '8px 12px', borderRadius: '6px', backgroundColor: '#e0e7ff', color: '#4338ca', cursor: 'pointer', fontWeight: 'bold', border: '1px dashed #4338ca' }}>
                          + Oturum Ekle (PDF)
                          <input type="file" accept="application/pdf" onChange={(e) => handleChildFileUpload(e, parentExam.id)} style={{ display: 'none' }} />
                        </label>
                        <button onClick={() => togglePublish(parentExam.id)} style={{ padding: '8px 12px', borderRadius: '6px', border: 'none', backgroundColor: parentExam.isPublished ? '#f59e0b' : '#16a34a', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }}>
                          {parentExam.isPublished ? 'Yayından Kaldır' : 'Yayınla'}
                        </button>
                        <button onClick={() => setActiveAdminExamId(parentExam.id)} style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#f1f5f9', cursor: 'pointer' }}>Ayarlar</button>
                        <button onClick={() => deleteExam(parentExam.id)} style={{ padding: '8px 12px', borderRadius: '6px', border: 'none', backgroundColor: '#ef4444', color: '#fff', cursor: 'pointer' }}>Sil</button>
                      </div>
                    </div>

                    <div style={{ padding: '0 16px 16px 16px', backgroundColor: '#ffffff' }}>
                      {exams.filter(child => child.parentId === parentExam.id).length > 0 ? (
                         <div style={{ display: 'grid', gap: '8px', marginTop: '10px' }}>
                           {exams.filter(child => child.parentId === parentExam.id).map(childExam => (
                             <div key={childExam.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', backgroundColor: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0', marginLeft: '20px' }}>
                               <div style={{ fontWeight: '500' }}>↳ Oturum: {childExam.name} <span style={{ fontSize: '0.8rem', color: '#64748b' }}>({childExam.numPages || '?'} Soru, {childExam.duration} Dk)</span></div>
                               <div style={{ display: 'flex', gap: '8px' }}>
                                 <button onClick={() => setActiveAdminExamId(childExam.id)} style={{ padding: '4px 10px', fontSize: '0.85rem', borderRadius: '4px', border: '1px solid #cbd5e1', cursor: 'pointer' }}>Düzenle (Cevap Anh. / Süre)</button>
                                 <button onClick={() => deleteExam(childExam.id)} style={{ padding: '4px 10px', fontSize: '0.85rem', borderRadius: '4px', border: 'none', backgroundColor: '#ef4444', color: '#fff', cursor: 'pointer' }}>Sil</button>
                               </div>
                             </div>
                           ))}
                         </div>
                      ) : (
                        <div style={{ fontSize: '0.85rem', color: '#64748b', marginLeft: '20px', fontStyle: 'italic', padding: '10px 0' }}>Tek PDF üzerinden yapılandırılmış sınav / test içeriği.</div>
                      )}
                    </div>

                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: adminActiveExam.pdfFile ? '1fr 380px' : '1fr', gap: '24px', alignItems: 'start' }}>
            {adminActiveExam.pdfFile && (
              <div style={{ backgroundColor: '#f1f5f9', padding: '16px', borderRadius: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <button onClick={() => setActiveAdminExamId(null)} style={{ padding: '6px 12px', borderRadius: '4px', border: '1px solid #cbd5e1', cursor: 'pointer' }}>◀ Listeye Dön</button>
                  <strong>Toplam Soru Sayısı/Sayfa: {adminActiveExam.numPages || 'Yükleniyor...'}</strong>
                </div>
                <PdfViewer 
                  file={adminActiveExam.pdfFile} 
                  pageNumber={1} 
                  onDocumentLoadSuccess={({ numPages }) => {
                    if (adminActiveExam.numPages !== numPages) {
                      updateExamInDb(adminActiveExam.id, { numPages });
                    }
                  }} 
                />
              </div>
            )}

            <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', position: 'sticky', top: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
                <h3 style={{ margin: 0 }}>İçerik Ayarları</h3>
                {!adminActiveExam.pdfFile && (
                  <button onClick={() => setActiveAdminExamId(null)} style={{ padding: '4px 10px', borderRadius: '4px', border: '1px solid #cbd5e1', cursor: 'pointer' }}>◀ Listeye Dön</button>
                )}
              </div>
              
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '4px' }}>Sınav / Oturum Adı:</label>
                <input type="text" value={adminActiveExam.name} onChange={(e) => updateExamInDb(adminActiveExam.id, { name: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '4px' }}>Güncel Fiyat (₺):</label>
                  <input 
                    type="number" 
                    min="0"
                    step="0.01"
                    value={adminActiveExam.price || 0} 
                    onChange={(e) => updateExamInDb(adminActiveExam.id, { price: Number(e.target.value) })} 
                    style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }} 
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '4px' }}>Eski Fiyat (Üstü Çizili):</label>
                  <input 
                    type="number" 
                    min="0"
                    step="0.01"
                    placeholder="İsteğe bağlı"
                    value={adminActiveExam.originalPrice || 0} 
                    onChange={(e) => updateExamInDb(adminActiveExam.id, { originalPrice: Number(e.target.value) })} 
                    style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }} 
                  />
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '4px' }}>Sınav Türü (Kategori):</label>
                <input 
                  type="text" 
                  placeholder="Örn: KPSS, LGS, YKS"
                  value={adminActiveExam.categoryExamType || ''} 
                  onChange={(e) => updateExamInDb(adminActiveExam.id, { categoryExamType: e.target.value })} 
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }} 
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '4px' }}>Ders Türü (Kategori):</label>
                <input 
                  type="text" 
                  placeholder="Örn: Genel Yetenek - Genel Kültür"
                  value={adminActiveExam.categoryLesson || ''} 
                  onChange={(e) => updateExamInDb(adminActiveExam.id, { categoryLesson: e.target.value })} 
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }} 
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '4px' }}>İçerik Formatı:</label>
                <select 
                  value={adminActiveExam.examType || 'deneme'} 
                  onChange={(e) => updateExamInDb(adminActiveExam.id, { examType: e.target.value })}
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#fff' }}
                >
                  <option value="deneme">Deneme Sınavı (Süreli Geri Sayım)</option>
                  <option value="test">Test</option>
                </select>
              </div>

              {adminActiveExam.examType === 'deneme' && (
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '4px' }}>Süre (Dakika):</label>
                  <input type="number" value={adminActiveExam.duration} onChange={(e) => updateExamInDb(adminActiveExam.id, { duration: Number(e.target.value) })} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
                </div>
              )}

              {adminActiveExam.pdfFile && (
                <>
                  <div style={{ marginBottom: '20px', padding: '12px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '6px', color: '#0f172a' }}>💡 Açıklamalı Çözüm PDF'i:</label>
                    <input type="file" accept="application/pdf" onChange={handleSolutionUpload} style={{ fontSize: '0.85rem', width: '100%' }} />
                    {adminActiveExam.solutionPdfFile && (
                      <div style={{ fontSize: '0.8rem', color: '#16a34a', marginTop: '6px', fontWeight: 'bold' }}>
                        ✓ Çözüm PDF başarıyla eklendi.
                      </div>
                    )}
                  </div>

                  <h3 style={{ margin: '0 0 16px 0', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>Hızlı Cevap Anahtarı</h3>
                  <div style={{ marginBottom: '20px' }}>
                    <textarea 
                      placeholder="Örn: ABCDECAD..."
                      value={
                        Array.from(
                          { length: adminActiveExam.numPages || 120 }, 
                          function (_, i) {
                            return adminActiveExam.answerKey && adminActiveExam.answerKey[i + 1] ? adminActiveExam.answerKey[i + 1] : '';
                          }
                        ).join('').toUpperCase()
                      }
                      onChange={(e) => handleFastKeyEntry(e.target.value)}
                      style={{ 
                        width: '100%', 
                        height: '100px', 
                        padding: '10px', 
                        borderRadius: '6px', 
                        border: '1px solid #cbd5e1',
                        fontSize: '1rem',
                        letterSpacing: '3px',
                        fontFamily: 'monospace',
                        textTransform: 'uppercase',
                        resize: 'none'
                      }} 
                    />
                    <div style={{ fontSize: '0.85rem', color: '#16a34a', fontWeight: 'bold', marginTop: '8px', textAlign: 'right' }}>
                      Girilen: {Object.keys(adminActiveExam.answerKey || {}).length} / {adminActiveExam.numPages || 0}
                    </div>
                  </div>
                </>
              )}

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
    
    if (inspectingExamId) {
      const inspectExam = exams.find(e => e.id === inspectingExamId);
      const childExams = exams.filter(e => e.parentId === inspectingExamId);
      const ratingInfo = examRatingsMap[inspectExam.id] || { average: '0,0', count: '0' };
      const isPaid = inspectExam.price && inspectExam.price > 0;
      const isPurchased = studentPurchases[inspectExam.id];
      const resData = studentResultsMap[inspectExam.id];
      const isCompleted = resData?.is_finished;

      return (
        <div style={{ fontFamily: "'Roboto', 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif", letterSpacing: '-0.01em', minHeight: '100vh', backgroundColor: '#f8fafc', color: '#1e293b' }}>
          <header style={{ backgroundColor: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '15px' }}>
            <button onClick={() => setInspectingExamId(null)} style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', cursor: 'pointer', fontWeight: '600' }}>
              ◀ Tüm Listeye Dön
            </button>
            <div style={{ fontSize: '1.2rem', fontWeight: '800', color: '#0f172a' }}>İçerik Detayları</div>
            <div style={{ width: '100px' }}></div>
          </header>

          <main style={{ maxWidth: '900px', margin: '40px auto', padding: '0 20px' }}>
            <div style={{ backgroundColor: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '32px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)' }}>
              
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
                <span style={{ backgroundColor: '#f1f5f9', color: '#334155', padding: '4px 10px', borderRadius: '6px', fontSize: '0.8rem', fontWeight: '600' }}>
                  🎯 {inspectExam.categoryExamType} / {inspectExam.categoryLesson}
                </span>
              </div>

              <h1 style={{ margin: '0 0 12px 0', fontSize: '1.8rem', color: '#0f172a', fontWeight: '800' }}>
                {inspectExam.name}
              </h1>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
                <span style={{ fontWeight: 'bold', color: '#0f172a', fontSize: '1rem' }}>{ratingInfo.average}</span>
                <div style={{ display: 'flex', gap: '2px' }}>
                  {[1, 2, 3, 4, 5].map((star) => {
                    const activeStar = Number(ratingInfo.average.replace(',', '.')) >= star;
                    return (
                      <span key={star} style={{ color: activeStar ? '#eab308' : '#cbd5e1', fontSize: '1.1rem' }}>★</span>
                    );
                  })}
                </div>
                <span style={{ color: '#64748b', fontSize: '0.85rem' }}>({ratingInfo.count} değerlendirme)</span>
              </div>

              <div style={{ backgroundColor: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '24px' }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '1.05rem', color: '#0f172a' }}>📚 Sınav Bilgileri ve Bölümler</h3>
                
                {inspectExam.sections && inspectExam.sections.length > 0 ? (
                  <div style={{ display: 'grid', gap: '10px' }}>
                    {inspectExam.sections.map((sec, index) => (
                      <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                        <div>
                          <strong style={{ color: '#1e293b' }}>{sec.name}</strong>
                        </div>
                        <div style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: '600' }}>
                          <span>Soru Aralığı: {sec.start} - {sec.end}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : childExams.length > 0 ? (
                  <div style={{ display: 'grid', gap: '10px' }}>
                    {childExams.map((child, index) => (
                      <div key={child.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                        <div>
                          <strong style={{ color: '#1e293b' }}>{index + 1}. Oturum: {child.name}</strong>
                        </div>
                        <div style={{ display: 'flex', gap: '16px', fontSize: '0.85rem', color: '#64748b', fontWeight: '600' }}>
                          <span>⏱️ {child.duration} Dk</span>
                          <span>📝 {child.numPages || '?'} Soru</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.9rem', color: '#64748b' }}>
                    <span>⏱️ Süre: {inspectExam.duration} Dakika</span> &nbsp;|&nbsp; <span>📝 Soru Sayısı: {inspectExam.numPages}</span>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #e2e8f0', paddingTop: '20px', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                  <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '4px' }}>Sınav Fiyatı</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                    {isPaid ? (
                      <>
                        <span style={{ fontSize: '1.8rem', fontWeight: '900', color: '#0f172a' }}>
                          ₺{inspectExam.price.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        {inspectExam.originalPrice && inspectExam.originalPrice > inspectExam.price ? (
                          <span style={{ fontSize: '1.1rem', fontWeight: '500', color: '#94a3b8', textDecoration: 'line-through' }}>
                            ₺{inspectExam.originalPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span style={{ fontSize: '1.5rem', fontWeight: '800', color: '#16a34a' }}>
                        Ücretsiz
                      </span>
                    )}
                  </div>
                </div>

                <button 
                  onClick={() => {
                    if (!user) {
                      setShowAuthModal(true);
                      return;
                    }
                    if (isCompleted) {
                      setActiveStudentExamId(inspectExam.id);
                      setInspectingExamId(null);
                      setStudentAnswers(resData.answers || {});
                      setStudentCurrentPage(1);
                      setIsExamFinished(true);
                      setShowResults(true);
                      setViewingSolutionQ(false);
                    } else {
                      startExam(inspectExam);
                    }
                  }} 
                  style={{ 
                    padding: '14px 32px', 
                    borderRadius: '12px', 
                    border: 'none', 
                    backgroundColor: isCompleted ? '#475569' : (isPaid && !isPurchased ? '#d97706' : '#2563eb'), 
                    color: '#fff', 
                    fontWeight: '700', 
                    fontSize: '1rem', 
                    cursor: 'pointer',
                    boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.2)'
                  }}
                >
                  {!user ? 'Üye Ol ve İncele ▶' : (isCompleted ? 'Sonuçları İncele 📊' : (isPaid && !isPurchased ? `Hemen Satın Al (₺${inspectExam.price}) 💳` : 'Sınava Başla ▶'))}
                </button>
              </div>

            </div>
          </main>
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
        if (searchQuery && !e.name.toLowerCase().includes(searchQuery.toLowerCase())) {
          return false;
        }
        return true;
      });

      const uniqueExamTypes = Array.from(
        new Set(
          exams
            .filter(e => e.isPublished && e.categoryExamType)
            .map(e => e.categoryExamType.trim())
        )
      );
      
      const allCategories = ['Tümü', ...uniqueExamTypes];

      return (
        <div style={{ fontFamily: "'Roboto', 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif", letterSpacing: '-0.01em', minHeight: '100vh', backgroundColor: '#f8fafc', color: '#1e293b' }}>
          
          <header style={{ backgroundColor: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '15px', boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.05)', flexWrap: 'wrap' }}>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flexShrink: 0 }}>
              <div style={{ fontSize: '1.3rem', fontWeight: '900', letterSpacing: '-0.05em', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ backgroundColor: '#2563eb', color: '#fff', padding: '4px 8px', borderRadius: '6px', fontSize: '0.9rem' }}>YT</span>
                YENİTREND
              </div>
            </div>

            <div style={{ flex: '1 1 300px', maxWidth: '450px', position: 'relative', minWidth: '200px' }}>
              <span style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }}>🔍</span>
              <input 
                type="text" 
                placeholder="Ne öğrenmek veya çözmek istiyorsunuz?" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ width: '100%', padding: '10px 16px 10px 42px', borderRadius: '9999px', border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', outline: 'none', fontSize: '0.9rem', boxSizing: 'border-box' }} 
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
              {user ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#f1f5f9', padding: '6px 12px', borderRadius: '20px', border: '1px solid #e2e8f0' }}>
                    <span style={{ width: '8px', height: '8px', backgroundColor: '#22c55e', borderRadius: '50%' }}></span>
                    <span style={{ fontSize: '0.85rem', fontWeight: '500', color: '#334155' }}>{user.email}</span>
                  </div>
                  <button onClick={handleLogout} style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #fecaca', backgroundColor: '#fef2f2', cursor: 'pointer', color: '#dc2626', fontWeight: '600', fontSize: '0.85rem' }}>
                    Çıkış Yap
                  </button>
                </>
              ) : (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => { setAuthMode('login'); setShowAuthModal(true); }} style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #2563eb', backgroundColor: '#ffffff', color: '#2563eb', cursor: 'pointer', fontWeight: '600', fontSize: '0.85rem' }}>
                    Giriş Yap
                  </button>
                  <button onClick={() => { setAuthMode('register'); setShowAuthModal(true); }} style={{ padding: '8px 14px', borderRadius: '8px', border: 'none', backgroundColor: '#2563eb', color: '#ffffff', cursor: 'pointer', fontWeight: '600', fontSize: '0.85rem' }}>
                    Kayıt Ol
                  </button>
                </div>
              )}
            </div>
          </header>

          <div style={{ backgroundColor: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '0 32px', overflowX: 'auto', display: 'flex', gap: '24px' }}>
            {allCategories.map(cat => (
              <button 
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  padding: '14px 4px', 
                  fontSize: '0.9rem', 
                  fontWeight: selectedCategory === cat ? '700' : '500', 
                  color: selectedCategory === cat ? '#2563eb' : '#64748b', 
                  borderBottom: selectedCategory === cat ? '2px solid #2563eb' : '2px solid transparent',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'color 0.2s'
                }}
              >
                {cat}
              </button>
            ))}
          </div>

          <main style={{ maxWidth: '1000px', margin: '40px auto', padding: '0 20px' }}>
            {publishedExams.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', backgroundColor: '#ffffff', borderRadius: '16px', border: '1px dashed #cbd5e1', boxShadow: '0 1px 3px 0 rgba(0,0,0,0.02)' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>📂</div>
                <h3 style={{ margin: '0 0 6px 0', color: '#334155', fontSize: '1.1rem' }}>Aktif İçerik Bulunmuyor</h3>
                <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>Seçilen kriterlere uygun aktif bir sınav veya paket bulunmamaktadır.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '16px' }}>
                {publishedExams.map(exam => {
                  const resData = studentResultsMap[exam.id];
                  const isCompleted = resData?.is_finished;
                  const isDeneme = exam.examType === 'deneme';
                  const ratingInfo = examRatingsMap[exam.id] || { average: '0,0', count: '0' };
                  const isPaid = exam.price && exam.price > 0;

                  return (
                    <div 
                      key={exam.id} 
                      onClick={() => setInspectingExamId(exam.id)}
                      style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center', 
                        padding: '24px', 
                        backgroundColor: '#ffffff', 
                        borderRadius: '16px', 
                        border: isCompleted ? '1px solid #bbf7d0' : '1px solid #e2e8f0', 
                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.02), 0 2px 4px -1px rgba(0, 0, 0, 0.02)',
                        position: 'relative',
                        overflow: 'hidden',
                        cursor: 'pointer',
                        transition: 'transform 0.1s, box-shadow 0.1s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.05)'}
                      onMouseLeave={(e) => e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.02)'}
                    >
                      <div style={{ 
                        position: 'absolute', 
                        left: 0, 
                        top: 0, 
                        bottom: 0, 
                        width: '6px', 
                        backgroundColor: isCompleted ? '#22c55e' : '#2563eb' 
                      }}></div>

                      <div style={{ paddingLeft: '8px', flex: 1, paddingRight: '16px' }}>
                        
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
                          <span style={{ backgroundColor: '#f1f5f9', color: '#334155', padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '600' }}>
                            🎯 {exam.categoryExamType} / {exam.categoryLesson}
                          </span>
                          <span style={{ backgroundColor: isDeneme ? '#eff6ff' : '#f5f3ff', color: isDeneme ? '#1d4ed8' : '#7c3aed', padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '600' }}>
                            {isDeneme ? 'Deneme Sınavı' : 'Test'}
                          </span>

                          {user && isCompleted ? (
                            <span style={{ backgroundColor: '#f0fdf4', color: '#15803d', padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '600' }}>
                              ✓ Çözüldü (Net: {resData.net})
                            </span>
                          ) : null}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '12px' }}>
                          <h3 style={{ margin: 0, color: '#0f172a', fontSize: '1.2rem', fontWeight: '700', letterSpacing: '-0.025em' }}>{exam.name}</h3>
                          
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#f8fafc', padding: '4px 10px', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                            <span style={{ fontWeight: 'bold', color: '#0f172a', fontSize: '0.9rem' }}>{ratingInfo.average}</span>
                            <div style={{ display: 'flex', gap: '1px' }}>
                              {[1, 2, 3, 4, 5].map((star) => {
                                const activeStar = Number(ratingInfo.average.replace(',', '.')) >= star;
                                return (
                                  <span key={star} style={{ color: activeStar ? '#eab308' : '#cbd5e1', fontSize: '0.9rem' }}>★</span>
                                );
                              })}
                            </div>
                            <span style={{ color: '#64748b', fontSize: '0.8rem' }}>({ratingInfo.count})</span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '20px', fontSize: '0.85rem', color: '#64748b', fontWeight: '500', marginBottom: '12px', alignItems: 'center' }}>
                          {isDeneme && <span>⏱ Süre: {exam.duration} Dakika</span>}
                          <span>📝 Toplam Soru: {exam.numPages || 0}</span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                          {isPaid ? (
                            <>
                              <span style={{ fontSize: '1.25rem', fontWeight: '800', color: '#0f172a' }}>
                                ₺{exam.price.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                              {exam.originalPrice && exam.originalPrice > exam.price ? (
                                <span style={{ fontSize: '0.95rem', fontWeight: '500', color: '#94a3b8', textDecoration: 'line-through' }}>
                                  ₺{exam.originalPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <span style={{ fontSize: '1.1rem', fontWeight: '700', color: '#16a34a' }}>
                              Ücretsiz
                            </span>
                          )}
                        </div>

                      </div>

                      <div>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setInspectingExamId(exam.id);
                          }} 
                          style={{ 
                            padding: '12px 24px', 
                            borderRadius: '10px', 
                            border: 'none', 
                            backgroundColor: '#2563eb', 
                            color: '#fff', 
                            fontWeight: '600', 
                            fontSize: '0.9rem', 
                            cursor: 'pointer',
                            boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.2)'
                          }}
                        >
                          İçeriği İncele ▶
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </main>

          {showAuthModal && (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
              <div style={{ fontFamily: "'Roboto', 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif", letterSpacing: '-0.01em', width: '100%', maxWidth: '400px', backgroundColor: '#ffffff', borderRadius: '12px', border: '1px solid #cbd5e1', padding: '30px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', color: '#1e293b', position: 'relative' }}>
                <button onClick={() => setShowAuthModal(false)} style={{ position: 'absolute', top: '15px', right: '15px', background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#64748b' }}>✕</button>

                <h2 style={{ textAlign: 'center', color: '#0f172a', marginBottom: '24px' }}>
                  {authMode === 'login' && '🔑 Kullanıcı Girişi'}
                  {authMode === 'register' && '📝 Yeni Hesap Oluştur'}
                  {authMode === 'forgot' && '🔒 Şifremi Unuttum'}
                </h2>

                <form onSubmit={handleAuth}>
                  <div style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '6px' }}>E-posta Adresi:</label>
                    <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ornek@mail.com" style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
                  </div>

                  {authMode !== 'forgot' && (
                    <div style={{ marginBottom: '20px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <label style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>Şifre:</label>
                        {authMode === 'login' && (
                          <button type="button" onClick={() => setAuthMode('forgot')} style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: '0.75rem', cursor: 'pointer', padding: 0 }}>Şifremi Unuttum?</button>
                        )}
                      </div>
                      <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
                    </div>
                  )}

                  <button type="submit" disabled={authLoading} style={{ width: '100%', padding: '12px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', fontSize: '1rem', cursor: 'pointer', marginBottom: '16px' }}>
                    {authLoading ? 'İşleniyor...' : (authMode === 'login' ? 'Giriş Yap' : authMode === 'register' ? 'Kayıt Ol' : 'Sıfırlama Bağlantısı Gönder')}
                  </button>
                </form>

                <div style={{ textAlign: 'center', fontSize: '0.85rem' }}>
                  {authMode === 'login' && (
                    <span>Hesabınız yok mu? <button onClick={() => setAuthMode('register')} style={{ background: 'none', border: 'none', color: '#2563eb', fontWeight: 'bold', cursor: 'pointer', padding: 0 }}>Kayıt Olun</button></span>
                  )}
                  {authMode === 'register' && (
                    <span>Zaten hesabınız var mı? <button onClick={() => setAuthMode('login')} style={{ background: 'none', border: 'none', color: '#2563eb', fontWeight: 'bold', cursor: 'pointer', padding: 0 }}>Giriş Yapın</button></span>
                  )}
                  {authMode === 'forgot' && (
                    <span><button onClick={() => setAuthMode('login')} style={{ background: 'none', border: 'none', color: '#2563eb', fontWeight: 'bold', cursor: 'pointer', padding: 0 }}>◀ Giriş Ekranına Dön</button></span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    // Sınav / Test Çözüm Ekranı
    const answeredCount = Object.keys(studentAnswers).length;
    const emptyCount = activeStudentExam.numPages - answeredCount;
    const results = showResults ? (studentResultsMap[activeStudentExamId] || calculateResults()) : null;
    const isDeneme = activeStudentExam.examType === 'deneme';
    const myActiveRating = studentResultsMap[activeStudentExamId]?.rating || 0;

    return (
      <div style={{ fontFamily: "'Roboto', 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif", letterSpacing: '-0.01em', maxWidth: '1400px', margin: '0 auto', padding: '20px', color: '#1e293b' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #e2e8f0', paddingBottom: '12px', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
          <h1 style={{ margin: 0, fontSize: '1.4rem', color: '#0f172a' }}>{activeStudentExam.name}</h1>
          <button onClick={() => setActiveStudentExamId(null)} style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', cursor: 'pointer' }}>İçerik Listesine Dön</button>
        </header>

        {showResults ? (
          <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px', maxWidth: '700px', margin: '0 auto 24px auto', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
            
            {user && (
              <div style={{ marginBottom: '20px', padding: '16px', backgroundColor: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                <div style={{ fontSize: '0.95rem', fontWeight: 'bold', color: '#0f172a', marginBottom: '8px' }}>Bu içeriği nasıl buldunuz? Puanlayın:</div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '6px' }}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <span
                      key={star}
                      onClick={() => handleRateExamInActiveScreen(star)}
                      style={{
                        cursor: 'pointer',
                        fontSize: '2.4rem',
                        color: myActiveRating >= star ? '#eab308' : '#cbd5e1',
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
                  <div style={{ fontSize: '0.85rem', color: '#16a34a', fontWeight: '600', marginTop: '8px' }}>
                    ✓ Puanınız kaydedildi ({myActiveRating} Yıldız)
                  </div>
                )}
              </div>
            )}

            <h2 style={{ textAlign: 'center', marginTop: 0, color: '#0f172a' }}>🎉 Sonuçlar</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
              <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', padding: '12px', borderRadius: '8px', textAlign: 'center' }}><span style={{ fontSize: '0.75rem', color: '#166534', fontWeight: 'bold' }}>DOĞRU</span><div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#15803d' }}>{results.correct}</div></div>
              <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', padding: '12px', borderRadius: '8px', textAlign: 'center' }}><span style={{ fontSize: '0.75rem', color: '#991b1b', fontWeight: 'bold' }}>YANLIŞ</span><div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#dc2626' }}>{results.wrong}</div></div>
              <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', padding: '12px', borderRadius: '8px', textAlign: 'center' }}><span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 'bold' }}>BOŞ</span><div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#64748b' }}>{results.empty}</div></div>
              <div style={{ backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', padding: '12px', borderRadius: '8px', textAlign: 'center' }}><span style={{ fontSize: '0.75rem', color: '#1e40af', fontWeight: 'bold' }}>NET</span><div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#2563eb' }}>{results.net}</div></div>
            </div>
          </div>
        ) : null}

        <style>{`
          .exam-layout {
            display: grid;
            grid-template-columns: 1fr 420px;
            gap: 20px;
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f1f5f9', padding: '12px 20px', borderRadius: '8px', fontWeight: '600', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
              <span>Soru {studentCurrentPage} / {activeStudentExam.numPages}</span>
              {!showResults && (
                <div style={{ backgroundColor: '#ffffff', color: '#0f172a', padding: '6px 14px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '1rem' }}>
                  {isDeneme ? `⏱️ Kalan Süre: ` : `⏳ Kronometre: `}
                  <strong>{formatTime(timeLeft)}</strong>
                </div>
              )}
              <span>İşaretlenen: <strong style={{ color: studentAnswers[studentCurrentPage] ? '#16a34a' : '#2563eb' }}>{studentAnswers[studentCurrentPage] || 'Boş'}</strong></span>
            </div>

            <PdfViewer 
              file={activeStudentExam.pdfFile} 
              pageNumber={studentCurrentPage} 
              onDocumentLoadSuccess={({ numPages }) => {
                if (activeStudentExam.numPages !== numPages) {
                  updateExamInDb(activeStudentExam.id, { numPages });
                }
              }}
            />

            {!isExamFinished && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', margin: '20px 0' }}>
                {['A', 'B', 'C', 'D', 'E'].map(option => {
                  const isSelected = studentAnswers[studentCurrentPage] === option;
                  return (
                    <button key={option} onClick={() => handleAnswerSelect(option)} style={{ width: '48px', height: '48px', borderRadius: '50%', border: isSelected ? '2px solid #16a34a' : '2px solid #94a3b8', backgroundColor: isSelected ? '#16a34a' : '#ffffff', color: isSelected ? '#ffffff' : '#334155', fontSize: '1.2rem', fontWeight: 'bold', cursor: 'pointer' }}>
                      {option}
                    </button>
                  );
                })}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px', gap: '10px' }}>
              <button disabled={studentCurrentPage <= 1} onClick={() => { setStudentCurrentPage(p => p - 1); setViewingSolutionQ(false); }} style={{ padding: '10px 24px', borderRadius: '6px', border: 'none', backgroundColor: studentCurrentPage <= 1 ? '#e2e8f0' : '#475569', color: studentCurrentPage <= 1 ? '#94a3b8' : '#ffffff', fontWeight: 'bold', cursor: studentCurrentPage <= 1 ? 'not-allowed' : 'pointer' }}>◀ Önceki Soru</button>
              <button disabled={studentCurrentPage >= activeStudentExam.numPages} onClick={() => { setStudentCurrentPage(p => p + 1); setViewingSolutionQ(false); }} style={{ padding: '10px 24px', borderRadius: '6px', border: 'none', backgroundColor: studentCurrentPage >= activeStudentExam.numPages ? '#e2e8f0' : '#2563eb', color: studentCurrentPage >= activeStudentExam.numPages ? '#94a3b8' : '#ffffff', fontWeight: 'bold', cursor: studentCurrentPage >= activeStudentExam.numPages ? 'not-allowed' : 'pointer' }}>Sonraki Soru ▶</button>
            </div>
          </div>

          {(showResults && viewingSolutionQ) && activeStudentExam.solutionPdfFile ? (
            <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '12px', padding: '14px', width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#dcfce7', padding: '10px 14px', borderRadius: '8px', fontWeight: '600', marginBottom: '12px', color: '#166534', fontSize: '0.85rem' }}>
                <span>💡 {studentCurrentPage}. Soru Çözümü</span>
                <button onClick={() => setViewingSolutionQ(false)} style={{ padding: '2px 8px', borderRadius: '4px', border: 'none', backgroundColor: '#166534', color: '#fff', cursor: 'pointer', fontSize: '0.75rem' }}>Kapat</button>
              </div>
              <PdfViewer file={activeStudentExam.solutionPdfFile} pageNumber={studentCurrentPage} />
            </div>
          ) : (
            <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px' }}>
              <h3 style={{ margin: '0 0 10px 0', fontSize: '1rem', color: '#0f172a', textAlign: 'center' }}>Soru Paleti</h3>
              
              {!showResults ? (
                <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: '12px', padding: '6px', backgroundColor: '#ffffff', borderRadius: '6px', border: '1px solid #f1f5f9', fontSize: '0.75rem' }}>
                  <span style={{ color: '#16a34a', fontWeight: 'bold' }}>● Çözüldü: {answeredCount}</span>
                  <span style={{ color: '#64748b', fontWeight: 'bold' }}>○ Boş: {emptyCount}</span>
                </div>
              ) : null}

              <div style={{ maxHeight: '420px', overflowY: 'auto', paddingRight: '2px', marginBottom: '14px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
                  {Array.from({ length: activeStudentExam.numPages }, (_, index) => {
                    const qNum = index + 1;
                    const isAnswered = !!studentAnswers[qNum];
                    const isCurrent = studentCurrentPage === qNum;
                    let btnBg = '#ffffff', btnColor = '#334155', btnBorder = '1px solid #cbd5e1';
                    
                    if (showResults) {
                      const studentAns = studentAnswers[qNum];
                      const correctAns = activeStudentExam.answerKey[qNum];
                      if (studentAns && studentAns === correctAns) {
                        btnBg = '#dcfce7'; btnColor = '#15803d'; btnBorder = '1px solid #16a34a';
                      } else if (studentAns && studentAns !== correctAns) {
                        btnBg = '#fee2e2'; btnColor = '#dc2626'; btnBorder = '1px solid #ef4444';
                      } else {
                        btnBg = '#f1f5f9'; btnColor = '#64748b'; btnBorder = '1px solid #e2e8f0';
                      }
                    } else {
                      if (isAnswered) { btnBg = '#16a34a'; btnColor = '#ffffff'; btnBorder = '1px solid #16a34a'; }
                    }

                    if (isCurrent) { btnBorder = '2px solid #2563eb'; }

                    return (
                      <button key={qNum} onClick={() => { setStudentCurrentPage(qNum); setViewingSolutionQ(false); }} style={{ height: '36px', borderRadius: '4px', border: btnBorder, backgroundColor: btnBg, color: btnColor, fontWeight: 'bold', fontSize: '0.85rem', cursor: 'pointer', padding: 0 }}>
                        {qNum}
                      </button>
                    );
                  })}
                </div>
              </div>

              {showResults && activeStudentExam.solutionPdfFile && (
                <button onClick={() => setViewingSolutionQ(true)} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: 'none', backgroundColor: '#16a34a', color: '#ffffff', fontWeight: 'bold', fontSize: '0.85rem', cursor: 'pointer', marginBottom: '10px' }}>
                  💡 {studentCurrentPage}. Çözümü Gör
                </button>
              )}

              {!isExamFinished && (
                <button onClick={finishExam} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: 'none', backgroundColor: '#dc2626', color: '#ffffff', fontWeight: 'bold', fontSize: '0.85rem', cursor: 'pointer' }}>
                  {isDeneme ? 'Sınavı Bitir 🏁' : 'Testi Bitir 🏁'}
                </button>
              )}
            </div>
          )}

        </div>
      </div>
    );
  }
}
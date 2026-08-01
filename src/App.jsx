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
  const [activeSubExamId, setActiveSubExamId] = useState(null);
  const [isCreatingExam, setIsCreatingExam] = useState(false);
  const [newExamForm, setNewExamForm] = useState({
    name: '', duration: '', examType: 'deneme', categoryExamType: '', categoryLesson: '', price: 0, originalPrice: 0, isParent: true, answerKey: {}, sections: [], numPages: 0
  });

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
      session?.user ? checkUserRoleAndSetMode(session.user) : fetchPublicExams();
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
    const { data, error } = await supabase.from('student_exams').select('exam_id, rating').gt('rating', 0);
    if (!error && data) {
      const map = {};
      data.forEach(item => {
        if (!map[item.exam_id]) map[item.exam_id] = { total: 0, count: 0 };
        map[item.exam_id].total += item.rating;
        map[item.exam_id].count += 1;
      });
      const formattedMap = {};
      Object.keys(map).forEach(id => {
        formattedMap[id] = {
          average: (map[id].total / map[id].count).toFixed(1).replace('.', ','),
          count: map[id].count.toLocaleString('tr-TR')
        };
      });
      setExamRatingsMap(formattedMap);
    }
  };

  const checkUserRoleAndSetMode = (currentUser) => {
    setAppMode(currentUser.email === 'admin@yayinevi.com' ? 'admin' : 'student');
    fetchExams(currentUser);
    fetchUserPurchases(currentUser.email);
  };

  const fetchUserPurchases = async (userEmail) => {
    const { data, error } = await supabase.from('student_purchases').select('exam_id').eq('student_email', userEmail);
    if (!error && data) {
      const purchasedMap = {};
      data.forEach(p => purchasedMap[p.exam_id] = true);
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
    const { data, error } = await supabase.from('exams').select('*').eq('is_published', true).order('created_at', { ascending: false });
    if (!error && data) setExams(data.map(formatExamData));
  };

  const fetchExams = async (currentUser = user) => {
    const query = supabase.from('exams').select('*').order('created_at', { ascending: false });
    if (!currentUser || currentUser.email !== 'admin@yayinevi.com') query.eq('is_published', true);

    const { data, error } = await query;
    if (!error && data) setExams(data.map(formatExamData));

    if (currentUser && currentUser.email !== 'admin@yayinevi.com') {
      const { data: resultsData } = await supabase.from('student_exams').select('*').eq('student_email', currentUser.email);
      if (resultsData) {
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
    if (authMode === 'register' && password.length < 6) return alert("Şifre en az 6 haneli olmalıdır.");
    setAuthLoading(true);

    if (authMode === 'register') {
      const { error } = await supabase.auth.signUp({ email, password });
      alert(error ? "Kayıt hatası: " + error.message : "Kayıt başarılı! Lütfen e-postanızı kontrol edin.");
      if (!error) setAuthMode('login');
    } else if (authMode === 'login') {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) alert("Giriş hatası: " + error.message);
      else { setUser(data.user); checkUserRoleAndSetMode(data.user); setShowAuthModal(false); }
    } else if (authMode === 'forgot') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
      alert(error ? "Şifre sıfırlama hatası: " + error.message : "Şifre sıfırlama bağlantısı gönderildi.");
      if (!error) setAuthMode('login');
    }
    setAuthLoading(false);
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
    setStudentResultsMap({});
    setStudentPurchases({});
    fetchPublicExams();
  };

  const updateExamInDb = async (id, updates) => {
    setExams(prev => prev.map(ex => ex.id === id ? { ...ex, ...updates } : ex));
    const dbUpdates = {};
    Object.keys(updates).forEach(key => {
      const dbKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
      dbUpdates[dbKey] = updates[key];
    });
    await supabase.from('exams').update(dbUpdates).eq('id', id);
  };

  const activeStudentExam = exams.find(e => e.id === activeStudentExamId);

  useEffect(() => {
    if (user && appMode === 'student' && activeStudentExam && !isExamFinished && !showResults) {
      const timer = setInterval(() => {
        if (activeStudentExam.examType === 'deneme') {
          setTimeLeft(prev => {
            if (prev <= 1) {
              clearInterval(timer);
              saveAndFinishExam(0);
              alert("Süre doldu! Sınavınız otomatik olarak tamamlanmıştır.");
              return 0;
            }
            return prev - 1;
          });
        } else {
          setTimeLeft(prev => prev + 1);
        }
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [user, appMode, activeStudentExam, isExamFinished, showResults]);

  const formatTime = (seconds) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;

  const handleStartCreateExam = () => {
    setNewExamForm({ name: '', duration: '', examType: 'deneme', categoryExamType: '', categoryLesson: '', price: 0, originalPrice: 0, isParent: true, answerKey: {}, sections: [], numPages: 0 });
    setIsCreatingExam(true);
    setActiveAdminExamId(null);
    setActiveSubExamId(null);
  };

  const handleSaveNewExam = async () => {
    setAuthLoading(true);
    const { data, error } = await supabase.from('exams').insert([{
      name: newExamForm.name,
      duration: Number(newExamForm.duration) || 0,
      exam_type: newExamForm.examType,
      category_exam_type: newExamForm.categoryExamType,
      category_lesson: newExamForm.categoryLesson,
      is_published: false,
      price: Number(newExamForm.price) || 0,
      original_price: Number(newExamForm.originalPrice) || 0,
      is_parent: true,
      sections: []
    }]).select();
    setAuthLoading(false);

    if (error) alert("Sınav oluşturulamadı: " + error.message);
    else if (data?.[0]) {
      setExams(prev => [formatExamData(data[0]), ...prev]);
      setIsCreatingExam(false);
    }
  };

  const handleFileUpload = async (examId, e, isSolution = false) => {
    const file = e.target.files[0];
    if (!file || !examId) return;
    setAuthLoading(true);
    const prefix = isSolution ? 'sol' : 'exam';
    const fileName = `${prefix}_${Math.random().toString(36).substring(2)}_${Date.now()}.${file.name.split('.').pop()}`;
    
    const { error: storageError } = await supabase.storage.from('exam-files').upload(fileName, file);
    if (storageError) {
      alert("Dosya yüklenemedi: " + storageError.message);
      setAuthLoading(false);
      return;
    }
    const { data: publicURLData } = supabase.storage.from('exam-files').getPublicUrl(fileName);
    setAuthLoading(false);
    await updateExamInDb(examId, isSolution ? { solutionPdfFile: publicURLData.publicUrl } : { pdfFile: publicURLData.publicUrl });
  };

  const handleFastKeyEntryForExam = (examId, text) => {
    const exam = exams.find(e => e.id === examId);
    if (!exam) return;
    const sanitizedText = text.toUpperCase().replace(/[^ABCDE]/g, '');
    const newKey = {};
    for (let i = 0; i < sanitizedText.length; i++) {
      if (i < (exam.numPages || 120)) newKey[i + 1] = sanitizedText[i];
    }
    updateExamInDb(examId, { answerKey: newKey });
  };

  const handleAddSubTest = async () => {
    const adminActiveExam = exams.find(e => e.id === activeAdminExamId);
    if (!adminActiveExam) return;
    setAuthLoading(true);
    const { data, error } = await supabase.from('exams').insert([{
      name: '', parent_id: adminActiveExam.id, is_published: true, exam_type: 'test', duration: 0, price: 0, answer_key: {}, sections: [], num_pages: 0
    }]).select();
    setAuthLoading(false);
    if (error) alert("Alt test eklenemedi: " + error.message);
    else if (data?.[0]) {
      const formatted = formatExamData(data[0]);
      setExams(prev => [formatted, ...prev]);
      setActiveSubExamId(formatted.id);
    }
  };

  const togglePublish = async (examId) => {
    const exam = exams.find(e => e.id === examId);
    if (exam) await updateExamInDb(examId, { isPublished: !exam.isPublished });
  };

  const deleteExam = async (examId) => {
    if (window.confirm("Bu içeriği silmek istediğinize emin misiniz?")) {
      await supabase.from('exams').delete().eq('parent_id', examId);
      const { error } = await supabase.from('exams').delete().eq('id', examId);
      if (!error) {
        setExams(prev => prev.filter(e => e.id !== examId && e.parentId !== examId));
        if (activeAdminExamId === examId) { setActiveAdminExamId(null); setActiveSubExamId(null); }
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
    if (exam.price > 0 && !studentPurchases[exam.id] && !(exam.parentId && studentPurchases[exam.parentId])) {
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
    if (!user) {
      alert("Ödeme yapabilmek için lütfen giriş yapın.");
      setAuthMode('login');
      setShowAuthModal(true);
      return;
    }
    if (!window.confirm(`"${exam.name}" sınavı ücretli (₺${exam.price}). Ödemeyi onaylıyor musunuz?`)) return;
    
    initializePayment({ price: exam.price.toString() }, (err, result) => {
      if (err || result.status !== 'success') {
        alert("Ödeme başarısız: " + (err || result?.errorMessage));
        return;
      }
      const checkoutDiv = document.getElementById('iyzipay-checkout-form');
      if (checkoutDiv) checkoutDiv.innerHTML = result.checkoutFormContent;
      window.iyzipayCheckout?.show?.();
    });
  };

  const calculateResults = () => {
    if (!activeStudentExam) return { correct: 0, wrong: 0, empty: 0, net: 0 };
    let correct = 0, wrong = 0, empty = 0;
    for (let i = 1; i <= activeStudentExam.numPages; i++) {
      const studentAns = studentAnswers[i];
      const correctAns = activeStudentExam.answerKey[i];
      if (!studentAns || !correctAns) empty++;
      else if (studentAns === correctAns) correct++;
      else wrong++;
    }
    return { correct, wrong, empty, net: Math.max(0, correct - wrong * 0.25) };
  };

  const saveAndFinishExam = async (ratingVal = 0) => {
    const results = calculateResults();
    setIsExamFinished(true);
    setShowResults(true);
    const existingRes = studentResultsMap[activeStudentExamId] || {};
    const finalRating = ratingVal > 0 ? ratingVal : (existingRes.rating || 0);

    await supabase.from('student_exams').upsert([{
      student_email: user.email,
      exam_id: activeStudentExamId,
      answers: studentAnswers,
      correct_count: results.correct,
      wrong_count: results.wrong,
      empty_count: results.empty,
      net: results.net,
      is_finished: true,
      rating: finalRating
    }], { onConflict: 'student_email, exam_id' });

    setStudentResultsMap(prev => ({ ...prev, [activeStudentExamId]: { is_finished: true, ...results, answers: studentAnswers, rating: finalRating } }));
    fetchAllRatings();
  };

  const handleRateExamInActiveScreen = async (rate) => {
    if (!user || !activeStudentExamId) return;
    const existingRes = studentResultsMap[activeStudentExamId] || {};
    await supabase.from('student_exams').upsert([{
      student_email: user.email,
      exam_id: activeStudentExamId,
      answers: existingRes.answers || studentAnswers,
      correct_count: existingRes.correct ?? 0,
      wrong_count: existingRes.wrong ?? 0,
      empty_count: existingRes.empty ?? 0,
      net: existingRes.net ?? 0,
      is_finished: existingRes.is_finished ?? false,
      rating: rate
    }], { onConflict: 'student_email, exam_id' });

    setStudentResultsMap(prev => ({ ...prev, [activeStudentExamId]: { ...existingRes, rating: rate } }));
    fetchAllRatings();
  };

  // ==========================================
  // RENDER: YÖNETİCİ EKRANI
  // ==========================================
  if (user && appMode === 'admin') {
    const adminActiveExam = exams.find(e => e.id === activeAdminExamId);
    const childExams = adminActiveExam ? exams.filter(e => e.parentId === adminActiveExam.id) : [];
    const currentPreviewExam = childExams.find(e => e.id === activeSubExamId) || childExams[0] || adminActiveExam;

    return (
      <div style={{ fontFamily: "'Roboto', 'Inter', sans-serif", maxWidth: '1200px', margin: '0 auto', padding: '20px', color: '#1e293b' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #e2e8f0', paddingBottom: '12px', marginBottom: '20px' }}>
          <h1 style={{ margin: 0, fontSize: '1.4rem' }}>⚙️ Yönetici Paneli ({user.email})</h1>
          <button onClick={handleLogout} style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', color: '#dc2626', fontWeight: 'bold', cursor: 'pointer' }}>Çıkış Yap</button>
        </header>

        {authLoading && <div style={{ textAlign: 'center', padding: '10px', background: '#eff6ff', color: '#1e40af', marginBottom: '16px', borderRadius: '6px', fontWeight: 'bold' }}>⏳ İşlem yapılıyor...</div>}

        {!adminActiveExam && !isCreatingExam ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0 }}>Tüm Sınavlar ve Paketler</h2>
              <button onClick={handleStartCreateExam} style={{ padding: '10px 20px', background: '#2563eb', color: '#fff', borderRadius: '8px', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>+ Yeni Sınav / Paket Oluştur</button>
            </div>

            {exams.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px', background: '#f8fafc', borderRadius: '12px', border: '1px dashed #cbd5e1', color: '#64748b' }}>Henüz içerik yok.</div>
            ) : (
              <div style={{ display: 'grid', gap: '16px' }}>
                {exams.filter(e => !e.parentId).map(parentExam => (
                  <div key={parentExam.id} style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <h3 style={{ margin: '0 0 6px 0' }}>📦 {parentExam.name || 'İsimsiz İçerik'}</h3>
                      <span style={{ color: parentExam.isPublished ? '#16a34a' : '#ef4444', fontWeight: 'bold', fontSize: '0.85rem' }}>{parentExam.isPublished ? '● Yayında' : '○ Taslak'}</span> | <span>₺{parentExam.price}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => { setActiveAdminExamId(parentExam.id); setActiveSubExamId(null); }} style={{ padding: '8px 12px', borderRadius: '6px', background: '#e0e7ff', color: '#4338ca', border: '1px dashed #4338ca', fontWeight: 'bold', cursor: 'pointer' }}>+ Sınavı Tanımla</button>
                      <button onClick={() => togglePublish(parentExam.id)} style={{ padding: '8px 12px', borderRadius: '6px', border: 'none', background: parentExam.isPublished ? '#f59e0b' : '#16a34a', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}>{parentExam.isPublished ? 'Kaldır' : 'Yayınla'}</button>
                      <button onClick={() => deleteExam(parentExam.id)} style={{ padding: '8px 12px', borderRadius: '6px', border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer' }}>Sil</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : isCreatingExam ? (
          <div style={{ maxWidth: '600px', margin: '0 auto', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px' }}>
            <h3 style={{ marginTop: 0 }}>Yeni İçerik Ayarları</h3>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '4px' }}>İçerik Adı:</label>
              <input type="text" value={newExamForm.name} onChange={e => setNewExamForm({ ...newExamForm, name: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
              <div>
                <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '4px' }}>Fiyat (₺):</label>
                <input type="number" value={newExamForm.price} onChange={e => setNewExamForm({ ...newExamForm, price: Number(e.target.value) })} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '4px' }}>Eski Fiyat:</label>
                <input type="number" value={newExamForm.originalPrice} onChange={e => setNewExamForm({ ...newExamForm, originalPrice: Number(e.target.value) })} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={handleSaveNewExam} style={{ flex: 1, padding: '12px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>Kaydet</button>
              <button onClick={() => setIsCreatingExam(false)} style={{ flex: 1, padding: '12px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>İptal</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: currentPreviewExam?.pdfFile ? '1fr 380px' : '1fr', gap: '24px' }}>
            {currentPreviewExam?.pdfFile && (
              <div style={{ background: '#f1f5f9', padding: '16px', borderRadius: '12px' }}>
                <PdfViewer file={currentPreviewExam.pdfFile} pageNumber={1} />
              </div>
            )}
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px' }}>
              <h3 style={{ marginTop: 0 }}>İçerik Detayları</h3>
              {childExams.length === 0 ? (
                <div>
                  <div style={{ marginBottom: '12px' }}>
                    <label style={{ fontWeight: 'bold', fontSize: '0.85rem' }}>İsim:</label>
                    <input type="text" value={adminActiveExam.name} onChange={e => updateExamInDb(adminActiveExam.id, { name: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
                  </div>
                  <div style={{ marginBottom: '12px' }}>
                    <label style={{ fontWeight: 'bold', fontSize: '0.85rem' }}>Soru / Sayfa Sayısı:</label>
                    <input type="number" value={adminActiveExam.numPages || 0} onChange={e => updateExamInDb(adminActiveExam.id, { numPages: Number(e.target.value) })} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
                  </div>
                  <div style={{ marginBottom: '12px' }}>
                    <label style={{ fontWeight: 'bold', fontSize: '0.85rem' }}>PDF:</label>
                    <input type="file" accept="application/pdf" onChange={e => handleFileUpload(adminActiveExam.id, e)} />
                  </div>
                  <div style={{ marginBottom: '12px' }}>
                    <label style={{ fontWeight: 'bold', fontSize: '0.85rem' }}>Çözüm PDF:</label>
                    <input type="file" accept="application/pdf" onChange={e => handleFileUpload(adminActiveExam.id, e, true)} />
                  </div>
                  <div style={{ marginBottom: '12px' }}>
                    <label style={{ fontWeight: 'bold', fontSize: '0.85rem' }}>Hızlı Cevap Anahtarı:</label>
                    <textarea value={Array.from({ length: adminActiveExam.numPages || 0 }, (_, i) => adminActiveExam.answerKey?.[i + 1] || '').join('')} onChange={e => handleFastKeyEntryForExam(adminActiveExam.id, e.target.value)} style={{ width: '100%', height: '60px', fontFamily: 'monospace', textTransform: 'uppercase' }} />
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {childExams.map((sub, idx) => (
                    <div key={sub.id} onClick={() => setActiveSubExamId(sub.id)} style={{ padding: '10px', background: '#f8fafc', border: currentPreviewExam.id === sub.id ? '2px solid #2563eb' : '1px solid #e2e8f0', borderRadius: '8px', cursor: 'pointer' }}>
                      <strong>Test {idx + 1}</strong>
                      <input type="text" value={sub.name} onChange={e => updateExamInDb(sub.id, { name: e.target.value })} style={{ width: '100%', marginTop: '4px', padding: '4px' }} />
                    </div>
                  ))}
                </div>
              )}
              <button onClick={handleAddSubTest} style={{ width: '100%', marginTop: '10px', padding: '8px', background: '#eff6ff', color: '#2563eb', border: '1px dashed #2563eb', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>+ Yeni Test Ekle</button>
              <button onClick={() => setActiveAdminExamId(null)} style={{ width: '100%', marginTop: '10px', padding: '10px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>Listeye Dön</button>
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
      if (!inspectExam) return null;
      const childExams = exams.filter(e => e.parentId === inspectingExamId);
      const rating = examRatingsMap[inspectExam.id] || { average: '0,0', count: '0' };
      const isCompleted = studentResultsMap[inspectExam.id]?.is_finished;

      return (
        <div style={{ fontFamily: "'Roboto', 'Inter', sans-serif", minHeight: '100vh', background: '#f8fafc', padding: '20px' }}>
          <button onClick={() => setInspectingExamId(null)} style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}>◀ Geri Dön</button>
          <div style={{ maxWidth: '800px', margin: '20px auto', background: '#fff', borderRadius: '12px', padding: '24px', border: '1px solid #e2e8f0' }}>
            <h1>{inspectExam.name}</h1>
            <p>⭐ {rating.average} ({rating.count} değerlendirme)</p>
            {childExams.map((child, idx) => (
              <div key={child.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', borderBottom: '1px solid #e2e8f0', alignItems: 'center' }}>
                <span>{idx + 1}. {child.name || 'Test'}</span>
                <button onClick={() => startExam(child)} style={{ padding: '6px 12px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Çöz ▶</button>
              </div>
            ))}
            {childExams.length === 0 && (
              <button onClick={() => startExam(inspectExam)} style={{ padding: '12px 24px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', marginTop: '16px' }}>
                {isCompleted ? 'Sonucu İncele' : 'Sınava Başla ▶'}
              </button>
            )}
          </div>
        </div>
      );
    }

    if (!activeStudentExamId) {
      const published = exams.filter(e => e.isPublished && !e.parentId && (selectedCategory === 'Tümü' || e.categoryExamType === selectedCategory) && (!searchQuery || e.name.toLowerCase().includes(searchQuery.toLowerCase())));
      const categories = ['Tümü', ...Array.from(new Set(exams.filter(e => e.isPublished && e.categoryExamType).map(e => e.categoryExamType.trim())))];

      return (
        <div style={{ fontFamily: "'Roboto', 'Inter', sans-serif", minHeight: '100vh', background: '#f8fafc' }}>
          <header style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: '900', color: '#2563eb' }}>YENİTREND</div>
            <input type="text" placeholder="Arama yap..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} style={{ padding: '8px 16px', borderRadius: '99px', border: '1px solid #cbd5e1', width: '300px' }} />
            <div>
              {user ? (
                <button onClick={handleLogout} style={{ color: '#dc2626', background: 'none', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>Çıkış Yap</button>
              ) : (
                <button onClick={() => { setAuthMode('login'); setShowAuthModal(true); }} style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer' }}>Giriş Yap</button>
              )}
            </div>
          </header>
          <div style={{ background: '#fff', padding: '0 24px', display: 'flex', gap: '20px', borderBottom: '1px solid #e2e8f0', overflowX: 'auto' }}>
            {categories.map(cat => (
              <button key={cat} onClick={() => setSelectedCategory(cat)} style={{ background: 'none', border: 'none', padding: '12px 0', fontWeight: selectedCategory === cat ? 'bold' : 'normal', color: selectedCategory === cat ? '#2563eb' : '#64748b', cursor: 'pointer', borderBottom: selectedCategory === cat ? '2px solid #2563eb' : '2px solid transparent' }}>{cat}</button>
            ))}
          </div>
          <main style={{ maxWidth: '900px', margin: '20px auto', padding: '0 20px', display: 'grid', gap: '16px' }}>
            {published.map(exam => (
              <div key={exam.id} onClick={() => setInspectingExamId(exam.id)} style={{ background: '#fff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
                <div>
                  <h3>{exam.name}</h3>
                  <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Soru: {exam.numPages}</span>
                </div>
                <button style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px' }}>İncele</button>
              </div>
            ))}
          </main>
          {showAuthModal && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              <div style={{ background: '#fff', padding: '24px', borderRadius: '12px', width: '350px', position: 'relative' }}>
                <button onClick={() => setShowAuthModal(false)} style={{ position: 'absolute', right: '12px', top: '12px', border: 'none', background: 'none', cursor: 'pointer' }}>✕</button>
                <h2 style={{ marginTop: 0 }}>Giriş Yap</h2>
                <form onSubmit={handleAuth}>
                  <input type="email" required placeholder="E-posta" value={email} onChange={e => setEmail(e.target.value)} style={{ width: '100%', padding: '8px', marginBottom: '10px', boxSizing: 'border-box' }} />
                  <input type="password" required placeholder="Şifre" value={password} onChange={e => setPassword(e.target.value)} style={{ width: '100%', padding: '8px', marginBottom: '10px', boxSizing: 'border-box' }} />
                  <button type="submit" style={{ width: '100%', padding: '10px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Giriş</button>
                </form>
              </div>
            </div>
          )}
        </div>
      );
    }

    if (!activeStudentExam) return null;
    const results = showResults ? (studentResultsMap[activeStudentExamId] || calculateResults()) : null;

    return (
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '20px', fontFamily: "'Roboto', sans-serif" }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px', marginBottom: '20px' }}>
          <h2>{activeStudentExam.name}</h2>
          <button onClick={() => setActiveStudentExamId(null)} style={{ padding: '6px 12px', border: '1px solid #cbd5e1', background: '#fff', borderRadius: '6px', cursor: 'pointer' }}>Listeye Dön</button>
        </header>

        {showResults && results && (
          <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', marginBottom: '20px', textAlign: 'center' }}>
            <h3>Sonuçlar: Doğru: {results.correct} | Yanlış: {results.wrong} | Boş: {results.empty} | Net: {results.net}</h3>
            {user && (
              <div style={{ marginTop: '10px' }}>
                <span>Puan Ver: </span>
                {[1, 2, 3, 4, 5].map(star => (
                  <span key={star} onClick={() => handleRateExamInActiveScreen(star)} style={{ cursor: 'pointer', fontSize: '1.5rem', color: '#eab308' }}>★</span>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '20px' }}>
          <div>
            <div style={{ marginBottom: '10px' }}>Soru {studentCurrentPage} / {activeStudentExam.numPages} - Kalan Süre: {formatTime(timeLeft)}</div>
            <PdfViewer file={activeStudentExam.pdfFile} pageNumber={studentCurrentPage} />
            {!isExamFinished && (
              <div style={{ display: 'flex', gap: '10px', margin: '15px 0', justifyContent: 'center' }}>
                {['A', 'B', 'C', 'D', 'E'].map(opt => (
                  <button key={opt} onClick={() => setStudentAnswers({ ...studentAnswers, [studentCurrentPage]: studentAnswers[studentCurrentPage] === opt ? undefined : opt })} style={{ width: '40px', height: '40px', borderRadius: '50%', border: studentAnswers[studentCurrentPage] === opt ? '2px solid #16a34a' : '1px solid #cbd5e1', background: studentAnswers[studentCurrentPage] === opt ? '#16a34a' : '#fff', color: studentAnswers[studentCurrentPage] === opt ? '#fff' : '#000', fontWeight: 'bold', cursor: 'pointer' }}>{opt}</button>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button disabled={studentCurrentPage <= 1} onClick={() => setStudentCurrentPage(p => p - 1)} style={{ padding: '8px 16px', cursor: 'pointer' }}>◀ Önceki</button>
              <button disabled={studentCurrentPage >= activeStudentExam.numPages} onClick={() => setStudentCurrentPage(p => p + 1)} style={{ padding: '8px 16px', cursor: 'pointer' }}>Sonraki ▶</button>
            </div>
          </div>
          <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <h4 style={{ marginTop: 0, textAlign: 'center' }}>Soru Paleti</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px', marginBottom: '12px' }}>
              {Array.from({ length: activeStudentExam.numPages }, (_, i) => i + 1).map(qNum => (
                <button key={qNum} onClick={() => setStudentCurrentPage(qNum)} style={{ height: '32px', background: studentAnswers[qNum] ? '#16a34a' : '#fff', color: studentAnswers[qNum] ? '#fff' : '#000', border: '1px solid #cbd5e1', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>{qNum}</button>
              ))}
            </div>
            {!isExamFinished && <button onClick={() => saveAndFinishExam(0)} style={{ width: '100%', padding: '10px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>Sınavı Bitir 🏁</button>}
          </div>
        </div>
      </div>
    );
  }
  return null;
}
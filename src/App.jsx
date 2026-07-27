import { useState, useEffect } from 'react';
import PdfViewer from './PdfViewer';
import { supabase } from './supabase';

export default function App() {
  const [appMode, setAppMode] = useState('home'); // 'home', 'admin', 'student'
  const [authMode, setAuthMode] = useState('login'); // 'login', 'register', 'forgot'
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const [exams, setExams] = useState([]);
  const [activeAdminExamId, setActiveAdminExamId] = useState(null);
  const [activeStudentExamId, setActiveStudentExamId] = useState(null);

  const [studentCurrentPage, setStudentCurrentPage] = useState(1);
  const [studentAnswers, setStudentAnswers] = useState({});
  const [timeLeft, setTimeLeft] = useState(0); 
  const [isExamFinished, setIsExamFinished] = useState(false);
  const [showResults, setShowResults] = useState(false);
  
  const [viewingSolutionQ, setViewingSolutionQ] = useState(false);
  const [studentResultsMap, setStudentResultsMap] = useState({});

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        checkUserRoleAndSetMode(session.user);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        checkUserRoleAndSetMode(session.user);
      } else {
        setAppMode('home');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const checkUserRoleAndSetMode = (currentUser) => {
    if (currentUser.email === 'admin@yayinevi.com') {
      setAppMode('admin');
    } else {
      setAppMode('student');
    }
    fetchExams(currentUser);
  };

  const fetchExams = async (currentUser = user) => {
    const { data, error } = await supabase
      .from('exams')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error("Sınavlar yüklenirken hata oluştu:", error);
    } else {
      const formattedExams = data.map(item => ({
        id: item.id,
        name: item.name,
        duration: item.duration,
        examType: item.exam_type || 'deneme',
        pdfFile: item.pdf_file,
        solutionPdfFile: item.solution_pdf_file,
        answerKey: item.answer_key || {},
        isPublished: item.is_published,
        numPages: item.num_pages || 0
      }));
      setExams(formattedExams);
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
            net: res.net
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
    setAppMode('home');
    setActiveAdminExamId(null);
    setActiveStudentExamId(null);
    setStudentResultsMap({});
  };

  const updateExamInDb = async (id, updates) => {
    setExams((prev) => prev.map(ex => ex.id === id ? { ...ex, ...updates } : ex));

    const dbUpdates = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.duration !== undefined) dbUpdates.duration = updates.duration;
    if (updates.examType !== undefined) dbUpdates.exam_type = updates.examType;
    if (updates.pdfFile !== undefined) dbUpdates.pdf_file = updates.pdfFile;
    if (updates.solutionPdfFile !== undefined) dbUpdates.solution_pdf_file = updates.solutionPdfFile;
    if (updates.answerKey !== undefined) dbUpdates.answer_key = updates.answerKey;
    if (updates.isPublished !== undefined) dbUpdates.is_published = updates.isPublished;
    if (updates.numPages !== undefined) dbUpdates.num_pages = updates.numPages;

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
    if (appMode === 'student' && activeStudentExam && !isExamFinished && !showResults) {
      const timer = setInterval(() => {
        if (activeStudentExam.examType === 'deneme') {
          setTimeLeft((prev) => {
            if (prev <= 1) {
              clearInterval(timer);
              saveAndFinishExam();
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
  }, [appMode, activeStudentExam, isExamFinished, showResults, studentAnswers]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const uploadExamFile = async () => {
        setAuthLoading(true);
        const fileExt = file.name.split('.').pop();
        const fileName = `${Math.random().toString(36).substring(2)}_${Date.now()}.${fileExt}`;

        const { error: storageError } = await supabase.storage
          .from('exam-files')
          .upload(fileName, file);

        if (storageError) {
          console.error("Storage yükleme hatası:", storageError);
          alert("Dosya depolama alanına yüklenemedi: " + storageError.message);
          setAuthLoading(false);
          return;
        }

        const { data: publicURLData } = supabase.storage
          .from('exam-files')
          .getPublicUrl(fileName);

        const filePublicUrl = publicURLData.publicUrl;

        const newExamData = {
          name: file.name.replace('.pdf', ''),
          duration: 60,
          exam_type: 'deneme',
          pdf_file: filePublicUrl,
          solution_pdf_file: null,
          answer_key: {},
          is_published: false,
          num_pages: 0
        };

        const { data, error } = await supabase
          .from('exams')
          .insert([newExamData])
          .select();

        setAuthLoading(false);

        if (error) {
          console.error("Sınav veritabanı kayıt hatası:", error);
          alert("Sınav veritabanına kaydedilemedi: " + error.message);
        } else if (data && data.length > 0) {
          const inserted = data[0];
          const formatted = {
            id: inserted.id,
            name: inserted.name,
            duration: inserted.duration,
            examType: inserted.exam_type || 'deneme',
            pdfFile: inserted.pdf_file,
            solutionPdfFile: inserted.solution_pdf_file,
            answerKey: inserted.answer_key || {},
            isPublished: inserted.is_published,
            numPages: inserted.num_pages || 0
          };
          setExams(prev => [formatted, ...prev]);
          setActiveAdminExamId(formatted.id);
        }
      };

      uploadExamFile();
    }
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

        const solutionPublicUrl = publicURLData.publicUrl;
        setAuthLoading(false);

        await updateExamInDb(activeAdminExamId, { solutionPdfFile: solutionPublicUrl });
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
      if (!exam.isPublished && Object.keys(exam.answerKey).length === 0) {
         if(!window.confirm("Hiç cevap anahtarı girmediniz! Yine de yayınlamak istiyor musunuz?")) return;
      }
      await updateExamInDb(examId, { isPublished: !exam.isPublished });
    }
  };

  const deleteExam = async (examId) => {
    if (window.confirm("Bu içeriği silmek istediğinize emin misiniz?")) {
      const { error } = await supabase
        .from('exams')
        .delete()
        .eq('id', examId);

      if (error) {
        console.error("Silme hatası:", error);
      } else {
        setExams(exams.filter(e => e.id !== examId));
        if (activeAdminExamId === examId) setActiveAdminExamId(null);
      }
    }
  };

  const startExam = (exam) => {
    setActiveStudentExamId(exam.id);
    setStudentAnswers({});
    setStudentCurrentPage(1);
    setIsExamFinished(false);
    setShowResults(false);
    setViewingSolutionQ(false);
    setTimeLeft(exam.examType === 'deneme' ? exam.duration * 60 : 0);
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
    let correct = 0;
    let wrong = 0;
    let empty = 0;
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

  const saveAndFinishExam = async () => {
    const results = calculateResults();
    
    setIsExamFinished(true);
    setShowResults(true);

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
          is_finished: true
        }
      ], { onConflict: 'student_email, exam_id' });

    if (error) {
      console.error("Sonuç kaydedilemedi:", error);
    } else {
      setStudentResultsMap(prev => ({
        ...prev,
        [activeStudentExamId]: { is_finished: true, ...results, answers: studentAnswers }
      }));
    }
  };

  const finishExam = () => {
    const confirmText = activeStudentExam.examType === 'deneme' ? "Sınavı bitirmek istediğinize emin misiniz?" : "Testi bitirmek ve sonuçları görmek istediğinize emin misiniz?";
    if (window.confirm(confirmText)) {
      saveAndFinishExam();
    }
  };

  // ==========================================
  // RENDER: GİRİŞ / KAYIT / ŞİFRE SIFIRLAMA EKRANI (HOME)
  // ==========================================
  if (!user) {
    return (
      <div style={{ fontFamily: 'Inter, system-ui, sans-serif', maxWidth: '400px', margin: '60px auto', padding: '30px', backgroundColor: '#ffffff', borderRadius: '12px', border: '1px solid #cbd5e1', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', color: '#1e293b' }}>
        <h2 style={{ textAlign: 'center', color: '#0f172a', marginBottom: '24px' }}>
          {authMode === 'login' && '🔑 Kullanıcı Girişi'}
          {authMode === 'register' && '📝 Yeni Hesap Oluştur'}
          {authMode === 'forgot' && '🔒 Şifremi Unuttum'}
        </h2>

        <form onSubmit={handleAuth}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '6px' }}>E-posta Adresi:</label>
            <input 
              type="email" 
              required 
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              placeholder="ornek@mail.com"
              style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} 
            />
          </div>

          {authMode !== 'forgot' && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>Şifre {authMode === 'register' && <span style={{ fontWeight: 'normal', color: '#64748b', fontSize: '0.75rem' }}>(En az 6 karakter)</span>}:</label>
                {authMode === 'login' && (
                  <button 
                    type="button" 
                    onClick={() => setAuthMode('forgot')} 
                    style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: '0.75rem', cursor: 'pointer', padding: 0 }}
                  >
                    Şifremi Unuttum?
                  </button>
                )}
              </div>
              <input 
                type="password" 
                required 
                minLength={6}
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
                placeholder="••••••••"
                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} 
              />
            </div>
          )}

          <button 
            type="submit" 
            disabled={authLoading}
            style={{ width: '100%', padding: '12px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', fontSize: '1rem', cursor: 'pointer', marginBottom: '16px' }}
          >
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
    );
  }

  // ==========================================
  // RENDER: YÖNETİCİ EKRANI
  // ==========================================
  if (appMode === 'admin') {
    const adminActiveExam = exams.find(e => e.id === activeAdminExamId);

    return (
      <div style={{ fontFamily: 'Inter, system-ui, sans-serif', maxWidth: '1200px', margin: '0 auto', padding: '20px', color: '#1e293b' }}>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0 }}>Tüm Sınavlar ve Testler</h2>
              <label style={{ padding: '10px 20px', backgroundColor: '#2563eb', color: '#fff', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
                + Yeni İçerik Yükle (PDF)
                <input type="file" accept="application/pdf" onChange={handleFileUpload} style={{ display: 'none' }} />
              </label>
            </div>

            {exams.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px', backgroundColor: '#f8fafc', borderRadius: '12px', border: '1px dashed #cbd5e1' }}>
                <p style={{ color: '#64748b' }}>Henüz sisteme yüklenmiş bir içerik yok.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '16px' }}>
                {exams.map(exam => (
                  <div key={exam.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                    <div>
                      <h3 style={{ margin: '0 0 8px 0' }}>{exam.name}</h3>
                      <div style={{ display: 'flex', gap: '12px', fontSize: '0.85rem', color: '#64748b' }}>
                        <span style={{ backgroundColor: exam.examType === 'deneme' ? '#dbeafe' : '#f3e8ff', color: exam.examType === 'deneme' ? '#1e40af' : '#6b21a8', padding: '2px 8px', borderRadius: '4px', fontWeight: 'bold' }}>
                          {exam.examType === 'deneme' ? '📋 Deneme Sınavı' : '📚 Süresiz Test / Soru Bankası'}
                        </span>
                        {exam.examType === 'deneme' && <span>⏱ {exam.duration} Dk.</span>}
                        <span>📄 {exam.numPages || '?'} Soru</span>
                        <span>💡 Çözüm: {exam.solutionPdfFile ? '✅ Yüklendi' : '❌ Yüklenmedi'}</span>
                        <span style={{ color: exam.isPublished ? '#16a34a' : '#ef4444', fontWeight: 'bold' }}>
                          {exam.isPublished ? '● Yayında' : '○ Taslak'}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => togglePublish(exam.id)} style={{ padding: '8px 12px', borderRadius: '6px', border: 'none', backgroundColor: exam.isPublished ? '#f59e0b' : '#16a34a', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }}>
                        {exam.isPublished ? 'Yayından Kaldır' : 'Yayınla'}
                      </button>
                      <button onClick={() => setActiveAdminExamId(exam.id)} style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#f1f5f9', cursor: 'pointer' }}>Düzenle</button>
                      <button onClick={() => deleteExam(exam.id)} style={{ padding: '8px 12px', borderRadius: '6px', border: 'none', backgroundColor: '#ef4444', color: '#fff', cursor: 'pointer' }}>Sil</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '24px', alignItems: 'start' }}>
            <div style={{ backgroundColor: '#f1f5f9', padding: '16px', borderRadius: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <button onClick={() => setActiveAdminExamId(null)} style={{ padding: '6px 12px', borderRadius: '4px', border: '1px solid #cbd5e1', cursor: 'pointer' }}>◀ Listeye Dön</button>
                <strong>Soru Sayısı/Sayfa: {adminActiveExam.numPages || 'Yükleniyor...'}</strong>
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

            <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', position: 'sticky', top: '20px' }}>
              <h3 style={{ margin: '0 0 16px 0', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>İçerik Ayarları</h3>
              
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '4px' }}>İçerik Adı:</label>
                <input type="text" value={adminActiveExam.name} onChange={(e) => updateExamInDb(adminActiveExam.id, { name: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '4px' }}>İçerik Türü:</label>
                <select 
                  value={adminActiveExam.examType || 'deneme'} 
                  onChange={(e) => updateExamInDb(adminActiveExam.id, { examType: e.target.value })}
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#fff' }}
                >
                  <option value="deneme">Deneme Sınavı (Süreli Geri Sayım)</option>
                  <option value="test">Süresiz Test / Soru Bankası (Kronometreli)</option>
                </select>
              </div>

              {adminActiveExam.examType === 'deneme' && (
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '4px' }}>Süre (Dakika):</label>
                  <input type="number" value={adminActiveExam.duration} onChange={(e) => updateExamInDb(adminActiveExam.id, { duration: Number(e.target.value) })} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
                </div>
              )}

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

            </div>
          </div>
        )}
      </div>
    );
  }

  // ==========================================
  // RENDER: ÖĞRENCİ EKRANI (Clean & Premium UI)
  // ==========================================
  if (appMode === 'student') {
    if (!activeStudentExamId) {
      const publishedExams = exams.filter(e => e.isPublished);
      return (
        <div style={{ fontFamily: 'Inter, system-ui, sans-serif', minHeight: '100vh', backgroundColor: '#f8fafc', color: '#1e293b' }}>
          {/* Modern Header */}
          <header style={{ backgroundColor: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '16px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '36px', height: '36px', backgroundColor: '#2563eb', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 'bold', fontSize: '1.2rem' }}>
                📚
              </div>
              <div>
                <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '700', color: '#0f172a', letterSpacing: '-0.025em' }}>Yayınevi Sınav Portalı</h1>
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Öğrenci Kontrol Paneli</span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#f1f5f9', padding: '6px 12px', borderRadius: '20px', border: '1px solid #e2e8f0' }}>
                <span style={{ width: '8px', height: '8px', backgroundColor: '#22c55e', borderRadius: '50%' }}></span>
                <span style={{ fontSize: '0.85rem', fontWeight: '500', color: '#334155' }}>{user.email}</span>
              </div>
              <button 
                onClick={handleLogout} 
                style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #fecaca', backgroundColor: '#fef2f2', cursor: 'pointer', color: '#dc2626', fontWeight: '600', fontSize: '0.85rem', transition: 'all 0.2s' }}
                onMouseOver={(e) => e.target.style.backgroundColor = '#fee2e2'}
                onMouseOut={(e) => e.target.style.backgroundColor = '#fef2f2'}
              >
                Çıkış Yap
              </button>
            </div>
          </header>

          {/* Main Content Area */}
          <main style={{ maxWidth: '1000px', margin: '40px auto', padding: '0 20px' }}>
            <div style={{ marginBottom: '24px' }}>
              <h2 style={{ fontSize: '1.5rem', fontWeight: '700', color: '#0f172a', margin: '0 0 6px 0', letterSpacing: '-0.025em' }}>Sınavlar ve Testler</h2>
              <p style={{ margin: 0, color: '#64748b', fontSize: '0.95rem' }}>Çözmek istediğiniz içeriği seçerek başlayabilir veya tamamlanan sınavlarınızı inceleyebilirsiniz.</p>
            </div>

            {publishedExams.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', backgroundColor: '#ffffff', borderRadius: '16px', border: '1px dashed #cbd5e1', boxShadow: '0 1px 3px 0 rgba(0,0,0,0.02)' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>📂</div>
                <h3 style={{ margin: '0 0 6px 0', color: '#334155', fontSize: '1.1rem' }}>Aktif İçerik Bulunmuyor</h3>
                <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>Şu an yayında olan aktif bir sınav veya test bulunmamaktadır.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '16px' }}>
                {publishedExams.map(exam => {
                  const resData = studentResultsMap[exam.id];
                  const isCompleted = resData?.is_finished;
                  const isDeneme = exam.examType === 'deneme';

                  return (
                    <div 
                      key={exam.id} 
                      style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center', 
                        padding: '24px', 
                        backgroundColor: '#ffffff', 
                        borderRadius: '16px', 
                        border: isCompleted ? '1px solid #bbf7d0' : '1px solid #e2e8f0', 
                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.02), 0 2px 4px -1px rgba(0, 0, 0, 0.02)',
                        transition: 'transform 0.2s, box-shadow 0.2s',
                        position: 'relative',
                        overflow: 'hidden'
                      }}
                    >
                      {/* Sol Kenar Durum Çubuğu Vurgusu */}
                      <div style={{ 
                        position: 'absolute', 
                        left: 0, 
                        top: 0, 
                        bottom: 0, 
                        width: '6px', 
                        backgroundColor: isCompleted ? '#22c55e' : (isDeneme ? '#3b82f6' : '#8b5cf6') 
                      }}></div>

                      <div style={{ paddingLeft: '8px' }}>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                          <span style={{ 
                            backgroundColor: isDeneme ? '#eff6ff' : '#f5f3ff', 
                            color: isDeneme ? '#1d4ed8' : '#7c3aed', 
                            padding: '4px 10px', 
                            borderRadius: '6px', 
                            fontSize: '0.75rem', 
                            fontWeight: '600',
                            letterSpacing: '0.025em'
                          }}>
                            {isDeneme ? 'Deneme Sınavı' : 'Süresiz Test'}
                          </span>
                          
                          {isCompleted ? (
                            <span style={{ backgroundColor: '#f0fdf4', color: '#15803d', padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '600' }}>
                              ✓ Çözüldü (Net: {resData.net})
                            </span>
                          ) : (
                            <span style={{ backgroundColor: '#fffbeb', color: '#b45309', padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '600' }}>
                              Bekliyor
                            </span>
                          )}
                        </div>

                        <h3 style={{ margin: '0 0 10px 0', color: '#0f172a', fontSize: '1.2rem', fontWeight: '700', letterSpacing: '-0.025em' }}>{exam.name}</h3>
                        
                        <div style={{ display: 'flex', gap: '20px', fontSize: '0.85rem', color: '#64748b', fontWeight: '500' }}>
                          {isDeneme && <span>⏱ Süre: {exam.duration} Dakika</span>}
                          <span>📝 Soru Sayısı: {exam.numPages}</span>
                          {exam.solutionPdfFile && <span style={{ color: '#2563eb', fontWeight: '600' }}>💡 Çözümlü</span>}
                        </div>
                      </div>

                      <div>
                        <button 
                          onClick={() => {
                            if (isCompleted) {
                              setActiveStudentExamId(exam.id);
                              setStudentAnswers(resData.answers || {});
                              setStudentCurrentPage(1);
                              setIsExamFinished(true);
                              setShowResults(true);
                              setViewingSolutionQ(false);
                            } else {
                              startExam(exam);
                            }
                          }} 
                          style={{ 
                            padding: '12px 24px', 
                            borderRadius: '10px', 
                            border: 'none', 
                            backgroundColor: isCompleted ? '#475569' : '#2563eb', 
                            color: '#fff', 
                            fontWeight: '600', 
                            fontSize: '0.9rem', 
                            cursor: 'pointer',
                            boxShadow: isCompleted ? 'none' : '0 4px 6px -1px rgba(37, 99, 235, 0.2)',
                            transition: 'background-color 0.2s'
                          }}
                          onMouseOver={(e) => e.target.style.backgroundColor = isCompleted ? '#334155' : '#1d4ed8'}
                          onMouseOut={(e) => e.target.style.backgroundColor = isCompleted ? '#475569' : '#2563eb'}
                        >
                          {isCompleted ? 'Sonuçları İncele 📊' : (isDeneme ? 'Sınava Başla ▶' : 'Teste Başla ▶')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </main>
        </div>
      );
    }

    const answeredCount = Object.keys(studentAnswers).length;
    const emptyCount = activeStudentExam.numPages - answeredCount;
    const results = showResults ? (studentResultsMap[activeStudentExamId] || calculateResults()) : null;
    const isDeneme = activeStudentExam.examType === 'deneme';

    return (
      <div style={{ fontFamily: 'Inter, system-ui, sans-serif', maxWidth: '1200px', margin: '0 auto', padding: '20px', color: '#1e293b' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #e2e8f0', paddingBottom: '12px', marginBottom: '20px' }}>
          <h1 style={{ margin: 0, fontSize: '1.4rem', color: '#0f172a' }}>{activeStudentExam.name}</h1>
          <button onClick={() => setActiveStudentExamId(null)} style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', cursor: 'pointer' }}>İçerik Listesine Dön</button>
        </header>

        {showResults ? (
          <div>
            <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px', maxWidth: '700px', margin: '0 auto 24px auto', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
              <h2 style={{ textAlign: 'center', marginTop: 0, color: '#0f172a' }}>🎉 Sonuçlar</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
                <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', padding: '12px', borderRadius: '8px', textAlign: 'center' }}><span style={{ fontSize: '0.75rem', color: '#166534', fontWeight: 'bold' }}>DOĞRU</span><div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#15803d' }}>{results.correct}</div></div>
                <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', padding: '12px', borderRadius: '8px', textAlign: 'center' }}><span style={{ fontSize: '0.75rem', color: '#991b1b', fontWeight: 'bold' }}>YANLIŞ</span><div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#dc2626' }}>{results.wrong}</div></div>
                <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', padding: '12px', borderRadius: '8px', textAlign: 'center' }}><span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 'bold' }}>BOŞ</span><div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#64748b' }}>{results.empty}</div></div>
                <div style={{ backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', padding: '12px', borderRadius: '8px', textAlign: 'center' }}><span style={{ fontSize: '0.75rem', color: '#1e40af', fontWeight: 'bold' }}>NET</span><div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#2563eb' }}>{results.net}</div></div>
              </div>
            </div>
          </div>
        ) : null}

        <div style={{ display: 'grid', gridTemplateColumns: (showResults && viewingSolutionQ) && activeStudentExam.solutionPdfFile ? '1fr 1fr' : '1fr 300px', gap: '24px', alignItems: 'start' }}>
          
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f1f5f9', padding: '12px 20px', borderRadius: '8px', fontWeight: '600', marginBottom: '12px' }}>
              <span>Soru {studentCurrentPage} / {activeStudentExam.numPages}</span>
              {!showResults && (
                <div style={{ 
                  backgroundColor: isDeneme && timeLeft < 300 ? '#fef2f2' : '#ffffff', 
                  color: isDeneme && timeLeft < 300 ? '#dc2626' : '#0f172a', 
                  padding: '6px 14px', 
                  borderRadius: '6px', 
                  border: isDeneme && timeLeft < 300 ? '1px solid #fca5a5' : '1px solid #cbd5e1', 
                  fontSize: '1rem' 
                }}>
                  {isDeneme ? `⏱️ Kalan Süre: ` : `⏳ Geçen Süre (Kronometre): `}
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

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px' }}>
              <button disabled={studentCurrentPage <= 1} onClick={() => { setStudentCurrentPage(p => p - 1); setViewingSolutionQ(false); }} style={{ padding: '10px 24px', borderRadius: '6px', border: 'none', backgroundColor: studentCurrentPage <= 1 ? '#e2e8f0' : '#475569', color: studentCurrentPage <= 1 ? '#94a3b8' : '#ffffff', fontWeight: 'bold', cursor: studentCurrentPage <= 1 ? 'not-allowed' : 'pointer' }}>◀ Önceki Soru</button>
              <button disabled={studentCurrentPage >= activeStudentExam.numPages} onClick={() => { setStudentCurrentPage(p => p + 1); setViewingSolutionQ(false); }} style={{ padding: '10px 24px', borderRadius: '6px', border: 'none', backgroundColor: studentCurrentPage >= activeStudentExam.numPages ? '#e2e8f0' : '#2563eb', color: studentCurrentPage >= activeStudentExam.numPages ? '#94a3b8' : '#ffffff', fontWeight: 'bold', cursor: studentCurrentPage >= activeStudentExam.numPages ? 'not-allowed' : 'pointer' }}>Sonraki Soru ▶</button>
            </div>
          </div>

          {(showResults && viewingSolutionQ) && activeStudentExam.solutionPdfFile ? (
            <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '12px', padding: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#dcfce7', padding: '12px 20px', borderRadius: '8px', fontWeight: '600', marginBottom: '12px', color: '#166534' }}>
                <span>💡 {studentCurrentPage}. Soru Açıklamalı Çözümü</span>
                <button onClick={() => setViewingSolutionQ(false)} style={{ padding: '4px 10px', borderRadius: '4px', border: 'none', backgroundColor: '#166534', color: '#fff', cursor: 'pointer', fontSize: '0.8rem' }}>Kapat</button>
              </div>
              <PdfViewer file={activeStudentExam.solutionPdfFile} pageNumber={studentCurrentPage} />
            </div>
          ) : (
            <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', position: 'sticky', top: '20px' }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: '1.1rem', color: '#0f172a', textAlign: 'center' }}>Soru Paleti</h3>
              
              {!showResults ? (
                <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: '16px', padding: '8px', backgroundColor: '#ffffff', borderRadius: '6px', border: '1px solid #f1f5f9', fontSize: '0.85rem' }}>
                  <span style={{ color: '#16a34a', fontWeight: 'bold' }}>● Çözüldü: {answeredCount}</span>
                  <span style={{ color: '#64748b', fontWeight: 'bold' }}>○ Boş: {emptyCount}</span>
                </div>
              ) : null}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px', maxHeight: '340px', overflowY: 'auto', paddingRight: '4px', marginBottom: '16px' }}>
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
                    <button key={qNum} onClick={() => { setStudentCurrentPage(qNum); setViewingSolutionQ(false); }} style={{ height: '38px', borderRadius: '6px', border: btnBorder, backgroundColor: btnBg, color: btnColor, fontWeight: 'bold', fontSize: '0.9rem', cursor: 'pointer' }}>
                      {qNum}
                    </button>
                  );
                })}
              </div>

              {showResults && activeStudentExam.solutionPdfFile && (
                <button onClick={() => setViewingSolutionQ(true)} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: 'none', backgroundColor: '#16a34a', color: '#ffffff', fontWeight: 'bold', fontSize: '0.95rem', cursor: 'pointer', marginBottom: '12px' }}>
                  💡 {studentCurrentPage}. Sorunun Çözümünü Gör
                </button>
              )}

              {!isExamFinished && (
                <button onClick={finishExam} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: 'none', backgroundColor: '#dc2626', color: '#ffffff', fontWeight: 'bold', fontSize: '0.95rem', cursor: 'pointer' }}>
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

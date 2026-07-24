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
  
  // ÖĞRENCİ ÇÖZÜM İNCELEME MODU & SONUÇLARI
  const [viewingSolutionQ, setViewingSolutionQ] = useState(false);
  const [studentResultsMap, setStudentResultsMap] = useState({});

  // OTURUM KONTROLÜ
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
        pdfFile: item.pdf_file,
        solutionPdfFile: item.solution_pdf_file,
        answerKey: item.answer_key || {},
        isPublished: item.is_published,
        numPages: item.num_pages || 0
      }));
      setExams(formattedExams);
    }

    // Eğer kullanıcı öğrenci ise, daha önce çözdüğü sınavları çekelim
    if (currentUser && currentUser.email !== 'admin@yayinevi.com') {
      const { data: resultsData, error: resError } = await supabase
        .from('student_exams')
        .select('*')
        .eq('student_email', currentUser.email);

      if (!resError && resultsData) {
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

  // GİRİŞ / KAYIT / ŞİFRE SIFIRLAMA İŞLEMLERİ
  const handleAuth = async (e) => {
    e.preventDefault();
    
    if (authMode === 'register' && password.length < 6) {
      alert("Şifre en az 6 haneli olmalıdır.");
      return;
    }

    setAuthLoading(true);

    if (authMode === 'register') {
      const { data, error } = await supabase.auth.signUp({ email, password });
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
  };

  const updateExamInDb = async (id, updates) => {
    setExams((prev) => prev.map(ex => ex.id === id ? { ...ex, ...updates } : ex));

    const dbUpdates = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.duration !== undefined) dbUpdates.duration = updates.duration;
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
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            saveAndFinishExam();
            alert("Süre doldu! Sınavınız otomatik olarak tamamlanmıştır.");
            return 0;
          }
          return prev - 1;
        });
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
      const reader = new FileReader();
      reader.onload = async (uploadEvent) => {
        const base64Pdf = uploadEvent.target.result;
        
        const newExamData = {
          name: file.name.replace('.pdf', ''),
          duration: 60,
          pdf_file: base64Pdf,
          solution_pdf_file: null,
          answer_key: {},
          is_published: false,
          num_pages: 0
        };

        const { data, error } = await supabase
          .from('exams')
          .insert([newExamData])
          .select();

        if (error) {
          console.error("Sınav yüklenemedi:", error);
          alert("Sınav yüklenirken hata oluştu.");
        } else if (data && data.length > 0) {
          const inserted = data[0];
          const formatted = {
            id: inserted.id,
            name: inserted.name,
            duration: inserted.duration,
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
      reader.readAsDataURL(file);
    }
  };

  const handleSolutionUpload = (e) => {
    const file = e.target.files[0];
    if (file && activeAdminExamId) {
      const reader = new FileReader();
      reader.onload = async (uploadEvent) => {
        const base64Solution = uploadEvent.target.result;
        await updateExamInDb(activeAdminExamId, { solutionPdfFile: base64Solution });
      };
      reader.readAsDataURL(file);
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
    if (window.confirm("Bu sınavı silmek istediğinize emin misiniz?")) {
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
    setTimeLeft(exam.duration * 60);
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
      console.error("Sınav sonucu kaydedilemedi:", error);
    } else {
      setStudentResultsMap(prev => ({
        ...prev,
        [activeStudentExamId]: { is_finished: true, ...results, answers: studentAnswers }
      }));
    }
  };

  const finishExam = () => {
    if (window.confirm("Sınavı bitirmek istediğinize emin misiniz?")) {
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

        {!adminActiveExam ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0 }}>Tüm Sınavlar</h2>
              <label style={{ padding: '10px 20px', backgroundColor: '#2563eb', color: '#fff', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
                + Yeni Sınav Yükle (PDF)
                <input type="file" accept="application/pdf" onChange={handleFileUpload} style={{ display: 'none' }} />
              </label>
            </div>

            {exams.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px', backgroundColor: '#f8fafc', borderRadius: '12px', border: '1px dashed #cbd5e1' }}>
                <p style={{ color: '#64748b' }}>Henüz sisteme yüklenmiş bir sınav yok.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '16px' }}>
                {exams.map(exam => (
                  <div key={exam.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                    <div>
                      <h3 style={{ margin: '0 0 8px 0' }}>{exam.name}</h3>
                      <div style={{ display: 'flex', gap: '12px', fontSize: '0.85rem', color: '#64748b' }}>
                        <span>⏱ {exam.duration} Dk.</span>
                        <span>📄 {exam.numPages || '?'} Soru</span>
                        <span>💡 Çözüm PDF: {exam.solutionPdfFile ? '✅ Yüklendi' : '❌ Yüklenmedi'}</span>
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
              <h3 style={{ margin: '0 0 16px 0', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>Sınav Ayarları</h3>
              
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '4px' }}>Sınav Adı:</label>
                <input type="text" value={adminActiveExam.name} onChange={(e) => updateExamInDb(adminActiveExam.id, { name: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '4px' }}>Süre (Dakika):</label>
                <input type="number" value={adminActiveExam.duration} onChange={(e) => updateExamInDb(adminActiveExam.id, { duration: Number(e.target.value) })} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
              </div>

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
  // RENDER: ÖĞRENCİ EKRANI
  // ==========================================
  if (appMode === 'student') {
    if (!activeStudentExamId) {
      const publishedExams = exams.filter(e => e.isPublished);
      return (
        <div style={{ fontFamily: 'Inter, system-ui, sans-serif', maxWidth: '800px', margin: '0 auto', padding: '20px', color: '#1e293b' }}>
           <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #e2e8f0', paddingBottom: '12px', marginBottom: '30px' }}>
            <h1 style={{ margin: 0, fontSize: '1.4rem', color: '#1e40af' }}>🎓 Sınav Seçim Ekranı ({user.email})</h1>
            <button onClick={handleLogout} style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', cursor: 'pointer', color: '#dc2626', fontWeight: 'bold' }}>Çıkış Yap</button>
          </header>

          <h2 style={{ color: '#334155', marginBottom: '20px' }}>Aktif Sınavlar</h2>
          {publishedExams.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', backgroundColor: '#f8fafc', borderRadius: '12px', border: '1px dashed #cbd5e1', color: '#64748b' }}>
              Şu an yayında olan aktif bir sınav bulunmamaktadır.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '16px' }}>
              {publishedExams.map(exam => {
                const resData = studentResultsMap[exam.id];
                const isCompleted = resData?.is_finished;
                return (
                  <div key={exam.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px', backgroundColor: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
                    <div>
                      <h3 style={{ margin: '0 0 8px 0', color: '#0f172a' }}>
                        {exam.name} {isCompleted && <span style={{ color: '#16a34a', fontSize: '0.85rem', marginLeft: '8px' }}>(✅ Çözüldü - Net: {resData.net})</span>}
                      </h3>
                      <div style={{ display: 'flex', gap: '16px', fontSize: '0.9rem', color: '#64748b' }}>
                        <span>⏱ {exam.duration} Dakika</span>
                        <span>📝 {exam.numPages} Soru</span>
                        {exam.solutionPdfFile && <span style={{ color: '#2563eb', fontWeight: 'bold' }}>💡 Çözümlü</span>}
                      </div>
                    </div>
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
                      style={{ padding: '12px 24px', borderRadius: '8px', border: 'none', backgroundColor: isCompleted ? '#475569' : '#2563eb', color: '#fff', fontWeight: 'bold', fontSize: '1rem', cursor: 'pointer' }}
                    >
                      {isCompleted ? 'Sonuçları İncele 📊' : 'Sınava Başla ▶'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    const answeredCount = Object.keys(studentAnswers).length;
    const emptyCount = activeStudentExam.numPages - answeredCount;
    const results = showResults ? (studentResultsMap[activeStudentExamId] || calculateResults()) : null;

    return (
      <div style={{ fontFamily: 'Inter, system-ui, sans-serif', maxWidth: '1200px', margin: '0 auto', padding: '20px', color: '#1e293b' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #e2e8f0', paddingBottom: '12px', marginBottom: '20px' }}>
          <h1 style={{ margin: 0, fontSize: '1.4rem', color: '#0f172a' }}>{activeStudentExam.name}</h1>
          <button onClick={() => setActiveStudentExamId(null)} style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', cursor: 'pointer' }}>Sınav Listesine Dön</button>
        </header>

        {showResults ? (
          <div>
            <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px', maxWidth: '700px', margin: '0 auto 24px auto', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
              <h2 style={{ textAlign: 'center', marginTop: 0, color: '#0f172a' }}>🎉 Sınav Sonucu</h2>
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
                <div style={{ backgroundColor: timeLeft < 300 ? '#fef2f2' : '#ffffff', color: timeLeft < 300 ? '#dc2626' : '#0f172a', padding: '6px 14px', borderRadius: '6px', border: timeLeft < 300 ? '1px solid #fca5a5' : '1px solid #cbd5e1', fontSize: '1rem' }}>
                  ⏱️ Kalan Süre: <strong>{formatTime(timeLeft)}</strong>
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
                  Sınavı Bitir 🏁
                </button>
              )}
            </div>
          )}

        </div>
      </div>
    );
  }
}

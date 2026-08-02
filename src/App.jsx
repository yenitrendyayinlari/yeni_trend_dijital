import { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
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
    numPages: 0
  });

  const [activeStudentExamId, setActiveStudentExamId] = useState(null);
  const [inspectingExamId, setInspectingExamId] = useState(null);

  const [studentCurrentPage, setStudentCurrentPage] = useState(1);
  const [studentAnswers, setStudentAnswers] = useState({});
  const [timeLeft, setTimeLeft] = useState(0); 
  const [isExamFinished, setIsExamFinished] = useState(false);
  const [showResults, setShowResults] = useState(false);
  
  const [viewingSolutionQ, setViewingSolutionQ] = useState(false);
  const solutionRef = useRef(null);
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

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    // exams listesi (parent/child id eşleşmesi için) yüklendikten sonra puanları hesapla.
    if (exams.length > 0) {
      fetchAllRatings();
    }
  }, [exams.length]);

  useEffect(() => {
    if (viewingSolutionQ && solutionRef.current) {
      solutionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [viewingSolutionQ]);

  const fetchAllRatings = async () => {
    const { data, error } = await supabase
      .from('student_exams')
      .select('exam_id, rating')
      .gt('rating', 0);

    if (!error && data) {
      const map = {};
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
    parentId: item.parent_id || null,
    sortOrder: item.sort_order ?? 0,
    topicMap: item.topic_map || {}
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

  const handleGoogleSignIn = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    });
    if (error) {
      alert("Google ile giriş başlatılamadı: " + error.message);
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
  }, [user, appMode, activeStudentExam, isExamFinished, showResults]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
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
      numPages: 0
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
        originalPrice: Number(newExamForm.originalPrice) || 0
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
      sections: []
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

  const handleOpenDefinitionScreen = (examId) => {
    setActiveAdminExamId(examId);
    setActiveSubExamId(null);
    setIsCreatingExam(false);
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
      numPages: exam.numPages || 0
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

      const { data: publicURLData } = supabase.storage
        .from('exam-files')
        .getPublicUrl(fileName);

      setAuthLoading(false);
      await updateExamInDb(examId, { pdfFile: publicURLData.publicUrl });
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

        const { data: publicURLData } = supabase.storage
          .from('exam-files')
          .getPublicUrl(fileName);

        setAuthLoading(false);
        await updateExamInDb(examId, { solutionPdfFile: publicURLData.publicUrl });
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
    updateExamInDb(examId, { answerKey: newKey });
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
      answer_key: {},
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
      alert("Ödeme yapabilmek ve sınava katılabilmek için lütfen giriş yapın.");
      setAuthMode('login');
      setShowAuthModal(true);
      return;
    }

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

  const getKazanimReport = () => {
    if (!activeStudentExam || !activeStudentExam.topicMap || Object.keys(activeStudentExam.topicMap).length === 0) {
      return null;
    }
    const numP = activeStudentExam.numPages;
    const byDers = {};

    for (let i = 1; i <= numP; i++) {
      const studentAns = studentAnswers[i];
      const correctAns = activeStudentExam.answerKey[i];
      const isWrongOrEmpty = !studentAns || (correctAns && studentAns !== correctAns);
      if (!isWrongOrEmpty) continue;

      const topic = activeStudentExam.topicMap[i];
      if (!topic || !topic.ders || !topic.kazanim) continue;

      if (!byDers[topic.ders]) byDers[topic.ders] = {};
      if (!byDers[topic.ders][topic.kazanim]) byDers[topic.ders][topic.kazanim] = 0;
      byDers[topic.ders][topic.kazanim]++;
    }

    const hasData = Object.keys(byDers).length > 0;
    return { byDers, hasData };
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
    const childExams = adminActiveExam ? exams.filter(e => e.parentId === adminActiveExam.id).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)) : [];
    
    const currentPreviewExam = childExams.length > 0 
      ? (childExams.find(e => e.id === activeSubExamId) || childExams[0]) 
      : adminActiveExam;

    return (
      <div style={{ fontFamily: "'Roboto', 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif", letterSpacing: '-0.01em', maxWidth: '1200px', margin: '0 auto', padding: '20px', color: '#1e293b' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #e2e8f0', paddingBottom: '12px', marginBottom: '20px' }}>
          <h1 style={{ margin: 0, fontSize: '1.4rem', color: '#0f172a' }}>⚙️ Yönetici Paneli ({user.email})</h1>
          <button onClick={handleLogout} style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', cursor: 'pointer', color: '#dc2626', fontWeight: 'bold' }}>Çıkış Yap</button>
        </header>

        {authLoading && (
          <div style={{ textAlign: 'center', padding: '10px', backgroundColor: '#eff6ff', color: '#1e40af', marginBottom: '16px', borderRadius: '6px', fontWeight: 'bold' }}>
            ⏳ İşlem yapılıyor, lütfen bekleyin...
          </div>
        )}

        {!adminActiveExam && !isCreatingExam ? (
          <div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0 }}>Tüm Sınavlar ve Paketler</h2>
              <button onClick={handleStartCreateExam} style={{ padding: '10px 20px', backgroundColor: '#2563eb', color: '#fff', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', border: 'none' }}>
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
                style={{ flex: 1, padding: '12px', fontSize: '0.95rem', fontWeight: 'bold', color: '#ffffff', backgroundColor: '#2563eb', borderRadius: '6px', border: 'none', cursor: 'pointer' }}
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
          <div style={{ display: 'grid', gridTemplateColumns: currentPreviewExam?.pdfFile ? '1fr 380px' : '1fr', gap: '24px', alignItems: 'start' }}>
            {currentPreviewExam?.pdfFile && (
              <div style={{ backgroundColor: '#f1f5f9', padding: '16px', borderRadius: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '12px' }}>
                  <strong>Toplam Soru Sayısı/Sayfa: {currentPreviewExam.numPages || '0'}</strong>
                </div>
                <PdfViewer 
                  file={currentPreviewExam.pdfFile} 
                  pageNumber={1} 
                />
              </div>
            )}

            {/* Sağ Panel - İçerik ve PDF Tanımlama Ayarları */}
            <div className="sidebar-content-settings" style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', position: 'sticky', top: '20px', maxHeight: '85vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
                <h3 style={{ margin: 0 }}>İçerik Ayarları</h3>
              </div>
              
              {activeSubExamId && childExams.find(e => e.id === activeSubExamId) ? (
                (() => {
                  const editingExam = childExams.find(e => e.id === activeSubExamId);
                  const editingIndex = childExams.findIndex(e => e.id === activeSubExamId);
                  return (
                    <div style={{ marginBottom: '16px' }}>
                      <button
                        type="button"
                        onClick={() => setActiveSubExamId(null)}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', fontSize: '0.85rem', fontWeight: 'bold', color: '#2563eb', backgroundColor: '#eff6ff', borderRadius: '6px', border: '1px solid #bfdbfe', cursor: 'pointer', marginBottom: '16px' }}
                      >
                        ◀ Test Listesine Dön
                      </button>

                      <div style={{ padding: '14px', borderRadius: '8px', border: '2px solid #2563eb', backgroundColor: '#f8fafc' }}>
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

                        <div className="form-group" style={{ marginTop: '10px' }}>
                          <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.8rem', marginBottom: '4px' }}>📊 Kazanım Haritası (Excel):</label>
                          <input
                            type="file"
                            accept=".xlsx,.xls"
                            onChange={(e) => handleTopicMapUpload(editingExam.id, e)}
                            style={{ fontSize: '0.8rem', width: '100%' }}
                          />
                          <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '4px' }}>
                            Sütun sırası: 1. Soru No, 2. Ders, 3. Kazanım (ilk satır başlık kabul edilir).
                          </div>
                          {editingExam.topicMap && Object.keys(editingExam.topicMap).length > 0 && (
                            <div style={{ fontSize: '0.75rem', color: '#16a34a', marginTop: '4px', fontWeight: 'bold' }}>
                              ✓ {Object.keys(editingExam.topicMap).length} soru için kazanım eklendi.
                            </div>
                          )}
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
                          <span style={{ color: '#2563eb', fontWeight: 'bold', fontSize: '0.8rem' }}>Düzenle ▸</span>
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
                  style={{ width: '100%', padding: '10px', fontSize: '0.9rem', fontWeight: 'bold', color: '#2563eb', backgroundColor: '#eff6ff', borderRadius: '6px', border: '1px dashed #2563eb', cursor: 'pointer', marginBottom: '16px' }}
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
                  style={{ width: '100%', padding: '10px', fontSize: '0.9rem', fontWeight: 'bold', color: '#ffffff', backgroundColor: '#2563eb', borderRadius: '6px', border: 'none', cursor: 'pointer' }}
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
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
        <div style={{ fontFamily: "'Roboto', 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif", letterSpacing: '-0.01em', width: '100%', maxWidth: '400px', backgroundColor: '#ffffff', borderRadius: '12px', border: '1px solid #cbd5e1', padding: '30px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', color: '#1e293b', position: 'relative' }}>
          <button onClick={() => setShowAuthModal(false)} style={{ position: 'absolute', top: '15px', right: '15px', background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#64748b' }}>✕</button>

          <h2 style={{ textAlign: 'center', color: '#0f172a', marginBottom: '24px' }}>
            {authMode === 'login' && '🔑 Kullanıcı Girişi'}
            {authMode === 'register' && '📝 Yeni Hesap Oluştur'}
            {authMode === 'forgot' && '🔒 Şifremi Unuttum'}
          </h2>

          {authMode !== 'forgot' && (
            <>
              <button
                type="button"
                onClick={handleGoogleSignIn}
                style={{ width: '100%', padding: '11px', backgroundColor: '#ffffff', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '6px', fontWeight: '600', fontSize: '0.9rem', cursor: 'pointer', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
              >
                <span style={{ fontSize: '1.1rem' }}>G</span> Google ile Devam Et
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                <div style={{ flex: 1, height: '1px', backgroundColor: '#e2e8f0' }}></div>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>veya</span>
                <div style={{ flex: 1, height: '1px', backgroundColor: '#e2e8f0' }}></div>
              </div>
            </>
          )}

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
    );
  };

  if (inspectingExamId) {
      const inspectExam = exams.find(e => e.id === inspectingExamId);
      if (!inspectExam) return null;

      const childExams = exams.filter(e => e.parentId === inspectingExamId);
      const ratingInfo = examRatingsMap[inspectExam.id] || { average: '0,0', count: '0' };
      const isPaid = inspectExam.price && inspectExam.price > 0;
      const isPurchased = studentPurchases[inspectExam.id];
      const resData = studentResultsMap[inspectExam.id];
      const isCompleted = resData?.is_finished;

      return (
        <div className="yt-shell">
          <header className="yt-header">
            <div className="yt-header-inner">
              <button onClick={() => setInspectingExamId(null)} className="yt-btn yt-btn-ghost">
                ◀ Tüm Listeye Dön
              </button>
              <div style={{ flex: 1, fontFamily: 'var(--yt-font-display)', fontWeight: '600', fontSize: '1.05rem', color: 'var(--yt-ink)' }}>İçerik Detayları</div>
              {user ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'var(--yt-paper)', padding: '6px 12px', borderRadius: '20px', border: '1px solid var(--yt-line)' }}>
                  <span style={{ width: '8px', height: '8px', backgroundColor: 'var(--yt-correct)', borderRadius: '50%' }}></span>
                  <span style={{ fontSize: '0.85rem', fontWeight: '500', color: 'var(--yt-ink)' }}>{user.email}</span>
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

              <div className="yt-rating" style={{ marginBottom: '24px', fontSize: '0.85rem' }}>
                <span className="stars">
                  {'★'.repeat(Math.round(Number(ratingInfo.average.replace(',', '.')))).padEnd(5, '☆')}
                </span>
                {ratingInfo.average} <span className="count">({ratingInfo.count} değerlendirme)</span>
              </div>

              <div style={{ marginBottom: '24px' }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '0.95rem' }}>Sınav Bilgileri ve Testler</h3>

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

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1.5px solid var(--yt-line)', paddingTop: '20px', flexWrap: 'wrap', gap: '16px' }}>
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
                )}

                {childExams.length === 0 && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--yt-graphite-soft)', fontStyle: 'italic' }}>
                    Test eklendiğinde burada &quot;Teste Başla&quot; seçeneği görünecek.
                  </div>
                )}
              </div>

            </div>
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
        <div className="yt-shell">

          <header className="yt-header">
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
                {user ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'var(--yt-paper)', padding: '6px 12px', borderRadius: '20px', border: '1px solid var(--yt-line)' }}>
                      <span style={{ width: '8px', height: '8px', backgroundColor: 'var(--yt-correct)', borderRadius: '50%' }}></span>
                      <span style={{ fontSize: '0.85rem', fontWeight: '500', color: 'var(--yt-ink)' }}>{user.email}</span>
                    </div>
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
            <div className="yt-perf"></div>
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
            {publishedExams.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', backgroundColor: 'var(--yt-paper-2)', borderRadius: '12px', border: '1.5px dashed var(--yt-line)' }}>
                <h3 style={{ margin: '0 0 6px 0', color: 'var(--yt-ink)', fontSize: '1.1rem' }}>Aktif İçerik Bulunmuyor</h3>
                <p style={{ margin: 0, color: 'var(--yt-graphite)', fontSize: '0.9rem' }}>Seçilen kriterlere uygun aktif bir sınav veya paket bulunmamaktadır.</p>
              </div>
            ) : (
              <div className="yt-row-list">
                {publishedExams.map(exam => {
                  const resData = studentResultsMap[exam.id];
                  const isCompleted = resData?.is_finished;
                  const isDeneme = exam.examType === 'deneme';
                  const ratingInfo = examRatingsMap[exam.id] || { average: '0,0', count: '0' };
                  const isPaid = exam.price && exam.price > 0;
                  const bubbleLabel = isCompleted ? '✓' : (isDeneme ? 'D' : 'T');

                  return (
                    <div
                      key={exam.id}
                      onClick={() => setInspectingExamId(exam.id)}
                      className="yt-exam-row"
                    >
                      <div className={`yt-bubble-mark${isCompleted ? ' done' : ''}`}>{bubbleLabel}</div>

                      <div style={{ flex: 1, minWidth: 0 }}>

                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
                          <span className="yt-tag">{exam.categoryExamType} · {exam.categoryLesson}</span>
                          <span className={`yt-tag ${isDeneme ? 'deneme' : 'test'}`}>
                            {isDeneme ? 'Deneme Sınavı' : 'Test'}
                          </span>
                          {user && isCompleted ? (
                            <span className="yt-tag done">Çözüldü</span>
                          ) : null}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '8px' }}>
                          <h3 style={{ margin: 0, fontSize: '1.08rem' }}>{exam.name || 'İsimsiz İçerik'}</h3>
                          <div className="yt-rating">
                            <span className="stars">
                              {'★'.repeat(Math.round(Number(ratingInfo.average.replace(',', '.')))).padEnd(5, '☆')}
                            </span>
                            {ratingInfo.average} <span className="count">({ratingInfo.count})</span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '16px', fontFamily: 'var(--yt-font-mono)', fontSize: '0.78rem', color: 'var(--yt-graphite)', marginBottom: '12px' }}>
                          {isDeneme && <span>⏱ {exam.duration} DK</span>}
                          <span>{exam.numPages || 0} SORU</span>
                        </div>

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

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setInspectingExamId(exam.id);
                            }}
                            className="yt-btn yt-btn-outline"
                          >
                            {isCompleted ? 'Sonucu İncele →' : 'İçeriği İncele →'}
                          </button>
                        </div>

                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </main>

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
      <div style={{ fontFamily: "'Roboto', 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif", letterSpacing: '-0.01em', maxWidth: '1400px', margin: '0 auto', padding: '20px', color: '#1e293b' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #e2e8f0', paddingBottom: '12px', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
          <h1 style={{ margin: 0, fontSize: '1.4rem', color: '#0f172a' }}>{activeStudentExam.name || 'İsimsiz İçerik'}</h1>
          <button onClick={() => setActiveStudentExamId(null)} style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', cursor: 'pointer' }}>İçerik Listesine Dön</button>
        </header>

        {showResults && results ? (
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

            {kazanimReport && kazanimReport.hasData && (
              <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #e2e8f0' }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '1.05rem', color: '#0f172a' }}>📊 Kazanım Analizi</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {Object.entries(kazanimReport.byDers).map(([ders, kazanimlar]) => (
                    <div key={ders} style={{ backgroundColor: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px', padding: '14px' }}>
                      <div style={{ fontWeight: 'bold', color: '#9a3412', fontSize: '0.9rem', marginBottom: '8px' }}>
                        {ders} dersinde şu konularda eksiğin var:
                      </div>
                      <ul style={{ margin: 0, paddingLeft: '20px' }}>
                        {Object.entries(kazanimlar).map(([kazanim, count]) => (
                          <li key={kazanim} style={{ fontSize: '0.85rem', color: '#7c2d12', marginBottom: '4px' }}>
                            {kazanim} <span style={{ color: '#c2410c', fontWeight: 'bold' }}>({count} soru)</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f1f5f9', padding: '12px 20px', borderRadius: '8px', fontWeight: '600', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
              <span>
                {(() => {
                  const secs = activeStudentExam.sections || [];
                  const sec = secs.find(s => studentCurrentPage >= s.start && studentCurrentPage <= s.end);
                  if (sec) {
                    return `${sec.name} - Soru ${studentCurrentPage - sec.start + 1} / ${sec.end - sec.start + 1}`;
                  }
                  return `Soru ${studentCurrentPage} / ${activeStudentExam.numPages}`;
                })()}
              </span>
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
            />

            {!isExamFinished && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', margin: '20px 0' }}>
                {['A', 'B', 'C', 'D', 'E'].map(option => {
                  const isSelected = studentAnswers[studentCurrentPage] === option;
                  return (
                    <button key={option} onClick={() => handleAnswerSelect(option)} style={{ width: '30px', height: '30px', borderRadius: '50%', border: isSelected ? '2px solid #16a34a' : '2px solid #94a3b8', backgroundColor: isSelected ? '#16a34a' : '#ffffff', color: isSelected ? '#ffffff' : '#334155', fontSize: '0.85rem', fontWeight: 'bold', cursor: 'pointer' }}>
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

          <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px' }}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '1rem', color: '#0f172a', textAlign: 'center' }}>Soru Paleti</h3>
            
            {!showResults ? (
              <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: '12px', padding: '6px', backgroundColor: '#ffffff', borderRadius: '6px', border: '1px solid #f1f5f9', fontSize: '0.75rem' }}>
                <span style={{ color: '#16a34a', fontWeight: 'bold' }}>● Çözüldü: {answeredCount}</span>
                <span style={{ color: '#64748b', fontWeight: 'bold' }}>○ Boş: {emptyCount}</span>
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
                      <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#475569', marginBottom: '4px', paddingLeft: '2px' }}>
                        {sec.name}
                      </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px' }}>
                      {Array.from({ length: sec.end - sec.start + 1 }, (_, i) => {
                        const qNum = sec.start + i;
                        const localNum = i + 1;
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
                          <button key={qNum} onClick={() => { setStudentCurrentPage(qNum); setViewingSolutionQ(false); }} style={{ height: '26px', borderRadius: '4px', border: btnBorder, backgroundColor: btnBg, color: btnColor, fontWeight: 'bold', fontSize: '0.7rem', cursor: 'pointer', padding: 0 }}>
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
              <button onClick={() => setViewingSolutionQ(v => !v)} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: 'none', backgroundColor: viewingSolutionQ ? '#166534' : '#16a34a', color: '#ffffff', fontWeight: 'bold', fontSize: '0.85rem', cursor: 'pointer', marginBottom: '10px' }}>
                {viewingSolutionQ ? '✕ Çözümü Gizle' : `💡 ${studentCurrentPage}. Çözümü Gör`}
              </button>
            )}

            {!isExamFinished && (
              <button onClick={finishExam} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: 'none', backgroundColor: '#dc2626', color: '#ffffff', fontWeight: 'bold', fontSize: '0.85rem', cursor: 'pointer' }}>
                {isDeneme ? 'Sınavı Bitir 🏁' : 'Testi Bitir 🏁'}
              </button>
            )}
          </div>

        </div>

        {(showResults && viewingSolutionQ) && activeStudentExam.solutionPdfFile && (
          <div ref={solutionRef} style={{ marginTop: '20px', backgroundColor: '#f0fdf4', border: '2px solid #16a34a', borderRadius: '12px', padding: '14px', boxShadow: '0 4px 14px rgba(22,163,74,0.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#16a34a', padding: '10px 14px', borderRadius: '8px', fontWeight: '600', marginBottom: '12px', color: '#ffffff', fontSize: '0.9rem' }}>
              <span>💡 {studentCurrentPage}. Soru Çözümü Aşağıda 👇</span>
              <button onClick={() => setViewingSolutionQ(false)} style={{ padding: '4px 10px', borderRadius: '4px', border: 'none', backgroundColor: '#166534', color: '#fff', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold' }}>Kapat</button>
            </div>
            <PdfViewer file={activeStudentExam.solutionPdfFile} pageNumber={studentCurrentPage} />
          </div>
        )}
      </div>
    );
  }

  return null;
}
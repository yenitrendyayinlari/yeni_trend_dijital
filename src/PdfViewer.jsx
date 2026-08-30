import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// Kararlı cdn worker kullanımı
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export default function PdfViewer({ file, pageNumber, onDocumentLoadSuccess }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const loadingTaskRef = useRef(null);
  const pdfDocRef = useRef(null);
  const resizeTimeoutRef = useRef(null);

  // Konteynerin GERÇEK genişliğini izliyoruz -- eskiden sayfa sabit
  // scale:1.5 ile çiziliyordu, bu yüzden konteyner daha genişse bile
  // canvas büyümüyor, sadece maxWidth:100% sayesinde küçülebiliyordu.
  // Artık telefon yatay çevrildiğinde ya da masaüstünde pencere/sütun
  // genişlediğinde soru kutusu da orantılı olarak büyüyecek.
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      // Hızlı ardışık resize olaylarında (örn. döndürme animasyonu
      // sırasında) gereksiz tekrar render'ı önlemek için hafif bir
      // debounce uyguluyoruz.
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
      resizeTimeoutRef.current = setTimeout(() => {
        setContainerWidth(entry.contentRect.width);
      }, 80);
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
    };
  }, []);

  // Bir konteyner genişliği "gerçekçi" mi, yoksa tarayıcı henüz grid/sütun
  // yerleşimini oturtmadan mı ölçülmüş, onu ayırt etmek için bir alt sınır.
  // Gerçek bir soru kutusu bundan asla dar olmaz; bu değerin altı, ilk
  // açılışta (component daha yeni yerleşmişken) yakalanmış hatalı bir
  // ölçüm olduğuna işaret eder.
  const MIN_SANE_WIDTH = 150;

  const renderPage = async (attemptsLeft = 6) => {
    const pdfDoc = pdfDocRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!pdfDoc || !canvas || !container) return;

    // Tarayıcı henüz sayfayı tam yerleştirmediyse (özellikle İLK açılışta),
    // container.clientWidth olması gerekenden çok daha küçük bir değer
    // döndürebiliyor -- bu da PDF'in minicik ve bulanık görünmesine yol
    // açıyordu. Böyle mantıksız bir ölçüm yakalarsak, hemen o küçük
    // boyutla çizmek yerine kısa bir gecikmeyle tekrar ölçüyoruz; tarayıcı
    // birkaç deneme içinde (toplam ~250ms) mutlaka yerleşimini tamamlar.
    if (container.clientWidth < MIN_SANE_WIDTH && attemptsLeft > 0) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return renderPage(attemptsLeft - 1);
    }

    try {
      const page = await pdfDoc.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });

      // İç dolgu (padding) payını düşüp gerçek kullanılabilir genişliği
      // hesaplıyoruz (bkz. aşağıdaki dış div'in padding değeri).
      const availableWidth = Math.max((container.clientWidth || baseViewport.width) - 20, 100);
      const displayScale = availableWidth / baseViewport.width;

      // Retina/yüksek çözünürlüklü ekranlarda net görünmesi için canvas'ın
      // GERÇEK piksel çözünürlüğünü devicePixelRatio ile çarpıyoruz, ama
      // CSS ile GÖSTERİLEN boyutunu konteyner genişliğinde sabit tutuyoruz.
      const pixelRatio = window.devicePixelRatio || 1;
      const renderViewport = page.getViewport({ scale: displayScale * pixelRatio });

      canvas.width = renderViewport.width;
      canvas.height = renderViewport.height;
      canvas.style.width = `${baseViewport.width * displayScale}px`;
      canvas.style.height = `${baseViewport.height * displayScale}px`;

      const context = canvas.getContext('2d');
      await page.render({
        canvasContext: context,
        viewport: renderViewport
      }).promise;
    } catch (err) {
      if (err.name !== 'RenderingCancelledException' && err.message !== 'Worker was destroyed') {
        console.error('PDF sayfa render hatası:', err);
      }
    }
  };

  // Dosya ya da sayfa numarası değiştiğinde (soru değiştirme, sınav
  // değiştirme) -- eski davranışla aynı, PDF'i baştan yükleyip ilgili
  // sayfayı çiziyoruz.
  useEffect(() => {
    if (!file) return;
    let isMounted = true;

    const renderPdf = async () => {
      try {
        if (loadingTaskRef.current) {
          await loadingTaskRef.current.destroy();
        }

        const loadingTask = pdfjsLib.getDocument(file);
        loadingTaskRef.current = loadingTask;

        const pdfDoc = await loadingTask.promise;
        if (!isMounted) return;
        pdfDocRef.current = pdfDoc;

        if (onDocumentLoadSuccess) {
          onDocumentLoadSuccess({ numPages: pdfDoc.numPages });
        }

        await renderPage();
      } catch (err) {
        if (err.name !== 'RenderingCancelledException' && err.message !== 'Worker was destroyed') {
          console.error('PDF yükleme hatası:', err);
        }
      }
    };

    renderPdf();

    return () => {
      isMounted = false;
      if (loadingTaskRef.current) {
        loadingTaskRef.current.destroy().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, pageNumber]);

  // Konteyner genişliği değiştiğinde (telefon döndürüldüğünde, pencere
  // yeniden boyutlandırıldığında) AYNI sayfayı yeni genişliğe göre
  // yeniden çiziyoruz -- PDF'i baştan yüklemeye gerek yok, sadece
  // mevcut pdfDoc üzerinden tekrar render ediyoruz.
  useEffect(() => {
    if (!pdfDocRef.current || !containerWidth) return;
    renderPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerWidth]);

  if (!file) {
    return <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>PDF dosyası bulunamadı.</div>;
  }

  return (
    <div
      ref={containerRef}
      style={{ textAlign: 'center', overflowX: 'auto', backgroundColor: '#e2e8f0', padding: '10px', borderRadius: '8px' }}
    >
      <canvas ref={canvasRef} style={{ boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }} />
    </div>
  );
}

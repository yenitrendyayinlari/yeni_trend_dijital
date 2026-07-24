import { useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// Kararlı cdn worker kullanımı
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export default function PdfViewer({ file, pageNumber, onDocumentLoadSuccess }) {
  const canvasRef = useRef(null);
  const loadingTaskRef = useRef(null);

  useEffect(() => {
    if (!file) return;

    let isMounted = true;

    const renderPdf = async () => {
      try {
        // Eğer devam eden eski bir yükleme varsa güvenli şekilde sonlandır
        if (loadingTaskRef.current) {
          await loadingTaskRef.current.destroy();
        }

        const loadingTask = pdfjsLib.getDocument(file);
        loadingTaskRef.current = loadingTask;
        
        const pdfDoc = await loadingTask.promise;

        if (!isMounted) return;

        if (onDocumentLoadSuccess) {
          onDocumentLoadSuccess({ numPages: pdfDoc.numPages });
        }

        const page = await pdfDoc.getPage(pageNumber);
        
        if (!isMounted) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d');
        const viewport = page.getViewport({ scale: 1.5 });

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({
          canvasContext: context,
          viewport: viewport
        }).promise;

      } catch (err) {
        if (err.name !== 'RenderingCancelledException' && err.message !== 'Worker was destroyed') {
          console.error("PDF yükleme hatası:", err);
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
  }, [file, pageNumber]);

  if (!file) {
    return <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>PDF dosyası bulunamadı.</div>;
  }

  return (
    <div style={{ textAlign: 'center', overflowX: 'auto', backgroundColor: '#e2e8f0', padding: '10px', borderRadius: '8px' }}>
      <canvas ref={canvasRef} style={{ maxWidth: '100%', height: 'auto', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }} />
    </div>
  );
}

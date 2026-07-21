import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// Vercel / Canlı ortamda worker'ın güvenli yüklenmesi için cdnjs veya lokal yol tanımı
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export default function PdfViewer({ file, pageNumber = 1, onDocumentLoadSuccess }) {
  const canvasRef = useRef(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [loadingError, setLoadingError] = useState(null);

  // PDF Dokümanını Yükleme (Base64 veya URL desteği)
  useEffect(() => {
    if (!file) return;
    setLoadingError(null);

    let loadingTask;
    try {
      // Eğer Base64 formatındaysa doğrudan işleyebilmesi için atama yapıyoruz
      loadingTask = pdfjsLib.getDocument(file);
    } catch (err) {
      console.error("PDF yükleme başlatılamadı:", err);
      return;
    }

    loadingTask.promise.then(
      (loadedDoc) => {
        setPdfDoc(loadedDoc);
        if (onDocumentLoadSuccess) {
          onDocumentLoadSuccess({ numPages: loadedDoc.numPages });
        }
      },
      (error) => {
        console.error("PDF yükleme hatası:", error);
        setLoadingError(error.message);
      }
    );

    return () => {
      if (loadingTask) {
        loadingTask.destroy();
      }
    };
  }, [file]);

  // Sayfayı Canvas'a Çizdirme
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;

    let isCancelled = false;

    pdfDoc.getPage(pageNumber).then((page) => {
      if (isCancelled) return;

      const viewport = page.getViewport({ scale: 1.4 });
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const renderContext = {
        canvasContext: context,
        viewport: viewport,
      };

      page.render(renderContext);
    }).catch(err => {
      console.error("Sayfa çizdirme hatası:", err);
    });

    return () => {
      isCancelled = true;
    };
  }, [pdfDoc, pageNumber]);

  if (loadingError) {
    return <div style={{ padding: '20px', color: '#dc2626', textAlign: 'center' }}>PDF Yüklenemedi: {loadingError}</div>;
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', margin: '1rem 0', overflow: 'auto' }}>
      <canvas 
        ref={canvasRef} 
        style={{ 
          border: '1px solid #e2e8f0', 
          borderRadius: '8px', 
          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
          maxWidth: '100%',
          display: 'block'
        }} 
      />
    </div>
  );
}

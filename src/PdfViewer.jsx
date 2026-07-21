import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// Worker yapılandırması
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export default function PdfViewer({ file, pageNumber = 1, onDocumentLoadSuccess }) {
  const canvasRef = useRef(null);
  const [pdfDoc, setPdfDoc] = useState(null);

  // PDF Dokümanını Yükleme
  useEffect(() => {
    if (!file) return;

    const loadingTask = pdfjsLib.getDocument({ url: file });

    loadingTask.promise.then(
      (loadedDoc) => {
        setPdfDoc(loadedDoc);
        // Soru sayısını App.jsx'e güvenle bildiriyoruz
        if (onDocumentLoadSuccess) {
          onDocumentLoadSuccess({ numPages: loadedDoc.numPages });
        }
      },
      (error) => {
        console.error("PDF yükleme hatası:", error);
      }
    );

    return () => {
      loadingTask.destroy();
    };
  }, [file]);

  // Sayfayı Canvas'a Çizdirme
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;

    let renderTask = null;

    pdfDoc.getPage(pageNumber).then((page) => {
      const viewport = page.getViewport({ scale: 1.4 });
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const renderContext = {
        canvasContext: context,
        viewport: viewport,
      };

      renderTask = page.render(renderContext);
    });

    return () => {
      if (renderTask) {
        renderTask.cancel();
      }
    };
  }, [pdfDoc, pageNumber]);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', margin: '1rem 0' }}>
      <canvas 
        ref={canvasRef} 
        style={{ 
          border: '1px solid #e2e8f0', 
          borderRadius: '8px', 
          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
          maxWidth: '100%' 
        }} 
      />
    </div>
  );
}

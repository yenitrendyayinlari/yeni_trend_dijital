import { useEffect, useState, useRef } from 'react';
import PdfViewer from './PdfViewer';
import { supabase } from './supabase';

// PDF dosyaları artık storage'da PRIVATE olarak tutuluyor. Bu bileşen,
// gösterilecek her sınav/çözüm PDF'i için sunucudan (erişim hakkı
// doğrulandıktan sonra) kısa ömürlü bir imzalı URL ister ve onu
// PdfViewer'a iletir. Aynı examId+type için URL'i önbellekte tutarak
// sayfa değiştirmede tekrar tekrar istek atılmasını engeller.
const urlCache = {};

export default function SecurePdfViewer({ examId, type, pageNumber, onDocumentLoadSuccess }) {
  const [signedUrl, setSignedUrl] = useState(null);
  const [error, setError] = useState(null);
  const requestedKeyRef = useRef(null);

  useEffect(() => {
    if (!examId || !type) return;
    const cacheKey = `${type}:${examId}`;

    const cached = urlCache[cacheKey];
    if (cached && cached.expiresAt > Date.now()) {
      setSignedUrl(cached.url);
      setError(null);
      return;
    }

    if (requestedKeyRef.current === cacheKey) return; // zaten istek atıldı
    requestedKeyRef.current = cacheKey;

    let cancelled = false;

    const fetchUrl = async () => {
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (type !== 'exam-preview') {
          const { data: sessionData } = await supabase.auth.getSession();
          const token = sessionData?.session?.access_token;
          if (token) headers.Authorization = `Bearer ${token}`;
        }

        const resp = await fetch('/api/get-pdf-url', {
          method: 'POST',
          headers,
          body: JSON.stringify({ examId, type })
        });
        const result = await resp.json();

        if (!resp.ok) {
          if (!cancelled) setError(result.error || 'PDF yüklenemedi');
          return;
        }

        // Önizleme 15 dk, diğerleri 4 saat geçerli -- biraz payla önbellekliyoruz.
        const ttlMs = (type === 'exam-preview' ? 13 : 3.5 * 60) * 60 * 1000;
        urlCache[cacheKey] = { url: result.url, expiresAt: Date.now() + ttlMs };

        if (!cancelled) {
          setSignedUrl(result.url);
          setError(null);
        }
      } catch (err) {
        console.error('PDF URL alınamadı:', err);
        if (!cancelled) setError('PDF yüklenemedi');
      } finally {
        requestedKeyRef.current = null;
      }
    };

    fetchUrl();
    return () => { cancelled = true; };
  }, [examId, type]);

  if (error) {
    return <div style={{ textAlign: 'center', padding: '40px', color: '#dc2626' }}>{error}</div>;
  }

  if (!signedUrl) {
    return <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>Sorular yükleniyor...</div>;
  }

  return <PdfViewer file={signedUrl} pageNumber={pageNumber} onDocumentLoadSuccess={onDocumentLoadSuccess} />;
}

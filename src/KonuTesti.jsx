import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import PdfViewer from './PdfViewer';

const LETTERS = ['A', 'B', 'C', 'D', 'E'];

// Öğrenci konu testi: sorular tek tek, havuzdan sunucu seçer.
export default function KonuTesti({ title, lessonIds, topicIds, outcomeIds, round = 10, user, onNeedLogin, onClose }) {
  const ROUND = round; // bir turdaki soru sayısı (öğrenci 10/20/30 seçer)
  const [gate, setGate] = useState(false);   // misafir sınırı doldu: giriş iste
  const [q, setQ] = useState(null);          // {id,url,...}
  const [res, setRes] = useState(null);      // cevap sonucu
  const [picked, setPicked] = useState(null);
  const [showSol, setShowSol] = useState(false);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');
  const [stats, setStats] = useState(null);
  const [log, setLog] = useState([]);        // bu turda verilen cevaplar
  const [done, setDone] = useState(false);
  const seenRef = useRef([]);

  const call = async (body) => {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`; // giriş yoksa misafir
    const r = await fetch('/api/pool-test', { method: 'POST', headers, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Hata');
    return j;
  };

  const loadNext = async () => {
    setBusy(true); setErr(''); setRes(null); setPicked(null); setShowSol(false);
    try {
      const j = await call({ action: 'next', lessonIds, topicIds, outcomeIds, seen: seenRef.current });
      if (j.needLogin) { setQ(null); setGate(true); setBusy(false); return; }
      if (j.total != null) setStats(j);
      if (j.empty) { setQ(null); if (!j.total) setErr('Bu seçim için henüz soru eklenmedi.'); else setDone(true); }
      else { setQ(j); seenRef.current = [...seenRef.current, j.id]; }
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  useEffect(() => { loadNext(); /* eslint-disable-next-line */ }, []);
  // Kapıdayken giriş yapılırsa kaldığı yerden devam et
  useEffect(() => { if (gate && user) { setGate(false); loadNext(); } /* eslint-disable-next-line */ }, [user]);

  const answer = async (choice) => {
    if (res || busy || !q) return;
    setPicked(choice); setBusy(true);
    try {
      const j = await call({ action: 'answer', poolId: q.id, choice });
      setRes(j);
      setLog((l) => [...l, { id: q.id, choice, ok: j.isCorrect }]);
    } catch (e) { setErr(e.message); setPicked(null); }
    setBusy(false);
  };

  const next = () => { if (log.length >= ROUND && log.length % ROUND === 0) setDone(true); else loadNext(); };
  const okCount = log.filter((x) => x.ok).length;
  const blank = log.filter((x) => !x.choice).length;
  const wrongCount = log.length - okCount - blank;

  const css = `
    .kt-wrap { position: fixed; inset: 0; z-index: 900; background: #f6f5f1; overflow-y: auto; font-family: inherit; color: #17213a; }
    .kt-bar { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #e5e2da; padding: 12px 18px; display: flex; align-items: center; gap: 14px; z-index: 2; }
    .kt-bar b { flex: 1; font-size: 1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .kt-x { border: 1.5px solid #d9d5ca; background: #fff; border-radius: 20px; padding: 7px 16px; cursor: pointer; font-family: inherit; font-size: .9rem; }
    .kt-body { max-width: 760px; margin: 0 auto; padding: 18px 16px 60px; }
    .kt-prog { height: 6px; background: #e5e2da; border-radius: 4px; overflow: hidden; margin-bottom: 14px; }
    .kt-prog i { display: block; height: 100%; background: #0b86f6; transition: width .3s; }
    .kt-card { background: #fff; border-radius: 14px; box-shadow: 0 1px 8px rgba(27,33,56,.10); padding: 12px; }
    .kt-opts { display: flex; gap: 10px; justify-content: center; margin: 18px 0 6px; flex-wrap: wrap; }
    .kt-opt { width: 58px; height: 58px; border-radius: 50%; border: 2px solid #d9d5ca; background: #fff; font-size: 1.25rem; font-weight: 700; cursor: pointer; font-family: inherit; color: #17213a; }
    .kt-opt:hover:not(:disabled) { border-color: #17213a; }
    .kt-opt:disabled { cursor: default; }
    .kt-opt.ok { background: #16a34a; border-color: #16a34a; color: #fff; }
    .kt-opt.bad { background: #dc2626; border-color: #dc2626; color: #fff; }
    .kt-note { text-align: center; margin: 10px 0; font-weight: 600; }
    .kt-btn { padding: 12px 30px; border-radius: 26px; border: none; background: #0b86f6; color: #fff; font-weight: 700; font-size: 1rem; cursor: pointer; font-family: inherit; }
    .kt-btn.alt { background: #fff; color: #17213a; border: 1.5px solid #d9d5ca; }
    .kt-row { display: flex; gap: 10px; justify-content: center; margin-top: 14px; flex-wrap: wrap; }
    .kt-tag { display: inline-block; font-size: .78rem; padding: 3px 10px; border-radius: 12px; background: #eef2ff; color: #3b4a8a; margin-bottom: 8px; }
    .kt-sum { text-align: center; padding: 30px 10px; }
    .kt-sum .big { font-size: 3rem; font-weight: 800; }
  `;

  return (
    <div className="kt-wrap">
      <style>{css}</style>
      <div className="kt-bar">
        <b>{title}</b>
        <span style={{ color: '#6b7180', fontSize: '.9rem' }}>{log.length ? `${okCount} doğru · ${wrongCount} yanlış` : ''}</span>
        <button className="kt-x" onClick={onClose}>Çık</button>
      </div>
      <div className="kt-body">
        {gate ? (
          <div className="kt-card kt-sum">
            <div className="big">🎯</div>
            <h2 style={{ margin: '8px 0' }}>Devam etmek için giriş yap</h2>
            <p style={{ color: '#6b7180' }}>İlk soruları denedin{log.length ? ` (${okCount}/${log.length} doğru)` : ''}. Ücretsiz üye ol; çözdüğün sorular kaydedilsin, yanlışların sana tekrar gelsin.</p>
            <div className="kt-row">
              <button className="kt-btn" onClick={() => onNeedLogin && onNeedLogin('register')}>Ücretsiz üye ol</button>
              <button className="kt-btn alt" onClick={() => onNeedLogin && onNeedLogin('login')}>Giriş yap</button>
              <button className="kt-btn alt" onClick={onClose}>Çık</button>
            </div>
          </div>
        ) : done ? (
          <div className="kt-card kt-sum">
            <div className="big">{okCount}/{log.length}</div>
            <p>{okCount} doğru · {wrongCount} yanlış · {blank} boş</p>
            {stats && stats.total > 0 && <p style={{ color: '#6b7180', fontSize: '.9rem' }}>Havuzda bu seçim için {stats.total} soru var; {stats.unseen} tanesini henüz görmedin.</p>}
            <div className="kt-row">
              <button className="kt-btn" onClick={() => { setDone(false); if (log.length % ROUND === 0) setLog((l) => l); loadNext(); }}>Devam et</button>
              <button className="kt-btn alt" onClick={onClose}>Bitir</button>
            </div>
          </div>
        ) : err ? (
          <div className="kt-card" style={{ textAlign: 'center', padding: 30 }}>
            <p style={{ color: '#dc2626' }}>{err}</p>
            <div className="kt-row">{q && <button className="kt-btn alt" onClick={loadNext}>Tekrar dene</button>}<button className="kt-btn alt" onClick={onClose}>Geri dön</button></div>
          </div>
        ) : (
          <>
            <div className="kt-prog"><i style={{ width: `${((log.length % ROUND) / ROUND) * 100}%` }} /></div>
            {q && (
              <>
                <span className="kt-tag">Soru {(log.length % ROUND) + (res ? 0 : 1) + (res && log.length % ROUND === 0 ? ROUND : 0)} / {ROUND}{q.kind === 'wrong' ? ' · daha önce yanlış yaptığın' : q.kind === 'right' ? ' · tekrar' : ''}</span>
                <div className="kt-card"><PdfViewer file={q.url} pageNumber={1} /></div>
                <div className="kt-opts">
                  {LETTERS.map((L) => (
                    <button key={L} className={`kt-opt ${res && L === res.correct ? 'ok' : res && L === picked ? 'bad' : ''}`} disabled={!!res || busy} onClick={() => answer(L)}>{L}</button>
                  ))}
                </div>
                {!res && <div className="kt-row"><button className="kt-btn alt" disabled={busy} onClick={() => answer(null)}>Boş bırak</button></div>}
                {res && (
                  <>
                    <div className="kt-note" style={{ color: res.isCorrect ? '#16a34a' : '#dc2626' }}>
                      {res.isCorrect ? 'Doğru!' : picked ? `Yanlış — doğru cevap ${res.correct}` : `Boş — doğru cevap ${res.correct}`}
                    </div>
                    {showSol && res.solutionUrl && <div className="kt-card" style={{ marginBottom: 12 }}><PdfViewer file={res.solutionUrl} pageNumber={1} /></div>}
                    <div className="kt-row">
                      {res.solutionUrl && <button className="kt-btn alt" onClick={() => setShowSol((s) => !s)}>{showSol ? 'Çözümü gizle' : 'Çözümü göster'}</button>}
                      <button className="kt-btn" onClick={next}>{log.length % ROUND === 0 ? 'Sonucu gör' : 'Sonraki soru'}</button>
                    </div>
                  </>
                )}
              </>
            )}
            {!q && busy && <p style={{ textAlign: 'center', color: '#6b7180', marginTop: 60 }}>Soru hazırlanıyor…</p>}
          </>
        )}
      </div>
    </div>
  );
}

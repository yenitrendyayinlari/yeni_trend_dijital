import { useRef, useState, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Extension } from '@tiptap/core';
import { TextStyle, FontSize, FontFamily } from '@tiptap/extension-text-style';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import TextAlign from '@tiptap/extension-text-align';
import Image from '@tiptap/extension-image';
import html2canvas from 'html2canvas';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';
import { supabase } from './supabase';

// Havuz için soru + çözüm yazma / düzenleme ekranı (kelime işlemci tarzı).
// Sayfa boyutu seçilir; soru ve çözüm iki ayrı beyaz sayfa olarak doğrudan
// yazılır. Kaydedince her sayfa tek sayfalık PDF'e çevrilip eski sistemin
// kullandığı question_pool tablosuna eklenir. Yazılan içerik source_json'da
// saklanır, "Düzenle" ile aynen açılır.
const PX_PER_CM = 40; // ekranda 1 cm = 40 px (16 cm = 640 px)
const PT_PER_CM = 28.3465;
const PAD_X = 28;
const PAD_Y = 24;
const BASE_PX = 13; // varsayılan yazı boyutu
const PX_PER_PT = 1.411; // ekran px / punto
const SIZE_PRESETS = [
  { key: '16x9', label: 'Yatay 16 × 9 cm', w: 16, h: 9 },
  { key: '9x16', label: 'Dikey 9 × 16 cm', w: 9, h: 16 },
  { key: '12x9', label: 'Yatay 12 × 9 cm', w: 12, h: 9 },
  { key: '16x12', label: 'Yatay 16 × 12 cm', w: 16, h: 12 },
];
const FONT_SIZES_PT = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24];
const MM_PX = PX_PER_CM / 10; // ekranda 1 mm = 4 px
const FONTS = ['Arial', 'Times New Roman', 'Verdana', 'Georgia', 'Calibri', 'Courier New'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: 50,
        parseHTML: (el) => Number(el.getAttribute('data-w')) || 50,
        renderHTML: (attrs) => ({ 'data-w': attrs.width, style: `width:${attrs.width}%;height:auto;` }),
      },
    };
  },
}).configure({ inline: true, allowBase64: true });

// Paragraf biçimi (InDesign'daki gibi, milimetre cinsinden): sol/sağ girinti, ilk satır
// girintisi (negatif = asılı girinti), önce/sonra boşluk ve satır aralığı (punto).
const mmAttr = (name, cssProp, data) => ({
  default: null,
  parseHTML: (el) => { const v = el.getAttribute(data); return v == null ? null : Number(v); },
  renderHTML: (attrs) => (attrs[name] == null ? {} : { [data]: attrs[name], style: `${cssProp}:${(attrs[name] * MM_PX).toFixed(2)}px` }),
});
const ParaFormat = Extension.create({
  name: 'paraFormat',
  addGlobalAttributes() {
    return [{
      types: ['paragraph'],
      attributes: {
        indentLeft: mmAttr('indentLeft', 'margin-left', 'data-il'),
        indentRight: mmAttr('indentRight', 'margin-right', 'data-ir'),
        firstLine: mmAttr('firstLine', 'text-indent', 'data-fl'),
        spaceBefore: mmAttr('spaceBefore', 'margin-top', 'data-sb'),
        spaceAfter: mmAttr('spaceAfter', 'margin-bottom', 'data-sa'),
        leading: {
          default: null,
          parseHTML: (el) => { const v = el.getAttribute('data-ld'); return v == null ? null : Number(v); },
          renderHTML: (attrs) => (attrs.leading == null ? {} : { 'data-ld': attrs.leading, style: `line-height:${(attrs.leading * PX_PER_PT).toFixed(2)}px` }),
        },
      },
    }];
  },
});
// Tab tuşu: şıklardaki "A)<tab>metin" gibi sekme boşluğu bırakır (tabloda hücreler arası geçer).
const TabKey = Extension.create({
  name: 'tabKey',
  addKeyboardShortcuts() {
    return {
      Tab: () => { if (this.editor.isActive('table')) return false; return this.editor.commands.insertContent({ type: 'text', text: '\t' }); },
    };
  },
});

const baseExtensions = () => [
  StarterKit.configure({ heading: false, blockquote: false, codeBlock: false, code: false, horizontalRule: false, link: false, trailingNode: false, bulletList: false, orderedList: false, listItem: false, listKeymap: false, strike: false }),
  TextStyle, FontSize, FontFamily, ParaFormat, TabKey,
  Table.configure({ resizable: true }), TableRow, TableHeader, TableCell,
  Subscript, Superscript,
  TextAlign.configure({ types: ['paragraph'] }),
  ResizableImage,
];

// Yüklenen şekli (PNG/JPG/SVG ya da PDF/Illustrator-PDF'in ilk sayfası) PNG data URL'ine çevirir.
const fileToPngDataUrl = async (file) => {
  const MAX_W = 1100;
  const isPdf = file.type === 'application/pdf' || /\.(pdf|ai)$/i.test(file.name);
  const canvas = document.createElement('canvas');
  if (isPdf) {
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(3, MAX_W / base.width);
    const vp = page.getViewport({ scale });
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
  } else {
    const url = URL.createObjectURL(file);
    const img = await new Promise((res, rej) => { const im = new window.Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Resim okunamadı')); im.src = url; });
    const w = Math.min(MAX_W, img.naturalWidth || MAX_W);
    const h = Math.round(w * ((img.naturalHeight || w) / (img.naturalWidth || w)));
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
  }
  return trimWhiteMargins(canvas).toDataURL('image/png');
};

// Çizimin etrafındaki boş beyaz alanı otomatik kırpar (6 px pay bırakır).
const trimWhiteMargins = (canvas) => {
  const w = canvas.width, h = canvas.height;
  const { data } = canvas.getContext('2d').getImageData(0, 0, w, h);
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] > 10 && (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return canvas;
  const pad = 6;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = cw; out.height = ch;
  out.getContext('2d').drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch);
  return out;
};

// Eski editörle (v1) yazılmış soruları yeni editöre aktarmak için HTML üretir.
const legacyFmt = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/_\{([^}]*)\}/g, '<sub>$1</sub>').replace(/\^\{([^}]*)\}/g, '<sup>$1</sup>').replace(/\n/g, '<br>');
const legacyQuestionHtml = (src) => {
  let html = '';
  if (src.intro && src.intro.trim()) html += `<p><strong>${legacyFmt(src.intro)}</strong></p>`;
  String(src.items || '').split('\n').map((l) => l.trim()).filter(Boolean).forEach((l, i) => { html += `<p>${ROMAN[i] || i + 1}. ${legacyFmt(l)}</p>`; });
  if (src.stem && src.stem.trim()) html += `<p><strong>${legacyFmt(src.stem)}</strong></p>`;
  (src.opts || []).forEach((o, i) => { if (o) html += `<p>${'ABCDE'[i]}) ${legacyFmt(o)}</p>`; });
  if (src.img && src.img.dataUrl) html += `<p><img src="${src.img.dataUrl}" data-w="${Math.min(90, src.img.widthPct || 40)}"></p>`;
  return html;
};
const legacySolutionHtml = (src) => (src.solution && src.solution.trim() ? `<p>${legacyFmt(src.solution)}</p>` : '');

const tbBtn = (active) => ({
  minWidth: '30px', height: '30px', padding: '0 7px', borderRadius: '5px', border: '1px solid #cbd5e1',
  backgroundColor: active ? '#2563eb' : '#fff', color: active ? '#fff' : '#1e293b', cursor: 'pointer', fontSize: '0.85rem',
});
const tbSelect = { height: '30px', borderRadius: '5px', border: '1px solid #cbd5e1', backgroundColor: '#fff', fontSize: '0.8rem' };
const sep = <span style={{ width: '1px', height: '22px', backgroundColor: '#cbd5e1', margin: '0 4px' }} />;

// Küçük sayı kutusu: yazarken serbest, kutudan çıkınca (ya da Enter) uygulanır; boş = varsayılan.
function NumField({ label, title, value, onCommit, onEnterDone, width = 50, unit }) {
  const [t, setT] = useState('');
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setT(value == null ? '' : String(value)); }, [value, editing]);
  const commit = () => {
    setEditing(false);
    const raw = t.trim().replace(',', '.');
    if (raw === '') { onCommit(null); return; }
    const n = parseFloat(raw);
    if (Number.isFinite(n)) onCommit(n); else setT(value == null ? '' : String(value));
  };
  return (
    <label title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '0.72rem', color: '#475569' }}>
      {label}
      <input type="text" inputMode="decimal" value={t} onFocus={() => setEditing(true)} onChange={(e) => setT(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); if (onEnterDone) setTimeout(onEnterDone, 0); } }}
        style={{ width: `${width}px`, height: '28px', borderRadius: '5px', border: '1px solid #cbd5e1', padding: '0 5px', boxSizing: 'border-box', fontSize: '0.8rem' }} />
      {unit && <span style={{ color: '#94a3b8' }}>{unit}</span>}
    </label>
  );
}
const rowStyle = { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', padding: '3px 0' };
const rowTag = { width: '22px', height: '22px', borderRadius: '4px', backgroundColor: '#334155', color: '#fff', fontSize: '0.75rem', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };

export default function PoolQuestionEditor({ lessonCategories, topics, learningOutcomes, existingGroups, editRow, onClose, onSaved }) {
  const src = (editRow && editRow.source_json) || {};
  const isEdit = !!editRow;
  const isV2 = src.v === 2;
  const isLegacy = isEdit && !isV2 && (src.stem !== undefined || src.intro !== undefined);

  const [stage, setStage] = useState(isEdit ? 'edit' : 'size');
  const [pageW, setPageW] = useState(src.w || 16); // cm
  const [pageH, setPageH] = useState(src.h || 9);
  const [wInput, setWInput] = useState(String(src.w || 16));
  const [hInput, setHInput] = useState(String(src.h || 9));
  const [hyph, setHyph] = useState(src.hyph !== false); // tireleme (kelime bölme)
  const [showTable, setShowTable] = useState(false);
  const [tRows, setTRows] = useState('3');
  const [tCols, setTCols] = useState('3');
  const [batchName, setBatchName] = useState(isEdit ? (editRow.upload_batch_id || '') : '');
  const [dersId, setDersId] = useState(isEdit && editRow.lesson_category_id != null ? String(editRow.lesson_category_id) : '');
  const [konuId, setKonuId] = useState(isEdit && editRow.topic_id != null ? String(editRow.topic_id) : '');
  const [kazanimId, setKazanimId] = useState(isEdit && editRow.outcome_id != null ? String(editRow.outcome_id) : '');
  const [setCode, setSetCode] = useState(isEdit && editRow.set_key ? editRow.set_key.split('::').slice(1).join('::') : '');
  const [answer, setAnswer] = useState(isEdit ? (editRow.correct_answer || '') : '');
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [active, setActive] = useState('q'); // araç çubuğu hangi sayfaya uygulanıyor
  const [qOverflow, setQOverflow] = useState(false);
  const [sOverflow, setSOverflow] = useState(false);
  const [solHasText, setSolHasText] = useState(false);
  const qPageRef = useRef(null);
  const sPageRef = useRef(null);
  const fileRef = useRef(null);

  const contentPxW = pageW * PX_PER_CM;
  const contentPxH = pageH * PX_PER_CM;

  const initialQ = isV2 ? src.q : (isLegacy ? legacyQuestionHtml(src) : '');
  const initialS = isV2 ? src.s : (isLegacy ? legacySolutionHtml(src) : '');

  const qEditor = useEditor({
    extensions: baseExtensions(),
    content: initialQ || '',
    shouldRerenderOnTransaction: true,
    immediatelyRender: false,
    onFocus: () => setActive('q'),
  });
  const sEditor = useEditor({
    extensions: baseExtensions(),
    content: initialS || '',
    shouldRerenderOnTransaction: true,
    immediatelyRender: false,
    onFocus: () => setActive('s'),
  });
  const ed = active === 'q' ? qEditor : sEditor;

  // Metin sayfaya sığıyor mu?
  useEffect(() => {
    const measure = () => {
      const avail = contentPxH - PAD_Y * 2;
      const q = qPageRef.current && qPageRef.current.querySelector('.ProseMirror');
      const s = sPageRef.current && sPageRef.current.querySelector('.ProseMirror');
      if (q) setQOverflow(q.offsetHeight > avail + 1);
      if (s) setSOverflow(s.offsetHeight > avail + 1);
      if (sEditor) setSolHasText(sEditor.getText().trim().length > 0 || sEditor.getHTML().includes('<img'));
    };
    measure();
    const t = setTimeout(measure, 150);
    return () => clearTimeout(t);
  });

  const handleImageFile = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f || !ed) return;
    try {
      const dataUrl = await fileToPngDataUrl(f);
      ed.chain().focus().setImage({ src: dataUrl, width: 45 }).run();
    } catch (err) {
      alert('Şekil eklenemedi: ' + err.message + '\n(Illustrator dosyasını PDF, SVG veya PNG olarak dışa aktarıp deneyin.)');
    }
  };

  const insertOptions = () => {
    if (!qEditor) return;
    const nodes = ['A', 'B', 'C', 'D', 'E'].map((L) => ({ type: 'paragraph', content: [{ type: 'text', text: `${L}) ` }] }));
    qEditor.chain().focus('end').insertContent(nodes).run();
    // İmleci A) satırının sonuna koy -- şıkları hemen yazmaya başlanabilsin.
    let posA = null;
    const paras = [];
    qEditor.state.doc.descendants((node, pos) => { if (node.type.name === 'paragraph') paras.push({ node, pos }); });
    const a = paras.length >= 5 ? paras[paras.length - 5] : null;
    if (a && a.node.textContent.startsWith('A)')) posA = a.pos + 1 + a.node.content.size;
    if (posA != null) qEditor.chain().focus().setTextSelection(posA).run();
    setActive('q');
  };

  const pageToPdfBytes = async (node) => {
    const canvas = await html2canvas(node, { scale: 3, backgroundColor: '#ffffff', logging: false });
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    const pngBytes = new Uint8Array(await blob.arrayBuffer());
    const pdf = await PDFDocument.create();
    const image = await pdf.embedPng(pngBytes);
    const page = pdf.addPage([pageW * PT_PER_CM, pageH * PT_PER_CM]);
    page.drawImage(image, { x: 0, y: 0, width: pageW * PT_PER_CM, height: pageH * PT_PER_CM });
    return await pdf.save();
  };

  const uploadPdf = async (bytes, prefix) => {
    const name = `${prefix}_${Math.random().toString(36).substring(2)}_${Date.now()}.pdf`;
    const { error } = await supabase.storage.from('exam-files').upload(name, new Blob([bytes], { type: 'application/pdf' }));
    if (error) throw new Error('PDF yüklenemedi: ' + error.message);
    return name;
  };

  const handleSave = async () => {
    const batch = batchName.trim();
    if (!batch) { alert('Grup adı girin (sağdaki alandan, ör. "Biyoloji Kitabı 1").'); return; }
    if (!qEditor || qEditor.getText().trim().length === 0) { alert('Soru sayfasına soruyu yazın.'); return; }
    if (!['A', 'B', 'C', 'D', 'E'].includes(answer)) { alert('Doğru cevabı seçin (sağ taraf).'); return; }
    if (qOverflow || (solHasText && sOverflow)) {
      if (!window.confirm('Metin sayfaya sığmıyor, alt kısım kesilecek. Yine de kaydedilsin mi?')) return;
    }
    setSaving(true);
    try {
      qEditor.commands.setTextSelection(1);
      qEditor.commands.blur();
      if (sEditor) { sEditor.commands.setTextSelection(1); sEditor.commands.blur(); }
      await new Promise((r) => setTimeout(r, 60));
      const qBytes = await pageToPdfBytes(qPageRef.current);
      const qName = await uploadPdf(qBytes, 'pool');
      let sName = null;
      if (solHasText) {
        const sBytes = await pageToPdfBytes(sPageRef.current);
        sName = await uploadPdf(sBytes, 'pool_sol');
      }
      const fields = {
        pdf_file: qName,
        solution_pdf_file: sName,
        correct_answer: answer,
        upload_batch_id: batch,
        lesson_category_id: dersId || null,
        topic_id: konuId || null,
        outcome_id: kazanimId || null,
        set_key: setCode.trim() ? `${batch}::${setCode.trim()}` : null,
        source_json: { v: 2, w: pageW, h: pageH, hyph, q: qEditor.getJSON(), s: sEditor ? sEditor.getJSON() : null },
      };
      if (isEdit) {
        const { error } = await supabase.from('question_pool').update(fields).eq('id', editRow.id);
        if (error) throw new Error('Soru güncellenemedi: ' + error.message);
        const old = [editRow.pdf_file, editRow.solution_pdf_file].filter(Boolean);
        if (old.length) { try { await supabase.storage.from('exam-files').remove(old); } catch (e) { /* önemsiz */ } }
        if (onSaved) onSaved(editRow.id);
        onClose();
        setSaving(false);
        return;
      }
      const { error } = await supabase.from('question_pool').insert([fields]);
      if (error) throw new Error('Havuz kaydı oluşturulamadı: ' + error.message);
      setSavedCount((c) => c + 1);
      qEditor.commands.clearContent(true);
      if (sEditor) sEditor.commands.clearContent(true);
      setAnswer('');
      if (onSaved) onSaved();
    } catch (err) {
      alert('Kaydedilemedi: ' + err.message);
    }
    setSaving(false);
  };

  const inp = { width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box', fontFamily: 'inherit' };
  const lbl = { display: 'block', fontSize: '0.8rem', fontWeight: 'bold', margin: '12px 0 4px', color: '#334155' };
  const konular = topics.filter((t) => String(t.lesson_category_id) === String(dersId));
  const kazanimlar = learningOutcomes.filter((lo) => String(lo.topic_id) === String(konuId));

  // Boyut kutuları: yazarken serbest; kutudan çıkınca (ya da Enter) 5-30 cm arasına çekilip uygulanır.
  const commitSize = (which) => {
    const raw = which === 'w' ? wInput : hInput;
    const n = parseFloat(String(raw).replace(',', '.'));
    const cur = which === 'w' ? pageW : pageH;
    const v = Number.isFinite(n) ? Math.min(30, Math.max(5, n)) : cur;
    if (which === 'w') { setPageW(v); setWInput(String(v)); } else { setPageH(v); setHInput(String(v)); }
  };
  const pa = ed ? ed.getAttributes('paragraph') : {};
  const setPara = (key, v) => { if (ed) ed.chain().updateAttributes('paragraph', { [key]: v }).run(); };
  const refocus = () => { if (ed) ed.commands.focus(); };
  const inTable = !!ed && ed.isActive('table');
  const doTable = (fn) => () => { if (ed) fn(ed.chain().focus()).run(); };

  // Seçili şık paragraflarını asılı girintiye çevirir: sol girinti 7 mm, ilk satır -7 mm,
  // "A) metin" -> "A)<tab>metin" (InDesign'daki şık düzeni).
  const hangOptions = () => {
    if (!ed) return;
    const { from, to } = ed.state.selection;
    const targets = [];
    ed.state.doc.nodesBetween(from, to, (node, pos) => { if (node.type.name === 'paragraph') targets.push({ node, pos }); });
    ed.chain().focus().command(({ tr }) => {
      targets.slice().reverse().forEach(({ node, pos }) => {
        const m = node.textContent.match(/^([A-E]\))[ \t\u00a0]+/);
        if (m && node.firstChild && node.firstChild.isText && node.firstChild.text.startsWith(m[0])) {
          tr.insertText(m[1] + '\t', pos + 1, pos + 1 + m[0].length);
        }
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, indentLeft: 7, firstLine: -7 });
      });
      return true;
    }).run();
  };

  const addTable = () => {
    if (!ed) return;
    const r = Math.min(20, Math.max(1, parseInt(tRows, 10) || 0));
    const c = Math.min(8, Math.max(1, parseInt(tCols, 10) || 0));
    if (!r || !c) { alert('Satır ve sütun sayısı girin.'); return; }
    ed.chain().focus().insertTable({ rows: r, cols: c, withHeaderRow: false }).run();
    setShowTable(false);
  };
  // Yazının altındaki boş sayfaya tıklayınca imleç metnin sonuna gider (eski seçim temizlenir).
  const clickBlank = (editorInst, which) => (e) => {
    const pm = e.currentTarget.querySelector('.ProseMirror');
    if (!pm || !editorInst) return;
    const last = pm.lastElementChild;
    const bottom = last ? last.getBoundingClientRect().bottom : 0;
    if (e.clientY > bottom && (e.target === pm || e.target === e.currentTarget)) {
      e.preventDefault();
      editorInst.chain().focus('end').run();
      setActive(which);
    }
  };
  const keep = (e) => e.preventDefault(); // araç çubuğuna basınca yazı alanı odağı kaybolmasın
  const curSizePx = ed ? ed.getAttributes('textStyle').fontSize : null;
  const curSizePt = curSizePx ? String(Math.round(parseFloat(curSizePx) / PX_PER_PT)) : '';
  const curFont = ed ? (ed.getAttributes('textStyle').fontFamily || '').replace(/["']/g, '').split(',')[0] : '';
  const imgSelected = ed && ed.isActive('image');

  // ---- 1) Sayfa boyutu seçimi ----
  if (stage === 'size') {
    return (
      <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
        <div style={{ backgroundColor: '#fff', borderRadius: '12px', padding: '26px', width: '560px', maxWidth: '100%' }}>
          <h2 style={{ margin: '0 0 6px', fontSize: '1.15rem' }}>✏️ Soru Yaz — Sayfa boyutu</h2>
          <p style={{ margin: '0 0 16px', color: '#64748b', fontSize: '0.88rem' }}>Soru ve çözüm sayfası aynı ölçüde olur. Boyutu sonra da değiştirebilirsiniz.</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {SIZE_PRESETS.map((p) => (
              <button key={p.key} onClick={() => { setPageW(p.w); setPageH(p.h); setWInput(String(p.w)); setHInput(String(p.h)); setStage('edit'); }}
                style={{ padding: '14px', borderRadius: '8px', border: '2px solid #cbd5e1', backgroundColor: '#f8fafc', cursor: 'pointer', fontWeight: 'bold', textAlign: 'left' }}>
                <div style={{ width: `${p.w * 4}px`, height: `${p.h * 4}px`, border: '1px solid #64748b', backgroundColor: '#fff', marginBottom: '8px' }} />
                {p.label}
              </button>
            ))}
          </div>
          <div style={{ marginTop: '14px', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>Özel (cm):</span>
            <input type="text" inputMode="decimal" value={wInput} onChange={(e) => setWInput(e.target.value)} style={{ ...inp, width: '80px' }} />
            <span>×</span>
            <input type="text" inputMode="decimal" value={hInput} onChange={(e) => setHInput(e.target.value)} style={{ ...inp, width: '80px' }} />
            <button onClick={() => {
              const w = parseFloat(String(wInput).replace(',', '.')), h = parseFloat(String(hInput).replace(',', '.'));
              if (!(w >= 5 && w <= 30 && h >= 5 && h <= 30)) { alert('Genişlik ve yükseklik 5 ile 30 cm arasında olmalı.'); return; }
              setPageW(w); setPageH(h); setStage('edit');
            }}
              style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', backgroundColor: '#2563eb', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}>Devam</button>
          </div>
          <div style={{ marginTop: '14px', textAlign: 'right' }}>
            <button onClick={onClose} style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#f1f5f9', cursor: 'pointer' }}>Vazgeç</button>
          </div>
        </div>
      </div>
    );
  }

  const pageStyle = (overflow) => ({
    position: 'relative', width: `${contentPxW}px`, height: `${contentPxH}px`, backgroundColor: '#fff',
    boxSizing: 'border-box', padding: `${PAD_Y}px ${PAD_X}px`, fontFamily: 'Arial, Helvetica, sans-serif',
    fontSize: `${BASE_PX}px`, lineHeight: 1.35, color: '#000', overflow: 'hidden',
    boxShadow: overflow ? '0 0 0 2px #dc2626' : '0 1px 6px rgba(0,0,0,0.18)',
  });

  // ---- 2) Yazma ekranı ----
  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: '#fff', zIndex: 1100, overflowY: 'auto' }}>
      <style>{`
        .pq-page .ProseMirror { outline: none; min-height: ${contentPxH - PAD_Y * 2}px; hyphens: ${hyph ? 'auto' : 'manual'}; -webkit-hyphens: ${hyph ? 'auto' : 'manual'}; tab-size: ${7 * MM_PX}px; }
        .pq-page .ProseMirror p { margin: 0 0 ${MM_PX}px; }
        .pq-page .ProseMirror table { border-collapse: collapse; table-layout: fixed; width: 100%; margin: 4px 0; }
        .pq-page .ProseMirror td, .pq-page .ProseMirror th { border: 1px solid #000; padding: 2px 5px; vertical-align: top; position: relative; box-sizing: border-box; min-width: 1em; }
        .pq-page .ProseMirror td p, .pq-page .ProseMirror th p { margin: 0; }
        .pq-page .ProseMirror .selectedCell:after { content: ''; position: absolute; inset: 0; background: rgba(37,99,235,0.18); pointer-events: none; }
        .pq-page .ProseMirror .column-resize-handle { position: absolute; right: -2px; top: 0; bottom: 0; width: 4px; background: #2563eb; pointer-events: none; }
        .pq-page .ProseMirror .tableWrapper { overflow-x: auto; }
        .pq-page .ProseMirror img { max-width: 100%; vertical-align: middle; }
        .pq-page .ProseMirror img.ProseMirror-selectednode { outline: 2px solid #2563eb; }
        .pq-page .ProseMirror sub, .pq-page .ProseMirror sup { line-height: 0; }
      `}</style>
      <div style={{ position: 'sticky', top: 0, zIndex: 20, backgroundColor: '#fff', borderBottom: '1px solid #e2e8f0', padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '1.15rem' }}>
          {isEdit ? `✏️ Soruyu Düzenle (#${editRow.id})` : '✏️ Soru Yaz'} {savedCount > 0 && <span style={{ fontSize: '0.8rem', color: '#16a34a' }}>({savedCount} soru eklendi)</span>}
        </h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {(qOverflow || (solHasText && sOverflow)) && <span style={{ color: '#dc2626', fontSize: '0.8rem', fontWeight: 'bold' }}>⚠ Metin sayfaya sığmıyor</span>}
          <button onClick={handleSave} disabled={saving}
            style={{ padding: '8px 20px', borderRadius: '6px', border: 'none', backgroundColor: saving ? '#94a3b8' : '#2563eb', color: '#fff', fontWeight: 'bold', cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Kaydediliyor...' : (isEdit ? 'Değişiklikleri Kaydet' : 'Havuza Kaydet')}
          </button>
          {!saving && <button onClick={onClose} style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#f1f5f9', cursor: 'pointer' }}>Kapat</button>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '20px', padding: '16px 20px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* SOL: araç çubuğu + soru sayfası + çözüm sayfası */}
        <div style={{ flex: '1 1 640px', minWidth: 0 }}>
          <div style={{ position: 'sticky', top: '62px', zIndex: 15, backgroundColor: '#f1f3f5', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '4px 10px', marginBottom: '14px' }}>
            {/* Satır 1: karakter (InDesign kontrol paneli gibi) */}
            <div style={rowStyle}>
              <span style={rowTag} title="Karakter">A</span>
              <select style={{ ...tbSelect, width: '140px' }} value={curFont}
                onChange={(e) => { if (!ed) return; if (e.target.value) ed.chain().focus().setFontFamily(e.target.value).run(); else ed.chain().focus().unsetFontFamily().run(); }}>
                <option value="">Yazı tipi</option>
                {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <NumField label="Punto" title="Yazı boyutu (pt)" width={46} unit="pt" value={curSizePt === '' ? null : Number(curSizePt)}
                onEnterDone={refocus} onCommit={(v) => { if (!ed) return; if (v == null) ed.chain().unsetFontSize().run(); else ed.chain().setFontSize(`${(v * PX_PER_PT).toFixed(2)}px`).run(); }} />
              <NumField label="Satır ar." title="Satır aralığı / leading (pt). Boş = otomatik" width={46} unit="pt" value={pa.leading == null ? null : pa.leading} onEnterDone={refocus} onCommit={(v) => setPara('leading', v)} />
              {sep}
              <button title="Kalın" onMouseDown={keep} onClick={() => ed && ed.chain().focus().toggleBold().run()} style={{ ...tbBtn(ed && ed.isActive('bold')), fontWeight: 'bold' }}>B</button>
              <button title="İtalik" onMouseDown={keep} onClick={() => ed && ed.chain().focus().toggleItalic().run()} style={{ ...tbBtn(ed && ed.isActive('italic')), fontStyle: 'italic' }}>I</button>
              <button title="Altı çizili" onMouseDown={keep} onClick={() => ed && ed.chain().focus().toggleUnderline().run()} style={{ ...tbBtn(ed && ed.isActive('underline')), textDecoration: 'underline' }}>U</button>
              <button title="Alt simge" onMouseDown={keep} onClick={() => ed && ed.chain().focus().toggleSubscript().run()} style={tbBtn(ed && ed.isActive('subscript'))}>x₂</button>
              <button title="Üst simge" onMouseDown={keep} onClick={() => ed && ed.chain().focus().toggleSuperscript().run()} style={tbBtn(ed && ed.isActive('superscript'))}>x²</button>
              {sep}
              <button title="Geri al" onMouseDown={keep} onClick={() => ed && ed.chain().focus().undo().run()} style={tbBtn(false)}>↶</button>
              <button title="Yinele" onMouseDown={keep} onClick={() => ed && ed.chain().focus().redo().run()} style={tbBtn(false)}>↷</button>
            </div>
            {/* Satır 2: paragraf (ölçüler milimetre) */}
            <div style={rowStyle}>
              <span style={rowTag} title="Paragraf">¶</span>
              {[['left', 'Sol', 'Sola yasla'], ['center', 'Orta', 'Ortala'], ['right', 'Sağ', 'Sağa yasla'], ['justify', 'Yaslı', 'İki yana yasla']].map(([k, ic, tt]) => (
                <button key={k} title={tt} onMouseDown={keep} onClick={() => ed && ed.chain().focus().setTextAlign(k).run()} style={tbBtn(ed && ed.isActive({ textAlign: k }))}>{ic}</button>
              ))}
              {sep}
              <NumField label="Sol girinti" title="Soldan girinti (mm)" unit="mm" value={pa.indentLeft == null ? 0 : pa.indentLeft} onEnterDone={refocus} onCommit={(v) => setPara('indentLeft', v)} />
              <NumField label="Sağ girinti" title="Sağdan girinti (mm)" unit="mm" value={pa.indentRight == null ? 0 : pa.indentRight} onEnterDone={refocus} onCommit={(v) => setPara('indentRight', v)} />
              <NumField label="İlk satır" title="Paragraf başı girintisi (mm). Negatif değer = asılı girinti" unit="mm" value={pa.firstLine == null ? 0 : pa.firstLine} onEnterDone={refocus} onCommit={(v) => setPara('firstLine', v)} />
              {sep}
              <NumField label="Önce" title="Paragraftan önce boşluk (mm)" unit="mm" value={pa.spaceBefore == null ? 0 : pa.spaceBefore} onEnterDone={refocus} onCommit={(v) => setPara('spaceBefore', v)} />
              <NumField label="Sonra" title="Paragraftan sonra boşluk (mm)" unit="mm" value={pa.spaceAfter == null ? 1 : pa.spaceAfter} onEnterDone={refocus} onCommit={(v) => setPara('spaceAfter', v)} />
              {sep}
              <label title="Kelimeleri satır sonunda hecelerine böl" style={{ fontSize: '0.75rem', color: '#475569', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <input type="checkbox" checked={hyph} onChange={(e) => setHyph(e.target.checked)} /> Tireleme
              </label>
              <button title="Seçili şık satırlarını asılı girintiye çevirir (7 mm), A) ile metin arasına sekme koyar" onMouseDown={keep} onClick={hangOptions} style={tbBtn(false)}>Şıkları hizala</button>
            </div>
            {/* Satır 3: ekle */}
            <div style={rowStyle}>
              <span style={rowTag} title="Ekle">+</span>
              <button title="İmlecin olduğu yere resim ekle" onMouseDown={keep} onClick={() => fileRef.current && fileRef.current.click()} style={tbBtn(false)}>🖼 Resim ekle</button>
              <input ref={fileRef} type="file" accept="image/*,.pdf,.svg" style={{ display: 'none' }} onChange={handleImageFile} />
              {imgSelected && (
                <select title="Resim boyutu" style={{ ...tbSelect, width: '90px' }} value={ed.getAttributes('image').width || 50}
                  onChange={(e) => ed.chain().focus().updateAttributes('image', { width: Number(e.target.value) }).run()}>
                  {[15, 20, 25, 30, 40, 50, 60, 75, 90, 100].map((n) => <option key={n} value={n}>Resim %{n}</option>)}
                </select>
              )}
              <span style={{ position: 'relative', display: 'inline-block' }}>
                <button title="Tablo ekle" onMouseDown={keep} onClick={() => setShowTable((v) => !v)} style={tbBtn(showTable)}>▦ Tablo ekle</button>
                {showTable && (
                  <div style={{ position: 'absolute', top: '34px', left: 0, zIndex: 30, backgroundColor: '#fff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '10px', boxShadow: '0 4px 14px rgba(0,0,0,0.18)', display: 'flex', gap: '8px', alignItems: 'flex-end', whiteSpace: 'nowrap' }}>
                    <label style={{ fontSize: '0.75rem' }}>Satır<br /><input type="text" inputMode="numeric" value={tRows} onChange={(e) => setTRows(e.target.value)} style={{ width: '50px', height: '28px', boxSizing: 'border-box' }} /></label>
                    <label style={{ fontSize: '0.75rem' }}>Sütun<br /><input type="text" inputMode="numeric" value={tCols} onChange={(e) => setTCols(e.target.value)} style={{ width: '50px', height: '28px', boxSizing: 'border-box' }} /></label>
                    <button onMouseDown={keep} onClick={addTable} style={{ height: '28px', padding: '0 12px', borderRadius: '5px', border: 'none', backgroundColor: '#2563eb', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}>Ekle</button>
                  </div>
                )}
              </span>
              <button title="Soru sayfasının sonuna A–E şık satırları ekler" onMouseDown={keep} onClick={insertOptions} style={tbBtn(false)}>＋ Şık ekle</button>
            </div>
            {/* Satır 4: tablo içindeyken */}
            {inTable && (
              <div style={{ ...rowStyle, borderTop: '1px dashed #cbd5e1', marginTop: '2px' }}>
                <span style={rowTag} title="Tablo">▦</span>
                {[['↑ Üste satır', (c) => c.addRowBefore()], ['↓ Alta satır', (c) => c.addRowAfter()], ['← Sola sütun', (c) => c.addColumnBefore()], ['→ Sağa sütun', (c) => c.addColumnAfter()],
                  ['Satırı sil', (c) => c.deleteRow()], ['Sütunu sil', (c) => c.deleteColumn()], ['Hücreleri birleştir', (c) => c.mergeCells()], ['Hücreyi böl', (c) => c.splitCell()], ['Tabloyu sil', (c) => c.deleteTable()]].map(([t, fn]) => (
                  <button key={t} onMouseDown={keep} onClick={doTable(fn)} style={tbBtn(false)}>{t}</button>
                ))}
              </div>
            )}
          </div>

          <div style={{ backgroundColor: '#eef2f7', borderRadius: '12px', padding: '16px', overflowX: 'auto' }}>
            <div style={{ fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '8px', color: active === 'q' ? '#2563eb' : '#475569' }}>
              Soru {qOverflow && <span style={{ color: '#dc2626' }}>⚠ sığmıyor</span>}
            </div>
            <div ref={qPageRef} className="pq-page" lang="tr" style={pageStyle(qOverflow)}
              onMouseDown={clickBlank(qEditor, 'q')}>
              <EditorContent editor={qEditor} />
            </div>
          </div>

          <div style={{ backgroundColor: '#eef2f7', borderRadius: '12px', padding: '16px', overflowX: 'auto', marginTop: '14px' }}>
            <div style={{ fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '8px', color: active === 's' ? '#2563eb' : '#475569' }}>
              💡 Çözüm <span style={{ fontWeight: 'normal', color: '#64748b' }}>(boş bırakırsanız çözüm sayfası oluşturulmaz)</span> {solHasText && sOverflow && <span style={{ color: '#dc2626' }}>⚠ sığmıyor</span>}
            </div>
            <div ref={sPageRef} className="pq-page" lang="tr" style={pageStyle(solHasText && sOverflow)}
              onMouseDown={clickBlank(sEditor, 's')}>
              <EditorContent editor={sEditor} />
              {solHasText && answer && (
                <div style={{ position: 'absolute', right: `${PAD_X}px`, bottom: '14px', fontSize: '12px', fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {['A', 'B', 'C', 'D', 'E'].map((L) => (<span key={L}>|<span style={{ fontWeight: L === answer ? 'bold' : 'normal' }}>{L}</span></span>))}|
                </div>
              )}
            </div>
          </div>
        </div>

        {/* SAĞ: standart alanlar */}
        <div style={{ flex: '0 0 320px', maxWidth: '100%' }}>
          <label style={{ ...lbl, marginTop: 0 }}>Grup Adı</label>
          <input list="pool-editor-groups" style={inp} value={batchName} onChange={(e) => setBatchName(e.target.value)} placeholder='Ör. "Biyoloji Kitabı 1"' />
          <datalist id="pool-editor-groups">{(existingGroups || []).map((g) => <option key={g} value={g} />)}</datalist>

          <label style={lbl}>Ders</label>
          <select style={inp} value={dersId} onChange={(e) => { setDersId(e.target.value); setKonuId(''); setKazanimId(''); }}>
            <option value="">Seçin</option>
            {lessonCategories.map((lc) => <option key={lc.id} value={lc.id}>{lc.name}</option>)}
          </select>
          <label style={lbl}>Konu</label>
          <select style={inp} value={konuId} disabled={!dersId} onChange={(e) => { setKonuId(e.target.value); setKazanimId(''); }}>
            <option value="">{dersId ? 'Seçin' : 'Önce Ders seçin'}</option>
            {konular.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <label style={lbl}>Kazanım</label>
          <select style={inp} value={kazanimId} disabled={!konuId} onChange={(e) => setKazanimId(e.target.value)}>
            <option value="">{konuId ? 'Seçin' : 'Önce Konu seçin'}</option>
            {kazanimlar.map((lo) => <option key={lo.id} value={lo.id}>{lo.name}</option>)}
          </select>

          <label style={lbl}>Doğru Cevap</label>
          <select style={inp} value={answer} onChange={(e) => setAnswer(e.target.value)}>
            <option value="">Seçin</option>
            {['A', 'B', 'C', 'D', 'E'].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          <label style={lbl}>Soru Grubu Kodu (ortak metne bağlı sorular, opsiyonel)</label>
          <input style={inp} value={setCode} onChange={(e) => setSetCode(e.target.value)} placeholder="Boş = tek soru. Bağlı sorulara aynı kod (G1)" />

          <label style={lbl}>Sayfa boyutu (cm)</label>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input type="text" inputMode="decimal" value={wInput} onChange={(e) => setWInput(e.target.value)} onBlur={() => commitSize('w')} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} style={inp} />
            <span>×</span>
            <input type="text" inputMode="decimal" value={hInput} onChange={(e) => setHInput(e.target.value)} onBlur={() => commitSize('h')} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} style={inp} />
          </div>
          <div style={{ marginTop: '14px', fontSize: '0.75rem', color: '#64748b', lineHeight: 1.5 }}>
            İpucu: Yazı alanına tıklayıp yazın; üstteki araçlar imlecin bulunduğu sayfaya (Soru ya da Çözüm) uygulanır. “＋ Şık ekle” soru sayfasının sonuna A–E satırlarını açar.
          </div>
        </div>
      </div>
    </div>
  );
}

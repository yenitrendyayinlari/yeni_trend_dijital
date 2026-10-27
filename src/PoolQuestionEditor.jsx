import { useRef, useState, useEffect } from 'react';
import CategoryPicker from './CategoryPicker';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Extension } from '@tiptap/core';
import { TextStyle, FontSize, FontFamily } from '@tiptap/extension-text-style';
import { Table, TableRow, TableHeader, TableCell, TableView } from '@tiptap/extension-table';
import { selectedRect } from '@tiptap/pm/tables';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
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
        renderHTML: (attrs) => (attrs.widthMm != null ? { 'data-w': attrs.width } : { 'data-w': attrs.width, style: `width:${attrs.width}%;height:auto;` }),
      },
      // Kaynak dosya adı (InDesign "Bağlantılar" gibi): resim hangi dosyadan eklendi.
      srcName: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-src-name'),
        renderHTML: (attrs) => (attrs.srcName ? { 'data-src-name': attrs.srcName } : {}),
      },
      // Mutlak genişlik (mm): sayfa boyutu değişse de resim küçülmez/büyümez.
      widthMm: {
        default: null,
        parseHTML: (el) => { const v = el.getAttribute('data-wmm'); return v == null ? null : Number(v); },
        renderHTML: (attrs) => (attrs.widthMm == null ? {} : { 'data-wmm': attrs.widthMm, style: `width:${(attrs.widthMm * MM_PX).toFixed(1)}px;height:auto;` }),
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
        tabs: {
          default: null,
          parseHTML: (el) => { try { const v = el.getAttribute('data-tabs'); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
          renderHTML: (attrs) => (attrs.tabs && attrs.tabs.length ? { 'data-tabs': JSON.stringify(attrs.tabs) } : {}),
        },
        leading: {
          default: null,
          parseHTML: (el) => { const v = el.getAttribute('data-ld'); return v == null ? null : Number(v); },
          renderHTML: (attrs) => (attrs.leading == null ? {} : { 'data-ld': attrs.leading, style: `line-height:${(attrs.leading * PX_PER_PT).toFixed(2)}px` }),
        },
      },
    }];
  },
});
// Sekme (Tab) karakterlerinin genişliği: tarayıcı Tab'ı iki yana yaslı satırlarda esnetiyor (ilk satır
// kayıyordu). Bu yüzden her Tab'ı, bir sonraki durağa kadar ölçülmüş sabit genişlikte bir kutuya çeviriyoruz.
// Durak sırası: paragrafa özel durak listesi (tabs, mm) -> asılı girintinin sol girinti noktası -> 7 mm ızgara.
const tabPluginKey = new PluginKey('pqTabs');
const TAB_GRID_MM = 7;
function buildTabDeco(doc, widths) {
  const decos = [];
  widths.forEach((w, pos) => {
    if (pos >= 0 && pos < doc.content.size && doc.textBetween(pos, pos + 1) === '\t') {
      decos.push(Decoration.inline(pos, pos + 1, { class: 'pq-tab', style: `display:inline-block;width:${w.toFixed(1)}px;white-space:pre;text-indent:0;overflow:hidden;vertical-align:bottom;` }));
    }
  });
  return DecorationSet.create(doc, decos);
}
function measureTabs(view) {
  const st = tabPluginKey.getState(view.state);
  if (!st) return;
  const doc = view.state.doc;
  const next = new Map();
  const rootRect = view.dom.getBoundingClientRect();
  doc.descendants((node, pos, parent) => {
    if (!node.isText || !node.text || node.text.indexOf('\t') < 0) return;
    for (let i = 0; i < node.text.length; i++) {
      if (node.text[i] !== '\t') continue;
      const tp = pos + i;
      let left;
      try { left = view.coordsAtPos(tp).left; } catch (e) { continue; }
      const $p = doc.resolve(tp);
      let frameLeft = rootRect.left;
      for (let d = $p.depth; d > 0; d--) {
        const nm = $p.node(d).type.name;
        if (nm === 'tableCell' || nm === 'tableHeader') {
          const el = view.nodeDOM($p.before(d));
          if (el && el.getBoundingClientRect) { const cs = getComputedStyle(el); frameLeft = el.getBoundingClientRect().left + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.borderLeftWidth) || 0); }
          break;
        }
      }
      const x = left - frameLeft;
      const pa = $p.parent.attrs || {};
      // tabs: pozitif = sola hizalı durak (mm), negatif = sağa hizalı durak (mm, işareti eksi)
      const stops = (Array.isArray(pa.tabs) ? pa.tabs : []).map((m) => ({ x: Math.abs(m) * MM_PX, r: m < 0 }));
      // asılı girintide sol girinti noktası da (ilk satırdan sonraki) örtük bir sekme durağıdır
      if ((pa.firstLine || 0) < 0 && (pa.indentLeft || 0) > 0) stops.push({ x: pa.indentLeft * MM_PX, r: false });
      stops.sort((a, b) => a.x - b.x);
      const hit = stops.find((sx) => sx.x > x + 1);
      let stop;
      if (hit && hit.r) {
        // sağa hizalı: sekmeden sonraki metin (bir sonraki sekme/paragraf sonuna kadar) durakta bitsin
        let endPos = $p.end();
        const txt = $p.parent.textContent; const startInPar = tp + 1 - $p.start();
        const nt = txt.indexOf('\t', startInPar);
        if (nt >= 0) endPos = $p.start() + nt;
        let tw = 0;
        try { tw = Math.max(0, view.coordsAtPos(endPos).left - view.coordsAtPos(tp + 1).left); } catch (e) { tw = 0; }
        stop = Math.max(x + 4, hit.x - tw);
      } else if (hit) stop = hit.x;
      else { const g = TAB_GRID_MM * MM_PX; stop = (Math.floor((x + 1) / g) + 1) * g; }
      next.set(tp, Math.max(4, stop - x));
    }
  });
  let same = next.size === st.widths.size;
  if (same) next.forEach((w, k) => { const o = st.widths.get(k); if (o == null || Math.abs(o - w) > 0.5) same = false; });
  if (same) return;
  if (st.pass >= 5) return; // sonsuz döngüye karşı
  view.dispatch(view.state.tr.setMeta(tabPluginKey, { widths: next, pass: st.pass + 1 }).setMeta('addToHistory', false));
}
const tabPlugin = () => new Plugin({
  key: tabPluginKey,
  state: {
    init: () => ({ widths: new Map(), deco: DecorationSet.empty, pass: 0 }),
    apply(tr, st) {
      const meta = tr.getMeta(tabPluginKey);
      if (meta) return { widths: meta.widths, deco: buildTabDeco(tr.doc, meta.widths), pass: meta.pass };
      if (tr.docChanged) {
        const w = new Map(); st.widths.forEach((v, k) => w.set(tr.mapping.map(k), v));
        return { widths: w, deco: st.deco.map(tr.mapping, tr.doc), pass: 0 };
      }
      return st;
    },
  },
  props: { decorations(state) { const s2 = tabPluginKey.getState(state); return s2 ? s2.deco : null; } },
  view(view) {
    let scheduled = false;
    return { update() { if (scheduled) return; scheduled = true; Promise.resolve().then(() => { scheduled = false; if (view.dom.isConnected) measureTabs(view); }); } };
  },
});

// Tab tuşu: şıklardaki "A)<tab>metin" gibi sekme boşluğu bırakır (tabloda hücreler arası geçer).
const TabKey = Extension.create({
  name: 'tabKey',
  addProseMirrorPlugins() { return [tabPlugin()]; },
  addKeyboardShortcuts() {
    return {
      Tab: () => { if (this.editor.isActive('table')) return false; return this.editor.commands.insertContent({ type: 'text', text: '\t' }); },
    };
  },
});

// Tablo: çerçeve kalınlığı (pt) ve "yazıya göre genişlik" tablo özelliği; satır yüksekliği (mm, en az) satır özelliği.
class PqTableView extends TableView {
  constructor(node, cellMinWidth, view, attrs) { super(node, cellMinWidth, view, attrs); this.pqApply(node); }
  update(node) { const ok = super.update(node); if (ok) this.pqApply(node); return ok; }
  pqApply(node) {
    const bw = node.attrs.borderW == null ? 0.75 : node.attrs.borderW;
    this.table.style.setProperty('--bw', `${(bw * PX_PER_PT).toFixed(2)}px`);
    this.table.classList.toggle('pq-noborder', bw <= 0);
    this.table.classList.toggle('pq-fit', !!node.attrs.fit);
  }
}
const PqTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      borderW: { default: 0.75, parseHTML: (el) => { const v = el.getAttribute('data-bw'); return v == null ? 0.75 : Number(v); }, renderHTML: (a) => ({ 'data-bw': a.borderW }) },
      fit: { default: false, parseHTML: (el) => el.getAttribute('data-fit') === '1', renderHTML: (a) => (a.fit ? { 'data-fit': '1' } : {}) },
    };
  },
});
const PqTableRow = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      rowH: { default: null, parseHTML: (el) => { const v = el.getAttribute('data-rh'); return v == null ? null : Number(v); }, renderHTML: (a) => (a.rowH == null ? {} : { 'data-rh': a.rowH, style: `height:${(a.rowH * MM_PX).toFixed(1)}px` }) },
    };
  },
});

const baseExtensions = () => [
  StarterKit.configure({ heading: false, blockquote: false, codeBlock: false, code: false, horizontalRule: false, link: false, trailingNode: false, bulletList: false, orderedList: false, listItem: false, listKeymap: false, strike: false }),
  TextStyle, FontSize, FontFamily, ParaFormat, TabKey,
  PqTable.configure({ resizable: true, View: PqTableView }), PqTableRow, TableHeader, TableCell,
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

// ---- InDesign (.icml / InCopy Document) içe aktarma ----
// ICML bir XML dosyasıdır: paragraf ve karakter biçimleri (nokta/pt cinsinden) dosyanın içinde durur.
const PT_MM = 25.4 / 72;
const round1 = (v) => Math.round(v * 10) / 10;
const kids = (el, tag) => Array.from(el.children).filter((c) => c.tagName === tag);
function parseIcml(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (doc.querySelector('parsererror') || !doc.documentElement) throw new Error('Dosya okunamadı (geçerli bir .icml değil).');
  // Stil tablosu: Self -> {attrs, base, leading}
  const styles = {};
  doc.querySelectorAll('ParagraphStyle, CharacterStyle').forEach((st) => {
    const props = kids(st, 'Properties')[0];
    const base = props ? kids(props, 'BasedOn')[0] : null;
    const lead = props ? kids(props, 'Leading')[0] : null;
    styles[st.getAttribute('Self')] = { el: st, base: base ? (base.textContent || '').trim() : null, leading: lead ? lead.textContent.trim() : null };
  });
  const resolveStyle = (self) => {
    const chain = []; let cur = self, guard = 0;
    while (cur && styles[cur] && guard++ < 8) { chain.unshift(styles[cur]); cur = styles[cur].base; }
    const attrs = {}; let leading = null;
    chain.forEach((st) => { Array.from(st.el.attributes).forEach((a) => { attrs[a.name] = a.value; }); if (st.leading != null) leading = st.leading; });
    return { attrs, leading };
  };
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  let skippedTables = 0;
  const storyPages = [];
  const collectPsr = (node, out) => {
    Array.from(node.children).forEach((c) => {
      if (c.tagName === 'ParagraphStyleRange') out.push(c);
      else if (c.tagName === 'Table') skippedTables++;
      else if (c.tagName === 'XMLElement') collectPsr(c, out);
    });
  };
  const stories = [];
  doc.querySelectorAll('Story').forEach((story) => {
    const psrs = []; collectPsr(story, psrs);
    const paras = [];
    psrs.forEach((psr) => {
      const ps = resolveStyle(psr.getAttribute('AppliedParagraphStyle'));
      const pa = (n) => (psr.hasAttribute(n) ? psr.getAttribute(n) : ps.attrs[n]);
      const just = pa('Justification');
      const pfmt = {
        textAlign: just === 'CenterAlign' ? 'center' : just === 'RightAlign' ? 'right' : (just && /Justified/.test(just) ? 'justify' : null),
        indentLeft: num(pa('LeftIndent')) != null ? round1(num(pa('LeftIndent')) * PT_MM) : null,
        indentRight: num(pa('RightIndent')) != null ? round1(num(pa('RightIndent')) * PT_MM) : null,
        firstLine: num(pa('FirstLineIndent')) != null ? round1(num(pa('FirstLineIndent')) * PT_MM) : null,
        spaceBefore: round1((num(pa('SpaceBefore')) || 0) * PT_MM),
        spaceAfter: round1((num(pa('SpaceAfter')) || 0) * PT_MM),
        leading: null,
        tabs: null,
      };
      { // sekme durakları (yalnızca sola hizalı olanlar), pt -> mm
        const tl = kids(psr, 'Properties')[0] ? kids(kids(psr, 'Properties')[0], 'TabList')[0] : null;
        if (tl) {
          const arr = [];
          kids(tl, 'ListItem').forEach((li) => {
            const al = kids(li, 'Alignment')[0], po = kids(li, 'Position')[0];
            if (po && num(po.textContent) != null) { const v = round1(num(po.textContent) * PT_MM); if (!al || /LeftAlign/.test(al.textContent)) arr.push(v); else if (/RightAlign/.test(al.textContent)) arr.push(-v); else arr.push(v); }
          });
          if (arr.length) pfmt.tabs = arr;
        }
      }
      if (ps.leading != null && num(ps.leading) != null) pfmt.leading = num(ps.leading);
      let cur = { segs: [], ...pfmt }; let open = false;
      const push = () => { paras.push(cur); cur = { segs: [], ...pfmt, leading: cur.leading }; open = false; };
      kids(psr, 'CharacterStyleRange').forEach((csr) => {
        const cs = resolveStyle(csr.getAttribute('AppliedCharacterStyle'));
        const ca = (n) => (csr.hasAttribute(n) ? csr.getAttribute(n) : cs.attrs[n]);
        const props = kids(csr, 'Properties')[0];
        const ld = props ? kids(props, 'Leading')[0] : null;
        if (ld && num(ld.textContent) != null && cur.leading == null) cur.leading = num(ld.textContent);
        const fs = ca('FontStyle') || '';
        const pos = ca('Position') || '';
        const fam = props && kids(props, 'AppliedFont')[0] ? kids(props, 'AppliedFont')[0].textContent.trim() : null;
        const marks = {
          bold: /Bold|Black|Heavy/i.test(fs), italic: /Italic|Oblique/i.test(fs), underline: ca('Underline') === 'true',
          sup: /Superscript/i.test(pos), sub: /Subscript/i.test(pos), size: num(ca('PointSize')), fam,
        };
        Array.from(csr.children).forEach((ch) => {
          if (ch.tagName === 'Content') {
            const parts = (ch.textContent || '').split(' ');
            parts.forEach((t, i) => { if (i > 0) { cur.segs.push({ br: true }); } if (t) cur.segs.push({ text: t, marks }); });
            open = true;
          } else if (ch.tagName === 'Br') { push(); }
        });
        // Sayfa/sütun sonu işareti (InDesign'da "Page Break" ya da bağlı kutudan sonraki kutuya geçiş)
        if (/^Next/.test(ca('ParagraphBreakType') || '')) { if (open || cur.segs.length) push(); paras.push({ pageBreak: true }); }
      });
      if (open || cur.segs.length) paras.push(cur);
      if (/^Next/.test(pa('ParagraphBreakType') || '') && !(paras.length && paras[paras.length - 1].pageBreak)) paras.push({ pageBreak: true });
    });
    // bloklara böl: tamamen boş paragraflar (içinde hiçbir karakter olmayan) ayırıcıdır
    const textOf = (p) => (p.segs || []).map((g) => g.text || '').join('');
    // sayfalara böl (toplu aktarma için)
    const pages = []; let pg = [];
    const flushPage = () => {
      while (pg.length && textOf(pg[0]).length === 0) pg.shift();
      while (pg.length && textOf(pg[pg.length - 1]).length === 0) pg.pop();
      if (pg.length && pg.some((x) => textOf(x).trim().length)) pages.push(pg);
      pg = [];
    };
    paras.forEach((p) => { if (p.pageBreak) flushPage(); else pg.push(p); });
    flushPage();
    storyPages.push({ len: paras.reduce((n, p) => n + textOf(p).length, 0), pages });
    const blocks = []; let b = [];
    paras.forEach((p) => { if (p.pageBreak || textOf(p).length === 0) { if (b.length) { blocks.push(b); b = []; } } else b.push(p); });
    if (b.length) blocks.push(b);
    blocks.forEach((bl) => stories.push({ paras: bl, label: textOf(bl[0]).replace(/\s+/g, ' ').trim().slice(0, 110) || textOf(bl[bl.length - 1]).trim().slice(0, 110), count: bl.length }));
  });
  return { blocks: stories, skippedTables, storyPages };
}
// Çözüm sayfasının altındaki "|A|B|C|D|E|" satırını bulur; kalın (Black/Bold) harf doğru cevaptır.
function extractAnswer(paras) {
  const txt = (p) => (p.segs || []).map((g) => g.text || '').join('');
  let li = paras.length - 1;
  while (li >= 0 && !txt(paras[li]).trim()) li--;
  if (li < 0) return { answer: null, paras, found: false };
  const last = paras[li];
  // Cevap satırı bazen ayrı bir paragraf, bazen çözüm metninin hemen sonunda: sondan geriye
  // yalnızca "|", A-E harfleri ve boşluk içeren parçaları topla.
  let k = last.segs.length;
  while (k > 0) { const g = last.segs[k - 1]; if (g.br || !/^[|A-E\s]*$/.test(g.text || '')) break; k--; }
  const tail = last.segs.slice(k);
  const tailText = tail.map((g) => g.text || '').join('');
  if (!(tailText.length <= 30 && tailText.replace(/[^A-E]/g, '') === 'ABCDE')) return { answer: null, paras, found: false };
  const heavy = new Set();
  tail.forEach((g) => { if (g.marks && g.marks.bold && g.text) (g.text.match(/[A-E]/g) || []).forEach((L) => heavy.add(L)); });
  const rest = paras.slice(0, li);
  if (k > 0) rest.push({ ...last, segs: last.segs.slice(0, k) });
  while (rest.length && txt(rest[rest.length - 1]).length === 0) rest.pop();
  return { answer: heavy.size === 1 ? [...heavy][0] : null, paras: rest, found: true };
}
const icmlParasToJson = (paras) => paras.map((p) => {
  const attrs = { indentLeft: p.indentLeft, indentRight: p.indentRight, firstLine: p.firstLine, spaceBefore: p.spaceBefore, spaceAfter: p.spaceAfter, leading: p.leading, tabs: p.tabs || null };
  if (p.textAlign) attrs.textAlign = p.textAlign;
  const content = [];
  p.segs.forEach((g) => {
    if (g.br) { content.push({ type: 'hardBreak' }); return; }
    const m = g.marks; const marks = [];
    if (m.bold) marks.push({ type: 'bold' });
    if (m.italic) marks.push({ type: 'italic' });
    if (m.underline) marks.push({ type: 'underline' });
    if (m.sup) marks.push({ type: 'superscript' });
    if (m.sub) marks.push({ type: 'subscript' });
    const ts = {};
    if (m.size) ts.fontSize = `${(m.size * PX_PER_PT).toFixed(2)}px`;
    if (m.fam && FONTS.includes(m.fam)) ts.fontFamily = m.fam;
    if (Object.keys(ts).length) marks.push({ type: 'textStyle', attrs: ts });
    content.push(marks.length ? { type: 'text', text: g.text, marks } : { type: 'text', text: g.text });
  });
  return content.length ? { type: 'paragraph', attrs, content } : { type: 'paragraph', attrs };
});

// Sekme durakları: "20, 33.5, 48" gibi mm değerleri (soldan, metin alanının sol kenarından ölçülür).
function TabsField({ value, onCommit, onEnterDone }) {
  const show = (v) => (Array.isArray(v) && v.length ? v.map((n) => (n < 0 ? `${-n}r` : n)).join(', ') : '');
  const [t, setT] = useState('');
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setT(show(value)); }, [value, editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    setEditing(false);
    const nums = t.split(/[\s,;]+/).filter(Boolean).map((x) => { const r = /[rRsS]$/.test(x); const n = parseFloat(x.replace(',', '.')); return Number.isFinite(n) && n > 0 && n < 400 ? (r ? -n : n) : null; }).filter((n) => n != null);
    const uniq = [...new Set(nums.map((n) => Math.round(n * 10) / 10))].sort((a, b) => Math.abs(a) - Math.abs(b));
    onCommit(uniq.length ? uniq : null);
    setT(uniq.map((n) => (n < 0 ? `${-n}r` : n)).join(', '));
  };
  return (
    <label title="Sekme durakları (mm), virgülle ayırın: 20, 33.5, 48. Sağa hizalı durak için sayının sonuna r yazın: 12r. Tab tuşu sıradaki durağa gider. Boş = varsayılan" style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '0.72rem', color: '#475569' }}>
      Sekme
      <input type="text" value={t} placeholder="mm, mm…" onFocus={() => setEditing(true)} onChange={(e) => setT(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); if (onEnterDone) setTimeout(onEnterDone, 0); } }}
        style={{ width: '120px', height: '28px', borderRadius: '5px', border: '1px solid #cbd5e1', padding: '0 5px', boxSizing: 'border-box', fontSize: '0.8rem' }} />
      <span style={{ color: '#94a3b8' }}>mm</span>
    </label>
  );
}

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

export default function PoolQuestionEditor({ lessonCategories, topics, learningOutcomes, existingGroups, editRow, onClose, onSaved, onCreateLesson, onCreateTopic, onCreateOutcome }) {
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
  const [bulk, setBulk] = useState(null); // toplu aktarma penceresi: {items, notes, from, to, running, done, log}
  const bulkStop = useRef(false);
  const bulkLogMap = useRef(new Map());
  const cssRef = useRef(null);
  const [tRows, setTRows] = useState('3');
  const [tCols, setTCols] = useState('3');
  const [batchName, setBatchName] = useState(isEdit ? (editRow.upload_batch_id || '') : '');
  // Aynı adlı dersler (KPSS/MEB-AGS 'Tarih' gibi) tek ders olarak listelenir; kayıtlı soru ilk kopyaya çevrilir.
  const lessonsUniq = lessonCategories.filter((lc, i, a) => a.findIndex((x) => x.name === lc.name) === i);
  const canon = (() => {
    if (!isEdit || editRow.lesson_category_id == null) return { d: '', k: '', z: '' };
    const l = lessonCategories.find((x) => String(x.id) === String(editRow.lesson_category_id));
    const cl = l ? lessonCategories.find((x) => x.name === l.name) : null;
    const dId = cl ? cl.id : editRow.lesson_category_id;
    const t = topics.find((x) => String(x.id) === String(editRow.topic_id));
    const ct = t ? (topics.find((x) => x.lesson_category_id === dId && x.name === t.name) || t) : null;
    const o = learningOutcomes.find((x) => String(x.id) === String(editRow.outcome_id));
    const co = o ? (learningOutcomes.find((x) => ct && x.topic_id === ct.id && x.name === o.name) || o) : null;
    return { d: String(dId), k: ct ? String(ct.id) : (editRow.topic_id != null ? String(editRow.topic_id) : ''), z: co ? String(co.id) : (editRow.outcome_id != null ? String(editRow.outcome_id) : '') };
  })();
  const [dersId, setDersId] = useState(canon.d);
  const [konuId, setKonuId] = useState(canon.k);
  const [kazanimId, setKazanimId] = useState(canon.z);
  const [setCode, setSetCode] = useState(isEdit && editRow.set_key ? editRow.set_key.split('::').slice(1).join('::') : '');
  const [answer, setAnswer] = useState(isEdit ? (editRow.correct_answer || '') : '');
  // Ek etiketler: aynı soru başka ders/konu/kazanımda da (ör. KPSS Tarih + MEB-AGS Tarih + TYT) kullanılabilsin.
  const [extras, setExtras] = useState(() => {
    if (!isEdit || !Array.isArray(editRow.extra_outcome_ids)) return [];
    return editRow.extra_outcome_ids.map((oid) => {
      const lo = learningOutcomes.find((x) => String(x.id) === String(oid));
      if (!lo) return null;
      const tp = topics.find((t) => String(t.id) === String(lo.topic_id));
      return { dersId: String(tp ? tp.lesson_category_id : (lo.lesson_category_id || '')), konuId: String(lo.topic_id), kazanimId: String(lo.id) };
    }).filter(Boolean);
  });
  const updExtra = (i, patch) => setExtras((arr) => arr.map((x, k) => (k === i ? { ...x, ...patch } : x)));
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
  const availMm = (contentPxW - 2 * PAD_X) / MM_PX; // yazı alanı genişliği (mm)
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

  // ---- Toplu aktarma (soru dosyası + çözüm dosyası, her sayfa bir soru) ----
  const mainPages = (res) => (res.storyPages.slice().sort((a, b) => b.len - a.len)[0] || { pages: [] }).pages;
  const handleBulkFiles = async (qFile, sFile) => {
    try {
      const notes = [];
      const qRes = parseIcml(await qFile.text());
      const qPages = mainPages(qRes);
      const extraStories = qRes.storyPages.filter((x) => x.len > 0).length - 1;
      if (extraStories > 0) notes.push(`${extraStories} küçük metin kutusu (şekil etiketleri: I, II, III gibi) atlandı; şekilli sorulara resmi siz eklersiniz.`);
      let sPages = [];
      if (sFile) { sPages = mainPages(parseIcml(await sFile.text())); }
      if (sFile && sPages.length !== qPages.length) notes.push(`Soru sayfası ${qPages.length}, çözüm sayfası ${sPages.length}: sayılar eşit değil. Eşleştirme sıraya göredir, kontrol edin.`);
      const items = qPages.map((qp, i) => {
        const sp = sPages[i];
        const ex = sp ? extractAnswer(sp) : { answer: null, paras: [], found: false };
        const first = (qp.map((p) => p.segs.map((g) => g.text || '').join('')).join(' ')).replace(/\s+/g, ' ').trim();
        return { n: i + 1, q: qp, s: ex.paras, answer: ex.answer, answerLine: ex.found, label: first.slice(0, 100), fig: /harita|grafik|şekil|resim|görsel|piramit|tabloda|diyagram/i.test(first) };
      });
      setBulk({ items, notes, from: 1, to: Math.min(items.length, 50), running: false, done: 0, log: [], finished: false });
    } catch (err) { alert('Dosya okunamadı: ' + err.message); }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const runBulk = async () => {
    const batch = batchName.trim();
    if (!batch) { alert('Önce sağdaki "Grup Adı" alanını doldurun.'); return; }
    if (!dersId) { alert('Önce sağdan Ders seçin (Konu/Kazanım isteğe bağlı).'); return; }
    if (extrasIncomplete()) { alert('Ek etiketlerden birinde Kazanım seçilmemiş. Seçin ya da ✕ ile kaldırın.'); return; }
    if (!qEditor || !sEditor) return;
    const from = Math.max(1, bulk.from), to = Math.min(bulk.items.length, bulk.to);
    if (!(to >= from)) { alert('Aralığı kontrol edin.'); return; }
    bulkStop.current = false;
    setBulk((b) => ({ ...b, running: true, finished: false, done: 0, log: [] }));
    const avail = contentPxH - PAD_Y * 2;
    const log = []; let done = 0;
    for (let n = from; n <= to; n++) {
      if (bulkStop.current) break;
      const it = bulk.items[n - 1];
      try {
        if (!it.answer) throw new Error(it.answerLine ? 'doğru cevap okunamadı (kalın harf yok ya da birden fazla)' : 'çözüm dosyasında cevap satırı bulunamadı');
        qEditor.chain().setMeta('addToHistory', false).setContent({ type: 'doc', content: icmlParasToJson(it.q) }).run(); // geri al geçmişi şişmesin
        const hasSol = it.s && it.s.some((p) => (p.segs || []).length);
        sEditor.chain().setMeta('addToHistory', false).setContent(hasSol ? { type: 'doc', content: icmlParasToJson(it.s) } : '').run();
        setAnswer(it.answer);
        await sleep(420);
        const qh = qPageRef.current.querySelector('.ProseMirror').offsetHeight;
        const sh = sPageRef.current.querySelector('.ProseMirror').offsetHeight;
        if (qh > avail + 1) throw new Error('soru sayfaya sığmıyor (sayfa boyunu büyütün)');
        if (hasSol && sh > avail + 1) throw new Error('çözüm sayfaya sığmıyor');
        qEditor.commands.blur(); sEditor.commands.blur();
        const qName = await uploadPdf(await pageToPdfBytes(qPageRef.current), 'pool');
        let sName = null;
        if (hasSol) sName = await uploadPdf(await pageToPdfBytes(sPageRef.current), 'pool_sol');
        const { error } = await supabase.from('question_pool').insert([{
          pdf_file: qName, solution_pdf_file: sName, correct_answer: it.answer, upload_batch_id: batch,
          lesson_category_id: dersId || null, topic_id: konuId || null, outcome_id: kazanimId || null, extra_outcome_ids: extraOutcomeIds(), set_key: null,
          source_json: { v: 2, w: pageW, h: pageH, hyph, q: qEditor.getJSON(), s: hasSol ? sEditor.getJSON() : null },
        }]);
        if (error) throw new Error(error.message);
        done++;
        log.push({ n, ok: true });
      } catch (err) { log.push({ n, ok: false, msg: err.message }); }
      setBulk((b) => ({ ...b, done: n - from + 1, log: log.slice() }));
    }
    qEditor.commands.clearContent(true); sEditor.commands.clearContent(true); setAnswer('');
    setBulk((b) => ({ ...b, running: false, finished: true, log: log.slice() }));
    if (done && onSaved) onSaved();
  };

  const handleImageFile = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f || !ed) return;
    try {
      const dataUrl = await fileToPngDataUrl(f);
      ed.chain().focus().setImage({ src: dataUrl, srcName: f.name, width: 45, widthMm: Math.round(Math.min(60, availMm * 0.45)) }).run();
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

  // html2canvas normalde TÜM sayfanın (admin panelinin bütün listeleri dahil) kopyasını çıkarıyor; uygulama büyüdükçe
  // her soru onlarca saniye sürüyordu. Bu yüzden sayfayı küçük, boş bir iframe'e kopyalayıp orada çekiyoruz.
  const captureCanvas = async (node) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = `position:fixed;left:-99999px;top:0;border:0;width:${node.offsetWidth + 4}px;height:${node.offsetHeight + 4}px;`;
    document.body.appendChild(iframe);
    try {
      const idoc = iframe.contentDocument;
      idoc.open();
      idoc.write(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>${cssRef.current ? cssRef.current.textContent : ''}\nbody{margin:0;background:#fff}</style></head><body></body></html>`);
      idoc.close();
      const clone = node.cloneNode(true);
      clone.style.boxShadow = 'none';
      idoc.body.appendChild(clone);
      return await html2canvas(clone, { scale: 3, backgroundColor: '#ffffff', logging: false });
    } finally {
      iframe.remove();
    }
  };
  const pageToPdfBytes = async (node) => {
    const canvas = await captureCanvas(node);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    const pngBytes = new Uint8Array(await blob.arrayBuffer());
    canvas.width = 0; canvas.height = 0; // büyük tuvali hemen bırak (toplu yüklemede bellek şişmesin)
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

  const extraOutcomeIds = () => {
    const out = [];
    extras.forEach((x) => {
      const lo = learningOutcomes.find((l) => String(l.id) === String(x.kazanimId));
      if (lo && String(lo.id) !== String(kazanimId) && !out.some((o) => String(o) === String(lo.id))) out.push(lo.id);
    });
    return out;
  };
  const extrasIncomplete = () => extras.some((x) => (x.dersId || x.konuId) && !x.kazanimId);

  const handleSave = async () => {
    const batch = batchName.trim();
    if (!batch) { alert('Grup adı girin (sağdaki alandan, ör. "Biyoloji Kitabı 1").'); return; }
    if (!qEditor || qEditor.getText().trim().length === 0) { alert('Soru sayfasına soruyu yazın.'); return; }
    if (!['A', 'B', 'C', 'D', 'E'].includes(answer)) { alert('Doğru cevabı seçin (sağ taraf).'); return; }
    if (extrasIncomplete()) { alert('Ek etiketlerden birinde Kazanım seçilmemiş. Seçin ya da ✕ ile kaldırın.'); return; }
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
        extra_outcome_ids: extraOutcomeIds(),
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

  // Boyut kutuları: yazarken serbest; kutudan çıkınca (ya da Enter) 5-30 cm arasına çekilip uygulanır.
  // Sayfa boyutu değişmeden önce yüzdeyle (eski) ölçülmüş resimleri mm'ye sabitler.
  const freezeImages = () => {
    [qEditor, sEditor].forEach((e) => {
      if (!e) return;
      const found = [];
      e.state.doc.descendants((node, pos) => { if (node.type.name === 'image' && node.attrs.widthMm == null) found.push({ node, pos }); });
      if (!found.length) return;
      const tr = e.state.tr;
      found.forEach(({ node, pos }) => tr.setNodeMarkup(pos, undefined, { ...node.attrs, widthMm: Math.round((node.attrs.width || 50) * availMm) / 100 }));
      e.view.dispatch(tr);
    });
  };
  const commitSize = (which) => {
    const raw = which === 'w' ? wInput : hInput;
    const n = parseFloat(String(raw).replace(',', '.'));
    const cur = which === 'w' ? pageW : pageH;
    const v = Number.isFinite(n) ? Math.min(30, Math.max(5, n)) : cur;
    if (v !== cur) freezeImages();
    if (which === 'w') { setPageW(v); setWInput(String(v)); } else { setPageH(v); setHInput(String(v)); }
  };
  const pa = ed ? ed.getAttributes('paragraph') : {};
  const setPara = (key, v) => { if (ed) ed.chain().updateAttributes('paragraph', { [key]: v }).run(); };
  const refocus = () => { if (ed) ed.commands.focus(); };
  const inTable = !!ed && ed.isActive('table');
  const doTable = (fn) => () => { if (ed) fn(ed.chain().focus()).run(); };
  // Tablo ayarları (mm / pt). Hepsi imlecin bulunduğu tabloya uygulanır.
  const tableInfo = () => {
    if (!ed || !inTable) return null;
    try {
      const rect = selectedRect(ed.state);
      const { map, table, tableStart } = rect;
      const cellAt = (r, c) => table.nodeAt(map.map[r * map.width + c]);
      const cw = cellAt(rect.top, rect.left).attrs.colwidth;
      let total = 0, all = true;
      for (let c = 0; c < map.width; c++) { const w = cellAt(0, c).attrs.colwidth; if (w && w[0]) total += w[0]; else all = false; }
      const rowNode = table.child(rect.top);
      return { rect, map, table, tableStart, colMm: cw && cw[0] ? cw[0] / MM_PX : null, tableMm: all ? total / MM_PX : null, rowH: rowNode.attrs.rowH, bw: table.attrs.borderW == null ? 0.75 : table.attrs.borderW, fit: !!table.attrs.fit };
    } catch (e) { return null; }
  };
  const tblSetColW = (mm, wholeTable) => {
    const ti = tableInfo(); if (!ti || !(mm > 0)) return;
    const { map, table, tableStart, rect } = ti;
    const px = Math.max(20, Math.round(mm * MM_PX));
    const tr = ed.state.tr;
    const cols = wholeTable ? Array.from({ length: map.width }, (_, i) => i) : [rect.left];
    const per = wholeTable ? Math.max(20, Math.round(mm * MM_PX / map.width)) : px;
    cols.forEach((c) => {
      for (let r = 0; r < map.height; r++) {
        const pos = map.map[r * map.width + c];
        const node = table.nodeAt(pos);
        if (node.attrs.colspan > 1) continue;
        tr.setNodeMarkup(tableStart + pos, undefined, { ...node.attrs, colwidth: [per] });
      }
    });
    tr.setNodeMarkup(tableStart - 1, undefined, { ...table.attrs, fit: false });
    ed.view.dispatch(tr);
  };
  const tblResetW = () => {
    const ti = tableInfo(); if (!ti) return;
    const { map, table, tableStart } = ti;
    const tr = ed.state.tr;
    for (let r = 0; r < map.height; r++) for (let c = 0; c < map.width; c++) {
      const pos = map.map[r * map.width + c];
      const node = table.nodeAt(pos);
      if (node.attrs.colwidth) tr.setNodeMarkup(tableStart + pos, undefined, { ...node.attrs, colwidth: null });
    }
    ed.view.dispatch(tr);
  };
  const tblSetAttr = (k, v) => {
    const ti = tableInfo(); if (!ti) return;
    ed.view.dispatch(ed.state.tr.setNodeMarkup(ti.tableStart - 1, undefined, { ...ti.table.attrs, [k]: v }));
  };
  const tblFit = (on) => { if (on) tblResetW(); tblSetAttr('fit', on); };
  const tblSetRowH = (mm) => {
    const ti = tableInfo(); if (!ti) return;
    const { table, tableStart, rect } = ti;
    const tr = ed.state.tr;
    let pos = tableStart;
    table.forEach((row, _o, i) => {
      if (i >= rect.top && i < rect.bottom) tr.setNodeMarkup(pos, undefined, { ...row.attrs, rowH: mm > 0 ? mm : null });
      pos += row.nodeSize;
    });
    ed.view.dispatch(tr);
  };
  const ti = tableInfo();

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
  // Bağlantılar: iki sayfadaki tüm resimler ve geldikleri dosya adları
  const imgLinks = [];
  [['q', qEditor, 'Soru'], ['s', sEditor, 'Çözüm']].forEach(([k, e, label]) => {
    if (!e) return;
    e.state.doc.descendants((node, pos) => { if (node.type.name === 'image') imgLinks.push({ k, e, pos, label, name: node.attrs.srcName }); });
  });
  const selectLink = (l) => { setActive(l.k); l.e.chain().focus().setNodeSelection(l.pos).run(); };

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
      <style ref={cssRef}>{`
        .pq-page .ProseMirror { outline: none; min-height: ${contentPxH - PAD_Y * 2}px; hyphens: ${hyph ? 'auto' : 'manual'}; -webkit-hyphens: ${hyph ? 'auto' : 'manual'}; tab-size: ${7 * MM_PX}px; }
        .pq-page .ProseMirror p { margin: 0 0 ${MM_PX}px; }
        .pq-page .ProseMirror table { border-collapse: collapse; table-layout: fixed; width: 100%; margin: 4px 0; }
        .pq-page .ProseMirror table.pq-fit { table-layout: auto; width: auto; }
        .pq-page .ProseMirror table.pq-noborder td, .pq-page .ProseMirror table.pq-noborder th { border-color: transparent; }
        .pq-page .ProseMirror td, .pq-page .ProseMirror th { border: var(--bw, 1px) solid #000; padding: 2px 5px; vertical-align: top; position: relative; box-sizing: border-box; min-width: 1em; }
        .pq-page .ProseMirror td p, .pq-page .ProseMirror th p { margin: 0; }
        .pq-page .ProseMirror .selectedCell:after { content: ''; position: absolute; inset: 0; background: rgba(37,99,235,0.18); pointer-events: none; }
        .pq-page .ProseMirror .column-resize-handle { position: absolute; right: -2px; top: 0; bottom: 0; width: 4px; background: #2563eb; pointer-events: none; }
        .pq-page .ProseMirror .tableWrapper { overflow-x: auto; }
        .pq-page .ProseMirror img { max-width: 100%; vertical-align: middle; }
        .pq-page .ProseMirror img.ProseMirror-selectednode { outline: 2px solid #2563eb; }
        .pq-page .ProseMirror sub, .pq-page .ProseMirror sup { line-height: 0; }
      `}</style>
      {bulk && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.6)', zIndex: 1250, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ backgroundColor: '#fff', borderRadius: '12px', padding: '20px', width: '760px', maxWidth: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
            <h3 style={{ margin: '0 0 8px' }}>📚 InDesign'dan toplu aktar</h3>
            {!bulk.items && (
              <div style={{ fontSize: '0.85rem', lineHeight: 1.6 }}>
                <p style={{ margin: '0 0 10px', color: '#475569' }}>Her sayfası bir soru olan InDesign dosyasını <b>InCopy Document (.icml)</b> olarak dışa aktarın. Çözüm dosyasını da aynı şekilde (soru sırasıyla aynı sırada, her sayfa bir çözüm). Doğru cevap, çözüm sayfası altındaki |A|B|C|D|E| satırındaki kalın harften okunur.</p>
                <label style={{ display: 'block', margin: '8px 0 2px', fontWeight: 'bold' }}>1) Soru dosyası (.icml)</label>
                <input type="file" accept=".icml,.xml" id="bulkQ" />
                <label style={{ display: 'block', margin: '10px 0 2px', fontWeight: 'bold' }}>2) Çözüm dosyası (.icml)</label>
                <input type="file" accept=".icml,.xml" id="bulkS" />
                <div style={{ marginTop: '14px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button style={{ ...tbBtn(false), height: '34px' }} onClick={() => setBulk(null)}>Vazgeç</button>
                  <button style={{ ...tbBtn(true), height: '34px', backgroundColor: '#2563eb', color: '#fff' }} onClick={() => {
                    const q = document.getElementById('bulkQ').files[0]; const sf = document.getElementById('bulkS').files[0];
                    if (!q) { alert('Soru dosyasını seçin.'); return; }
                    handleBulkFiles(q, sf);
                  }}>Dosyaları oku</button>
                </div>
              </div>
            )}
            {bulk.items && (
              <>
                <div style={{ fontSize: '0.82rem', color: '#334155', marginBottom: '6px' }}>
                  <b>{bulk.items.length}</b> soru bulundu · doğru cevabı okunan: <b>{bulk.items.filter((x) => x.answer).length}</b>
                  {bulk.items.some((x) => !x.answer) && <span style={{ color: '#b45309' }}> · cevabı bulunamayan: {bulk.items.filter((x) => !x.answer).length} (kaydedilmez, listede işaretli)</span>}
                </div>
                {bulk.notes.map((t, i) => <div key={i} style={{ fontSize: '0.78rem', color: '#b45309', marginBottom: '3px' }}>⚠ {t}</div>)}
                <div style={{ overflowY: 'auto', flex: 1, border: '1px solid #e2e8f0', borderRadius: '8px', margin: '8px 0', minHeight: '140px' }}>
                  {(() => { bulkLogMap.current = new Map(bulk.log.map((l) => [l.n, l])); return null; })()}
                  {bulk.items.map((it) => {
                    const lg = bulkLogMap.current.get(it.n);
                    return (
                      <div key={it.n} style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '5px 8px', fontSize: '0.78rem', borderBottom: '1px solid #f1f5f9', backgroundColor: lg ? (lg.ok ? '#f0fdf4' : '#fef2f2') : 'transparent' }}>
                        <b style={{ width: '34px', color: '#2563eb' }}>{it.n}</b>
                        <span style={{ width: '24px', fontWeight: 'bold', color: it.answer ? '#16a34a' : '#dc2626' }}>{it.answer || '?'}</span>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
                        {it.fig && <span title="Metinde şekil/harita/grafik geçiyor; resmi eklemeniz gerekebilir">🖼?</span>}
                        {lg && <span style={{ color: lg.ok ? '#16a34a' : '#dc2626' }}>{lg.ok ? '✓ kaydedildi' : '✗ ' + lg.msg}</span>}
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.8rem' }}>
                  <span>Aralık:</span>
                  <input type="number" min={1} max={bulk.items.length} value={bulk.from} disabled={bulk.running} onChange={(e) => setBulk((b) => ({ ...b, from: Number(e.target.value) }))} style={{ width: '70px', height: '30px' }} />
                  <span>–</span>
                  <input type="number" min={1} max={bulk.items.length} value={bulk.to} disabled={bulk.running} onChange={(e) => setBulk((b) => ({ ...b, to: Number(e.target.value) }))} style={{ width: '70px', height: '30px' }} />
                  <span style={{ color: '#64748b' }}>Grup: <b>{batchName.trim() || '(sağdan girin)'}</b> · Sayfa: {pageW}×{pageH} cm</span>
                </div>
                {bulk.running && <div style={{ marginTop: '8px', fontSize: '0.85rem' }}>⏳ {bulk.done} / {Math.min(bulk.items.length, bulk.to) - Math.max(1, bulk.from) + 1} işleniyor… (sekmeyi kapatmayın)</div>}
                {bulk.finished && <div style={{ marginTop: '8px', fontSize: '0.85rem', fontWeight: 'bold' }}>Bitti: {bulk.log.filter((l) => l.ok).length} kaydedildi, {bulk.log.filter((l) => !l.ok).length} atlandı.</div>}
                <div style={{ marginTop: '12px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  {bulk.running
                    ? <button style={{ ...tbBtn(false), height: '34px' }} onClick={() => { bulkStop.current = true; }}>Durdur</button>
                    : <>
                      <button style={{ ...tbBtn(false), height: '34px' }} onClick={() => setBulk(null)}>Kapat</button>
                      <button style={{ ...tbBtn(true), height: '34px', backgroundColor: '#2563eb', color: '#fff' }} onClick={runBulk}>Seçili aralığı havuza kaydet</button>
                    </>}
                </div>
              </>
            )}
          </div>
        </div>
      )}
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
              <TabsField value={pa.tabs} onEnterDone={refocus} onCommit={(arr) => setPara('tabs', arr)} />
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
                <NumField label="Resim gen." title="Resim genişliği (mm). Sayfa boyutu değişse de sabit kalır" width={52} unit="mm"
                  value={(() => { const a = ed.getAttributes('image'); return a.widthMm != null ? Math.round(a.widthMm * 10) / 10 : Math.round((a.width || 50) * availMm) / 100; })()}
                  onEnterDone={refocus} onCommit={(v) => { if (v > 0) ed.chain().updateAttributes('image', { widthMm: Math.min(v, Math.round(availMm)) }).run(); }} />
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
              {!isEdit && <button title="500 sayfalık InDesign dosyasından (her sayfa bir soru) toplu aktarır" onMouseDown={keep} onClick={() => setBulk({ items: null })} style={tbBtn(false)}>📚 Toplu aktar</button>}
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
            {inTable && ti && (
              <div style={{ ...rowStyle, borderTop: '1px dashed #cbd5e1', marginTop: '2px' }}>
                <span style={rowTag} title="Tablo ayarları">⚙</span>
                <NumField label="Tablo gen." title="Tablonun toplam genişliği (mm); sütunlar eşit bölünür" width={50} unit="mm" value={ti.tableMm == null ? null : Math.round(ti.tableMm * 10) / 10} onEnterDone={refocus} onCommit={(v) => tblSetColW(v, true)} />
                <NumField label="Sütun gen." title="İmlecin olduğu sütunun genişliği (mm)" width={50} unit="mm" value={ti.colMm == null ? null : Math.round(ti.colMm * 10) / 10} onEnterDone={refocus} onCommit={(v) => tblSetColW(v, false)} />
                <NumField label="Satır yük." title="Seçili satırların en az yüksekliği (mm). Yazı sığmazsa hücre otomatik büyür. Boş/0 = otomatik" width={50} unit="mm" value={ti.rowH} onEnterDone={refocus} onCommit={(v) => tblSetRowH(v)} />
                <NumField label="Çerçeve" title="Çerçeve kalınlığı (pt). 0 = çerçevesiz" width={46} unit="pt" value={ti.bw} onEnterDone={refocus} onCommit={(v) => tblSetAttr('borderW', Math.min(6, Math.max(0, v == null ? 0.75 : v)))} />
                <label style={{ fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }} title="Sütun genişlikleri yazıya göre otomatik olur">
                  <input type="checkbox" checked={ti.fit} onMouseDown={keep} onChange={(e) => tblFit(e.target.checked)} />Genişlik yazıya göre
                </label>
                <button title="Elle verilen sütun genişliklerini sıfırlar (sayfaya eşit yayılır)" onMouseDown={keep} onClick={tblResetW} style={tbBtn(false)}>Genişliği sıfırla</button>
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

          <CategoryPicker
            lessons={lessonCategories} topics={topics} outcomes={learningOutcomes}
            dersId={dersId} konuId={konuId} kazanimId={kazanimId}
            onChange={(v) => { setDersId(v.dersId); setKonuId(v.konuId); setKazanimId(v.kazanimId); }}
            onCreateLesson={onCreateLesson} onCreateTopic={onCreateTopic} onCreateOutcome={onCreateOutcome}
            labelStyle={lbl} selectStyle={inp}
          />

          {extras.map((x, i) => {
            const ks = topics.filter((t) => String(t.lesson_category_id) === String(x.dersId));
            const zs = learningOutcomes.filter((lo) => String(lo.topic_id) === String(x.konuId));
            return (
              <div key={i} style={{ marginTop: '10px', padding: '8px', border: '1px dashed #94a3b8', borderRadius: '8px', backgroundColor: '#f8fafc' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 'bold', color: '#475569', marginBottom: '4px' }}>
                  <span>Ek etiket {i + 1}</span>
                  <button type="button" onClick={() => setExtras((arr) => arr.filter((_, k) => k !== i))} style={{ border: 'none', background: 'none', color: '#dc2626', cursor: 'pointer', fontWeight: 'bold' }}>✕ kaldır</button>
                </div>
                <select style={{ ...inp, marginBottom: '5px' }} value={x.dersId} onChange={(e) => updExtra(i, { dersId: e.target.value, konuId: '', kazanimId: '' })}>
                  <option value="">Ders seçin</option>
                  {lessonsUniq.map((lc) => <option key={lc.id} value={lc.id}>{lc.name}</option>)}
                </select>
                <select style={{ ...inp, marginBottom: '5px' }} value={x.konuId} disabled={!x.dersId} onChange={(e) => updExtra(i, { konuId: e.target.value, kazanimId: '' })}>
                  <option value="">{x.dersId ? 'Konu seçin' : 'Önce Ders seçin'}</option>
                  {ks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <select style={inp} value={x.kazanimId} disabled={!x.konuId} onChange={(e) => updExtra(i, { kazanimId: e.target.value })}>
                  <option value="">{x.konuId ? 'Kazanım seçin' : 'Önce Konu seçin'}</option>
                  {zs.map((lo) => <option key={lo.id} value={lo.id}>{lo.name}</option>)}
                </select>
              </div>
            );
          })}
          <button type="button" onClick={() => setExtras((arr) => [...arr, { dersId: '', konuId: '', kazanimId: '' }])}
            title="Aynı soru başka bir ders/konu/kazanımda da test üretiminde kullanılsın (ör. KPSS Tarih + MEB-AGS Tarih + TYT)"
            style={{ marginTop: '8px', width: '100%', padding: '7px', borderRadius: '6px', border: '1px dashed #2563eb', backgroundColor: '#fff', color: '#2563eb', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.8rem' }}>
            ＋ Başka ders / kazanımda da kullan
          </button>

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
          <div style={{ marginTop: '16px' }}>
            <label style={lbl}>🔗 Bağlantılar (resim dosyaları)</label>
            {imgLinks.length === 0 && <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Henüz resim yok.</div>}
            {imgLinks.map((l, i) => (
              <div key={i} onClick={() => selectLink(l)} title="Resmi seç. Dosya adını kopyalamak için sağdaki düğme" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: '6px', marginBottom: '4px', cursor: 'pointer', fontSize: '0.78rem', backgroundColor: '#f8fafc' }}>
                <span style={{ color: '#64748b', flexShrink: 0 }}>{l.label}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 'bold', color: l.name ? '#1d4ed8' : '#94a3b8' }}>{l.name || '(dosya adı kayıtlı değil)'}</span>
                {l.name && <button onClick={(ev) => { ev.stopPropagation(); try { navigator.clipboard.writeText(l.name); } catch (e2) { /* yoksay */ } }} style={{ border: '1px solid #cbd5e1', borderRadius: '4px', background: '#fff', cursor: 'pointer', fontSize: '0.7rem' }}>Kopyala</button>}
              </div>
            ))}
          </div>
          <div style={{ marginTop: '14px', fontSize: '0.75rem', color: '#64748b', lineHeight: 1.5 }}>
            İpucu: Yazı alanına tıklayıp yazın; üstteki araçlar imlecin bulunduğu sayfaya (Soru ya da Çözüm) uygulanır. “＋ Şık ekle” soru sayfasının sonuna A–E satırlarını açar.
          </div>
        </div>
      </div>
    </div>
  );
}

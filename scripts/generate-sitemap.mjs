// scripts/generate-sitemap.mjs
//
// Build sırasında (npm run build) çalışır: Supabase'den yayınlanmış (is_published = true)
// tüm sınavları çeker ve public/sitemap.xml dosyasını otomatik olarak günceller.
// Vite, public/ klasöründeki her şeyi build sırasında olduğu gibi dist/ içine
// kopyaladığı için, ayrıca dist'e dokunmamıza gerek yok.

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SITE_URL = 'https://sualink.com';
const SUPABASE_URL = 'https://gzkqylheloxcgpcrftci.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_zDB7lVQ00ickN7N-YxEXog__OHGX-Od';

async function fetchPublishedExams() {
  const url =
    `${SUPABASE_URL}/rest/v1/exams` +
    `?select=id,created_at` +
    `&is_published=eq.true` +
    `&order=created_at.desc`;

  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });

  if (!res.ok) {
    console.error('Sitemap: Supabase sorgusu başarısız oldu, sadece ana sayfa ile devam ediliyor.', res.status);
    return [];
  }

  return res.json();
}

function buildSitemapXml(exams) {
  const today = new Date().toISOString().split('T')[0];

  const staticUrls = [
    { loc: `${SITE_URL}/`, lastmod: today, priority: '1.0' },
  ];

  const examUrls = exams.map((exam) => ({
    loc: `${SITE_URL}/?exam=${exam.id}`,
    lastmod: exam.created_at ? exam.created_at.split('T')[0] : today,
    priority: '0.8',
  }));

  const allUrls = [...staticUrls, ...examUrls];

  const body = allUrls
    .map(
      (u) => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <priority>${u.priority}</priority>
  </url>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

async function main() {
  console.log('Sitemap: Supabase\'den yayınlanmış sınavlar çekiliyor...');
  const exams = await fetchPublishedExams();
  console.log(`Sitemap: ${exams.length} sınav bulundu.`);

  const xml = buildSitemapXml(exams);
  const outPath = join(__dirname, '..', 'public', 'sitemap.xml');
  writeFileSync(outPath, xml, 'utf-8');

  console.log(`Sitemap: public/sitemap.xml oluşturuldu (${exams.length + 1} URL).`);
}

main().catch((err) => {
  console.error('Sitemap oluşturulurken hata oluştu:', err);
  // Sitemap hatası build'i durdurmasın -- site build'i her zaman devam etsin.
  process.exit(0);
});

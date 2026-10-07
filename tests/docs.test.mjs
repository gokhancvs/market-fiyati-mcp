import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changelogSections, linkProblems } from '../scripts/release-notes.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const markdown = (dir) =>
  readdirSync(join(root, dir))
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(dir, name));
const publicDocs = [
  'README.md',
  'CHANGELOG.md',
  'SECURITY.md',
  '.github/pull_request_template.md',
  ...markdown('docs')
];
const issueTemplates = readdirSync(join(root, '.github/ISSUE_TEMPLATE')).map((name) =>
  join('.github/ISSUE_TEMPLATE', name)
);
const read = (path) => readFileSync(join(root, path), 'utf8');
const withoutCode = (text) => text.replace(/^```[\s\S]*?^```$/gm, (block) => block.replace(/[^\n]/g, ''));
const links = (text) =>
  [...withoutCode(text).matchAll(/\[([^\]]*)\]\(([^)\s]+)\)/g)].map(([, label, href]) => ({ label, href }));

const slug = (heading) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
const anchors = (path) => {
  const seen = new Map();
  return new Set(
    [...withoutCode(read(path)).matchAll(/^#{1,6} (.+)$/gm)].map(([, heading]) => {
      const base = slug(heading);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      return count ? `${base}-${count}` : base;
    })
  );
};

test('public documentation links and anchors resolve', () => {
  const broken = [];
  for (const path of publicDocs) {
    for (const { href } of links(read(path))) {
      if (/^[a-z]+:/i.test(href)) continue;
      const [file, anchor] = href.split('#');
      const target = file ? relative(root, join(root, dirname(path), decodeURI(file))) : path;
      if (!existsSync(join(root, target))) broken.push(`${path}: ${href} (missing file)`);
      else if (anchor && target.endsWith('.md') && !anchors(target).has(decodeURIComponent(anchor))) {
        broken.push(`${path}: ${href} (missing anchor)`);
      }
    }
  }
  assert.deepEqual(broken, []);
});

test('CHANGELOG sections keep absolute links pinned to their tag because they become GitHub Release bodies', () => {
  const sections = changelogSections(read('CHANGELOG.md'));
  assert.deepEqual(
    sections.filter(({ heading, version }) => !version && heading !== 'Yayımlanmamış').map(({ heading }) => heading),
    [],
    'every section is Yayımlanmamış or "X.Y.Z — YYYY-MM-DD"'
  );
  const problems = sections.flatMap(({ heading, version, body }) =>
    linkProblems(body, version && `v${version}`).map((href) => `${heading}: ${href}`)
  );
  assert.deepEqual(problems, []);
});

test('the live query guide has one name in every link', () => {
  const names = publicDocs.flatMap((path) =>
    links(read(path))
      .filter(({ href }) => /live-testing\.md/.test(href))
      .filter(({ label }) => !label.startsWith('Gerçek fiyatlarla sorgulama'))
      .map(({ label }) => `${path}: ${label}`)
  );
  assert.deepEqual(names, []);
});

const banned = [
  [/[‘’]/, 'curly apostrophe; use straight quote'],
  [/AI['’]a\b/, "AI'ya"],
  [/\bRTK\b/, 'maintainer shell convention'],
  [/yaklaşık \d+(?:[–-]\d+)? dakika/i, 'unmeasured duration'],
  [/(?<!\p{L})dahil/iu, 'dâhil'],
  [/canlı/i, 'live'],
  [/(?<!\p{L})araç/iu, 'tool'],
  [/teklif/i, 'offer'],
  [/mağaza/i, 'şube'],
  [/\bradius\b/i, 'yarıçap'],
  [/teşhis/i, 'tanılama'],
  [/doküman/i, 'belge'],
  [/ilan edil/i, 'calque'],
  [/yanıt gözlemleri/i, 'calque'],
  [/tüketici/i, 'bağımsız kurulum testi'],
  [/kaçış yolu/i, 'calque'],
  [/kabul kit/i, 'sentetik kabul testleri'],
  [/açıklayıcı tercih/i, 'calque'],
  [/kullanıcıyla birlikte/i, 'maintainer voice'],
  [/yeniden istemeyin/i, 'maintainer voice'],
  [/henüz npm|yayını tamamlandıktan sonra/i, 'stale future tense'],
  [/^#+ Context\b/m, 'Turkish heading'],
  [/context'/i, 'bağlam'],
  [/23\.09\.2026/, 'pre-1.0.0 compatibility note'],
  [/`any`yi/, "`any`'yi"]
];

// Prose is hard-wrapped, so a space in a phrase also matches a line break.
const acrossLines = (pattern) => new RegExp(pattern.source.replace(/ /g, '\\s+'), `${pattern.flags}g`);

test('public documentation follows the Turkish glossary and style', () => {
  const findings = [];
  for (const path of [...publicDocs, ...issueTemplates]) {
    const text = withoutCode(read(path));
    for (const [pattern, fix] of banned) {
      for (const { index } of text.matchAll(acrossLines(pattern))) {
        findings.push(`${path}:${text.slice(0, index).split('\n').length} ${pattern} → ${fix}`);
      }
    }
  }
  assert.deepEqual(findings, []);
});

test('every application error code in src is documented in the API error sections', () => {
  const api = read('docs/api.md');
  const errorDocs = api.slice(api.indexOf('### Hata çıktısı'));
  // A code is the first AppError argument (possibly a ternary) or an envelope `code:` literal.
  const sources = readdirSync(join(root, 'src'))
    .filter((name) => name.endsWith('.ts'))
    .flatMap((name) => [
      ...[...read(join('src', name)).matchAll(/new AppError\(\s*([^,]+),/g)].map(([, first]) => first),
      ...[...read(join('src', name)).matchAll(/code: ('[A-Z_]+')/g)].map(([, literal]) => literal)
    ]);
  const codes = new Set(sources.flatMap((source) => [...source.matchAll(/'([A-Z_]+)'/g)].map(([, code]) => code)));
  assert.ok(codes.has('RATE_LIMITED') && codes.has('INTERNAL_ERROR'));
  assert.deepEqual(
    [...codes].filter((code) => !errorDocs.includes(`\`${code}\``)),
    []
  );
});

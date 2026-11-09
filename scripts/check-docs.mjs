import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
);
const files = ['README.md', 'ARCHITECTURE.md', 'AGENTS.md'];
const fail = [];
let links = 0,
  examples = 0;
const heading = (s) =>
  s
    .toLowerCase()
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[\x60*_]/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
function anchors(file) {
  const text = fs
    .readFileSync(file, 'utf8')
    .replace(/^[ \t]*\x60\x60\x60[^\n]*\n[\s\S]*?^[ \t]*\x60\x60\x60/gm, '');
  const seen = new Map();
  const result = new Set();
  for (const m of text.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const name = heading(m[1]);
    const count = seen.get(name) || 0;
    seen.set(name, count + 1);
    result.add(name + (count ? '-' + count : ''));
  }
  for (const m of text.matchAll(/<a\s+id="([^"]+)"/g)) result.add(m[1]);
  return result;
}
for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const prose = source.replace(
    /^[ \t]*\x60\x60\x60[^\n]*\n[\s\S]*?^[ \t]*\x60\x60\x60/gm,
    '',
  );
  for (const match of prose.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const ref = match[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) continue;
    const [target, fragment] = ref.split('#');
    const dest = path.resolve(
      root,
      path.dirname(file),
      decodeURIComponent(target || file),
    );
    links++;
    if (!fs.existsSync(dest)) {
      fail.push(file + ': missing ' + ref);
      continue;
    }
    if (
      fragment &&
      dest.endsWith('.md') &&
      !anchors(dest).has(decodeURIComponent(fragment))
    )
      fail.push(file + ': missing anchor ' + ref);
  }
  for (const m of source.matchAll(/\bnpm run ([a-zA-Z0-9:_-]+)/g))
    if (!pkg.scripts[m[1]]) fail.push(file + ': unknown npm script ' + m[1]);
  for (const m of source.matchAll(
    /\x60\x60\x60json\s*\n([\s\S]*?)\x60\x60\x60/g,
  )) {
    try {
      JSON.parse(m[1]);
      examples++;
    } catch {
      fail.push(file + ': invalid JSON example');
    }
  }
}
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const expected = [
  '/health',
  '/docs',
  '/openapi.json',
  '/api/v1/webhooks/rita-id/employee-profile',
  ...(pkg.name === 'sale-app-example'
    ? [
        'order-created',
        'stock-approval-requested',
        'customer-support-requested',
      ]
    : ['task-assigned', 'task-commented']
  ).map((route) => '/api/v1/examples/notifications/' + route),
];
const listed = [
  ...readme.matchAll(/^\|\s*(?:GET|POST)\s*\|\s*\x60([^\x60]+)\x60/gm),
].map((m) => m[1]);
if (JSON.stringify(listed.sort()) !== JSON.stringify(expected.sort()))
  fail.push('README: route inventory differs');
for (const file of [
  'examples/notification.json',
  'examples/profile-event.json',
]) {
  JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  examples++;
}
if (fail.length) {
  process.stderr.write(fail.join('\n') + '\n');
  process.exitCode = 1;
} else
  process.stdout.write(
    'Docs checked: ' +
      files.length +
      ' Markdown files, ' +
      links +
      ' links, ' +
      expected.length +
      ' routes, ' +
      examples +
      ' JSON examples.\n',
  );

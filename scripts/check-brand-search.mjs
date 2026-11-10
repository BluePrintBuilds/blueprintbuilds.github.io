import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const approved = {
  'assets/blueprint-fingerprint.png': 'd83bc6b95c6a52f9fb25284162dd004dc98a51a84c129ada87a5c5146845f24a',
  'assets/icons/fingerprint-48.png': 'efddf91c56dc5f16ef4fe24997d15cc7e88b104ac7c64864c700a3c4514c2608',
  'apple-touch-icon.png': '3b9a2109773377a96ba65f719969258897f23742cb4087965b849a588a9b950c',
  'assets/blueprint-social-20261111.jpg': '2e721eecdea9ea116cb133d0af93b959cb0e4842c94df22fea40035c3ae8b08b',
};
for (const [path, digest] of Object.entries(approved)) {
  assert.equal(hash(path), digest, path + ': approved brand artwork changed; review any intentional update');
}
const expected = [
  '<link rel="canonical" href="https://blueprintbuilds.app/"',
  '<meta name="robots" content="index,follow,max-image-preview:large"',
  '<link rel="icon" sizes="48x48" href="/assets/icons/fingerprint-48.png"',
  '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"',
  '<img src="/assets/blueprint-fingerprint.png"',
  '<meta property="og:image" content="https://blueprintbuilds.app/assets/blueprint-social-20261111.jpg"',
  '<meta name="twitter:image" content="https://blueprintbuilds.app/assets/blueprint-social-20261111.jpg"',
];
for (const value of expected) assert.ok(html.includes(value), 'Missing approved discovery or identity reference: ' + value);
assert.match(html, /<title>[^<]*Blueprint Builds[^<]*Construction[^<]*<\/title>/i, 'Search title should identify Blueprint and its construction purpose');
assert.match(html, /<meta name="description" content="[^"]*builders[^"]*clients[^"]*"/i, 'Search description should describe the intended audiences');
assert.match(html, /<button[^>]*data-arrival-replay[^>]*hidden[^>]*>/, 'The optional intro replay must start hidden until supported');
assert.match(html, /<script src="\/assets\/blueprint-arrival\.js\?[^"]+"><\/script>/, 'The current versioned welcome script must load');
assert.match(html, /<link rel="stylesheet" href="\/assets\/blueprint-arrival\.css\?[^"]+"/, 'The current versioned welcome stylesheet must load');
assert.ok(readFileSync('sitemap.xml', 'utf8').includes('<loc>https://blueprintbuilds.app/</loc>'), 'Sitemap must include the canonical homepage');
assert.ok(readFileSync('robots.txt', 'utf8').includes('Sitemap: https://blueprintbuilds.app/sitemap.xml'), 'Robots file must advertise the canonical sitemap');
console.log('PASS: approved fingerprint, browser icon, social preview, search metadata and sitemap references');

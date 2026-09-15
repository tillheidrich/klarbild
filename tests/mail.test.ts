import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEmail, mailLayout, esc } from '../src/lib/mail.ts';

test('Valid addresses are recognised', () => {
  for (const good of ['first.last@example.com', 'a.b+c@sub.example.co.uk', 'x@y.de', 'Gran_1949@example.de']) {
    assert.ok(isEmail(good), `wrongly rejected: ${good}`);
  }
});

test('Invalid addresses are rejected — including the ones with a line break appended', () => {
  const bad = [
    '', '   ', 'not-an-address', 'a@b', '@b.de', 'a@.de', 'a b@c.de', 'a@b .de',
    'a@b.de\nBcc: victim@example.com',   // header injection
    'a@b.de\r\nSubject: x',
    'a@b.de\n',                          // JavaScript's "$" also matches before a line end
    'a'.repeat(250) + '@b.de',           // too long
  ];
  for (const s of bad) assert.ok(!isEmail(s), `slipped through: ${JSON.stringify(s)}`);
});

test('esc defuses everything that could take the HTML apart', () => {
  assert.equal(esc('<b>x</b>'), '&lt;b&gt;x&lt;/b&gt;');
  assert.equal(esc('a & b'), 'a &amp; b');
  assert.equal(esc('said "hello"'), 'said &quot;hello&quot;');
  // Order: & first, otherwise &lt; would become &amp;lt;
  assert.equal(esc('<&>'), '&lt;&amp;&gt;');
});

test('The heading of the mail is always escaped', () => {
  const html = mailLayout('</h1><script>alert(1)</script>', ['Text']);
  assert.ok(!html.includes('<script>'), 'script tag ended up in the HTML');
  assert.match(html, /&lt;script&gt;/);
});

test('The address of the button is escaped', () => {
  const html = mailLayout('Title', ['Text'], { text: 'View', url: 'https://x.de/"><script>alert(1)</script>' });
  assert.ok(!html.includes('<script>'), 'script tag smuggled in through the address');
});

test('Paragraphs are deliberately allowed to contain HTML — which is why callers have to escape', () => {
  // This is on purpose (for <b>), and exactly for that reason it is the caller's
  // duty to send user input through esc() first. The bug the review found was a
  // place that had forgotten to.
  const html = mailLayout('Title', ['A <b>bold</b> word']);
  assert.match(html, /<b>bold<\/b>/);
  // And with esc() it is defused:
  assert.ok(!mailLayout('T', [esc('<b>x</b>')]).includes('<b>x</b>'));
});

test('The mail loads nothing from outside servers', () => {
  const html = mailLayout('Title', ['Text'], { text: 'Go', url: 'https://klarbild.example/s/abc' });
  // No images, no fonts, no stylesheets from outside — that would be a tracking
  // pixel, and many mailboxes would block it anyway.
  assert.ok(!/<img/i.test(html), 'image in the mail HTML');
  assert.ok(!/<link/i.test(html), 'external resource in the mail HTML');
  assert.ok(!/@import|url\(/i.test(html), 'the CSS loads something');
  // Exactly one destination: the link that was handed in.
  const targets = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(targets)], ['https://klarbild.example/s/abc']);
});

test('Without a button no link comes into being either', () => {
  const html = mailLayout('Title', ['Text only']);
  assert.ok(!html.includes('href='), 'unexpected link');
});

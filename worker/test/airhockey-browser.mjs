// Two headless browsers against a local wrangler dev. Run wrangler first:
//   npx wrangler dev --port 8787 --ip 127.0.0.1 --persist-to /tmp/cbn-ah-dev
// and a static server for the site on 127.0.0.1:8091.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
import assert from 'node:assert/strict';
import fs from 'node:fs';

const WORKER = process.env.AH_WORKER || 'http://127.0.0.1:8787';
const SITE = process.env.AH_SITE || 'http://127.0.0.1:8091';
const OUT = process.env.AH_SHOTS || '/opt/cursor/artifacts';
fs.mkdirSync(OUT, { recursive: true });
const tag = Math.random().toString(36).slice(2, 6);
const nameA = 'ace' + tag;
const nameB = 'bay' + tag;

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream'],
});
const shots = [];
function shot(page, file) {
  const path = OUT + '/' + file;
  shots.push(path);
  return page.screenshot({ path });
}
async function boot(name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', err => console.log(name, 'pageerror', err.message));
  await page.goto(SITE + '/play.html?api=' + encodeURIComponent(WORKER), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.querySelectorAll('.cbn-install').forEach(n => n.remove()));
  return page;
}
async function signup(page, username, capture) {
  await page.locator('#onlineCard').scrollIntoViewIfNeeded();
  await page.fill('#username', username);
  if (capture) await shot(page, 'airhockey-signup.png');
  await page.click('#signupBtn');
  await page.waitForSelector('#recoveryCode', { state: 'visible' });
  const code = (await page.locator('#recoveryCode').textContent()).trim();
  assert.match(code, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  await page.click('#savedRecovery');
  await page.waitForSelector('#quickMatch', { state: 'visible' });
  return code;
}
function armBot(page, mode) {
  return page.evaluate(mode => {
    const W = 360, H = 620, PR = 34, WALL = 14;
    window.__ahBot = setInterval(() => {
      const api = window.CbnAirOnline;
      const s = api && api.debug && api.debug.snapshot();
      if (!s || !s.puck || s.phase === 'over') return;
      if (mode === 'attack') {
        const ty = Math.min(H - WALL - PR - 12, Math.max(H / 2 + PR + 12, s.puck.y + 46));
        const tx = Math.max(WALL + PR, Math.min(W - WALL - PR, s.puck.x));
        api.debug.setTarget(tx, ty);
      } else api.debug.setTarget(WALL + PR + 8, H - 160);
    }, 40);
  }, mode);
}
try {
  const pageA = await boot('A');
  const codeA = await signup(pageA, nameA, true);
  await pageA.locator('#onlineCard').scrollIntoViewIfNeeded();
  await shot(pageA, 'airhockey-online-menu.png');
  const pageB = await boot('B');
  await signup(pageB, nameB, false);

  await Promise.all([pageA.click('#quickMatch'), pageB.click('#quickMatch')]);
  await pageA.waitForFunction(() => document.body.classList.contains('rink-immersive'), null, { timeout: 15000 });
  await pageB.waitForFunction(() => document.body.classList.contains('rink-immersive'), null, { timeout: 15000 });
  await pageA.waitForFunction(() => {
    const s = window.CbnAirOnline.debug.snapshot();
    return s && (s.phase === 'playing' || s.phase === 'faceoff' || s.phase === 'goal');
  }, null, { timeout: 10000 });
  const labels = await pageA.evaluate(() => ({ you: document.getElementById('youLabel').textContent, opp: document.getElementById('oppLabel').textContent }));
  const labelsB = await pageB.evaluate(() => ({ you: document.getElementById('youLabel').textContent, opp: document.getElementById('oppLabel').textContent }));
  assert.equal(labels.you, nameA);
  assert.equal(labels.opp, nameB);
  assert.equal(labelsB.you, nameB);
  assert.equal(labelsB.opp, nameA);
  await armBot(pageA, 'attack');
  await armBot(pageB, 'idle');
  await pageA.waitForFunction(() => window.CbnAirOnline.debug.snapshot()?.phase === 'playing', null, { timeout: 10000 });
  await pageA.waitForTimeout(250);
  const clock = (await pageA.locator('#arenaRule').textContent()).trim();
  assert.match(clock, /^(OT )?\d:\d\d$/, clock);
  await shot(pageA, 'airhockey-match-player1.png');
  await shot(pageB, 'airhockey-match-player2.png');

  let synced = 0, banner = '';
  const deadline = Date.now() + 170000;
  let finalA = null;
  while (Date.now() < deadline) {
    const pair = await Promise.all([pageA.evaluate(() => window.CbnAirOnline.debug.snapshot()), pageB.evaluate(() => window.CbnAirOnline.debug.snapshot())]);
    const [a, b] = pair;
    if (a && b && a.score && b.score) {
      if (a.score[0] === b.score[1] && a.score[1] === b.score[0]) synced++;
      if (a.puck && b.puck && Math.abs(a.puck.x + b.puck.x - 360) < 80 && Math.abs(a.puck.y + b.puck.y - 620) < 80) synced++;
    }
    const text = await pageA.evaluate(() => {
      const el = document.getElementById('goalBanner');
      return el && !el.hidden ? document.getElementById('goalBannerTitle').textContent : '';
    });
    if (text.includes('lights the lamp!')) banner = text;
    finalA = a;
    if (a && a.phase === 'over') break;
    await pageA.waitForTimeout(200);
  }
  assert.ok(finalA && finalA.phase === 'over', 'match did not finish: ' + JSON.stringify(finalA));
  assert.ok(synced > 3, 'expected matching scores and mirrored puck, synced=' + synced);
  assert.match(banner, /lights the lamp!/);
  const finalB = await pageB.evaluate(() => window.CbnAirOnline.debug.snapshot());
  assert.equal(finalA.score[0] + finalA.score[1], finalB.score[0] + finalB.score[1]);
  assert.ok(finalA.score[0] > finalA.score[1], 'attacking player should lead when time expires: ' + finalA.score);
  const titleA = await pageA.locator('#panelTitle').textContent();
  const titleB = await pageB.locator('#panelTitle').textContent();
  assert.notEqual(titleA, titleB, 'both players cannot win');
  assert.match(titleA + titleB, /You take it!/);
  console.log('match', { nameA, nameB, scoreA: finalA.score, scoreB: finalB.score, banner, titleA, titleB, synced });

  await pageA.click('#panelExit');
  await pageA.waitForSelector('#showLeaderboard', { state: 'visible' });
  await pageA.click('#showLeaderboard');
  await pageA.waitForFunction(() => /Your rank:/.test(document.getElementById('boardYou').textContent || ''), null, { timeout: 10000 });
  const boardText = await pageA.locator('#boardYou').textContent();
  await pageA.locator('#leaderBox').scrollIntoViewIfNeeded();
  await shot(pageA, 'airhockey-leaderboard.png');
  assert.match(boardText, /Your rank: #/);
  const winnerName = finalA.score[0] > finalA.score[1] ? nameA : nameB;
  const board = await pageA.evaluate(() => [...document.querySelectorAll('#boardList li')].map(li => li.textContent));
  assert.ok(board.some(row => row.includes(winnerName)), 'winner missing from board: ' + board.join(' | '));
  if (finalA.score[0] > finalA.score[1]) assert.match(boardText, /1W/);
  console.log('leaderboard', boardText, board);

  const pageC = await boot('C');
  await pageC.click('#showLogin');
  await pageC.fill('#loginUser', nameA);
  await pageC.fill('#loginCode', codeA);
  await pageC.click('#loginBtn');
  await pageC.waitForSelector('#profileName', { state: 'visible' });
  const hello = await pageC.locator('#profileName').textContent();
  assert.match(hello, new RegExp(nameA));
  console.log('recovery', hello);
  const homeCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const home = await homeCtx.newPage();
  await home.goto(SITE + '/index.html?api=' + encodeURIComponent(WORKER), { waitUntil: 'domcontentloaded' });
  await home.locator('#play-home').scrollIntoViewIfNeeded();
  await home.waitForFunction(() => !document.getElementById('homeBoard').hidden, null, { timeout: 8000 });
  await shot(home, 'airhockey-home.png');
  const homeText = await home.locator('#play-home').innerText();
  assert.match(homeText, /Play vs Copper/);
  assert.match(homeText, /Play Online/);
  assert.match(homeText, new RegExp(nameA));
  console.log('SHOTS', shots.join('\n'));
} finally {
  await browser.close();
}

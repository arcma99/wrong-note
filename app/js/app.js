import { ensureSeed } from './db.js';
import { profilesView } from './views/profiles.js';
import { subjectsView } from './views/subjects.js';
import { listView } from './views/list.js';
import { editorView } from './views/editor.js';
import { detailView } from './views/detail.js';

const app = document.getElementById('app');

const routes = [
  [/^#?\/?$/, () => profilesView()],
  [/^#\/p\/([^/]+)$/, (m) => subjectsView(m[1])],
  [/^#\/p\/([^/]+)\/s\/([^/]+)$/, (m) => listView(m[1], m[2])],
  [/^#\/p\/([^/]+)\/new$/, (m) => editorView(m[1])],
  [/^#\/p\/([^/]+)\/q\/([^/]+)$/, (m) => detailView(m[1], m[2])],
  [/^#\/p\/([^/]+)\/q\/([^/]+)\/clean$/, (m) => editorView(m[1], m[2])],
];

let current = null;
let renderToken = 0;

async function render() {
  const token = ++renderToken;
  if (current?.cleanup) { try { current.cleanup(); } catch (e) { console.error(e); } }
  current = null;

  const hash = location.hash || '#/';
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (!m) continue;
    const view = await fn(m);
    if (token !== renderToken) { view.cleanup?.(); return; } // 그 사이 다른 화면으로 이동함
    app.replaceChildren(view.el);
    current = view;
    window.scrollTo(0, 0);
    view.onMount?.();
    return;
  }
  location.replace('#/');
}

async function start() {
  await ensureSeed();
  // 브라우저가 저장 공간이 부족할 때 데이터를 지우지 않도록 요청
  try { await navigator.storage?.persist?.(); } catch { /* 무시 */ }
  window.addEventListener('hashchange', render);
  render();
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW 등록 실패', e));
  }
}

start();

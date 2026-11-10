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
let updateReady = false;

// 사진 자르기/지우기 화면(/new, /clean)이 아닐 때만 새 버전으로 새로고침
function reloadIfSafe() {
  if (updateReady && !/\/(new|clean)$/.test(location.hash)) location.reload();
}

async function render() {
  reloadIfSafe();
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
    // 새 버전이 설치되면 다음 화면 이동 때 자동으로 새로고침 (사진 편집 중에는 기다림)
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return; // 처음 설치는 새로고침 필요 없음
      updateReady = true;
      reloadIfSafe();
    });
    navigator.serviceWorker.register('sw.js')
      .then((reg) => {
        // 앱을 다시 열거나 다시 보게 될 때마다 새 버전 확인
        document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
      })
      .catch((e) => console.warn('SW 등록 실패', e));
  }
}

start();

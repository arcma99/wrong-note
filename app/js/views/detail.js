import { h, toast, debounce, fmtDate, fmtFullDate, nowISO, session } from '../util.js';
import * as db from '../db.js';
import { createInkPad } from './inkpad.js';
import { topbar, SUBJECTS, REASONS, reviewCount, passesFilter, byNewest, subjectKey, subjectFromKey } from '../shared.js';

export async function detailView(pid, qid) {
  const q = await db.get('problems', qid);
  if (!q || q.profileId !== pid) { location.replace(`#/p/${pid}`); return { el: h('div') }; }

  // ---- 어느 목록에서 왔는지 (이전/다음, 뒤로 가기 기준) ----
  let ctx = session.get(`ctx:${pid}`, 'all');
  if (ctx !== 'all' && subjectFromKey(ctx) !== (q.subject || '')) ctx = subjectKey(q.subject);
  const filter = session.get(`filter:${pid}`, 'doing');
  const siblings = (await db.listProblems(pid))
    .filter((p) => ctx === 'all' || (p.subject || '') === subjectFromKey(ctx))
    .filter((p) => p.id === qid || passesFilter(p, filter))
    .sort(byNewest);
  const idx = siblings.findIndex((p) => p.id === qid);
  const prevQ = siblings[idx - 1], nextQ = siblings[idx + 1];
  const go = (p) => { if (p) { saveSoon.flush(); location.replace(`#/p/${pid}/q/${p.id}`); } };
  const listHref = () => `#/p/${pid}/s/${ctx}`;

  const blob = await db.getImage(`${qid}/full`);
  const imgUrl = blob ? URL.createObjectURL(blob) : '';
  const origBlob = await db.getImage(`${qid}/orig`);
  const origUrl = origBlob ? URL.createObjectURL(origBlob) : '';

  // ---- 저장 ----
  const status = h('span', { class: 'save-status' });
  let statusTimer = null;
  async function save() {
    try {
      await db.saveProblem(q);
      status.textContent = '저장됨 ✓';
      clearTimeout(statusTimer);
      statusTimer = setTimeout(() => { status.textContent = ''; }, 1500);
    } catch (e) {
      console.error(e);
      toast('저장하지 못했어요');
    }
  }
  const saveSoon = debounce(save, 400);

  // ---- 문제 이미지 ----
  let showOrig = false;
  const mainImg = h('img', { src: imgUrl, alt: '문제', draggable: 'false' });
  const viewerImg = h('img', { src: imgUrl, alt: '문제 크게 보기' });
  const viewer = h('div', { class: 'viewer hidden', onclick: () => viewer.classList.add('hidden') },
    viewerImg,
    h('span', { class: 'viewer-close' }, '닫기 ✕'));
  const problemImg = h('button', { class: 'problem-img', onclick: () => viewer.classList.remove('hidden'), 'aria-label': '크게 보기' },
    imgUrl ? mainImg : h('div', { class: 'empty' }, '이미지가 없어요'));
  const origToggle = origUrl ? h('button', { class: 'btn small', onclick: () => {
    showOrig = !showOrig;
    mainImg.src = viewerImg.src = showOrig ? origUrl : imgUrl;
    origToggle.textContent = showOrig ? '✨ 정리본 보기' : '👀 내가 푼 원본 보기';
    problemImg.classList.toggle('orig', showOrig);
  } }, '👀 내가 푼 원본 보기') : null;
  const imgActions = h('div', { class: 'row img-actions' },
    origToggle,
    h('a', { class: 'btn small', href: `#/p/${pid}/q/${qid}/clean` }, '✏️ 다시 다듬기'));

  // ---- 이전 / 다음 문제 ----
  const pager = siblings.length > 1 ? h('div', { class: 'pager' },
    h('button', { class: 'btn', disabled: !prevQ, onclick: () => go(prevQ) }, '‹ 이전'),
    h('span', { class: 'pos' }, `${idx + 1} / ${siblings.length}`),
    h('button', { class: 'btn', disabled: !nextQ, onclick: () => go(nextQ) }, '다음 ›')) : null;
  // 문제 사진을 옆으로 밀어도 넘어가기
  let swipe = null;
  problemImg.addEventListener('pointerdown', (e) => { swipe = { x: e.clientX, y: e.clientY, t: Date.now() }; });
  problemImg.addEventListener('pointerup', (e) => {
    if (!swipe) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    const quick = Date.now() - swipe.t < 600;
    swipe = null;
    if (quick && Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      problemImg.dataset.swiped = '1'; // 크게 보기 열리지 않게
      go(dx < 0 ? nextQ : prevQ);
    }
  });
  problemImg.addEventListener('click', (e) => {
    if (problemImg.dataset.swiped) { delete problemImg.dataset.swiped; e.stopImmediatePropagation(); }
  }, true);

  // ---- 과목 / 단원 ----
  const subjectChips = h('div', { class: 'chips' });
  function drawSubjects() {
    subjectChips.replaceChildren(...SUBJECTS.map((s) =>
      h('button', { class: 'chip' + (q.subject === s ? ' on' : ''),
        onclick: () => {
          q.subject = q.subject === s ? '' : s;
          // 과목을 바꾸면 '뒤로'는 새 과목 목록으로
          if (ctx !== 'all') { ctx = subjectKey(q.subject); session.set(`ctx:${pid}`, ctx); backLink.href = listHref(); }
          drawSubjects(); save();
        } }, s)));
  }
  const unitInput = h('input', { class: 'input', type: 'text', placeholder: '단원 (예: 비례식의 활용)', value: q.unit,
    oninput: (e) => { q.unit = e.target.value; saveSoon(); } });

  // ---- 틀린 이유 ----
  const reasonChips = h('div', { class: 'chips' });
  function drawReasons() {
    reasonChips.replaceChildren(...REASONS.map((r) => {
      const on = q.reasons.includes(r);
      return h('button', { class: 'chip reason' + (on ? ' on' : ''),
        onclick: () => {
          q.reasons = on ? q.reasons.filter((x) => x !== r) : [...q.reasons, r];
          drawReasons(); save();
        } }, r);
    }));
  }
  const memo = h('textarea', { class: 'memo', rows: 5,
    placeholder: '왜 틀렸는지, 다음에는 어떻게 풀지 적어보세요',
    value: q.memo,
    oninput: (e) => { q.memo = e.target.value; saveSoon(); drawMemoTabs(); } });

  // ---- 메모: 키보드 / 펜슬 ----
  const inkPad = createInkPad(q.ink, { onChange: (ink) => { q.ink = ink; saveSoon(); drawMemoTabs(); } });
  // 손글씨만 있는 문제는 펜슬 칸을 먼저, 그 외에는 이 기기에서 마지막으로 쓴 칸
  let lastMode = 'text';
  try { lastMode = localStorage.getItem('wrongnote:memoMode') || 'text'; } catch { /* 무시 */ }
  let memoMode = q.ink && !q.memo ? 'ink' : q.memo ? 'text' : lastMode;
  const memoTabs = h('div', { class: 'segmented memo-tabs' });
  const memoBody = h('div', { class: 'memo-body' });
  function drawMemoTabs() {
    const tabs = [['text', '⌨️ 키보드', !!q.memo], ['ink', '✏️ 펜슬', !!q.ink]];
    memoTabs.replaceChildren(...tabs.map(([k, label, has]) =>
      h('button', { class: memoMode === k ? 'on' : '', onclick: () => setMemoMode(k) },
        label, has ? h('i', { class: 'has-dot', 'aria-label': '내용 있음' }) : null)));
  }
  function setMemoMode(k) {
    memoMode = k;
    try { localStorage.setItem('wrongnote:memoMode', k); } catch { /* 무시 */ }
    memoBody.replaceChildren(k === 'ink' ? inkPad.el : memo);
    drawMemoTabs();
    if (k === 'ink') requestAnimationFrame(() => inkPad.onShow());
  }

  // ---- 복기 체크 ----
  const reviewBox = h('div', { class: 'reviews' });
  const grad = h('div', { class: 'graduate' }, '🎓 세 번 모두 복기 완료! 이 문제는 졸업이에요');
  function drawReviews() {
    reviewBox.replaceChildren(...[0, 1, 2].map((i) => {
      const d = q.reviews[i];
      return h('button', { class: 'review' + (d ? ' on' : ''), onclick: () => toggleReview(i), 'aria-pressed': d ? 'true' : 'false' },
        h('span', { class: 'box' }, d ? '✓' : ''),
        h('span', { class: 'lbl' }, `${i + 1}차 복기`),
        h('span', { class: 'date' }, d ? fmtDate(d) : '아직'));
    }));
    grad.classList.toggle('hidden', reviewCount(q) < 3);
  }
  function toggleReview(i) {
    if (q.reviews[i]) {
      if (q.reviews[i + 1]) { toast(`${i + 2}차 체크부터 풀어주세요`); return; }
      q.reviews[i] = null;
    } else {
      if (i > 0 && !q.reviews[i - 1]) { toast(`${i}차 복기부터 체크해요`); return; }
      q.reviews[i] = nowISO();
      toast(i === 2 ? '🎓 졸업! 정말 잘했어요' : `${i + 1}차 복기 완료! 👏`);
    }
    drawReviews();
    save();
  }

  // ---- 삭제 ----
  async function remove() {
    if (!confirm('이 오답을 지울까요?\n지운 뒤에는 되돌릴 수 없어요.')) return;
    saveSoon.flush();
    await db.deleteProblem(qid);
    toast('삭제했어요');
    const after = nextQ || prevQ;
    location.replace(after ? `#/p/${pid}/q/${after.id}` : listHref());
  }

  drawSubjects();
  drawReasons();
  drawReviews();
  setMemoMode(memoMode);

  const bar = topbar({ back: listHref(), title: `${fmtFullDate(q.createdAt)} 오답`,
    right: h('button', { class: 'icon-btn', onclick: remove, 'aria-label': '삭제' }, '🗑') });
  const backLink = bar.querySelector('a');

  const el = h('div', { class: 'screen detail' },
    bar,
    h('div', { class: 'detail-layout' },
      h('section', { class: 'panel problem-panel' }, pager, problemImg, imgActions),
      h('div', { class: 'side' },
        h('section', { class: 'panel' },
          h('h3', {}, '복기 체크'),
          reviewBox,
          grad),
        h('section', { class: 'panel' },
          h('h3', {}, '틀린 이유 ', status),
          reasonChips,
          memoTabs,
          memoBody),
        h('section', { class: 'panel' },
          h('h3', {}, '과목 · 단원'),
          subjectChips,
          unitInput),
      ),
    ),
    viewer,
  );

  return {
    el,
    cleanup() {
      saveSoon.flush();
      inkPad.cleanup();
      if (imgUrl) URL.revokeObjectURL(imgUrl);
      if (origUrl) URL.revokeObjectURL(origUrl);
    },
  };
}

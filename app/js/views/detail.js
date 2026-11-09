import { h, toast, debounce, fmtDate, fmtFullDate, nowISO } from '../util.js';
import * as db from '../db.js';
import { topbar, SUBJECTS, REASONS, reviewCount } from '../shared.js';

export async function detailView(pid, qid) {
  const q = await db.get('problems', qid);
  if (!q || q.profileId !== pid) { location.replace(`#/p/${pid}`); return { el: h('div') }; }

  const blob = await db.getImage(`${qid}/full`);
  const imgUrl = blob ? URL.createObjectURL(blob) : '';

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
  const viewer = h('div', { class: 'viewer hidden', onclick: () => viewer.classList.add('hidden') },
    h('img', { src: imgUrl, alt: '문제 크게 보기' }),
    h('span', { class: 'viewer-close' }, '닫기 ✕'));
  const problemImg = h('button', { class: 'problem-img', onclick: () => viewer.classList.remove('hidden'), 'aria-label': '크게 보기' },
    imgUrl ? h('img', { src: imgUrl, alt: '문제' }) : h('div', { class: 'empty' }, '이미지가 없어요'));

  // ---- 과목 / 단원 ----
  const subjectChips = h('div', { class: 'chips' });
  function drawSubjects() {
    subjectChips.replaceChildren(...SUBJECTS.map((s) =>
      h('button', { class: 'chip' + (q.subject === s ? ' on' : ''),
        onclick: () => { q.subject = q.subject === s ? '' : s; drawSubjects(); save(); } }, s)));
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
    oninput: (e) => { q.memo = e.target.value; saveSoon(); } });

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
    location.replace(`#/p/${pid}`);
  }

  drawSubjects();
  drawReasons();
  drawReviews();

  const el = h('div', { class: 'screen detail' },
    topbar({ back: `#/p/${pid}`, title: `${fmtFullDate(q.createdAt)} 오답`,
      right: h('button', { class: 'icon-btn', onclick: remove, 'aria-label': '삭제' }, '🗑') }),
    h('div', { class: 'detail-layout' },
      h('section', { class: 'panel problem-panel' }, problemImg),
      h('div', { class: 'side' },
        h('section', { class: 'panel' },
          h('h3', {}, '복기 체크'),
          reviewBox,
          grad),
        h('section', { class: 'panel' },
          h('h3', {}, '틀린 이유 ', status),
          reasonChips,
          memo),
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
      if (imgUrl) URL.revokeObjectURL(imgUrl);
    },
  };
}

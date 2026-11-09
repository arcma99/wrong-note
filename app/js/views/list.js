import { h, fmtDate, session } from '../util.js';
import * as db from '../db.js';
import { topbar, reviewDots, isGraduated, setPendingFile, SUBJECTS } from '../shared.js';

export async function listView(pid) {
  const profile = await db.get('profiles', pid);
  if (!profile) { location.replace('#/'); return { el: h('div') }; }

  const problems = (await db.listProblems(pid)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const urls = [];
  const state = {
    filter: session.get(`filter:${pid}`, 'doing'),
    subject: session.get(`subject:${pid}`, 'all'),
  };

  const el = h('div', { class: 'screen' });
  const grid = h('div', { class: 'card-grid' });
  const filterBar = h('div', { class: 'segmented' });
  const subjectBar = h('div', { class: 'chips scroll' });

  const doingCount = problems.filter((q) => !isGraduated(q)).length;
  const doneCount = problems.length - doingCount;
  const subjectsInUse = SUBJECTS.filter((s) => problems.some((q) => q.subject === s));

  function drawFilters() {
    const seg = [['doing', `복기 중 ${doingCount}`], ['done', `졸업 ${doneCount}`], ['all', `전체 ${problems.length}`]];
    filterBar.replaceChildren(...seg.map(([k, label]) =>
      h('button', { class: state.filter === k ? 'on' : '', onclick: () => { state.filter = k; session.set(`filter:${pid}`, k); drawAll(); } }, label)));

    subjectBar.classList.toggle('hidden', subjectsInUse.length < 2);
    subjectBar.replaceChildren(...['all', ...subjectsInUse].map((s) =>
      h('button', { class: 'chip' + (state.subject === s ? ' on' : ''), onclick: () => { state.subject = s; session.set(`subject:${pid}`, s); drawAll(); } },
        s === 'all' ? '모든 과목' : s)));
  }

  function drawGrid() {
    const shown = problems.filter((q) =>
      (state.filter === 'all' || (state.filter === 'done') === isGraduated(q)) &&
      (state.subject === 'all' || q.subject === state.subject));

    if (!shown.length) {
      grid.replaceChildren(h('div', { class: 'empty' },
        h('div', { class: 'big' }, problems.length ? '🎉' : '📷'),
        h('p', {}, problems.length
          ? (state.filter === 'doing' ? '복기할 문제가 없어요. 멋져요!' : '여기에 해당하는 문제가 없어요')
          : '틀린 문제를 찍어서 첫 오답을 추가해 보세요')));
      return;
    }

    grid.replaceChildren(...shown.map((q) => {
      const img = h('img', { alt: '', loading: 'lazy' });
      db.getImage(`${q.id}/thumb`).then((b) => {
        if (!b) return;
        const u = URL.createObjectURL(b);
        urls.push(u);
        img.src = u;
      });
      const snippet = q.reasons.length ? q.reasons.join(' · ') : q.memo;
      return h('a', { class: 'card' + (isGraduated(q) ? ' graduated' : ''), href: `#/p/${pid}/q/${q.id}` },
        h('div', { class: 'thumb' }, img, isGraduated(q) ? h('span', { class: 'badge-grad' }, '🎓 졸업') : null),
        h('div', { class: 'meta' },
          h('div', { class: 'row between' },
            h('span', { class: 'subject' + (q.subject ? '' : ' none') }, q.subject || '과목 미정'),
            reviewDots(q)),
          h('div', { class: 'snippet' }, snippet || '틀린 이유를 적어주세요'),
          h('div', { class: 'date' }, fmtDate(q.createdAt) + (q.unit ? ` · ${q.unit}` : ''))));
    }));
  }

  function drawAll() { drawFilters(); drawGrid(); }

  function pick(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    setPendingFile(f);
    location.hash = `#/p/${pid}/new`;
  }
  const camInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden', onchange: pick });
  const albumInput = h('input', { type: 'file', accept: 'image/*', class: 'hidden', onchange: pick });

  el.append(
    topbar({ back: '#/', title: `${profile.emoji} ${profile.name}의 오답노트` }),
    filterBar,
    subjectBar,
    grid,
    h('div', { class: 'fab-bar' },
      h('button', { class: 'btn primary big', onclick: () => camInput.click() }, '📷 사진 찍기'),
      h('button', { class: 'btn big', onclick: () => albumInput.click() }, '🖼 앨범에서'),
    ),
    camInput, albumInput,
  );
  drawAll();

  return { el, cleanup: () => urls.forEach((u) => URL.revokeObjectURL(u)) };
}

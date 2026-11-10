// 과목 하나의 문제 목록 (subjectKeyStr: 과목 이름 / 'none' = 미분류 / 'all' = 모든 과목)
import { h, fmtDate, session } from '../util.js';
import * as db from '../db.js';
import { topbar, captureBar, reviewDots, isGraduated, passesFilter, byNewest,
  SUBJECT_META, subjectLabel, subjectFromKey } from '../shared.js';

export async function listView(pid, subjectKeyStr) {
  const profile = await db.get('profiles', pid);
  if (!profile) { location.replace('#/'); return { el: h('div') }; }

  const all = subjectKeyStr === 'all';
  const subject = all ? null : subjectFromKey(subjectKeyStr);
  const problems = (await db.listProblems(pid))
    .filter((q) => all || (q.subject || '') === subject)
    .sort(byNewest);
  const urls = [];
  const state = { filter: session.get(`filter:${pid}`, 'doing') };
  // 문제 화면에서 '이전/다음'과 '뒤로'가 이 목록을 기준으로 움직이도록 기억
  session.set(`ctx:${pid}`, subjectKeyStr);

  const el = h('div', { class: 'screen' });
  const grid = h('div', { class: 'card-grid' });
  const filterBar = h('div', { class: 'segmented' });

  const doingCount = problems.filter((q) => !isGraduated(q)).length;
  const doneCount = problems.length - doingCount;

  function drawFilters() {
    const seg = [['doing', `복기 중 ${doingCount}`], ['done', `졸업 ${doneCount}`], ['all', `전체 ${problems.length}`]];
    filterBar.replaceChildren(...seg.map(([k, label]) =>
      h('button', { class: state.filter === k ? 'on' : '', onclick: () => { state.filter = k; session.set(`filter:${pid}`, k); drawAll(); } }, label)));
  }

  function drawGrid() {
    const shown = problems.filter((q) => passesFilter(q, state.filter));

    if (!shown.length) {
      grid.replaceChildren(h('div', { class: 'empty' },
        h('div', { class: 'big' }, problems.length ? '🎉' : '📷'),
        h('p', {}, problems.length
          ? (state.filter === 'doing' ? '복기할 문제가 없어요. 멋져요!' : '여기에 해당하는 문제가 없어요')
          : subject === '' ? '과목을 정하지 않은 문제가 없어요' : '틀린 문제를 찍어서 오답을 추가해 보세요')));
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
            h('span', { class: 'subject' + (q.subject ? '' : ' none') }, subjectLabel(q.subject)),
            reviewDots(q)),
          h('div', { class: 'snippet' }, snippet || '틀린 이유를 적어주세요'),
          h('div', { class: 'date' }, fmtDate(q.createdAt) + (q.unit ? ` · ${q.unit}` : ''))));
    }));
  }

  function drawAll() { drawFilters(); drawGrid(); }

  const title = all ? '📚 모든 과목' : `${SUBJECT_META[subject].icon} ${subjectLabel(subject)}`;
  el.append(...[
    topbar({ back: `#/p/${pid}`, title: `${title} · ${profile.name}` }),
    subject === '' && problems.length ? h('p', { class: 'hint' }, '문제를 눌러서 아래쪽 ‘과목 · 단원’에서 과목을 정해 주세요') : null,
    filterBar,
    grid,
    // 과목 화면에서 찍으면 그 과목으로 바로 저장
    captureBar(pid, all || subject === '' ? {} : { subject }),
  ].filter(Boolean));
  drawAll();

  return { el, cleanup: () => urls.forEach((u) => URL.revokeObjectURL(u)) };
}

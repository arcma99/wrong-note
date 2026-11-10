// 프로필을 고르면 처음 보이는 화면: 과목 고르기
import { h } from '../util.js';
import * as db from '../db.js';
import { topbar, captureBar, isGraduated, SUBJECTS, SUBJECT_META, subjectLabel, subjectKey } from '../shared.js';

export async function subjectsView(pid) {
  const profile = await db.get('profiles', pid);
  if (!profile) { location.replace('#/'); return { el: h('div') }; }
  const problems = await db.listProblems(pid);

  const stats = (list) => ({ total: list.length, left: list.filter((q) => !isGraduated(q)).length });
  const unsorted = problems.filter((q) => !q.subject);

  function card(subject, list) {
    const { total, left } = stats(list);
    const meta = SUBJECT_META[subject];
    return h('a', { class: 'subject-card' + (total ? '' : ' empty-subject'), href: `#/p/${pid}/s/${subjectKey(subject)}`,
      style: { '--accent': meta.color } },
      h('span', { class: 'icon' }, meta.icon),
      h('span', { class: 'name' }, subjectLabel(subject)),
      h('span', { class: 'sub' },
        total === 0 ? '아직 없어요'
          : left ? h('span', {}, h('b', {}, `복기할 문제 ${left}개`), ` · 전체 ${total}`)
            : `모두 졸업 🎉 · 전체 ${total}`));
  }

  const cards = SUBJECTS.map((s) => card(s, problems.filter((q) => q.subject === s)));
  // 과목을 아직 안 정한 문제가 있으면 맨 앞에 '미분류'
  if (unsorted.length) cards.unshift(card('', unsorted));

  const { total, left } = stats(problems);
  const el = h('div', { class: 'screen' },
    topbar({ back: '#/', title: `${profile.emoji} ${profile.name}의 오답노트` }),
    h('p', { class: 'subjects-summary' },
      total ? `복기할 문제 ${left}개 · 전체 ${total}개` : '틀린 문제를 찍어서 첫 오답을 추가해 보세요'),
    h('div', { class: 'subject-grid' }, ...cards),
    total ? h('div', { class: 'center' }, h('a', { class: 'btn ghost', href: `#/p/${pid}/s/all` }, '📚 모든 과목 한꺼번에 보기')) : null,
    captureBar(pid),
  );
  return { el };
}

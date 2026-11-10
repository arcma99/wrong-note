import { h } from './util.js';

export const SUBJECTS = ['국어', '수학', '영어', '과학', '사회', '기타'];
export const UNSORTED = '미분류';
// 과목별 아이콘/색 ('' = 아직 과목을 안 정한 문제)
export const SUBJECT_META = {
  국어: { icon: '📖', color: '#FF8A65' },
  수학: { icon: '➗', color: '#4F8EF7' },
  영어: { icon: '🔤', color: '#9B6BE0' },
  과학: { icon: '🔬', color: '#2FB57E' },
  사회: { icon: '🌏', color: '#1FA7B5' },
  기타: { icon: '📌', color: '#E0A030' },
  '': { icon: '❔', color: '#8C8494' },
};
export const subjectLabel = (s) => s || UNSORTED;
// 주소에 쓰는 과목 이름 (미분류 = none, 전체 = all)
export const subjectKey = (s) => (s ? encodeURIComponent(s) : 'none');
export const subjectFromKey = (k) => (k === 'none' ? '' : decodeURIComponent(k));
export const byNewest = (a, b) => b.createdAt.localeCompare(a.createdAt);
// 목록과 하나씩 보기에서 같이 쓰는 '복기 중 / 졸업 / 전체' 기준
export const passesFilter = (q, filter) => filter === 'all' || (filter === 'done') === isGraduated(q);
export const REASONS = ['계산 실수', '문제 잘못 읽음', '개념 부족', '시간 부족', '기타'];
export const EMOJIS = ['🐰', '🐻', '🦊', '🐱', '🐶', '🐼', '🦄', '🐯', '🐸', '🐧', '🐨', '🦁'];

export const reviewCount = (q) => q.reviews.filter(Boolean).length;
export const isGraduated = (q) => reviewCount(q) >= 3;

// 목록 화면에서 고른 사진을 편집 화면으로 넘기는 통로
// meta.subject: 과목 화면에서 찍었으면 그 과목으로 바로 정해 둠
let pendingFile = null;
let pendingMeta = {};
export const setPendingFile = (f, meta = {}) => { pendingFile = f; pendingMeta = meta; };
export const takePendingFile = () => { const f = pendingFile; pendingFile = null; return f; };
export const takePendingMeta = () => { const m = pendingMeta; pendingMeta = {}; return m; };

// 아래쪽 '사진 찍기 / 앨범에서' 버튼 (과목 화면에서 누르면 그 과목으로 저장)
export function captureBar(pid, meta = {}) {
  function pick(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    setPendingFile(f, meta);
    location.hash = `#/p/${pid}/new`;
  }
  const camInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden', onchange: pick });
  const albumInput = h('input', { type: 'file', accept: 'image/*', class: 'hidden', onchange: pick });
  return h('div', { class: 'fab-bar' },
    h('button', { class: 'btn primary big', onclick: () => camInput.click() }, '📷 사진 찍기'),
    h('button', { class: 'btn big', onclick: () => albumInput.click() }, '🖼 앨범에서'),
    camInput, albumInput);
}

export function topbar({ back, title, right }) {
  return h('header', { class: 'topbar' },
    back ? h('a', { class: 'icon-btn', href: back, 'aria-label': '뒤로' }, '‹') : h('span'),
    h('h2', {}, title),
    right || h('span'),
  );
}

export function reviewDots(q) {
  return h('span', { class: 'dots', 'aria-label': `복기 ${reviewCount(q)}/3` },
    ...[0, 1, 2].map((i) => h('i', { class: q.reviews[i] ? 'on' : '' })));
}

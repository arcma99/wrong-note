import { h } from './util.js';

export const SUBJECTS = ['국어', '수학', '영어', '과학', '사회', '기타'];
export const REASONS = ['계산 실수', '문제 잘못 읽음', '개념 부족', '시간 부족', '기타'];
export const EMOJIS = ['🐰', '🐻', '🦊', '🐱', '🐶', '🐼', '🦄', '🐯', '🐸', '🐧', '🐨', '🦁'];

export const reviewCount = (q) => q.reviews.filter(Boolean).length;
export const isGraduated = (q) => reviewCount(q) >= 3;

// 목록 화면에서 고른 사진을 편집 화면으로 넘기는 통로
let pendingFile = null;
export const setPendingFile = (f) => { pendingFile = f; };
export const takePendingFile = () => { const f = pendingFile; pendingFile = null; return f; };

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

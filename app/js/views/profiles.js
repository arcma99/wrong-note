import { h, toast } from '../util.js';
import * as db from '../db.js';
import { EMOJIS, isGraduated } from '../shared.js';

export async function profilesView() {
  let editing = false;
  const el = h('div', { class: 'screen' });

  async function draw() {
    const profiles = await db.listProfiles();
    const left = {};
    const total = {};
    for (const p of profiles) {
      const probs = await db.listProblems(p.id);
      total[p.id] = probs.length;
      left[p.id] = probs.filter((q) => !isGraduated(q)).length;
    }

    const cards = profiles.map((p) => {
      if (!editing) {
        return h('a', { class: 'profile-card', href: `#/p/${p.id}` },
          h('span', { class: 'emoji' }, p.emoji),
          h('span', { class: 'name' }, p.name),
          h('span', { class: 'sub' },
            total[p.id] === 0 ? '아직 오답이 없어요'
              : left[p.id] ? `복기할 문제 ${left[p.id]}개`
                : '모두 졸업! 🎉'),
        );
      }
      return h('div', { class: 'profile-card editing' },
        h('button', { class: 'emoji', title: '눌러서 동물 바꾸기', onclick: () => nextEmoji(p) }, p.emoji),
        h('span', { class: 'name' }, p.name),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', onclick: () => rename(p) }, '이름 바꾸기'),
          h('button', { class: 'btn small danger', onclick: () => remove(p, total[p.id]) }, '삭제'),
        ),
      );
    });

    el.replaceChildren(
      h('header', { class: 'hero' },
        h('h1', {}, '오답노트'),
        h('p', {}, editing ? '동물을 누르면 바뀌어요' : '누구의 노트를 열까요?'),
      ),
      h('div', { class: 'profile-grid' },
        ...cards,
        editing ? h('button', { class: 'profile-card add', onclick: add },
          h('span', { class: 'emoji' }, '＋'), h('span', { class: 'name' }, '추가')) : null,
      ),
      h('div', { class: 'center' },
        h('button', { class: 'btn ghost', onclick: () => { editing = !editing; draw(); } },
          editing ? '편집 완료' : '프로필 편집'),
      ),
    );
  }

  async function nextEmoji(p) {
    p.emoji = EMOJIS[(EMOJIS.indexOf(p.emoji) + 1) % EMOJIS.length];
    await db.put('profiles', p);
    draw();
  }

  async function rename(p) {
    const name = prompt('새 이름을 적어주세요', p.name);
    if (name == null || !name.trim()) return;
    p.name = name.trim().slice(0, 12);
    await db.put('profiles', p);
    draw();
  }

  async function remove(p, count) {
    const msg = count
      ? `'${p.name}' 프로필과 오답 ${count}개를 모두 지울까요?\n지운 뒤에는 되돌릴 수 없어요.`
      : `'${p.name}' 프로필을 지울까요?`;
    if (!confirm(msg)) return;
    await db.deleteProfile(p.id);
    toast('삭제했어요');
    draw();
  }

  async function add() {
    const name = prompt('이름을 적어주세요');
    if (name == null || !name.trim()) return;
    const used = new Set((await db.listProfiles()).map((p) => p.emoji));
    await db.addProfile(name.trim().slice(0, 12), EMOJIS.find((e) => !used.has(e)) || EMOJIS[0]);
    draw();
  }

  await draw();
  return { el };
}

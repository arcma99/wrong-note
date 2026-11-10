import { h, toast } from '../util.js';
import * as db from '../db.js';
import { topbar, takePendingFile, takePendingMeta, subjectKey } from '../shared.js';
import { fileToCanvas, rotate90, cropCanvas, scaleDown, toBlob } from '../image.js';
import { createCleaner } from './cleaner.js';

const DEFAULT_CROP = { x: 0.04, y: 0.04, w: 0.92, h: 0.92 };
const MIN = 0.03;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// 새 오답: 사진 → ① 자르기 → ② 필기 지우기 → 저장
// 다시 다듬기(qid 있음): 저장된 원본 → ② 필기 지우기 → 덮어쓰기
export async function editorView(pid, qid) {
  const file = qid ? null : takePendingFile();
  const meta = qid ? {} : takePendingMeta();
  if (!qid && !file) { location.replace(`#/p/${pid}`); return { el: h('div') }; }
  if (qid) {
    const q = await db.get('problems', qid);
    if (!q || q.profileId !== pid) { location.replace(`#/p/${pid}`); return { el: h('div') }; }
  }

  const backHref = qid ? `#/p/${pid}/q/${qid}`
    : meta.subject ? `#/p/${pid}/s/${subjectKey(meta.subject)}` : `#/p/${pid}`;
  const el = h('div', { class: 'screen editor' });
  let child = null; // 현재 단계의 정리 함수

  function setStep(title, hint, ...content) {
    el.replaceChildren(
      topbar({ back: backHref, title }),
      hint ? h('p', { class: 'hint' }, hint) : null,
      ...content,
    );
  }

  // ---------- ② 필기 지우기 ----------
  function startClean(cropped) {
    if (child) child();
    const cleaner = createCleaner(cropped, {
      saveLabel: '✓ 저장',
      async onSave(view) {
        const full = await toBlob(view, 0.88);
        const thumb = await toBlob(scaleDown(view, 480), 0.8);
        if (qid) {
          await db.putImages(qid, { full, thumb });
          await db.saveProblem(await db.get('problems', qid)); // 수정 시각 갱신
          location.replace(`#/p/${pid}/q/${qid}`);
        } else {
          const orig = await toBlob(cropped, 0.85);
          const q = await db.createProblem(pid, full, thumb, orig, meta.subject || '');
          location.replace(`#/p/${pid}/q/${q.id}`);
        }
      },
    });
    setStep(qid ? '필기 다시 다듬기' : '② 필기 지우기',
      '남은 자국은 지우개로 문지르고, 잘못 지워진 곳은 되살리기로 칠해주세요',
      cleaner.el);
    child = cleaner.cleanup;
    requestAnimationFrame(() => cleaner.onMount());
  }

  // ---------- ① 자르기 ----------
  function startCrop(canvas) {
    let crop = { ...DEFAULT_CROP };
    let drag = null;

    const stage = h('div', { class: 'stage' });
    const box = h('div', { class: 'crop-box' },
      ...['nw', 'ne', 'sw', 'se'].map((k) => h('i', { class: `handle ${k}`, 'data-h': k })));
    const wrap = h('div', { class: 'crop-wrap' }, canvas, box);
    stage.append(wrap);

    function layout() {
      const r = stage.getBoundingClientRect();
      const pad = 24;
      const s = Math.min((r.width - pad * 2) / canvas.width, (r.height - pad * 2) / canvas.height);
      wrap.style.width = `${Math.floor(canvas.width * s)}px`;
      wrap.style.height = `${Math.floor(canvas.height * s)}px`;
      place();
    }
    function place() {
      Object.assign(box.style, {
        left: `${crop.x * 100}%`, top: `${crop.y * 100}%`,
        width: `${crop.w * 100}%`, height: `${crop.h * 100}%`,
      });
    }
    function pointerPos(e) {
      const r = wrap.getBoundingClientRect();
      return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)];
    }

    // 모서리 끌기 / 네모 옮기기 / 바깥에서 끌어 새 네모 그리기
    wrap.addEventListener('pointerdown', (e) => {
      if (drag) return;
      const [px, py] = pointerPos(e);
      const handle = e.target.dataset && e.target.dataset.h;
      const prev = { ...crop };
      if (handle) {
        drag = { id: e.pointerId, mode: 'corner', prev,
          ax: handle.includes('w') ? crop.x + crop.w : crop.x,
          ay: handle.includes('n') ? crop.y + crop.h : crop.y };
      } else if (e.target === box) {
        drag = { id: e.pointerId, mode: 'move', prev, ox: px - crop.x, oy: py - crop.y };
      } else {
        drag = { id: e.pointerId, mode: 'corner', prev, ax: px, ay: py };
      }
      wrap.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    wrap.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const [px, py] = pointerPos(e);
      if (drag.mode === 'move') {
        crop.x = clamp(px - drag.ox, 0, 1 - crop.w);
        crop.y = clamp(py - drag.oy, 0, 1 - crop.h);
      } else {
        crop = { x: Math.min(drag.ax, px), y: Math.min(drag.ay, py), w: Math.abs(px - drag.ax), h: Math.abs(py - drag.ay) };
      }
      place();
    });
    const endDrag = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (crop.w < MIN || crop.h < MIN) crop = drag.prev; // 너무 작으면 이전으로
      drag = null;
      place();
    };
    wrap.addEventListener('pointerup', endDrag);
    wrap.addEventListener('pointercancel', endDrag);

    function rotate() {
      canvas = rotate90(canvas);
      wrap.replaceChildren(canvas, box);
      crop = { ...DEFAULT_CROP };
      layout();
    }

    setStep('① 문제 영역 고르기', '틀린 문제만 들어가도록 네모의 모서리를 끌어 맞춰주세요',
      stage,
      h('div', { class: 'toolbar' },
        h('button', { class: 'btn', onclick: rotate }, '↻ 회전'),
        h('button', { class: 'btn', onclick: () => { crop = { x: 0, y: 0, w: 1, h: 1 }; place(); } }, '⬚ 전체'),
        h('button', { class: 'btn primary', onclick: () => startClean(cropCanvas(canvas, crop)) }, '다음 →')));

    window.addEventListener('resize', layout);
    child = () => window.removeEventListener('resize', layout);
    requestAnimationFrame(layout);
  }

  setStep(qid ? '필기 다시 다듬기' : '① 문제 영역 고르기', null,
    h('div', { class: 'stage' }, h('div', { class: 'loading' }, '사진 불러오는 중…')));

  return {
    el,
    async onMount() {
      let canvas;
      try {
        if (qid) {
          const blob = (await db.getImage(`${qid}/orig`)) || (await db.getImage(`${qid}/full`));
          if (!blob) throw new Error('저장된 사진이 없어요');
          canvas = await fileToCanvas(blob);
        } else {
          canvas = await fileToCanvas(file);
        }
      } catch (err) {
        toast(err.message);
        location.replace(backHref);
        return;
      }
      if (qid) startClean(canvas);
      else startCrop(canvas);
    },
    cleanup() { if (child) child(); },
  };
}

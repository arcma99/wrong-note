import { h, toast } from '../util.js';
import * as db from '../db.js';
import { topbar, takePendingFile } from '../shared.js';
import { fileToCanvas, rotate90, cropCanvas, scaleDown, toBlob } from '../image.js';

const DEFAULT_CROP = { x: 0.04, y: 0.04, w: 0.92, h: 0.92 };
const MIN = 0.03;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export async function editorView(pid) {
  const file = takePendingFile();
  if (!file) { location.replace(`#/p/${pid}`); return { el: h('div') }; }

  let canvas = null;
  let crop = { ...DEFAULT_CROP };
  let drag = null;
  let saving = false;

  const stage = h('div', { class: 'stage' }, h('div', { class: 'loading' }, '사진 불러오는 중…'));
  const box = h('div', { class: 'crop-box' },
    ...['nw', 'ne', 'sw', 'se'].map((k) => h('i', { class: `handle ${k}`, 'data-h': k })));
  const wrap = h('div', { class: 'crop-wrap' });
  const saveBtn = h('button', { class: 'btn primary', onclick: save, disabled: true }, '✓ 저장');
  const rotateBtn = h('button', { class: 'btn', onclick: rotate, disabled: true }, '↻ 회전');
  const fullBtn = h('button', { class: 'btn', onclick: () => { crop = { x: 0, y: 0, w: 1, h: 1 }; place(); }, disabled: true }, '⬚ 전체');

  const el = h('div', { class: 'screen editor' },
    topbar({ back: `#/p/${pid}`, title: '문제 영역 고르기' }),
    h('p', { class: 'hint' }, '틀린 문제만 들어가도록 네모의 모서리를 끌어 맞춰주세요'),
    stage,
    h('div', { class: 'toolbar' }, rotateBtn, fullBtn, saveBtn),
  );

  function layout() {
    if (!canvas) return;
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
    if (drag || !canvas) return;
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

  async function save() {
    if (saving) return;
    saving = true;
    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중…';
    try {
      const cropped = cropCanvas(canvas, crop);
      const full = await toBlob(cropped, 0.88);
      const thumb = await toBlob(scaleDown(cropped, 480), 0.8);
      const q = await db.createProblem(pid, full, thumb);
      location.replace(`#/p/${pid}/q/${q.id}`);
    } catch (err) {
      console.error(err);
      toast('저장하지 못했어요. 다시 시도해 주세요');
      saving = false;
      saveBtn.disabled = false;
      saveBtn.textContent = '✓ 저장';
    }
  }

  const onResize = () => layout();

  return {
    el,
    async onMount() {
      try {
        canvas = await fileToCanvas(file);
      } catch (err) {
        toast(err.message);
        location.replace(`#/p/${pid}`);
        return;
      }
      wrap.replaceChildren(canvas, box);
      stage.replaceChildren(wrap);
      [saveBtn, rotateBtn, fullBtn].forEach((b) => { b.disabled = false; });
      layout();
      window.addEventListener('resize', onResize);
    },
    cleanup() { window.removeEventListener('resize', onResize); },
  };
}

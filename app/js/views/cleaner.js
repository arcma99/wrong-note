// 필기 지우기 + 손으로 다듬기 화면 조각
//  - 자동 지우기: 연필 / 빨간펜 켜고 끄기, 강도 슬라이더
//  - 지우개(하얗게) / 되살리기(원래대로) 브러시, 되돌리기, 확대
//  - '원본' 버튼을 누르고 있는 동안 원래 사진 보기
import { h, toast } from '../util.js';

const BRUSH_SIZES = [14, 28, 52]; // 화면 기준 픽셀
const ZOOMS = [1, 1.5, 2, 3, 4];

// 강도 0~100 → 진한 점 기준값 (강할수록 기준이 낮아져 더 많이 지움)
const strengthToDark = (s) => Math.round(175 - s * 0.9);

export function createCleaner(src, { onSave, saveLabel = '✓ 저장' }) {
  const W = src.width, H = src.height;
  const params = { pencil: true, pen: true, strength: 50 };
  const strokes = [];
  let tool = 'erase';
  let sizeIdx = 1;
  let zoomIdx = 0;
  let fit = 1;
  let autoData = null;
  let baseCanvas = null;
  let restorePattern = null;
  let runId = 0;
  let ready = false;
  let showingOrig = false;
  let saving = false;

  const view = h('canvas', { class: 'clean-canvas' });
  view.width = W; view.height = H;
  const ctx = view.getContext('2d');
  ctx.drawImage(src, 0, 0);

  const scroller = h('div', { class: 'clean-scroller' }, view);
  const busyText = h('span', {}, 'AI가 손글씨 찾는 중…');
  const busy = h('div', { class: 'busy' }, h('span', { class: 'spinner' }), busyText);
  const stage = h('div', { class: 'stage clean-stage' }, scroller, busy);

  // ---------- 자동 지우기 설정 ----------
  const pencilChip = h('button', { class: 'chip on', onclick: () => toggle('pencil', pencilChip) }, '✏️ 연필 지우기');
  const penChip = h('button', { class: 'chip on', onclick: () => toggle('pen', penChip) }, '🖍 빨간펜 지우기');
  const slider = h('input', { type: 'range', min: 0, max: 100, step: 5, value: params.strength, class: 'slider',
    'aria-label': '지우기 강도' });
  slider.addEventListener('input', () => { params.strength = +slider.value; scheduleRun(); });
  const sliderWrap = h('label', { class: 'slider-wrap' }, h('span', {}, '약하게'), slider, h('span', {}, '강하게'));

  function toggle(key, chip) {
    params[key] = !params[key];
    chip.classList.toggle('on', params[key]);
    sliderWrap.classList.toggle('disabled', !params.pencil);
    scheduleRun();
  }

  // ---------- 도구 ----------
  const toolBtns = {
    erase: h('button', { class: 'tool on', onclick: () => setTool('erase') }, '🧽', h('small', {}, '지우개')),
    restore: h('button', { class: 'tool', onclick: () => setTool('restore') }, '🖌', h('small', {}, '되살리기')),
    pan: h('button', { class: 'tool', onclick: () => setTool('pan') }, '✋', h('small', {}, '이동')),
  };
  const sizeBtns = BRUSH_SIZES.map((s, i) =>
    h('button', { class: 'size' + (i === sizeIdx ? ' on' : ''), onclick: () => setSize(i), 'aria-label': `붓 크기 ${i + 1}` },
      h('i', { style: { width: `${8 + i * 7}px`, height: `${8 + i * 7}px` } })));
  const undoBtn = h('button', { class: 'tool', onclick: undo, disabled: true }, '↶', h('small', {}, '되돌리기'));
  const zoomLabel = h('span', { class: 'zoom-label' }, '100%');
  const origBtn = h('button', { class: 'tool hold' }, '👀', h('small', {}, '원본(꾹)'));
  const saveBtn = h('button', { class: 'btn primary', onclick: save, disabled: true }, saveLabel);

  origBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); showOriginal(true); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => origBtn.addEventListener(ev, () => showOriginal(false)));
  origBtn.addEventListener('contextmenu', (e) => e.preventDefault());

  function setTool(t) {
    tool = t;
    Object.entries(toolBtns).forEach(([k, b]) => b.classList.toggle('on', k === t));
    view.style.touchAction = t === 'pan' ? 'auto' : 'none';
    scroller.classList.toggle('panning', t === 'pan');
  }
  function setSize(i) {
    sizeIdx = i;
    sizeBtns.forEach((b, j) => b.classList.toggle('on', j === i));
  }

  const el = h('div', { class: 'cleaner' },
    h('div', { class: 'clean-controls' }, pencilChip, penChip, sliderWrap),
    stage,
    h('div', { class: 'clean-toolbar' },
      h('div', { class: 'group' }, toolBtns.erase, toolBtns.restore, toolBtns.pan),
      h('div', { class: 'group sizes' }, ...sizeBtns),
      h('div', { class: 'group' },
        h('button', { class: 'tool', onclick: () => setZoom(-1) }, '－', h('small', {}, '축소')),
        zoomLabel,
        h('button', { class: 'tool', onclick: () => setZoom(1) }, '＋', h('small', {}, '확대'))),
      h('div', { class: 'group' }, undoBtn, origBtn),
      saveBtn,
    ),
  );

  // ---------- 화면 맞춤 / 확대 ----------
  function layout() {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    fit = Math.min((r.width - 16) / W, (r.height - 16) / H);
    applyZoom();
  }
  function applyZoom(keepCenter) {
    const before = keepCenter && {
      cx: (scroller.scrollLeft + scroller.clientWidth / 2) / scroller.scrollWidth,
      cy: (scroller.scrollTop + scroller.clientHeight / 2) / scroller.scrollHeight,
    };
    const s = fit * ZOOMS[zoomIdx];
    view.style.width = `${Math.round(W * s)}px`;
    view.style.height = `${Math.round(H * s)}px`;
    zoomLabel.textContent = `${Math.round(ZOOMS[zoomIdx] * 100)}%`;
    if (before) {
      scroller.scrollLeft = before.cx * scroller.scrollWidth - scroller.clientWidth / 2;
      scroller.scrollTop = before.cy * scroller.scrollHeight - scroller.clientHeight / 2;
    }
  }
  function setZoom(d) {
    const n = Math.max(0, Math.min(ZOOMS.length - 1, zoomIdx + d));
    if (n === zoomIdx) return;
    zoomIdx = n;
    applyZoom(true);
  }

  // ---------- 그리기 ----------
  function styleFor(mode) { return mode === 'erase' ? '#ffffff' : restorePattern; }

  function drawStroke(s, from = 0) {
    const pts = s.pts;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = s.width;
    ctx.strokeStyle = ctx.fillStyle = styleFor(s.mode);
    if (pts.length === 2) {
      ctx.beginPath();
      ctx.arc(pts[0], pts[1], s.width / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      const start = Math.max(0, from - 2);
      ctx.moveTo(pts[start], pts[start + 1]);
      for (let i = start + 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  function compose() {
    if (!autoData) return;
    ctx.putImageData(autoData, 0, 0);
    for (const s of strokes) drawStroke(s);
    undoBtn.disabled = strokes.length === 0;
  }

  function toImage(e) {
    const r = view.getBoundingClientRect();
    return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)];
  }

  let active = null;
  view.addEventListener('pointerdown', (e) => {
    if (!ready || tool === 'pan' || active || showingOrig) return;
    const [x, y] = toImage(e);
    const width = BRUSH_SIZES[sizeIdx] / (fit * ZOOMS[zoomIdx]);
    active = { id: e.pointerId, stroke: { mode: tool, width, pts: [x, y] } };
    strokes.push(active.stroke);
    drawStroke(active.stroke);
    view.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  view.addEventListener('pointermove', (e) => {
    if (!active || e.pointerId !== active.id) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const s = active.stroke;
    const from = s.pts.length;
    for (const ev of (events.length ? events : [e])) {
      const [x, y] = toImage(ev);
      s.pts.push(x, y);
    }
    drawStroke(s, from);
  });
  const end = (e) => {
    if (!active || e.pointerId !== active.id) return;
    active = null;
    undoBtn.disabled = false;
  };
  view.addEventListener('pointerup', end);
  view.addEventListener('pointercancel', end);

  function undo() {
    if (!strokes.length) return;
    strokes.pop();
    compose();
  }

  function showOriginal(on) {
    if (!ready || on === showingOrig) return;
    showingOrig = on;
    if (on) ctx.drawImage(src, 0, 0);
    else compose();
    origBtn.classList.toggle('on', on);
  }

  // ---------- 자동 지우기 (백그라운드) ----------
  const worker = new Worker(new URL('../clean-worker.js', import.meta.url));
  worker.onmessage = (e) => {
    const d = e.data;
    if (d.type === 'base') {
      baseCanvas = document.createElement('canvas');
      baseCanvas.width = W; baseCanvas.height = H;
      baseCanvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(d.buffer), W, H), 0, 0);
      restorePattern = ctx.createPattern(baseCanvas, 'no-repeat');
      runNow();
    } else if (d.type === 'mode') {
      busyText.textContent = '필기 지우는 중…';
      if (!d.ai) toast('AI를 불러오지 못해 기본 방식으로 지웠어요');
    } else if (d.type === 'result' && d.id === runId) {
      autoData = new ImageData(new Uint8ClampedArray(d.buffer), W, H);
      busy.classList.add('hidden');
      if (!ready) {
        ready = true;
        saveBtn.disabled = false;
      }
      if (!showingOrig) compose();
    }
  };
  worker.onerror = (e) => {
    console.error(e);
    busy.classList.add('hidden');
    toast('자동 지우기에 실패했어요. 손 지우개로 다듬어 주세요');
    // 실패해도 원본 그대로 다듬을 수 있게
    autoData = ctx.getImageData(0, 0, W, H);
    baseCanvas = src;
    restorePattern = ctx.createPattern(src, 'no-repeat');
    ready = true;
    saveBtn.disabled = false;
  };

  function runNow() {
    runId++;
    busy.classList.remove('hidden');
    worker.postMessage({ type: 'run', id: runId,
      params: { pencil: params.pencil, pen: params.pen, strength: params.strength,
        tDark: strengthToDark(params.strength) } });
  }
  let runTimer = null;
  function scheduleRun() {
    if (!baseCanvas) return;
    clearTimeout(runTimer);
    runTimer = setTimeout(runNow, 180);
  }

  async function save() {
    if (saving || !ready) return;
    saving = true;
    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중…';
    showOriginal(false);
    compose();
    try {
      await onSave(view);
    } catch (err) {
      console.error(err);
      toast('저장하지 못했어요. 다시 시도해 주세요');
      saving = false;
      saveBtn.disabled = false;
      saveBtn.textContent = saveLabel;
    }
  }

  const onResize = () => layout();

  return {
    el,
    onMount() {
      layout();
      window.addEventListener('resize', onResize);
      const data = src.getContext('2d').getImageData(0, 0, W, H);
      worker.postMessage({ type: 'init', width: W, height: H, buffer: data.data.buffer, useAI: true }, [data.data.buffer]);
    },
    cleanup() {
      window.removeEventListener('resize', onResize);
      clearTimeout(runTimer);
      worker.terminate();
      // iPad Safari의 캔버스 메모리를 빨리 돌려주기
      if (baseCanvas && baseCanvas !== src) baseCanvas.width = baseCanvas.height = 0;
      view.width = view.height = 0;
    },
  };
}

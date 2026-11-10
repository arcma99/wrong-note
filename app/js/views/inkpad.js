// 손글씨 메모판 (애플펜슬 / S펜 / 손가락)
//
// 저장 형식 (문제 기록의 ink 칸, 작아서 나중에 동기화하기도 쉬움)
//   { h: 높이, strokes: [{ c: 색, w: 굵기, p: [x, y, 압력, x, y, 압력, ...] }] }
//   좌표는 가로 1000 기준 → 패드/폰 화면 크기가 달라도 같은 모양으로 보임
//
// 펜을 한 번이라도 쓰면 그 기기에서는 손가락/손바닥으로는 그리지 않고 화면만 움직임 (손바닥 인식 방지)
import { h, toast } from '../util.js';

const L = 1000;              // 논리 가로 크기
const START_H = 760;         // 처음 높이
const GROW = 400;            // '공간 늘리기' 한 번에 늘어나는 높이
const MAX_H = 4000;
const LINE_GAP = 56;         // 공책 줄 간격
const COLORS = [
  { c: '#2B2730', name: '검정' },
  { c: '#2F6FE0', name: '파랑' },
  { c: '#E5484D', name: '빨강' },
];
const SIZES = [4, 7.5];      // 가는 펜 / 굵은 펜 (가로 1000 기준)
const ERASE_R = 22;
const PEN_KEY = 'wrongnote:penSeen';

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 무시 */ } };

// 획 하나 그리기 (ctx는 이미 가로 1000 기준으로 맞춰져 있어야 함)
// from: 이 점부터 이어서 그림 (그리는 중 새로 들어온 부분만)
const widthAt = (s, pr) => s.w * (0.55 + 0.9 * pr);
export function drawStroke(ctx, s, from = 0) {
  const p = s.p;
  ctx.strokeStyle = ctx.fillStyle = s.c;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (p.length === 3) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], widthAt(s, p[2]) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // 점 사이를 중간점 곡선으로 부드럽게, 압력에 따라 굵기 변화
  for (let i = Math.max(3, from); i < p.length; i += 3) {
    const x0 = p[i - 3], y0 = p[i - 2], x1 = p[i], y1 = p[i + 1];
    const px = i >= 6 ? (p[i - 6] + x0) / 2 : x0, py = i >= 6 ? (p[i - 5] + y0) / 2 : y0;
    ctx.lineWidth = widthAt(s, (p[i - 1] + p[i + 2]) / 2);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    if (i + 3 >= p.length) ctx.lineTo(x1, y1);
    ctx.stroke();
  }
}

// 사진 위에 겹쳐 보여주기용: canvas를 화면 크기(cssW×cssH)에 맞추고 획만 그림
export function paintInk(canvas, ink, cssW, cssH) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!ink) return;
  const s = (cssW / L) * dpr;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  for (const st of ink.strokes) drawStroke(ctx, st);
}

// opts.bg: 배경 사진(img), opts.fixedH: 높이 고정(사진 비율), 없으면 공책 줄 + 공간 늘리기
export function createInkPad(initial, { onChange, bg = null, fixedH = null }) {
  const data = {
    h: fixedH || Math.min(MAX_H, initial?.h || START_H),
    strokes: (initial?.strokes || []).map((s) => ({ ...s, p: [...s.p] })),
  };
  const history = [];          // 되돌리기용: 바뀌기 전 strokes 사본
  let color = COLORS[0].c;
  let sizeIdx = 0;
  let tool = 'pen';            // pen | eraser
  let penSeen = lsGet(PEN_KEY) === '1';
  let fingerDraw = !penSeen;   // 펜이 없는 기기(아들 패드 등)는 손가락으로 쓰기

  const canvas = h('canvas', { class: 'inkpad-canvas' });
  const ctx = canvas.getContext('2d');
  let scale = 1, dpr = 1;

  // ---------- 도구 막대 ----------
  const colorBtns = COLORS.map((x) => h('button', { class: 'ink-color', 'aria-label': x.name, style: { '--c': x.c },
    onclick: () => { color = x.c; setTool('pen'); } }));
  const sizeBtns = SIZES.map((s, i) => h('button', { class: 'ink-size', 'aria-label': i ? '굵게' : '가늘게',
    onclick: () => { sizeIdx = i; setTool('pen'); } }, h('i', { style: { width: `${4 + i * 5}px`, height: `${4 + i * 5}px` } })));
  const eraserBtn = h('button', { class: 'ink-tool', onclick: () => setTool(tool === 'eraser' ? 'pen' : 'eraser') }, '🧽', h('small', {}, '지우개'));
  const undoBtn = h('button', { class: 'ink-tool', onclick: undo, disabled: true }, '↶', h('small', {}, '되돌리기'));
  const clearBtn = h('button', { class: 'ink-tool', onclick: clearAll }, '🗑', h('small', {}, '모두 지우기'));
  const fingerBtn = h('button', { class: 'chip small-chip', onclick: () => { fingerDraw = !fingerDraw; drawToolbar(); } });

  function setTool(t) { tool = t; drawToolbar(); }
  function drawToolbar() {
    colorBtns.forEach((b, i) => b.classList.toggle('on', tool === 'pen' && COLORS[i].c === color));
    sizeBtns.forEach((b, i) => b.classList.toggle('on', tool === 'pen' && i === sizeIdx));
    eraserBtn.classList.toggle('on', tool === 'eraser');
    undoBtn.disabled = history.length === 0;
    clearBtn.disabled = data.strokes.length === 0;
    fingerBtn.textContent = fingerDraw ? '👆 손가락으로 쓰기: 켬' : '👆 손가락으로 쓰기: 끔';
    fingerBtn.classList.toggle('on', fingerDraw);
    fingerBtn.classList.toggle('hidden', !penSeen); // 펜을 쓰는 기기에서만 보여줌
  }

  const growBtn = h('button', { class: 'btn small ghost grow-btn', onclick: grow }, '＋ 아래로 공간 늘리기');
  const el = h('div', { class: 'inkpad' },
    h('div', { class: 'ink-toolbar' },
      h('div', { class: 'group' }, ...colorBtns),
      h('div', { class: 'group' }, ...sizeBtns),
      h('div', { class: 'group' }, eraserBtn, undoBtn, clearBtn),
      fingerBtn),
    h('div', { class: 'inkpad-paper' }, canvas),
    fixedH ? null : growBtn);

  // ---------- 그리기 ----------
  function resize() {
    const w = canvas.parentElement?.clientWidth || 0;
    if (!w) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    scale = w / L;
    canvas.style.height = `${Math.round(data.h * scale)}px`;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(data.h * scale * dpr);
    redraw();
  }

  function paper() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#FFFEFB';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    if (bg) { ctx.drawImage(bg, 0, 0, L, data.h); return; }
    ctx.strokeStyle = '#EFE6DD';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let y = LINE_GAP; y < data.h; y += LINE_GAP) { ctx.moveTo(0, y); ctx.lineTo(L, y); }
    ctx.stroke();
  }

  function redraw() {
    paper();
    for (const s of data.strokes) drawStroke(ctx, s);
  }

  // ---------- 입력 ----------
  let active = null;   // { id, stroke } 또는 { id, erase: true } 또는 { id, scroll: y }
  const toLocal = (e) => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale];
  };
  const round1 = (v) => Math.round(v * 10) / 10;

  function remember() {
    history.push(data.strokes.slice());
    if (history.length > 50) history.shift();
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (active) return;
    if (e.pointerType === 'pen' && !penSeen) {
      penSeen = true; fingerDraw = false; lsSet(PEN_KEY, '1'); drawToolbar();
    }
    // 손가락인데 '손가락으로 쓰기'가 꺼져 있으면: 화면 위아래로 움직이기만
    if (e.pointerType === 'touch' && !fingerDraw) {
      active = { id: e.pointerId, scroll: e.clientY };
      return;
    }
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* 이미 끝난 터치 */ }
    const [x, y] = toLocal(e);
    if (tool === 'eraser' || e.button === 5) { // 펜 뒤쪽 지우개(일부 펜)도 지우개로
      remember();
      active = { id: e.pointerId, erase: true, changed: false };
      eraseAt(x, y);
      return;
    }
    const pr = e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5;
    const stroke = { c: color, w: SIZES[sizeIdx], p: [round1(x), round1(y), round1(pr)] };
    active = { id: e.pointerId, stroke };
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    drawStroke(ctx, stroke);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!active || e.pointerId !== active.id) return;
    if (active.scroll != null) {
      (canvas.closest('[data-ink-scroll]') || window).scrollBy(0, active.scroll - e.clientY); // 전체 화면 쓰기에선 그 안에서 움직임
      active.scroll = e.clientY;
      return;
    }
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    const list = evs.length ? evs : [e];
    if (active.erase) {
      for (const ev of list) { const [x, y] = toLocal(ev); eraseAt(x, y); }
      return;
    }
    const s = active.stroke;
    const from = s.p.length;
    for (const ev of list) {
      const [x, y] = toLocal(ev);
      const lx = s.p[s.p.length - 3], ly = s.p[s.p.length - 2];
      if (Math.hypot(x - lx, y - ly) < 1.2) continue; // 너무 가까운 점은 건너뜀 (저장 크기 절약)
      const pr = ev.pointerType === 'pen' ? (ev.pressure || 0.5) : 0.5;
      s.p.push(round1(x), round1(y), round1(pr));
    }
    if (s.p.length > from) {
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
      drawStroke(ctx, s, from);
    }
  }, { passive: false });

  function end(e) {
    if (!active || e.pointerId !== active.id) return;
    const a = active;
    active = null;
    if (a.scroll != null) return;
    if (a.erase) {
      if (!a.changed) history.pop();
      else changed();
      return;
    }
    remember();
    data.strokes.push(a.stroke);
    changed();
  }
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  // iPad Safari: 펜으로 길게 누를 때 확대경/메뉴가 뜨지 않게
  canvas.addEventListener('touchstart', (e) => { if (e.touches.length === 1) e.preventDefault(); }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // 지우개: 닿은 획을 통째로 지움
  function eraseAt(x, y) {
    const r2 = ERASE_R * ERASE_R;
    const keep = data.strokes.filter((s) => {
      const p = s.p;
      for (let i = 0; i < p.length; i += 3) {
        const dx = p[i] - x, dy = p[i + 1] - y;
        if (dx * dx + dy * dy <= r2) return false;
      }
      return true;
    });
    if (keep.length !== data.strokes.length) {
      data.strokes = keep;
      active.changed = true;
      redraw();
    }
  }

  function undo() {
    if (!history.length) return;
    data.strokes = history.pop();
    redraw();
    changed();
  }

  function clearAll() {
    if (!data.strokes.length) return;
    if (!confirm('손글씨 메모를 모두 지울까요?\n(되돌리기로 다시 살릴 수 있어요)')) return;
    remember();
    data.strokes = [];
    if (!fixedH) data.h = START_H;
    resize();
    changed();
  }

  function grow() {
    if (data.h >= MAX_H) { toast('더 늘릴 수 없어요'); return; }
    data.h = Math.min(MAX_H, data.h + GROW);
    resize();
    changed();
  }

  function changed() {
    drawToolbar();
    onChange(data.strokes.length ? { h: data.h, strokes: data.strokes } : null);
  }

  // 화면을 돌리거나 크기가 바뀌면 새 너비에 맞춰 다시 그림 (너비가 같으면 그대로)
  let lastW = 0;
  const ro = new ResizeObserver(() => {
    const w = canvas.parentElement?.clientWidth || 0;
    if (w && w !== lastW) { lastW = w; resize(); }
  });

  drawToolbar();
  return {
    el,
    onShow() { resize(); ro.observe(el); },
    cleanup() { ro.disconnect(); canvas.width = canvas.height = 0; },
  };
}

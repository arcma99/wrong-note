// 작은 DOM 헬퍼: h('div', {class:'x', onclick: fn}, '내용', childEl)
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv); // CSS 변수
        else el.style[sk] = sv;
      }
    }
    else if (k === 'value') el.value = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

// crypto.randomUUID는 https에서만 동작하므로 직접 만듭니다
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

export const nowISO = () => new Date().toISOString();

export function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function fmtFullDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

export function debounce(fn, ms) {
  let t = null;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => { t = null; fn(...args); }, ms);
  };
  wrapped.flush = () => {
    if (t) { clearTimeout(t); t = null; fn(); }
  };
  return wrapped;
}

let toastTimer = null;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// 브라우저 저장소 접근은 개인정보 보호 모드 등에서 실패할 수 있어 감쌉니다
export const session = {
  get(k, d) { try { return sessionStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* 무시 */ } },
};

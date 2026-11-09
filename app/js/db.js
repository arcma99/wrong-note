// 기기 안 저장소(IndexedDB)
//  profiles: { id, name, emoji, order }
//  problems: { id, profileId, createdAt, updatedAt, subject, unit, reasons[], memo, reviews[3] }
//  images:   { id: `${problemId}/full` | `${problemId}/thumb`, blob }
import { uid, nowISO } from './util.js';

const DB_NAME = 'wrongnote';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('profiles', { keyPath: 'id' });
        const problems = db.createObjectStore('problems', { keyPath: 'id' });
        problems.createIndex('profileId', 'profileId');
        db.createObjectStore('images', { keyPath: 'id' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbPromise;
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

async function txn(names, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(names, 'readwrite');
    fn(t);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function get(name, id) { return reqP((await store(name)).get(id)); }
export async function put(name, value) { return reqP((await store(name, 'readwrite')).put(value)); }

// ---- 프로필 ----
export async function listProfiles() {
  const all = await reqP((await store('profiles')).getAll());
  return all.sort((a, b) => a.order - b.order);
}

export async function ensureSeed() {
  const all = await listProfiles();
  if (all.length) return;
  await put('profiles', { id: uid(), name: '딸', emoji: '🐰', order: 0 });
  await put('profiles', { id: uid(), name: '아들', emoji: '🐻', order: 1 });
}

export async function addProfile(name, emoji) {
  const all = await listProfiles();
  const p = { id: uid(), name, emoji, order: all.length ? all[all.length - 1].order + 1 : 0 };
  await put('profiles', p);
  return p;
}

export async function deleteProfile(id) {
  const problems = await listProblems(id);
  await txn(['profiles', 'problems', 'images'], (t) => {
    t.objectStore('profiles').delete(id);
    for (const q of problems) {
      t.objectStore('problems').delete(q.id);
      t.objectStore('images').delete(`${q.id}/full`);
      t.objectStore('images').delete(`${q.id}/thumb`);
    }
  });
}

// ---- 문제 ----
export async function listProblems(profileId) {
  return reqP((await store('problems')).index('profileId').getAll(profileId));
}

export async function createProblem(profileId, fullBlob, thumbBlob) {
  const now = nowISO();
  const q = {
    id: uid(), profileId, createdAt: now, updatedAt: now,
    subject: '', unit: '', reasons: [], memo: '', reviews: [null, null, null],
  };
  await txn(['problems', 'images'], (t) => {
    t.objectStore('problems').put(q);
    t.objectStore('images').put({ id: `${q.id}/full`, blob: fullBlob });
    t.objectStore('images').put({ id: `${q.id}/thumb`, blob: thumbBlob });
  });
  return q;
}

export async function saveProblem(q) {
  q.updatedAt = nowISO();
  await put('problems', q);
}

export async function deleteProblem(id) {
  await txn(['problems', 'images'], (t) => {
    t.objectStore('problems').delete(id);
    t.objectStore('images').delete(`${id}/full`);
    t.objectStore('images').delete(`${id}/thumb`);
  });
}

export async function getImage(key) {
  const r = await get('images', key);
  return r ? r.blob : null;
}

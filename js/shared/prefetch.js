/**
 * Karpus Kids — PrefetchModule
 * Prefetching de datos al hover + persistencia de borradores + skeletons precisos
 */

const _cache = new Map();
const _pending = new Set();
const DRAFT_PREFIX = 'karpus_draft_';

// ─── Prefetching ──────────────────────────────────────────────────────────────

export function registerPrefetch(sectionId, loadFn) {
  const selectors = [
    `[data-section="${sectionId}"]`,
    `[data-target="${sectionId}"]`
  ];
  selectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(btn => {
      btn.addEventListener('mouseenter', () => _prefetch(sectionId, loadFn), { passive: true });
      btn.addEventListener('touchstart', () => _prefetch(sectionId, loadFn), { passive: true });
    });
  });
}

async function _prefetch(sectionId, loadFn) {
  if (_cache.has(sectionId) || _pending.has(sectionId)) return;
  _pending.add(sectionId);
  try {
    const data = await loadFn();
    _cache.set(sectionId, { data, ts: Date.now() });
  } catch (e) {
    console.warn('[Prefetch]', sectionId, e.message);
  } finally {
    _pending.delete(sectionId);
  }
}

export function getPrefetched(sectionId, maxAgeMs = 120000) {
  const entry = _cache.get(sectionId);
  if (!entry) return null;
  if (Date.now() - entry.ts > maxAgeMs) { _cache.delete(sectionId); return null; }
  return entry.data;
}

export function invalidatePrefetch(sectionId) { _cache.delete(sectionId); }
export function invalidateAll() { _cache.clear(); }

// ─── Borradores ───────────────────────────────────────────────────────────────

export function saveDraft(key, value) {
  try {
    value?.trim()
      ? localStorage.setItem(DRAFT_PREFIX + key, value)
      : localStorage.removeItem(DRAFT_PREFIX + key);
  } catch (_) {}
}

export function getDraft(key) {
  try { return localStorage.getItem(DRAFT_PREFIX + key) || ''; } catch (_) { return ''; }
}

export function clearDraft(key) {
  try { localStorage.removeItem(DRAFT_PREFIX + key); } catch (_) {}
}

export function bindDraft(input, key) {
  if (!input) return { destroy: () => {} };
  const saved = getDraft(key);
  if (saved) { input.value = saved; input.dispatchEvent(new Event('input', { bubbles: true })); }
  let t;
  const handler = () => { clearTimeout(t); t = setTimeout(() => saveDraft(key, input.value), 500); };
  input.addEventListener('input', handler);
  return { destroy: () => { input.removeEventListener('input', handler); clearTimeout(t); } };
}

// ─── Skeletons precisos ───────────────────────────────────────────────────────

export const Skeletons = {
  kpiCard: () => `<div class="bg-white rounded-2xl p-5 border border-slate-100 animate-pulse">
    <div class="flex justify-between items-start mb-3">
      <div class="w-10 h-10 bg-slate-200 rounded-xl"></div>
      <div class="w-12 h-5 bg-slate-100 rounded-full"></div>
    </div>
    <div class="w-16 h-8 bg-slate-200 rounded-lg mb-1"></div>
    <div class="w-24 h-3 bg-slate-100 rounded-full"></div>
  </div>`,

  tableRow: (cols = 4) => `<tr class="animate-pulse">${
    Array.from({ length: cols }).map((_, i) =>
      `<td class="px-5 py-4"><div class="h-4 bg-slate-100 rounded-full ${i === 0 ? 'w-32' : i === cols - 1 ? 'w-16 ml-auto' : 'w-24'}"></div>${i === 0 ? '<div class="h-3 bg-slate-50 rounded-full w-20 mt-1.5"></div>' : ''}</td>`
    ).join('')
  }</tr>`,

  wallPost: () => `<div class="bg-white rounded-3xl p-5 border border-slate-100 mb-4 animate-pulse">
    <div class="flex items-center gap-3 mb-4">
      <div class="w-10 h-10 bg-slate-200 rounded-full shrink-0"></div>
      <div class="flex-1"><div class="h-4 bg-slate-200 rounded-full w-32 mb-1.5"></div><div class="h-3 bg-slate-100 rounded-full w-20"></div></div>
    </div>
    <div class="space-y-2 mb-4">
      <div class="h-4 bg-slate-100 rounded-full w-full"></div>
      <div class="h-4 bg-slate-100 rounded-full w-4/5"></div>
      <div class="h-4 bg-slate-100 rounded-full w-3/5"></div>
    </div>
    <div class="h-48 bg-slate-100 rounded-2xl mb-4"></div>
    <div class="flex gap-4 pt-3 border-t border-slate-50">
      <div class="h-4 bg-slate-100 rounded-full w-16"></div>
      <div class="h-4 bg-slate-100 rounded-full w-20"></div>
    </div>
  </div>`,

  chatContact: () => `<div class="flex items-center gap-3 p-3 animate-pulse">
    <div class="w-10 h-10 bg-slate-200 rounded-full shrink-0"></div>
    <div class="flex-1 min-w-0">
      <div class="h-4 bg-slate-200 rounded-full w-28 mb-1.5"></div>
      <div class="h-3 bg-slate-100 rounded-full w-20"></div>
    </div>
  </div>`,

  chatBubble: (mine = false) => `<div class="flex ${mine ? 'justify-end' : 'justify-start'} mb-2 animate-pulse">
    <div class="h-9 ${mine ? 'bg-blue-100' : 'bg-slate-100'} rounded-2xl ${mine ? 'w-40' : 'w-48'}"></div>
  </div>`,

  studentCard: () => `<div class="bg-white rounded-2xl p-5 border border-slate-100 animate-pulse">
    <div class="flex items-center gap-3 mb-4">
      <div class="w-12 h-12 bg-slate-200 rounded-xl shrink-0"></div>
      <div class="flex-1"><div class="h-4 bg-slate-200 rounded-full w-28 mb-1.5"></div><div class="h-3 bg-slate-100 rounded-full w-16"></div></div>
    </div>
    <div class="grid grid-cols-2 gap-2">
      <div class="h-8 bg-slate-100 rounded-xl"></div>
      <div class="h-8 bg-slate-100 rounded-xl"></div>
    </div>
  </div>`,

  render(type, count = 3) {
    return Array.from({ length: count }).map(() => this[type]?.() || '').join('');
  }
};

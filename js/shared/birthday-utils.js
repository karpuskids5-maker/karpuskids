/**
 * 🎂 Birthday & Age Utilities — Karpus Kids
 * Shared module for age display and birthday detection across all panels.
 */

/**
 * Computes a human-readable age string from a birth date.
 * @param {string} birthDate — ISO date string (YYYY-MM-DD)
 * @returns {string} e.g. "3 años y 2 meses", "5 meses", "Recién nacido"
 */
export function computeAge(birthDate) {
  if (!birthDate) return '';
  const [y, m, d] = birthDate.split('-').map(Number);
  if (!y || !m || !d) return '';
  const now = new Date();
  let years = now.getFullYear() - y;
  let months = now.getMonth() + 1 - m;
  if (now.getDate() < d) months--;
  if (months < 0) { years--; months += 12; }
  if (years < 0) return '';
  const parts = [];
  if (years > 0) parts.push(`${years} año${years === 1 ? '' : 's'}`);
  if (months > 0) parts.push(`${months} mes${months === 1 ? '' : 'es'}`);
  if (parts.length === 0) parts.push('Recién nacido');
  return parts.join(' y ');
}

/**
 * Returns birthday info for a given birth date.
 * @param {string} birthDate — ISO date string (YYYY-MM-DD)
 * @returns {{ isToday: boolean, isUpcoming: boolean, daysUntil: number, month: number, day: number, ageTurning: number } | null}
 */
export function getBirthdayInfo(birthDate) {
  if (!birthDate) return null;
  const [y, m, d] = birthDate.split('-').map(Number);
  if (!y || !m || !d) return null;

  const now = new Date();
  const thisYear = now.getFullYear();

  // This year's birthday
  let nextBday = new Date(thisYear, m - 1, d);
  // If already passed this year, use next year
  if (nextBday < new Date(thisYear, now.getMonth(), now.getDate())) {
    nextBday = new Date(thisYear + 1, m - 1, d);
  }

  const diffMs = nextBday.getTime() - new Date(thisYear, now.getMonth(), now.getDate()).getTime();
  const daysUntil = Math.round(diffMs / (1000 * 60 * 60 * 24));
  const isToday = daysUntil === 0;
  const isUpcoming = daysUntil > 0 && daysUntil <= 7;
  // La edad que cumple es el año del próximo cumpleaños menos el de nacimiento
  // (ej.: nace 2023-08-31 → su cumpleaños de 2026 es cuando cumple 3)
  const ageTurning = nextBday.getFullYear() - y;

  return { isToday, isUpcoming, daysUntil, month: m, day: d, ageTurning };
}

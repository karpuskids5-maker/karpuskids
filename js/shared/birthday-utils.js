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

  const now     = new Date();
  const todayY  = now.getFullYear();
  const todayM  = now.getMonth() + 1; // 1-based
  const todayD  = now.getDate();

  // Determinar si el cumpleaños de este año ya pasó
  // Comparación puramente de componentes de fecha (sin zonas horarias)
  const bdayThisYear_month = m;
  const bdayThisYear_day   = d;
  const alreadyPassed =
    bdayThisYear_month < todayM ||
    (bdayThisYear_month === todayM && bdayThisYear_day < todayD);

  const bdayYear  = alreadyPassed ? todayY + 1 : todayY;
  const nextBday  = new Date(bdayYear, m - 1, d);
  const todayDate = new Date(todayY,   todayM - 1, todayD);

  // Días exactos sin decimales ni DST (enteros de medianoche a medianoche)
  const daysUntil = Math.floor((nextBday.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));

  const isToday    = daysUntil === 0;
  const isUpcoming = daysUntil > 0 && daysUntil <= 7;

  // Edad que cumple = año del próximo cumpleaños − año de nacimiento
  const ageTurning = bdayYear - y;

  return { isToday, isUpcoming, daysUntil, month: m, day: d, ageTurning };
}

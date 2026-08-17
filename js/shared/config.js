/**
 * config.js — Fuente única de verdad para credenciales públicas del cliente.
 * La ANON_KEY es pública por diseño (Supabase client-side), pero centralizarla
 * facilita rotación y evita duplicación en múltiples archivos.
 */
export const SUPABASE_URL      = 'https://wwnfonkvemimwiqjpkij.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3bmZvbmt2ZW1pbXdpcWpwa2lqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4MzY0MzUsImV4cCI6MjA4MzQxMjQzNX0.n5VW-3U0r2nRlwC8pDstQLowu9MZ3aWHMzXVVNFQaDo';

/**
 * Jornadas disponibles y sus horarios por defecto.
 * entry / exit en formato HH:MM (24h).
 */
export const SCHEDULE_DEFINITIONS = [
  { id: 'Matutina',  entry: '08:00', exit: '11:45' },
  { id: 'Extendida', entry: '07:00', exit: '14:00' },
  { id: 'Completa',  entry: '07:00', exit: '18:00' },
];
export const SCHEDULE_IDS = SCHEDULE_DEFINITIONS.map(s => s.id);

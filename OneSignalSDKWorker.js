/**
 * 🔔 OneSignal Service Worker - Karpus Kids
 * Archivo optimizado para evitar errores de evaluación inicial.
 */

// 1. IMPORTANTE: Los importScripts deben ser lo PRIMERO y ÚNICO en la evaluación inicial.
// No agregues listeners de 'message' aquí, OneSignal ya los maneja internamente.
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");


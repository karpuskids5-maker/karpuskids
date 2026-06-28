# Ejemplos de Mora - Nueva Regla 2026

## Regla
- **Días 1 al 6 de atraso**: RD$50 por día  
- **Día 7 (primer bloque)**: Se convierte en RD$500 acumulados  
- **Después del día 7**: +RD$50 por día adicional  
- **Cada 7 días (nuevo bloque)**: +RD$500 adicionales  
- **Fórmula**: (bloques de 7 días × RD$500) + (días restantes × RD$50)

## Ejemplos de Cálculo

| Días de Atraso | Cálculo | Mora Total |
|---|---|---|
| 1 día | 1 × 50 | RD$50 |
| 3 días | 3 × 50 | RD$150 |
| 6 días | 6 × 50 | RD$300 |
| 7 días | 1 bloque × 500 | RD$500 |
| 8 días | 1 bloque × 500 + 1 × 50 | RD$550 |
| 10 días | 1 bloque × 500 + 3 × 50 | RD$650 |
| 13 días | 1 bloque × 500 + 6 × 50 | RD$800 |
| 14 días | 2 bloques × 500 | RD$1,000 |
| 15 días | 2 bloques × 500 + 1 × 50 | RD$1,050 |
| 21 días | 3 bloques × 500 | RD$1,500 |
| 25 días | 3 bloques × 500 + 4 × 50 | RD$1,700 |
| 30 días | 4 bloques × 500 + 2 × 50 | RD$2,100 |

## Archivos Actualizados
1. `PAYMENT_SECURITY_2026.sql` - Lógica en BD
2. `js/shared/helpers.js` - Lógica en cliente

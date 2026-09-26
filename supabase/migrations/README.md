# Migraciones de base de datos — Karpus Kids

Estas 10 migraciones consolidan **44 fuentes SQL** (36 archivos de
`migraciones/operativos/` y 8 de `supabase/migrations/`) y corrigen los defectos
encontrados al auditarlas.

Los 44 archivos originales **se eliminaron del repositorio** tras la
consolidación: no son válidos para desplegar. Estas 10 son las únicas
migraciones del proyecto y el único estado desplegable del esquema.

## Aplicar en este orden

| # | Archivo | Contenido |
|---|---------|-----------|
| 01 | `20260920120100_01_esquema.sql` | Núcleo: perfiles, aulas, años escolares, periodos, estudiantes, asistencia, tareas |
| 02 | `20260920120200_02_esquema.sql` | Pagos: `payments`, conceptos de cobro, cargos del estudiante |
| 03 | `20260920120300_03_esquema.sql` | Académico: asignaturas, actividades, calificaciones, boletines |
| 04 | `20260920120400_04_esquema.sql` | Operación: incidentes, rutina, accesos, agenda, reuniones, reportes, matrícula |
| 05 | `20260920120500_05_esquema.sql` | Muro y comunicación: `posts`, comentarios, reacciones, chat, notificaciones |
| 06 | `20260920120600_06_esquema.sql` | Comercio y social: tienda, donaciones, referidos, preinscripción, respaldo |
| 07 | `20260920120700_07_indices.sql` | Índices de performance |
| 08 | `20260920120800_08_funciones_vistas_triggers_storage.sql` | Funciones, vistas, triggers, buckets de storage y sus policies |
| 09 | `20260920120900_09_rls_policies.sql` | RLS de todas las tablas + grants |
| 10 | `20260920121000_10_correcciones_auditoria.sql` | Correcciones de auditoría (ver abajo) |

Los timestamps arrancan en `20260920`, después de la última migración anterior
(`20260919120000_asistencia_unifica_horario.sql`), así que se aplican al final.

```bash
supabase db push          # aplica lo pendiente en orden
# o manual, en orden 01 -> 10:
psql "$DATABASE_URL" -f 20260920120100_01_esquema.sql
psql "$DATABASE_URL" -f 20260920120200_02_esquema.sql
# ... etc
```

## Idempotencia

Todas las migraciones son idempotentes y se pueden aplicar **sobre la base ya
desplegada sin perder datos**:

- `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
  `CREATE OR REPLACE FUNCTION/VIEW`, `CREATE POLICY` sobre `DROP ... IF EXISTS`
  previo, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
- La 10 usa `DROP ... IF EXISTS` antes de cada `CREATE` de objetos que cambian
  de definición, y envuelve las extensiones opcionales (`pg_cron`, `pg_net`,
  `pgcrypto`) en `DO ... EXCEPTION` para que no fallen si no están disponibles.

## Correcciones de la migración 10

| Bloque | Corrección |
|--------|-----------|
| A | Eliminación de tablas muertas: `payment_audit_log`, `payment_plans`, `payment_installments` |
| A2 | Índice único pasa a `(student_id, month_paid, concept)`: el anterior impedía tener 2 cargos en el mismo mes |
| A3 | Trigger de reinscripción que leía `payments.recorded_by` (columna eliminada) |
| B | `fn_protect_paid_records`: el `DELETE` era un no-op silencioso **[crítico]** |
| C | Protección de montos en pagos ya pagados |
| D | RPC `get_morosidad_report(text)` |
| E | Normalización `rechazado` → `rejected` + `payments_status_check` |
| F | `generate_annual_payments` → alias obsoleto de `run_payment_cycle()`; `pay_full_year` corregido |
| G | RLS de pagos simétrica (parent/teacher/staff) |
| H | `get_monthly_fee_for`, `run_payment_cycle`, `sync_current_month_payment` (regla del día 25) |
| I | Vista `v_payments_with_mora` recreada sin las columnas eliminadas |
| J | Bucket `posts` del Muro + límite de 25 MB en `classroom_media` |
| K | `post_views` con deduplicación real |
| L | Crons sin placeholders: tabla `cron_endpoints` |
| M | `post_views` con deduplicación real; `increment_post_views` deja de contar en bucle (requiere `DROP`, cambia el retorno de `void` a `boolean`) |
| N | **Periodo escolar 2026-2027**: piso de cobros en `2026-08` (`public.school_year_floor_month()`), archivo de años escolares anteriores, liquidación de la deuda previa y `CHECK` que impide generar o pagar meses anteriores a agosto de 2026 |

## Periodo de cobros 2026-2027

El único periodo facturable es **agosto 2026 en adelante** (hasta `2027-06-30`).
No se generan, no se cobra y no se reportan meses anteriores.

- `public.school_year_floor_month()` devuelve el mes inicial del año escolar más
  reciente. Todas las funciones de cobro lo consultan.
- La migración 10 archiva los años escolares anteriores y asegura el
  `2026-2027` (`2026-08-01` → `2027-06-30`).
- `payments_month_floor_check` es un `CHECK ... NOT VALID` con el literal
  `2026-08`: impide **nuevos** registros fuera del periodo sin rechazar el
  historial ya existente.
- La deuda previa se liquida: los pagos `pending`/`review`/`overdue` anteriores a
  agosto se marcan `deleted_at`, y los cargos correspondientes pasan a `waived`.
  Los pagos ya `paid` **se conservan** (son dinero recibido).
- `financial_summary_month()` devuelve ceros para meses fuera del periodo en
  lugar de exponer la deuda antigua.

> La marca `NOT VALID` deja pasar filas antiguas a propósito. Para borrar también
> el historial pagado hay que hacerlo de forma explícita y consciente.

## Vocabulario de estados de pago

`pending` · `review` · `paid` · `overdue` · `rejected`

`rejected` es el valor en base de datos. `rechazado` es solo el alias de
presentación en la interfaz. El borrado es lógico, vía `deleted_at`.

## Validación

Estas migraciones pasan parseo estático con `pgsql-parser`. **No han sido
ejecutadas contra una base real**: los permisos, RLS, triggers y el
comportamiento de `run_payment_cycle()` deben verificarse en Supabase tras el
primer `db push`.

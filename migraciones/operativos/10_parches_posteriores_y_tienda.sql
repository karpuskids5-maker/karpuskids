-- ═══════════════════════════════════════════════════════════════════════════
-- KARPUS KIDS · SQL OPERATIVO 10/10 — PARCHES POSTERIORES AL MAESTRO + TIENDA
-- ═══════════════════════════════════════════════════════════════════════════
-- Todos los SQL creados DESPUÉS del schema maestro, en orden cronológico.
-- Incluye el módulo TIENDA ESCOLAR completo (v1+v2+v3 fusionados aquí).
--
-- ⚠ EJECUTAR EN ORDEN: 01 → 10 (Supabase Dashboard → SQL Editor)
--   Cada archivo continúa el esquema del anterior; no saltarse ninguno
--   en una base nueva. En la base existente son idempotentes.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- 10.1 · TIENDA v1 — esquema base (tablas, RPCs, RLS)
-- Origen: db/store.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- KARPUS KIDS · TIENDA ESCOLAR — Esquema de Base de Datos
-- ═══════════════════════════════════════════════════════════════════════════
--
--   Módulo   : Tienda Escolar
--   Archivo  : db/store.sql
--   Entorno  : Supabase (PostgreSQL 15+)
--   Fecha    : Agosto 2026
--
--   Tablas:
--     store_categories  — Categorías de productos
--     store_products    — Catálogo de productos
--     store_orders      — Pedidos de padres
--     store_order_items — Ítems de cada pedido
--     store_inventory   — Movimientos de inventario (entradas/salidas)
--
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. CATEGORÍAS ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS store_categories (
  id          SERIAL  PRIMARY KEY,
  name        TEXT    NOT NULL,
  icon        TEXT    DEFAULT '📦',
  sort_order  INT     DEFAULT 0,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Categorías iniciales
INSERT INTO store_categories (name, icon, sort_order) VALUES
  ('Uniformes',       '👕', 1),
  ('Útiles',          '✏️', 2),
  ('Refrigerios',     '🍱', 3),
  ('Libros',          '📚', 4),
  ('Actividades',     '🎨', 5)
ON CONFLICT DO NOTHING;

-- ── 2. PRODUCTOS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS store_products (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id  INT     REFERENCES store_categories(id) ON DELETE SET NULL,
  name         TEXT    NOT NULL,
  description  TEXT,
  price        NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  image_url    TEXT,
  stock        INT     NOT NULL DEFAULT 0 CHECK (stock >= 0),
  unit         TEXT    DEFAULT 'unidad',   -- 'unidad', 'par', 'kit', 'litro'
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── 3. PEDIDOS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS store_orders (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id    UUID    NOT NULL REFERENCES profiles(id)  ON DELETE CASCADE,
  student_id   BIGINT  REFERENCES students(id)           ON DELETE SET NULL,
  status       TEXT    NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','confirmed','ready','delivered','cancelled')),
  total        NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes        TEXT,
  confirmed_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── 4. ÍTEMS DEL PEDIDO ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS store_order_items (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID    NOT NULL REFERENCES store_orders(id)   ON DELETE CASCADE,
  product_id  UUID    NOT NULL REFERENCES store_products(id) ON DELETE RESTRICT,
  quantity    INT     NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price  NUMERIC(10,2) NOT NULL,          -- precio al momento del pedido
  subtotal    NUMERIC(10,2) GENERATED ALWAYS AS (quantity * unit_price) STORED
);

-- ── 5. INVENTARIO ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS store_inventory (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID    NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
  type        TEXT    NOT NULL CHECK (type IN ('entry','exit','adjustment')),
  quantity    INT     NOT NULL,               -- positivo = entrada, negativo = salida
  reason      TEXT,                           -- 'compra', 'venta', 'devolución', 'ajuste'
  actor_id    UUID    REFERENCES profiles(id) ON DELETE SET NULL,
  order_id    UUID    REFERENCES store_orders(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 6. ÍNDICES ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_store_products_category  ON store_products(category_id);
CREATE INDEX IF NOT EXISTS idx_store_products_active    ON store_products(is_active);
CREATE INDEX IF NOT EXISTS idx_store_orders_parent      ON store_orders(parent_id);
CREATE INDEX IF NOT EXISTS idx_store_orders_student     ON store_orders(student_id);
CREATE INDEX IF NOT EXISTS idx_store_orders_status      ON store_orders(status);
CREATE INDEX IF NOT EXISTS idx_store_order_items_order  ON store_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_store_inventory_product  ON store_inventory(product_id);

-- ── 7. TRIGGER updated_at ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION store_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_store_products_updated
  BEFORE UPDATE ON store_products
  FOR EACH ROW EXECUTE FUNCTION store_set_updated_at();

CREATE OR REPLACE TRIGGER trg_store_orders_updated
  BEFORE UPDATE ON store_orders
  FOR EACH ROW EXECUTE FUNCTION store_set_updated_at();

-- ── 8. TRIGGER: descontar stock al confirmar pedido ──────────────────────────
CREATE OR REPLACE FUNCTION store_deduct_stock_on_confirm()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Solo actuar cuando el pedido pasa a 'confirmed' desde otro estado
  IF NEW.status = 'confirmed' AND (OLD.status IS DISTINCT FROM 'confirmed') THEN
    -- Descontar stock y registrar movimiento de inventario
    INSERT INTO store_inventory (product_id, type, quantity, reason, actor_id, order_id)
    SELECT
      i.product_id,
      'exit',
      -i.quantity,
      'venta',
      NEW.parent_id,
      NEW.id
    FROM store_order_items i
    WHERE i.order_id = NEW.id;

    -- Actualizar stock en store_products
    UPDATE store_products sp
    SET stock = sp.stock - i.quantity
    FROM store_order_items i
    WHERE i.order_id = NEW.id
      AND sp.id = i.product_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_store_deduct_stock
  AFTER UPDATE ON store_orders
  FOR EACH ROW EXECUTE FUNCTION store_deduct_stock_on_confirm();

-- ── 9. TRIGGER: recalcular total del pedido al cambiar ítems ─────────────────
CREATE OR REPLACE FUNCTION store_recalculate_order_total()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_order_id UUID;
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);
  UPDATE store_orders
  SET total = (
    SELECT COALESCE(SUM(subtotal), 0)
    FROM store_order_items
    WHERE order_id = v_order_id
  )
  WHERE id = v_order_id;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER trg_store_order_total
  AFTER INSERT OR UPDATE OR DELETE ON store_order_items
  FOR EACH ROW EXECUTE FUNCTION store_recalculate_order_total();

-- ── 10. FUNCIONES RPC ─────────────────────────────────────────────────────────

-- Catálogo activo con stock disponible
DROP FUNCTION IF EXISTS get_store_catalog();
CREATE OR REPLACE FUNCTION get_store_catalog()
RETURNS TABLE (
  id          UUID,
  name        TEXT,
  description TEXT,
  price       NUMERIC,
  image_url   TEXT,
  stock       INT,
  unit        TEXT,
  category    TEXT,
  category_icon TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    p.id, p.name, p.description, p.price,
    p.image_url, p.stock, p.unit,
    c.name   AS category,
    c.icon   AS category_icon
  FROM store_products p
  LEFT JOIN store_categories c ON c.id = p.category_id
  WHERE p.is_active = TRUE
  ORDER BY c.sort_order, p.name;
$$;

-- Crear pedido (llamado por el padre)
CREATE OR REPLACE FUNCTION create_store_order(
  p_student_id  bigint,
  p_items       JSONB,   -- [{ product_id, quantity }]
  p_notes       TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_parent_id UUID := auth.uid();
  v_order_id  UUID;
  v_item      JSONB;
  v_product   store_products%ROWTYPE;
BEGIN
  -- Crear el pedido vacío
  INSERT INTO store_orders (parent_id, student_id, notes)
  VALUES (v_parent_id, p_student_id, p_notes)
  RETURNING id INTO v_order_id;

  -- Insertar cada ítem y validar stock
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT * INTO v_product
    FROM store_products
    WHERE id = (v_item->>'product_id')::UUID AND is_active = TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Producto no encontrado: %', v_item->>'product_id';
    END IF;

    IF v_product.stock < (v_item->>'quantity')::INT THEN
      RAISE EXCEPTION 'Stock insuficiente para "%": disponible %, solicitado %',
        v_product.name, v_product.stock, v_item->>'quantity';
    END IF;

    INSERT INTO store_order_items (order_id, product_id, quantity, unit_price)
    VALUES (
      v_order_id,
      (v_item->>'product_id')::UUID,
      (v_item->>'quantity')::INT,
      v_product.price
    );
  END LOOP;

  RETURN v_order_id;
END;
$$;

-- Mis pedidos (padre)
CREATE OR REPLACE FUNCTION get_my_store_orders()
RETURNS TABLE (
  id           UUID,
  status       TEXT,
  total        NUMERIC,
  notes        TEXT,
  created_at   TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  items        JSONB
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    o.id, o.status, o.total, o.notes, o.created_at, o.delivered_at,
    COALESCE(
      jsonb_agg(jsonb_build_object(
        'product_name', p.name,
        'quantity',     i.quantity,
        'unit_price',   i.unit_price,
        'subtotal',     i.subtotal
      )) FILTER (WHERE i.id IS NOT NULL),
      '[]'::jsonb
    ) AS items
  FROM store_orders o
  LEFT JOIN store_order_items i ON i.order_id = o.id
  LEFT JOIN store_products p    ON p.id = i.product_id
  WHERE o.parent_id = auth.uid()
  GROUP BY o.id
  ORDER BY o.created_at DESC;
$$;

-- Todos los pedidos (staff)
CREATE OR REPLACE FUNCTION get_all_store_orders(p_status TEXT DEFAULT NULL)
RETURNS TABLE (
  id           UUID,
  status       TEXT,
  total        NUMERIC,
  notes        TEXT,
  created_at   TIMESTAMPTZ,
  parent_name  TEXT,
  student_name TEXT,
  items        JSONB
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    o.id, o.status, o.total, o.notes, o.created_at,
    pr.name  AS parent_name,
    st.name  AS student_name,
    COALESCE(
      jsonb_agg(jsonb_build_object(
        'product_name', pd.name,
        'quantity',     i.quantity,
        'unit_price',   i.unit_price,
        'subtotal',     i.subtotal
      )) FILTER (WHERE i.id IS NOT NULL),
      '[]'::jsonb
    ) AS items
  FROM store_orders o
  LEFT JOIN profiles pr          ON pr.id = o.parent_id
  LEFT JOIN students st          ON st.id = o.student_id
  LEFT JOIN store_order_items i  ON i.order_id = o.id
  LEFT JOIN store_products pd    ON pd.id = i.product_id
  WHERE (p_status IS NULL OR o.status = p_status)
  GROUP BY o.id, pr.name, st.name
  ORDER BY o.created_at DESC;
$$;

-- ── 11. ROW LEVEL SECURITY ────────────────────────────────────────────────────
ALTER TABLE store_categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_products     ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_order_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_inventory    ENABLE ROW LEVEL SECURITY;

-- Categorías: lectura pública (autenticados)
DROP POLICY IF EXISTS "store_categories_read" ON store_categories;
CREATE POLICY "store_categories_read" ON store_categories
  FOR SELECT TO authenticated USING (TRUE);

-- Productos: lectura pública (autenticados)
DROP POLICY IF EXISTS "store_products_read" ON store_products;
CREATE POLICY "store_products_read" ON store_products
  FOR SELECT TO authenticated USING (is_active = TRUE);

-- Productos: escritura solo staff
DROP POLICY IF EXISTS "store_products_write_staff" ON store_products;
CREATE POLICY "store_products_write_staff" ON store_products
  FOR ALL TO authenticated
  USING   (get_my_role() IN ('directora','asistente','admin'))
  WITH CHECK (get_my_role() IN ('directora','asistente','admin'));

-- Pedidos: padre ve solo los suyos
DROP POLICY IF EXISTS "store_orders_parent_read" ON store_orders;
CREATE POLICY "store_orders_parent_read" ON store_orders
  FOR SELECT TO authenticated
  USING (parent_id = auth.uid() OR get_my_role() IN ('directora','asistente','admin'));

-- Pedidos: padre puede crear los suyos
DROP POLICY IF EXISTS "store_orders_parent_insert" ON store_orders;
CREATE POLICY "store_orders_parent_insert" ON store_orders
  FOR INSERT TO authenticated
  WITH CHECK (parent_id = auth.uid());

-- Pedidos: staff puede actualizar estado
DROP POLICY IF EXISTS "store_orders_staff_update" ON store_orders;
CREATE POLICY "store_orders_staff_update" ON store_orders
  FOR UPDATE TO authenticated
  USING (get_my_role() IN ('directora','asistente','admin'));

-- Ítems: heredan permisos del pedido
DROP POLICY IF EXISTS "store_order_items_read" ON store_order_items;
CREATE POLICY "store_order_items_read" ON store_order_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM store_orders o
      WHERE o.id = order_id
        AND (o.parent_id = auth.uid() OR get_my_role() IN ('directora','asistente','admin'))
    )
  );

DROP POLICY IF EXISTS "store_order_items_insert" ON store_order_items;
CREATE POLICY "store_order_items_insert" ON store_order_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM store_orders o
      WHERE o.id = order_id AND o.parent_id = auth.uid()
    )
  );

-- Inventario: solo staff
DROP POLICY IF EXISTS "store_inventory_staff" ON store_inventory;
CREATE POLICY "store_inventory_staff" ON store_inventory
  FOR ALL TO authenticated
  USING   (get_my_role() IN ('directora','asistente','admin'))
  WITH CHECK (get_my_role() IN ('directora','asistente','admin'));

-- ═══════════════════════════════════════════════════════════════════════════
-- FIN DEL ESQUEMA — TIENDA ESCOLAR KARPUS KIDS
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 10.2 · TIENDA v2 — multi-imagen, tallas, stock por talla, inventario
-- Origen: db/store_v2_migration.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- KARPUS KIDS · TIENDA ESCOLAR — Migración v2
-- Agrega: múltiples imágenes, tallas, stock por talla, categorías dinámicas,
--         salidas en inventario, y vista enriquecida de inventario
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Nuevas columnas en store_products
ALTER TABLE store_products
  ADD COLUMN IF NOT EXISTS images      TEXT[]   DEFAULT '{}',   -- array de URLs subidas a Storage
  ADD COLUMN IF NOT EXISTS has_sizes   BOOLEAN  DEFAULT FALSE,  -- habilita tallas
  ADD COLUMN IF NOT EXISTS unit        TEXT     DEFAULT 'unidad';

-- 2. Tabla de stock por talla
CREATE TABLE IF NOT EXISTS store_product_sizes (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID    NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
  size_label  TEXT    NOT NULL,   -- 'XS','S','M','L','XL','2','4','6','8','10','12',...
  stock       INT     NOT NULL DEFAULT 0 CHECK (stock >= 0),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, size_label)
);

CREATE INDEX IF NOT EXISTS idx_store_sizes_product ON store_product_sizes(product_id);

-- RLS para tallas
ALTER TABLE store_product_sizes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_sizes_read" ON store_product_sizes;
CREATE POLICY "store_sizes_read" ON store_product_sizes
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "store_sizes_write_staff" ON store_product_sizes;
CREATE POLICY "store_sizes_write_staff" ON store_product_sizes
  FOR ALL TO authenticated
  USING   (get_my_role() IN ('directora','asistente','admin'))
  WITH CHECK (get_my_role() IN ('directora','asistente','admin'));

-- 3. Agregar size_label a store_order_items (opcional al pedir)
ALTER TABLE store_order_items
  ADD COLUMN IF NOT EXISTS size_label TEXT DEFAULT NULL;

-- 4. Vista enriquecida de inventario
CREATE OR REPLACE VIEW store_inventory_view AS
SELECT
  i.id,
  i.created_at,
  i.type,
  i.quantity,
  i.reason,
  p.name    AS product_name,
  p.images[1] AS product_image,
  c.name    AS category_name,
  pr.name   AS actor_name,
  i.order_id
FROM store_inventory i
LEFT JOIN store_products    p  ON p.id = i.product_id
LEFT JOIN store_categories  c  ON c.id = p.category_id
LEFT JOIN profiles          pr ON pr.id = i.actor_id
ORDER BY i.created_at DESC;

-- 5. RPC: catálogo con tallas
DROP FUNCTION IF EXISTS get_store_catalog();
CREATE OR REPLACE FUNCTION get_store_catalog()
RETURNS TABLE (
  id            UUID,
  name          TEXT,
  description   TEXT,
  price         NUMERIC,
  images        TEXT[],
  stock         INT,
  unit          TEXT,
  has_sizes     BOOLEAN,
  category      TEXT,
  category_icon TEXT,
  sizes         JSONB
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    p.id, p.name, p.description, p.price,
    COALESCE(p.images, '{}'),
    p.stock, p.unit,
    p.has_sizes,
    c.name        AS category,
    c.icon        AS category_icon,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('label', s.size_label, 'stock', s.stock) ORDER BY s.size_label)
       FROM store_product_sizes s WHERE s.product_id = p.id),
      '[]'::jsonb
    ) AS sizes
  FROM store_products p
  LEFT JOIN store_categories c ON c.id = p.category_id
  WHERE p.is_active = TRUE
  ORDER BY c.sort_order, p.name;
$$;

-- 6. RPC: inventario reciente para el panel admin
DROP FUNCTION IF EXISTS get_store_inventory(integer);
CREATE OR REPLACE FUNCTION get_store_inventory(p_limit INT DEFAULT 50)
RETURNS TABLE (
  id            UUID,
  created_at    TIMESTAMPTZ,
  type          TEXT,
  type_label    TEXT,
  quantity      INT,
  reason        TEXT,
  product_name  TEXT,
  product_image TEXT,
  category_name TEXT,
  actor_name    TEXT,
  order_id      UUID
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    i.id,
    i.created_at,
    i.type,
    CASE i.type
      WHEN 'entry'      THEN 'Entrada'
      WHEN 'exit'       THEN 'Salida'
      WHEN 'adjustment' THEN 'Ajuste'
      ELSE i.type
    END AS type_label,
    i.quantity,
    i.reason,
    p.name        AS product_name,
    COALESCE(p.images[1], '') AS product_image,
    c.name        AS category_name,
    pr.name       AS actor_name,
    i.order_id
  FROM store_inventory i
  LEFT JOIN store_products   p  ON p.id = i.product_id
  LEFT JOIN store_categories c  ON c.id = p.category_id
  LEFT JOIN profiles         pr ON pr.id = i.actor_id
  ORDER BY i.created_at DESC
  LIMIT p_limit;
$$;

-- 7. RPC: registrar movimiento manual de inventario (entrada/ajuste/salida)
CREATE OR REPLACE FUNCTION store_manual_movement(
  p_product_id UUID,
  p_type       TEXT,   -- 'entry' | 'exit' | 'adjustment'
  p_quantity   INT,
  p_reason     TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_actor UUID := auth.uid();
BEGIN
  IF p_type NOT IN ('entry','exit','adjustment') THEN
    RAISE EXCEPTION 'Tipo inválido: %', p_type;
  END IF;

  INSERT INTO store_inventory(product_id, type, quantity, reason, actor_id)
  VALUES (p_product_id, p_type, p_quantity, p_reason, v_actor);

  -- Actualizar stock
  UPDATE store_products
  SET stock = GREATEST(0, stock + p_quantity)
  WHERE id = p_product_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- FIN DE MIGRACIÓN v2
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 10.3 · TIENDA v3 — política categorías staff, size_label en pedidos/inventario, store_manual_movement_v2
-- Origen: db/store_v3_migration.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- KARPUS KIDS · TIENDA ESCOLAR — Migración v3
-- Agrega: política de escritura de categorías para staff, tallas registradas
--         en pedidos e inventario, salidas/entradas por talla con validación,
--         RPC store_manual_movement_v2, log de inventario con talla.
--
-- Ejecutar en Supabase → SQL Editor (es idempotente, puede re-ejecutarse).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Escritura de categorías solo staff ─────────────────────────────────────
DROP POLICY IF EXISTS "store_categories_write_staff" ON store_categories;
CREATE POLICY "store_categories_write_staff" ON store_categories
  FOR ALL TO authenticated
  USING   (get_my_role() IN ('directora','asistente','admin'))
  WITH CHECK (get_my_role() IN ('directora','asistente','admin'));

-- 2. Talla en los movimientos de inventario ──────────────────────────────────
ALTER TABLE store_inventory ADD COLUMN IF NOT EXISTS size_label TEXT;

-- 3. create_store_order guarda y valida la talla elegida por el padre ───────
CREATE OR REPLACE FUNCTION create_store_order(
  p_student_id  bigint,
  p_items       JSONB,   -- [{ product_id, quantity, size_label? }]
  p_notes       TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_parent_id UUID := auth.uid();
  v_order_id  UUID;
  v_item      JSONB;
  v_product   store_products%ROWTYPE;
  v_size_stock INT;
BEGIN
  INSERT INTO store_orders (parent_id, student_id, notes)
  VALUES (v_parent_id, p_student_id, p_notes)
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT * INTO v_product
    FROM store_products
    WHERE id = (v_item->>'product_id')::UUID AND is_active = TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Producto no encontrado: %', v_item->>'product_id';
    END IF;

    -- Validación por talla cuando el ítem trae talla
    IF COALESCE(v_item->>'size_label','') <> '' THEN
      SELECT s.stock INTO v_size_stock
      FROM store_product_sizes s
      WHERE s.product_id = v_product.id
        AND s.size_label = v_item->>'size_label';

      IF v_size_stock IS NULL THEN
        RAISE EXCEPTION 'La talla "%" no existe para "%"', v_item->>'size_label', v_product.name;
      END IF;

      IF v_size_stock < (v_item->>'quantity')::INT THEN
        RAISE EXCEPTION 'Stock insuficiente en talla % de "%": disponible %, solicitado %',
          v_item->>'size_label', v_product.name, v_size_stock, v_item->>'quantity';
      END IF;
    ELSE
      IF v_product.stock < (v_item->>'quantity')::INT THEN
        RAISE EXCEPTION 'Stock insuficiente para "%": disponible %, solicitado %',
          v_product.name, v_product.stock, v_item->>'quantity';
      END IF;
    END IF;

    INSERT INTO store_order_items (order_id, product_id, quantity, unit_price, size_label)
    VALUES (
      v_order_id,
      (v_item->>'product_id')::UUID,
      (v_item->>'quantity')::INT,
      v_product.price,
      NULLIF(v_item->>'size_label','')
    );
  END LOOP;

  RETURN v_order_id;
END;
$$;

-- 4. Al confirmar un pedido se descuenta stock general Y por talla ─────────
CREATE OR REPLACE FUNCTION store_deduct_stock_on_confirm()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'confirmed' AND (OLD.status IS DISTINCT FROM 'confirmed') THEN
    INSERT INTO store_inventory (product_id, type, quantity, reason, actor_id, order_id, size_label)
    SELECT
      i.product_id,
      'exit',
      -i.quantity,
      'venta',
      NEW.parent_id,
      NEW.id,
      i.size_label
    FROM store_order_items i
    WHERE i.order_id = NEW.id;

    UPDATE store_products sp
    SET stock = GREATEST(0, sp.stock - i.quantity)
    FROM store_order_items i
    WHERE i.order_id = NEW.id
      AND sp.id = i.product_id;

    -- Descontar también la talla específica
    UPDATE store_product_sizes s
    SET stock = GREATEST(0, s.stock - i.quantity)
    FROM store_order_items i
    WHERE i.order_id = NEW.id
      AND s.product_id = i.product_id
      AND i.size_label IS NOT NULL
      AND s.size_label = i.size_label;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_store_deduct_stock ON store_orders;
CREATE TRIGGER trg_store_deduct_stock
  AFTER UPDATE ON store_orders
  FOR EACH ROW EXECUTE FUNCTION store_deduct_stock_on_confirm();

-- 5. RPC: movimiento manual (entrada / salida / ajuste) opcionalmente por talla
CREATE OR REPLACE FUNCTION store_manual_movement_v2(
  p_product_id UUID,
  p_type       TEXT,   -- 'entry' | 'exit' | 'adjustment'
  p_quantity   INT,    -- siempre positivo; el tipo define el signo (ajuste admite signo)
  p_reason     TEXT DEFAULT NULL,
  p_size_label TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_actor     UUID := auth.uid();
  v_signed    INT;
  v_has_sizes BOOLEAN;
  v_available INT;
BEGIN
  IF p_type NOT IN ('entry','exit','adjustment') THEN
    RAISE EXCEPTION 'Tipo inválido: %', p_type;
  END IF;

  SELECT has_sizes INTO v_has_sizes FROM store_products WHERE id = p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;

  IF p_type = 'exit' THEN
    v_signed := -ABS(p_quantity);
  ELSIF p_type = 'entry' THEN
    v_signed := ABS(p_quantity);
  ELSE
    v_signed := p_quantity;  -- ajuste: delta con signo
  END IF;

  -- Validación dura: salida sin talla en producto con tallas
  IF p_type = 'exit' AND v_has_sizes AND COALESCE(p_size_label,'') = '' THEN
    RAISE EXCEPTION 'FALTA_TALLA: este producto se gestiona por tallas, selecciona una talla';
  END IF;

  IF COALESCE(p_size_label,'') <> '' THEN
    SELECT stock INTO v_available
    FROM store_product_sizes
    WHERE product_id = p_product_id AND size_label = p_size_label;

    IF v_available IS NULL THEN
      RAISE EXCEPTION 'La talla "%" no existe para este producto', p_size_label;
    END IF;
    IF v_available + v_signed < 0 THEN
      RAISE EXCEPTION 'STOCK_INSUFICIENTE: solo hay % unidades en talla %', v_available, p_size_label;
    END IF;

    INSERT INTO store_inventory (product_id, type, quantity, reason, actor_id, size_label)
    VALUES (p_product_id, p_type, v_signed, p_reason, v_actor, p_size_label);

    UPDATE store_product_sizes
    SET stock = stock + v_signed
    WHERE product_id = p_product_id AND size_label = p_size_label;

    -- El stock general del producto siempre refleja la suma de sus tallas
    UPDATE store_products sp
    SET stock = COALESCE((SELECT SUM(s.stock) FROM store_product_sizes s WHERE s.product_id = sp.id), 0)
    WHERE id = p_product_id;
  ELSE
    IF v_available IS NULL AND p_type = 'exit' THEN
      SELECT stock INTO v_available FROM store_products WHERE id = p_product_id;
      IF v_available + v_signed < 0 THEN
        RAISE EXCEPTION 'STOCK_INSUFICIENTE: solo hay % unidades disponibles', v_available;
      END IF;
    END IF;

    INSERT INTO store_inventory (product_id, type, quantity, reason, actor_id)
    VALUES (p_product_id, p_type, v_signed, p_reason, v_actor);

    UPDATE store_products
    SET stock = GREATEST(0, stock + v_signed)
    WHERE id = p_product_id;
  END IF;
END;
$$;

-- 6. Log de inventario enriquecido (ahora incluye talla) ────────────────────
DROP FUNCTION IF EXISTS get_store_inventory(integer);
CREATE OR REPLACE FUNCTION get_store_inventory(p_limit INT DEFAULT 50)
RETURNS TABLE (
  id            UUID,
  created_at    TIMESTAMPTZ,
  type          TEXT,
  type_label    TEXT,
  quantity      INT,
  reason        TEXT,
  size_label    TEXT,
  product_name  TEXT,
  product_image TEXT,
  category_name TEXT,
  actor_name    TEXT,
  order_id      UUID
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    i.id,
    i.created_at,
    i.type,
    CASE i.type
      WHEN 'entry'      THEN 'Entrada'
      WHEN 'exit'       THEN 'Salida'
      WHEN 'adjustment' THEN 'Ajuste'
      ELSE i.type
    END AS type_label,
    i.quantity,
    i.reason,
    i.size_label,
    p.name        AS product_name,
    COALESCE(p.images[1], '') AS product_image,
    c.name        AS category_name,
    pr.name       AS actor_name,
    i.order_id
  FROM store_inventory i
  LEFT JOIN store_products   p  ON p.id = i.product_id
  LEFT JOIN store_categories c  ON c.id = p.category_id
  LEFT JOIN profiles         pr ON pr.id = i.actor_id
  ORDER BY i.created_at DESC
  LIMIT p_limit;
$$;

-- 7. Pedidos con talla visible en los ítems (padre y staff) ─────────────────
CREATE OR REPLACE FUNCTION get_my_store_orders()
RETURNS TABLE (
  id           UUID,
  status       TEXT,
  total        NUMERIC,
  notes        TEXT,
  created_at   TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  items        JSONB
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    o.id, o.status, o.total, o.notes, o.created_at, o.delivered_at,
    COALESCE(
      jsonb_agg(jsonb_build_object(
        'product_name', p.name,
        'size_label',   i.size_label,
        'quantity',     i.quantity,
        'unit_price',   i.unit_price,
        'subtotal',     i.subtotal
      )) FILTER (WHERE i.id IS NOT NULL),
      '[]'::jsonb
    ) AS items
  FROM store_orders o
  LEFT JOIN store_order_items i ON i.order_id = o.id
  LEFT JOIN store_products p    ON p.id = i.product_id
  WHERE o.parent_id = auth.uid()
  GROUP BY o.id
  ORDER BY o.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION get_all_store_orders(p_status TEXT DEFAULT NULL)
RETURNS TABLE (
  id           UUID,
  status       TEXT,
  total        NUMERIC,
  notes        TEXT,
  created_at   TIMESTAMPTZ,
  parent_name  TEXT,
  student_name TEXT,
  items        JSONB
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    o.id, o.status, o.total, o.notes, o.created_at,
    pr.name  AS parent_name,
    st.name  AS student_name,
    COALESCE(
      jsonb_agg(jsonb_build_object(
        'product_name', pd.name,
        'size_label',   i.size_label,
        'quantity',     i.quantity,
        'unit_price',   i.unit_price,
        'subtotal',     i.subtotal
      )) FILTER (WHERE i.id IS NOT NULL),
      '[]'::jsonb
    ) AS items
  FROM store_orders o
  LEFT JOIN profiles pr          ON pr.id = o.parent_id
  LEFT JOIN students st          ON st.id = o.student_id
  LEFT JOIN store_order_items i  ON i.order_id = o.id
  LEFT JOIN store_products pd    ON pd.id = i.product_id
  WHERE (p_status IS NULL OR o.status = p_status)
  GROUP BY o.id, pr.name, st.name
  ORDER BY o.created_at DESC;
$$;

-- 8. Resincronizar el stock general de productos gestionados por tallas ─────
UPDATE store_products sp
SET stock = COALESCE((SELECT SUM(s.stock) FROM store_product_sizes s WHERE s.product_id = sp.id), 0)
WHERE sp.has_sizes;

-- ═══════════════════════════════════════════════════════════════════════════
-- FIN DE MIGRACIÓN v3 — TIENDA ESCOLAR KARPUS KIDS
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 10.4 · posts — columnas faltantes
-- Origen: migraciones/fix_posts_missing_columns.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ═════════════════════════════════════════════════════════════════════════════
-- FIX: Agregar columnas faltantes a la tabla posts
-- Causa: Las queries del muro fallan con 400 Bad Request porque el JS
-- referencia columnas que no existen en la BD.
-- Ejecutar en Supabase SQL Editor.
-- ═════════════════════════════════════════════════════════════════════════════

-- Columnas que el JS (wall.js / wall.module.js) necesita:
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS is_pinned boolean DEFAULT false;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS comments_enabled boolean DEFAULT true;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS expire_days integer;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS status text DEFAULT 'published';
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS views_count integer DEFAULT 0;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS tagged_students jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS thumbnail_url text;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS author_role text;

-- Índices para performance de las queries del scheduler y filtros
CREATE INDEX IF NOT EXISTS idx_posts_status_scheduled ON public.posts(status, scheduled_at)
  WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_posts_is_pinned ON public.posts(is_pinned) WHERE is_pinned = true;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10.5 · likes — columna reaction_type
-- Origen: migraciones/fix_likes_reaction_type.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ═════════════════════════════════════════════════════════════════════════════
-- FIX: Agregar columna reaction_type a la tabla likes
-- Causa: wall.js usa likes(user_id, reaction_type) y hace INSERT con
--        reaction_type, pero la columna no existe en la BD de producción.
--        Esto provoca 400 Bad Request en:
--          - GET  /rest/v1/posts?select=...likes(user_id, reaction_type)...
--          - POST /rest/v1/likes
-- Sintomas: el muro pierde reacciones/comentarios y las fotos muestran
--           "Imagen no disponible".
-- Ejecutar en Supabase SQL Editor (es idempotente, se puede repetir).
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.likes ADD COLUMN IF NOT EXISTS reaction_type text DEFAULT 'like';

-- Backfill por si acaso (registros creados via rutas antiguas)
UPDATE public.likes SET reaction_type = 'like' WHERE reaction_type IS NULL;

-- Índice útil para contar reacciones por tipo
CREATE INDEX IF NOT EXISTS idx_likes_post_reaction ON public.likes(post_id, reaction_type);

-- ═══════════════════════════════════════════════════════════════════════════
-- 10.6 · chat — reacciones, respuestas, borrado lógico
-- Origen: migraciones/chat_reacciones_respuestas.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================
-- CHAT: Reacciones, respuestas citadas y borrado lógico
-- Soporte para la experiencia estilo WhatsApp en todos los paneles:
--   - Mantener presionado un mensaje → 👍 ❤️ 😂 😮 😢
--   - Responder citando el mensaje original (reply_to)
--   - Eliminar mensaje propio (borrado lógico, se ve "Mensaje eliminado")
--
-- Las columnas son OPCIONALES: el frontend autodetecta su existencia
-- (js/shared/chat.js → _msgSelect) y degrada elegantemente si aún
-- no se ha aplicado esta migración.
-- =============================================================

-- 1. Reacciones: { [user_id]: emoji }
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reactions jsonb DEFAULT '{}'::jsonb;

-- 2. Respuesta citada (auto-referencia)
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to bigint REFERENCES public.messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON public.messages(reply_to) WHERE reply_to IS NOT NULL;

-- 3. Borrado lógico
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON public.messages(conversation_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 10.7 · profiles — padres ven staff para chat
-- Origen: migraciones/fix_profiles_select_padre_chat.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════
-- FIX: Padres pueden ver perfiles de staff para el chat
-- El RLS anterior solo permitía ver: propio perfil OR staff ve todos
-- Padres necesitan ver: directora/asistente + profesores de sus aulas
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "profiles_select" ON public.profiles;

CREATE POLICY "profiles_select" ON public.profiles FOR SELECT USING (
  deleted_at IS NULL AND (
    -- 1. Cualquiera ve su propio perfil
    auth.uid() = id
    -- 2. Staff ve todos los perfiles
    OR get_my_role() IN ('directora', 'asistente', 'admin')
    -- 3. Padres ven perfiles de directora/asistente (para chat, notificaciones)
    OR (
      get_my_role() = 'padre'
      AND role IN ('directora', 'asistente')
    )
    -- 4. Padres ven el perfil del profesor titular de sus aulas
    OR (
      get_my_role() = 'padre'
      AND id IN (
        SELECT c.teacher_id
        FROM public.classrooms c
        JOIN public.students s ON s.classroom_id = c.id
        WHERE s.parent_id = auth.uid()
          AND c.teacher_id IS NOT NULL
      )
    )
  )
);

SELECT '✅ profiles_select actualizado — padres ven staff en chat' AS status;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10.8 · subjects — relajar CHECK education_level
-- Origen: migraciones/fix_subjects_education_level.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ============================================================
-- KARPUS KIDS — Limpiar education_level de subjects
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Relajar el CHECK constraint (acepta cualquier valor de texto)
ALTER TABLE public.subjects 
  DROP CONSTRAINT IF EXISTS subjects_education_level_check;

-- 2. Hacer el campo nullable para mayor flexibilidad
ALTER TABLE public.subjects 
  ALTER COLUMN education_level DROP NOT NULL;

-- 3. Actualizar los valores del schema inicial a NULL
--    (ya no se usan estancia/preescolar/primaria como categorías)
UPDATE public.subjects
SET education_level = NULL
WHERE education_level IN ('estancia', 'preescolar', 'primaria');

-- 4. Actualizar también la función insert_subject para que acepte NULL
--    y áreas por aula (p_classroom_id). Solo directora/asistente crean áreas.
DROP FUNCTION IF EXISTS public.insert_subject(text, text, text, bigint);
DROP FUNCTION IF EXISTS public.insert_subject(text, text, text);
CREATE OR REPLACE FUNCTION public.insert_subject(
  p_name            text,
  p_education_level text DEFAULT NULL,
  p_description     text DEFAULT NULL,
  p_classroom_id    bigint DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text;
  v_row  public.subjects%ROWTYPE;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RETURN jsonb_build_object('error', 'Solo directora/asistente pueden crear áreas');
  END IF;

  IF p_classroom_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.classrooms WHERE id = p_classroom_id) THEN
    RETURN jsonb_build_object('error', 'El aula seleccionada no existe');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.subjects
    WHERE name = btrim(p_name)
      AND ((p_classroom_id IS NULL AND classroom_id IS NULL)
           OR (p_classroom_id IS NOT NULL AND classroom_id = p_classroom_id))
  ) THEN
    RETURN jsonb_build_object('error', CASE WHEN p_classroom_id IS NOT NULL
      THEN 'Ya existe un área con ese nombre en este aula'
      ELSE 'Ya existe un área con ese nombre' END);
  END IF;

  INSERT INTO public.subjects (name, education_level, description, is_active, classroom_id)
  VALUES (btrim(p_name), p_education_level, p_description, true, p_classroom_id)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('id', v_row.id, 'name', v_row.name);
END;
$$;
GRANT EXECUTE ON FUNCTION public.insert_subject(text, text, text, bigint) TO authenticated;

-- 5. Verificar resultado
SELECT id, name, education_level, is_active
FROM public.subjects
ORDER BY name;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10.9 · seguridad — task_evidences RLS + audit_logs
-- Origen: migraciones/security_hardening.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ============================================================
-- MIGRACIÓN: Security Hardening — Panel Maestra
-- Fecha: 2026-08-18
-- Descripción: Fix task_evidences RLS + audit_logs table
-- ============================================================

-- 1. FIX: task_evidences RLS — era demasiado permisiva (auth.uid() IS NOT NULL)
-- Solo staff con acceso al aula y padres de alumnos pueden ver/modificar evidencias

DROP POLICY IF EXISTS "evidences_all" ON public.task_evidences;
DROP POLICY IF EXISTS "evidences_staff" ON public.task_evidences;
DROP POLICY IF EXISTS "evidences_teacher" ON public.task_evidences;
DROP POLICY IF EXISTS "evidences_parent_insert" ON public.task_evidences;
DROP POLICY IF EXISTS "evidences_parent_select" ON public.task_evidences;

CREATE POLICY "evidences_staff" ON public.task_evidences FOR ALL
  USING (
    get_my_role() IN ('directora','asistente','maestra','admin')
    AND is_classroom_accessible(
      (SELECT t.classroom_id FROM public.tasks t WHERE t.id = task_evidences.task_id)
    )
  );

CREATE POLICY "evidences_parent_select" ON public.task_evidences FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (
      EXISTS (SELECT 1 FROM public.students s WHERE s.id = task_evidences.student_id AND s.parent_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.tasks t
                 JOIN public.students st ON st.classroom_id = t.classroom_id
                 WHERE t.id = task_evidences.task_id AND st.parent_id = auth.uid())
    )
  );

CREATE POLICY "evidences_parent_insert" ON public.task_evidences FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = task_evidences.student_id AND s.parent_id = auth.uid())
  );

-- 2. TABLA: audit_logs — Registro de cambios en rutina y asistencia
-- La tabla audit_logs puede existir ya con estructura vieja (id, user_id, action, payload, created_at).
-- Usamos ALTER TABLE para agregar las columnas faltantes de forma segura.
DO $$
BEGIN
  -- Crear solo si no existe (primera vez)
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_logs') THEN
    CREATE TABLE public.audit_logs (
      id            bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
      action        text NOT NULL,
      table_name    text NOT NULL,
      record_id     bigint,
      classroom_id  bigint REFERENCES public.classrooms(id),
      old_value     jsonb,
      new_value     jsonb,
      metadata      jsonb DEFAULT '{}',
      created_at    timestamp with time zone DEFAULT now() NOT NULL
    );
  ELSE
    -- Agregar columnas faltantes a tabla existente
    ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS table_name text;
    ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS record_id bigint;
    ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS classroom_id bigint REFERENCES public.classrooms(id);
    ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS old_value jsonb;
    ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS new_value jsonb;
    ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}';
  END IF;
END $$;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Solo staff del aula puede ver logs de auditoría de su aula
CREATE POLICY "audit_logs_staff" ON public.audit_logs FOR ALL
  USING (
    get_my_role() IN ('directora','asistente','admin')
    OR (
      get_my_role() = 'maestra'
      AND is_classroom_accessible(classroom_id)
    )
  );

CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON public.audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table ON public.audit_logs (table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_classroom ON public.audit_logs (classroom_id, created_at DESC);

-- 3. FUNCIÓN: Registrar cambio en auditoría
CREATE OR REPLACE FUNCTION public.log_audit_change(
  p_action text,
  p_table_name text,
  p_record_id bigint,
  p_classroom_id bigint,
  p_old_value jsonb DEFAULT NULL,
  p_new_value jsonb DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, classroom_id, old_value, new_value, metadata)
  VALUES (auth.uid(), p_action, p_table_name, p_record_id, p_classroom_id, p_old_value, p_new_value, p_metadata);
END;
$$;

-- 4. daily_logs pasados → solo lectura para maestras
-- (La directora/admin puede modificar registros de días anteriores)
DROP POLICY IF EXISTS "daily_logs_staff" ON public.daily_logs;
CREATE POLICY "daily_logs_staff" ON public.daily_logs FOR ALL
  USING (
    get_my_role() IN ('directora','asistente','admin')
    OR (
      get_my_role() = 'maestra'
      AND is_classroom_accessible(classroom_id)
      AND date >= CURRENT_DATE
    )
  );

-- 5. Asistencia: maestra no puede modificar asistencias de otras aulas
DROP POLICY IF EXISTS "attendance_staff" ON public.attendance;
CREATE POLICY "attendance_staff" ON public.attendance FOR ALL
  USING (
    get_my_role() IN ('directora','asistente','admin')
    OR (
      get_my_role() = 'maestra'
      AND is_classroom_accessible(classroom_id)
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- 10.10 · áreas — eliminar auto-creación por trigger
-- Origen: migraciones/eliminar_areas_automaticas.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════
-- Eliminar áreas creadas automáticamente por aula y desactivar el
-- mecanismo de auto-creación (trigger + backfill).
--
-- A partir de ahora la maestra será quien cree las áreas de su aula
-- (feature pendiente). La directora tampoco crea áreas.
--
-- ⚠️ EL DELETE EN CASCADA TAMBIÉN BORRA LAS ACTIVIDADES Y NOTAS DE
--    ESAS ÁREAS (FK: subjects -> period_config -> activities -> grades,
--    todas con ON DELETE CASCADE).
-- ══════════════════════════════════════════════════════════════

-- 1) Eliminar las áreas por aula (classroom_id NOT NULL).
DELETE FROM public.subjects
WHERE classroom_id IS NOT NULL;

-- 2) Quitar el trigger que crea áreas al insertar un aula
DROP TRIGGER IF EXISTS trg_classroom_auto_areas ON public.classrooms;
DROP FUNCTION IF EXISTS public.classroom_after_insert_areas();

-- 3) Quitar la función de aprovisionamiento (ya nadie la usa)
DROP FUNCTION IF EXISTS public.ensure_classroom_areas(bigint);

-- ═══════════════════════════════════════════════════════════════════════════
-- 10.11 · RLS — políticas débiles a estrictas
-- Origen: migraciones/fix_rls_strict_policies.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════
-- FIX RLS: Políticas débiles → estrictas
-- Ejecutar en Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════

-- ── COMMENTS: eliminar la política débil FOR ALL y mantener las específicas ──
DROP POLICY IF EXISTS "comments_all" ON public.comments;

-- ── LIKES: eliminar la política débil FOR ALL y mantener las específicas ──
DROP POLICY IF EXISTS "likes_all" ON public.likes;

-- ── CONVERSATIONS: reemplazar FOR ALL por política basada en participantes ──
DROP POLICY IF EXISTS "conversations_all" ON public.conversations;
DROP POLICY IF EXISTS "conversations_participants" ON public.conversations;
CREATE POLICY "conversations_participants" ON public.conversations FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.conversation_participants cp
    WHERE cp.conversation_id = conversations.id AND cp.user_id = auth.uid()
  ));

-- ── CONVERSATION_PARTICIPANTS: reemplazar FOR ALL ──
DROP POLICY IF EXISTS "conv_participants_all" ON public.conversation_participants;
DROP POLICY IF EXISTS "conv_participants_visible" ON public.conversation_participants;
CREATE POLICY "conv_participants_visible" ON public.conversation_participants FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.conversation_participants cp2
    WHERE cp2.conversation_id = conversation_participants.conversation_id AND cp2.user_id = auth.uid()
  ));

-- ── CLASSROOM_GALLERY: solo miembros del aula ──
DROP POLICY IF EXISTS "gallery_all" ON public.classroom_gallery;
DROP POLICY IF EXISTS "gallery_classroom_members" ON public.classroom_gallery;
CREATE POLICY "gallery_classroom_members" ON public.classroom_gallery FOR ALL
  USING (
    get_my_role() IN ('directora','asistente','admin')
    OR is_teacher_of_classroom(classroom_id)
    OR is_parent_of_classroom(classroom_id)
  );

-- ── CLASSROOM_CHAT: solo miembros del aula ──
DROP POLICY IF EXISTS "classroom_chat_all" ON public.classroom_chat;
DROP POLICY IF EXISTS "classroom_chat_classroom_members" ON public.classroom_chat;
CREATE POLICY "classroom_chat_classroom_members" ON public.classroom_chat FOR ALL
  USING (
    get_my_role() IN ('directora','asistente','admin')
    OR is_teacher_of_classroom(classroom_id)
    OR is_parent_of_classroom(classroom_id)
  );

-- ── AUDIT_LOGS: restringir INSERT a service_role únicamente ──
DROP POLICY IF EXISTS "audit_logs_insert" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_service_insert" ON public.audit_logs;
CREATE POLICY "audit_logs_service_insert" ON public.audit_logs FOR INSERT
  WITH CHECK (current_setting('role') = 'service_role');

-- ═══════════════════════════════════════════════════════════════════════════
-- 10.12 · students/preinscripción — entry_time/exit_time + aulas público
-- Origen: migraciones/operativos/add_student_schedule_times.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════════
-- HORARIO DE ENTRADA/SALIDA DEL ESTUDIANTE + PREINSCRIPCIÓN (tiempo real aulas)
-- 1) Columnas entry_time / exit_time en students y student_preregistrations
-- 2) submit_preinscripcion acepta y guarda las horas
-- 3) get_classrooms_capacity visible para el público (anon) → nivel con cupos
-- 4) student_name opcional (formulario sin campos obligatorios)
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Columnas de horario ────────────────────────────────────────────────────
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS entry_time time,
  ADD COLUMN IF NOT EXISTS exit_time  time;

ALTER TABLE public.student_preregistrations
  ADD COLUMN IF NOT EXISTS entry_time time,
  ADD COLUMN IF NOT EXISTS exit_time  time;

-- ── 2. submit_preinscripcion: guarda horas + tolera expediente incompleto ─────
CREATE OR REPLACE FUNCTION public.submit_preinscripcion(payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO public.student_preregistrations (
    student_name, student_last_name, birth_date, gender, nationality,
    school_year_requested, level_requested, schedule, entry_time, exit_time,
    estimated_entry_date, has_siblings, sibling_name,
    parent_1, parent_2, emergency_contact, authorized_people,
    medical, documents, consents, signature_data,
    contact_email, contact_phone, user_agent
  )
  VALUES (
    COALESCE(payload->>'student_name', 'Sin nombre'), payload->>'student_last_name',
    (payload->>'birth_date')::date, payload->>'gender', COALESCE(payload->>'nationality', 'Dominicana'),
    payload->>'school_year_requested', payload->>'level_requested', payload->>'schedule',
    (payload->>'entry_time')::time, (payload->>'exit_time')::time,
    (payload->>'estimated_entry_date')::date,
    COALESCE((payload->>'has_siblings')::boolean, false), payload->>'sibling_name',
    COALESCE(payload->'parent_1', '{}'), COALESCE(payload->'parent_2', '{}'),
    COALESCE(payload->'emergency_contact', '{}'), COALESCE(payload->'authorized_people', '[]'),
    COALESCE(payload->'medical', '{}'), COALESCE(payload->'documents', '{}'),
    COALESCE(payload->'consents', '{}'), payload->>'signature_data',
    payload->>'contact_email', payload->>'contact_phone', payload->>'user_agent'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_preinscripcion(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_preinscripcion(jsonb) TO anon, authenticated;

-- formulario 100% opcional → el único campo NOT NULL ya no bloquea
ALTER TABLE public.student_preregistrations ALTER COLUMN student_name DROP NOT NULL;

-- ── 3. Aulas con cupos para el formulario público ─────────────────────────────
GRANT EXECUTE ON FUNCTION public.get_classrooms_capacity() TO anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10.13 · door punch — evento "salida" automático en daily_logs
-- Origen: migraciones/operativos/salida_automatica_daily_logs.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- MIGRATION: Auto-crear evento "salida" en daily_logs desde process_door_punch
-- Cuando un estudiante sale por el ponchador (check_out), se crea automáticamente
-- un evento de tipo "salida" en daily_logs.events para que aparezca en la rutina del padre.

CREATE OR REPLACE FUNCTION public.process_door_punch(p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student  record; v_staff record; v_settings record;
  v_today    date := (now() AT TIME ZONE 'America/Santo_Domingo')::date;
  v_now      timestamp with time zone := now();
  v_local_time time := (now() AT TIME ZONE 'America/Santo_Domingo')::time;
  v_type     text; v_name text; v_role text; v_parent uuid;
  v_existing record; v_attendance record; v_status text := 'present';
BEGIN
  IF p_code IS NULL OR length(trim(p_code)) < 3 THEN
    RETURN jsonb_build_object('success',false,'message','Código QR inválido');
  END IF;

  SELECT * INTO v_student FROM public.students WHERE matricula = trim(p_code) AND is_active = true LIMIT 1;
  IF FOUND THEN
    v_name := v_student.name; v_role := 'Estudiante'; v_parent := v_student.parent_id;
    SELECT * INTO v_settings FROM public.school_settings WHERE id = 1;
    SELECT * INTO v_existing FROM public.door_punches WHERE student_id = v_student.id AND date = v_today AND punch_type = 'check_in';
    IF NOT FOUND THEN
      v_type := 'check_in';
      IF v_settings.check_in_end IS NOT NULL AND v_local_time > v_settings.check_in_end THEN v_status := 'late'; END IF;
      SELECT * INTO v_attendance FROM public.attendance WHERE student_id = v_student.id AND date = v_today;
      IF v_attendance.id IS NULL THEN
        INSERT INTO public.attendance (student_id, classroom_id, date, status, check_in)
        VALUES (v_student.id, v_student.classroom_id, v_today, v_status, v_now);
      ELSE
        UPDATE public.attendance SET status = v_status, check_in = v_now WHERE id = v_attendance.id;
      END IF;
      INSERT INTO public.door_punches (student_id, punch_type, punched_at, date) VALUES (v_student.id,'check_in',v_now,v_today) ON CONFLICT DO NOTHING;
    ELSE
      SELECT * INTO v_existing FROM public.door_punches WHERE student_id = v_student.id AND date = v_today AND punch_type = 'check_out';
      IF NOT FOUND THEN
        v_type := 'check_out'; v_status := 'retirado';
        SELECT * INTO v_attendance FROM public.attendance WHERE student_id = v_student.id AND date = v_today;
        IF v_attendance.id IS NOT NULL THEN UPDATE public.attendance SET check_out = v_now, status = 'retirado' WHERE id = v_attendance.id; END IF;
        INSERT INTO public.door_punches (student_id, punch_type, punched_at, date) VALUES (v_student.id,'check_out',v_now,v_today) ON CONFLICT DO NOTHING;

        -- Auto-crear evento "salida" en daily_logs para que aparezca en la rutina del padre
        BEGIN
          INSERT INTO public.daily_logs (student_id, classroom_id, date, status, events)
          VALUES (
            v_student.id, v_student.classroom_id, v_today, 'published',
            jsonb_build_array(
              jsonb_build_object(
                'type', 'salida',
                'scheduled_time', to_char(v_now AT TIME ZONE 'America/Santo_Domingo', 'HH12:MI AM'),
                'created_at', v_now::text,
                'comment', 'Salida registrada desde ponchador'
              )
            )
          )
          ON CONFLICT (student_id, date) DO UPDATE
            SET events = CASE
              WHEN NOT public.daily_logs.events @> '[{"type":"salida"}]'::jsonb
              THEN public.daily_logs.events || jsonb_build_array(
                jsonb_build_object(
                  'type', 'salida',
                  'scheduled_time', to_char(v_now AT TIME ZONE 'America/Santo_Domingo', 'HH12:MI AM'),
                  'created_at', v_now::text,
                  'comment', 'Salida registrada desde ponchador'
                )
              )
              ELSE public.daily_logs.events
            END;
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      ELSE
        RETURN jsonb_build_object('success',false,'message',v_name||' ya registró entrada y salida hoy');
      END IF;
    END IF;
    RETURN jsonb_build_object('success',true,'type',v_type,'name',v_name,'role',v_role,'status',v_status,
      'student_id',v_student.id,'parent_id',v_parent,'time',to_char(v_now AT TIME ZONE 'America/Santo_Domingo','HH12:MI AM'));
  END IF;

  SELECT * INTO v_staff FROM public.profiles
  WHERE (notes=trim(p_code) OR matricula=trim(p_code) OR access_code=trim(p_code))
    AND role IN ('maestra','asistente','directora','admin') LIMIT 1;
  IF NOT FOUND THEN
    BEGIN SELECT * INTO v_staff FROM public.profiles WHERE id=trim(p_code)::uuid AND role IN ('maestra','asistente','directora','admin') LIMIT 1;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF FOUND THEN
    v_name := v_staff.name; v_role := initcap(v_staff.role);
    SELECT * INTO v_existing FROM public.door_punches WHERE staff_id = v_staff.id AND date = v_today AND punch_type = 'check_in';
    IF NOT FOUND THEN
      v_type := 'check_in';
      INSERT INTO public.door_punches (staff_id, punch_type, punched_at, date) VALUES (v_staff.id,'check_in',v_now,v_today) ON CONFLICT DO NOTHING;
    ELSE
      SELECT * INTO v_existing FROM public.door_punches WHERE staff_id = v_staff.id AND date = v_today AND punch_type = 'check_out';
      IF NOT FOUND THEN
        v_type := 'check_out';
        INSERT INTO public.door_punches (staff_id, punch_type, punched_at, date) VALUES (v_staff.id,'check_out',v_now,v_today) ON CONFLICT DO NOTHING;
      ELSE
        RETURN jsonb_build_object('success',false,'message',v_name||' ya registró entrada y salida hoy');
      END IF;
    END IF;
    RETURN jsonb_build_object('success',true,'type',v_type,'name',v_name,'role',v_role,'status','present',
      'student_id',null,'parent_id',null,'time',to_char(v_now AT TIME ZONE 'America/Santo_Domingo','HH12:MI AM'));
  END IF;
  RETURN jsonb_build_object('success',false,'message','QR no registrado en el sistema');
END;
$$;
GRANT EXECUTE ON FUNCTION public.process_door_punch(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_door_punch(text) TO anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10.14 · cron — recordatorios automáticos de pago
-- Origen: migraciones/operativos/fix_cron_reminders.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════
-- fix_cron_reminders.sql
-- Configura el cron automático de recordatorios de pago
-- Ejecutar en Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════

-- PASO 1: Verificar extensiones disponibles
SELECT
  extname,
  extversion,
  '✅ Activa' AS estado
FROM pg_extension
WHERE extname IN ('pg_cron', 'pg_net');
-- Si no aparecen, actívalas en:
-- Dashboard → Database → Extensions → buscar "pg_cron" y "pg_net" → Enable

-- ══════════════════════════════════════════════════════════════
-- PASO 2: Eliminar crons viejos para evitar duplicados
-- ══════════════════════════════════════════════════════════════
DO $$
BEGIN
  BEGIN PERFORM cron.unschedule('karpus-mora-reminders');          EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM cron.unschedule('karpus-mark-overdue');            EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM cron.unschedule('karpus-payment-cycle');           EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM cron.unschedule('karpus-payment-reminders-daily'); EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

-- ══════════════════════════════════════════════════════════════
-- PASO 3: Crear los cron jobs
-- ⚠️  REEMPLAZA los dos valores marcados con tus datos reales:
--     SUPABASE_URL  → Dashboard → Settings → API → Project URL
--     SERVICE_KEY   → Dashboard → Settings → API → service_role (secret)
-- ══════════════════════════════════════════════════════════════

-- ── Cron 1: Marcar pagos vencidos — cada día 6:00 AM hora RD (10:00 UTC)
SELECT cron.schedule(
  'karpus-mark-overdue',
  '0 10 * * *',
  $$
    UPDATE public.payments
    SET status = 'overdue'
    WHERE status = 'pending'
      AND due_date < CURRENT_DATE
      AND (deleted_at IS NULL OR deleted_at > NOW());
  $$
);

-- ── Cron 2: Recordatorios diarios — 9:00 AM hora RD (13:00 UTC)
-- Reemplaza 'https://TU_REF.supabase.co' y 'eyJ...SERVICE_ROLE_KEY'
SELECT cron.schedule(
  'karpus-payment-reminders-daily',
  '0 13 * * *',
  $$
    SELECT net.http_post(
      url     := 'https://TU_REF.supabase.co/functions/v1/payment-reminders',
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJ...SERVICE_ROLE_KEY","apikey":"eyJ...SERVICE_ROLE_KEY"}'::jsonb,
      body    := '{"action":"auto"}'::jsonb
    );
  $$
);

-- ── Cron 3: Ciclo de pagos — día 1 de cada mes 6:00 AM hora RD (10:00 UTC)
-- Genera cobros del mes actual + backfill de meses anteriores sin cobros
SELECT cron.schedule(
  'karpus-payment-cycle',
  '0 10 1 * *',
  $$
    SELECT net.http_post(
      url     := 'https://TU_REF.supabase.co/functions/v1/auto-payment-cycle',
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJ...SERVICE_ROLE_KEY","apikey":"eyJ...SERVICE_ROLE_KEY"}'::jsonb,
      body    := '{"force":true}'::jsonb
    );
  $$
);

-- ══════════════════════════════════════════════════════════════
-- PASO 4: Verificar que quedaron registrados
-- ══════════════════════════════════════════════════════════════
SELECT
  jobid,
  jobname,
  schedule,
  active,
  CASE WHEN active THEN '✅ Activo' ELSE '❌ Inactivo' END AS estado
FROM cron.job
WHERE jobname LIKE 'karpus-%'
ORDER BY jobname;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10.15 · feature flags — visibilidad de módulos (school_settings)
-- Origen: migraciones/operativos/feature_flags.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- FEATURE FLAGS — Control de visibilidad de módulos por rol/usuario
-- Panel de Control → Módulos y Visibilidad (#sec-modulos)
--
-- Estructura del JSON en school_settings.feature_flags:
-- {
--   "modules": {
--     "wall": { "enabled": true, "roles": { "padre": true, "maestra": true, "asistente": true, "directora": true } }
--   },
--   "overrides": {
--     "<user_uuid>": { "wall": "allow" | "deny" }
--   }
-- }
--
-- Resolución de visibilidad (js/shared/feature-flags.js):
--   override individual > enabled global > permiso de rol > default ON
--
-- EJECUTAR EN SUPABASE SQL EDITOR (una sola vez)
-- ═══════════════════════════════════════════════════════════════

alter table public.school_settings
  add column if not exists feature_flags jsonb not null default '{}'::jsonb;

comment on column public.school_settings.feature_flags is
  'Visibilidad de módulos: {modules:{[key]:{enabled,roles}}, overrides:{[uuid]:{[key]:allow|deny}}}';

-- Realtime: emitir cambios de school_settings a todos los dispositivos conectados
do $$
begin
  alter publication supabase_realtime add table public.school_settings;
exception
  when duplicate_object then null;  -- ya está en la publicación
  when undefined_object then null;  -- realtime no instalado en este proyecto
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10.16 · admin — perfil impulsodigital@gmail.com
-- Origen: migraciones/operativos/fix_admin_profile.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ============================================================
-- FIX: Crear perfil de administrador para impulsodigital@gmail.com
-- UUID: c1e72617-ab8f-44c0-b1eb-cdd92eda62e7
-- EJECUTAR EN: Supabase Dashboard → SQL Editor
-- ============================================================

-- Insertar o actualizar el perfil con rol admin
INSERT INTO public.profiles (id, email, name, role, accepted_terms, created_at)
VALUES (
  'c1e72617-ab8f-44c0-b1eb-cdd92eda62e7',
  'impulsodigital@gmail.com',
  'Administrador',
  'admin',
  true,
  now()
)
ON CONFLICT (id) DO UPDATE SET
  role           = 'admin',
  email          = 'impulsodigital@gmail.com',
  accepted_terms = true;

-- Verificar que quedó bien
SELECT id, email, name, role FROM public.profiles
WHERE id = 'c1e72617-ab8f-44c0-b1eb-cdd92eda62e7';

-- ═══════════════════════════════════════════════════════════════════════════
-- 10.17 · pagos — generar cobros mayo 2026 (data-fix)
-- Origen: migraciones/operativos/fix_generate_mayo_2026.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════
-- fix_generate_mayo_2026.sql
-- Genera los cobros de Mayo 2026 para estudiantes activos
-- que aún no tienen registro en ese mes
-- Ejecutar en Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════

-- 1. Ver qué estudiantes activos NO tienen cobro de mayo 2026
SELECT
  s.id,
  s.name,
  s.monthly_fee,
  c.name AS classroom
FROM public.students s
LEFT JOIN public.classrooms c ON c.id = s.classroom_id
WHERE s.is_active = true
  AND s.monthly_fee > 0
  AND s.deleted_at IS NULL
  AND s.id NOT IN (
    SELECT student_id FROM public.payments
    WHERE month_paid IN ('2026-05', 'mayo', 'Mayo')
      AND (deleted_at IS NULL OR deleted_at > NOW())
  )
ORDER BY s.name;

-- 2. Insertar cobros de mayo 2026 para los que faltan
-- due_date = 5 de junio 2026 (día 5 del mes siguiente)
INSERT INTO public.payments (student_id, amount, concept, status, due_date, month_paid, created_at)
SELECT
  s.id,
  s.monthly_fee,
  'Mensualidad',
  'pending',
  '2026-06-05'::date,
  '2026-05',
  NOW()
FROM public.students s
WHERE s.is_active = true
  AND s.monthly_fee > 0
  AND s.deleted_at IS NULL
  AND s.id NOT IN (
    SELECT student_id FROM public.payments
    WHERE month_paid IN ('2026-05', 'mayo', 'Mayo')
      AND (deleted_at IS NULL OR deleted_at > NOW())
  );

-- 3. Verificar resultado
SELECT
  p.id,
  s.name AS estudiante,
  p.amount,
  p.status,
  p.due_date,
  p.month_paid
FROM public.payments p
JOIN public.students s ON s.id = p.student_id
WHERE p.month_paid = '2026-05'
ORDER BY s.name;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10.18 · diagnóstico — solo lectura, sin cambios
-- Origen: migraciones/operativos/diagnostico_materias.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- DIAGNÓSTICO: "Sin materias configuradas" (panel maestra)
-- Ejecuta esto en el SQL Editor de Supabase y comparte el resultado.
-- No modifica nada: solo lectura.
-- ═══════════════════════════════════════════════════════════════

-- 1) Período académico activo (el que usa el School Engine)
SELECT ap.id AS academic_period_id, ap.name, ap.start_date, ap.end_date,
       ap.status, ap.is_active, sy.name AS school_year
FROM academic_periods ap
JOIN school_years sy ON sy.id = ap.school_year_id
WHERE ap.is_active = true AND ap.status = 'open'
  AND sy.status IN ('active','enrollment','reenrollment')
ORDER BY ap.order_index
LIMIT 1;

-- 2) Todos los períodos legacy y cuántas materias tiene configuradas cada uno
SELECT p.id AS legacy_period_id, p.name, p.start_date, p.end_date,
       p.status, p.is_active, p.classroom_id,
       COUNT(pc.id) AS areas_configuradas
FROM periods p
LEFT JOIN period_config pc ON pc.period_id = p.id
GROUP BY p.id, p.name, p.start_date, p.end_date, p.status, p.is_active, p.classroom_id
ORDER BY p.start_date DESC, p.id;

-- 3) Qué id devuelve get_active_period() ahora (debe ser un legacy_period_id
--    que aparezca en el punto 2 con áreas_configuradas > 0)
SELECT get_active_period();

-- 4) Configuración que VE la maestra para ese período activo
SELECT get_period_config(
  (get_active_period()->>'id')::bigint
) AS config_visible_para_maestra;

-- 5) Si el punto 4 devuelve [] pero el punto 2 muestra áreas en otro período,
--    corre esto para ver a qué legacy_period_id resuelve cada academic_period:
SELECT ap.id AS academic_period_id, ap.name,
       resolve_period_id(ap.id) AS legacy_period_id_resuelto
FROM academic_periods ap
ORDER BY ap.order_index;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10.19 · deploy legacy — send_notification, ponche, permisos posts (idempotente)
-- Origen: migraciones/operativos/DEPLOY_PRODUCTION.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ============================================================
-- KARPUS KIDS — SQL DE PRODUCCIÓN CONSOLIDADO
-- Ejecutar en Supabase Dashboard → SQL Editor
-- ORDEN IMPORTANTE: ejecutar en el orden indicado
-- ============================================================

-- ── PASO 1: Schema base (si no se ha ejecutado) ───────────────────────────────
-- Si la DB ya tiene tablas, saltar este paso.
-- Si es una DB nueva, ejecutar schema.sql primero.

-- ── PASO 2: Permisos y RLS de posts ──────────────────────────────────────────
-- fix_posts_rls.sql + fix_posts_insert.sql

-- Eliminar triggers desconocidos en posts
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT trigger_name FROM information_schema.triggers
    WHERE event_object_table = 'posts' AND trigger_schema = 'public'
      AND trigger_name NOT IN ('on_new_post_populate_teacher','set_updated_at_posts')
  LOOP
    EXECUTE 'DROP TRIGGER IF EXISTS ' || quote_ident(r.trigger_name) || ' ON public.posts';
  END LOOP;
END;
$$;

-- Función send_notification (todas las firmas)
CREATE OR REPLACE FUNCTION public.send_notification(p_user_id uuid, p_type text, p_message text, p_data jsonb DEFAULT '{}', p_link text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications (user_id, title, message, type, link, is_read, created_at)
  VALUES (p_user_id, p_type, p_message, p_type, p_link, false, now()) ON CONFLICT DO NOTHING;
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_notification(p_user_id uuid, p_type text, p_message text, p_data json DEFAULT NULL, p_link text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications (user_id, title, message, type, link, is_read, created_at)
  VALUES (p_user_id, p_type, p_message, p_type, p_link, false, now()) ON CONFLICT DO NOTHING;
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_notification(p_user_id uuid, p_type text, p_message text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications (user_id, title, message, type, is_read, created_at)
  VALUES (p_user_id, p_type, p_message, p_type, false, now()) ON CONFLICT DO NOTHING;
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;

-- Permisos de tabla posts
GRANT SELECT, INSERT, UPDATE, DELETE ON public.posts    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.likes    TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public   TO authenticated;

-- Política INSERT de posts
DROP POLICY IF EXISTS "posts_insert" ON public.posts;
DROP POLICY IF EXISTS "posts_insert" ON posts;
CREATE POLICY "posts_insert" ON public.posts
  FOR INSERT WITH CHECK (auth.uid() = teacher_id AND get_my_role() IN ('directora','asistente','maestra','admin'));

-- Trigger teacher_info
CREATE OR REPLACE FUNCTION public.handle_new_post_teacher_info()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.teacher_id IS NOT NULL THEN
    NEW.teacher_name   := (SELECT name       FROM public.profiles WHERE id = NEW.teacher_id LIMIT 1);
    NEW.teacher_avatar := (SELECT avatar_url FROM public.profiles WHERE id = NEW.teacher_id LIMIT 1);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_new_post_populate_teacher ON public.posts;
CREATE TRIGGER on_new_post_populate_teacher BEFORE INSERT ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_post_teacher_info();

-- ── PASO 3: Sistema de ponche (door_punches) ──────────────────────────────────
-- fix_attendance_system.sql + fix_punch_notifications.sql

CREATE TABLE IF NOT EXISTS public.door_punches (
  id           bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  student_id   bigint REFERENCES public.students(id) ON DELETE CASCADE,
  staff_id     uuid   REFERENCES public.profiles(id) ON DELETE CASCADE,
  punch_type   text   NOT NULL CHECK (punch_type IN ('check_in','check_out')),
  punched_at   timestamp with time zone DEFAULT now() NOT NULL,
  date         date   DEFAULT current_date NOT NULL,
  parent_notified boolean DEFAULT false,
  created_at   timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT door_punches_student_type_date UNIQUE (student_id, punch_type, date),
  CONSTRAINT door_punches_staff_type_date   UNIQUE (staff_id,   punch_type, date),
  CONSTRAINT door_punches_one_subject CHECK (
    (student_id IS NOT NULL AND staff_id IS NULL) OR
    (student_id IS NULL     AND staff_id IS NOT NULL)
  )
);
ALTER TABLE public.door_punches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "punches_staff_all"   ON public.door_punches;
DROP POLICY IF EXISTS "punches_parent_read" ON public.door_punches;
CREATE POLICY "punches_staff_all" ON public.door_punches FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin'));
CREATE POLICY "punches_parent_read" ON public.door_punches FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = door_punches.student_id AND s.parent_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_door_punches_date    ON public.door_punches(date);
CREATE INDEX IF NOT EXISTS idx_door_punches_student ON public.door_punches(student_id, date);
CREATE INDEX IF NOT EXISTS idx_door_punches_staff   ON public.door_punches(staff_id, date);

-- RPC process_door_punch con student_id en el resultado
CREATE OR REPLACE FUNCTION public.process_door_punch(p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student  record; v_staff record; v_settings record;
  v_today    date := current_date;
  v_now      timestamp with time zone := now();
  v_type     text; v_name text; v_role text; v_parent uuid;
  v_existing record; v_attendance record; v_status text := 'present';
BEGIN
  SELECT * INTO v_student FROM public.students WHERE matricula = p_code AND is_active = true LIMIT 1;
  IF FOUND THEN
    v_name := v_student.name; v_role := 'Estudiante'; v_parent := v_student.parent_id;
    SELECT * INTO v_settings FROM public.school_settings WHERE id = 1;
    SELECT * INTO v_existing FROM public.door_punches WHERE student_id = v_student.id AND date = v_today AND punch_type = 'check_in';
    IF NOT FOUND THEN
      v_type := 'check_in';
      IF v_settings.check_in_end IS NOT NULL AND v_now::time > v_settings.check_in_end THEN v_status := 'late'; END IF;
      SELECT * INTO v_attendance FROM public.attendance WHERE student_id = v_student.id AND date = v_today;
      IF v_attendance.id IS NULL THEN
        INSERT INTO public.attendance (student_id, classroom_id, date, status, check_in)
        VALUES (v_student.id, v_student.classroom_id, v_today, v_status, v_now);
      END IF;
      INSERT INTO public.door_punches (student_id, punch_type, punched_at, date) VALUES (v_student.id, 'check_in', v_now, v_today) ON CONFLICT DO NOTHING;
    ELSE
      SELECT * INTO v_existing FROM public.door_punches WHERE student_id = v_student.id AND date = v_today AND punch_type = 'check_out';
      IF NOT FOUND THEN
        v_type := 'check_out';
        SELECT * INTO v_attendance FROM public.attendance WHERE student_id = v_student.id AND date = v_today;
        IF v_attendance.id IS NOT NULL THEN UPDATE public.attendance SET check_out = v_now, status = 'retirado' WHERE id = v_attendance.id; END IF;
        INSERT INTO public.door_punches (student_id, punch_type, punched_at, date) VALUES (v_student.id, 'check_out', v_now, v_today) ON CONFLICT DO NOTHING;
      ELSE
        RETURN jsonb_build_object('success', false, 'message', v_name || ' ya registró entrada y salida hoy');
      END IF;
    END IF;
    RETURN jsonb_build_object('success', true, 'type', v_type, 'name', v_name, 'role', v_role,
      'student_id', v_student.id, 'parent_id', v_parent,
      'time', to_char(v_now AT TIME ZONE 'America/Santo_Domingo', 'HH12:MI AM'));
  END IF;

  SELECT * INTO v_staff FROM public.profiles
  WHERE (notes = p_code OR matricula = p_code OR access_code = p_code)
    AND role IN ('maestra','asistente','directora','admin') LIMIT 1;
  IF NOT FOUND THEN
    BEGIN SELECT * INTO v_staff FROM public.profiles WHERE id = p_code::uuid AND role IN ('maestra','asistente','directora','admin') LIMIT 1;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF FOUND THEN
    v_name := v_staff.name; v_role := initcap(v_staff.role);
    SELECT * INTO v_existing FROM public.door_punches WHERE staff_id = v_staff.id AND date = v_today AND punch_type = 'check_in';
    IF NOT FOUND THEN
      v_type := 'check_in';
      INSERT INTO public.door_punches (staff_id, punch_type, punched_at, date) VALUES (v_staff.id, 'check_in', v_now, v_today) ON CONFLICT DO NOTHING;
    ELSE
      SELECT * INTO v_existing FROM public.door_punches WHERE staff_id = v_staff.id AND date = v_today AND punch_type = 'check_out';
      IF NOT FOUND THEN
        v_type := 'check_out';
        INSERT INTO public.door_punches (staff_id, punch_type, punched_at, date) VALUES (v_staff.id, 'check_out', v_now, v_today) ON CONFLICT DO NOTHING;
      ELSE
        RETURN jsonb_build_object('success', false, 'message', v_name || ' ya registró entrada y salida hoy');
      END IF;
    END IF;
    RETURN jsonb_build_object('success', true, 'type', v_type, 'name', v_name, 'role', v_role,
      'student_id', null, 'parent_id', null,
      'time', to_char(v_now AT TIME ZONE 'America/Santo_Domingo', 'HH12:MI AM'));
  END IF;
  RETURN jsonb_build_object('success', false, 'message', 'QR no registrado en el sistema');
END;
$$;
GRANT EXECUTE ON FUNCTION public.process_door_punch(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_door_punch(text) TO anon;

-- ── PASO 4: Perfil de administrador ──────────────────────────────────────────
-- Crear perfil admin para impulsodigital@gmail.com
INSERT INTO public.profiles (id, email, name, role, accepted_terms, created_at)
VALUES ('c1e72617-ab8f-44c0-b1eb-cdd92eda62e7', 'impulsodigital@gmail.com', 'Administrador', 'admin', true, now())
ON CONFLICT (id) DO UPDATE SET role = 'admin', accepted_terms = true;

-- ── PASO 5: Seguridad y auditoría ─────────────────────────────────────────────
-- Ejecutar también: fix_security_audit.sql, fix_production_security.sql

-- ── PASO 6: Sistema de mora ───────────────────────────────────────────────────
-- Ejecutar también: fix_mora_system.sql

-- ── PASO 7: Ciclo académico ───────────────────────────────────────────────────
-- Ejecutar también: fix_academic_lifecycle.sql, fix_period_close.sql

-- ── PASO 8: Producción final (cron jobs) ─────────────────────────────────────
-- Ejecutar también: fix_production_final.sql

-- ── VERIFICACIÓN FINAL ────────────────────────────────────────────────────────
SELECT 'profiles' as tabla, count(*) FROM public.profiles
UNION ALL SELECT 'students', count(*) FROM public.students
UNION ALL SELECT 'classrooms', count(*) FROM public.classrooms
UNION ALL SELECT 'door_punches', count(*) FROM public.door_punches
UNION ALL SELECT 'notifications', count(*) FROM public.notifications;

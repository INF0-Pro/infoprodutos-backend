-- ============================================================
-- INFOPRODUTOS PLATFORM - PRODUCTION MIGRATION
-- ============================================================
-- Execute this in Supabase SQL Editor before deploying the updated backend.
-- It is intentionally additive/backward-compatible where old data may exist.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- CHECKOUTS: make them reusable
-- ============================================================
ALTER TABLE checkouts ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
ALTER TABLE checkouts ADD COLUMN IF NOT EXISTS checkout_template VARCHAR(100) DEFAULT 'default';
ALTER TABLE checkouts ADD COLUMN IF NOT EXISTS payment_template VARCHAR(100) DEFAULT 'default';
ALTER TABLE checkouts ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false;

ALTER TABLE checkouts DROP CONSTRAINT IF EXISTS checkouts_status_check;
ALTER TABLE checkouts ADD CONSTRAINT checkouts_status_check
  CHECK (status IN ('active', 'inactive', 'deleted'));

-- Legacy installations may have checkouts.product_id NOT NULL.
-- Keep it as a legacy column only, but remove the hard requirement.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'checkouts' AND column_name = 'product_id'
  ) THEN
    ALTER TABLE checkouts ALTER COLUMN product_id DROP NOT NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS product_checkouts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    checkout_id UUID NOT NULL REFERENCES checkouts(id) ON DELETE RESTRICT,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (product_id, checkout_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_checkouts_one_default
  ON product_checkouts(product_id)
  WHERE is_default = true;
CREATE INDEX IF NOT EXISTS idx_product_checkouts_product ON product_checkouts(product_id);
CREATE INDEX IF NOT EXISTS idx_product_checkouts_checkout ON product_checkouts(checkout_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'checkouts' AND column_name = 'product_id'
  ) THEN
    INSERT INTO product_checkouts (product_id, checkout_id, is_default)
    SELECT c.product_id, c.id, true
    FROM checkouts c
    WHERE c.product_id IS NOT NULL
    ON CONFLICT (product_id, checkout_id) DO NOTHING;
  END IF;
END $$;

-- ============================================================
-- PRODUCTS: covers, uploads, checkout selection, richer status
-- ============================================================
ALTER TABLE products ADD COLUMN IF NOT EXISTS cover_url TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS default_checkout_id UUID REFERENCES checkouts(id) ON DELETE SET NULL;

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_content_type_check;
ALTER TABLE products ADD CONSTRAINT products_content_type_check
  CHECK (content_type IN ('ebook', 'link', 'download', 'video', 'course'));

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_status_check;
ALTER TABLE products ADD CONSTRAINT products_status_check
  CHECK (status IN ('active', 'pending', 'inactive', 'deleted'));

CREATE INDEX IF NOT EXISTS idx_products_default_checkout ON products(default_checkout_id);

UPDATE products p
SET default_checkout_id = pc.checkout_id
FROM product_checkouts pc
WHERE pc.product_id = p.id
  AND pc.is_default = true
  AND p.default_checkout_id IS NULL;

-- ============================================================
-- PAYMENT SESSIONS: state machine fields
-- ============================================================
ALTER TABLE payment_sessions ADD COLUMN IF NOT EXISTS processing BOOLEAN DEFAULT false;
ALTER TABLE payment_sessions ADD COLUMN IF NOT EXISTS upsell_expires_at TIMESTAMPTZ;
ALTER TABLE payment_sessions ADD COLUMN IF NOT EXISTS upsell_resolved_at TIMESTAMPTZ;
ALTER TABLE payment_sessions ADD COLUMN IF NOT EXISTS utm_data JSONB DEFAULT '{}';

ALTER TABLE payment_sessions DROP CONSTRAINT IF EXISTS payment_sessions_status_check;
ALTER TABLE payment_sessions ADD CONSTRAINT payment_sessions_status_check
  CHECK (status IN (
    'CREATED',
    'CHECKOUT_OPEN',
    'PAYMENT_SESSION_CREATED',
    'WAITING_PAYMENT',
    'PAYMENT_CONFIRMED',
    'UPSELL_PENDING',
    'UPSELL_ACCEPTED',
    'UPSELL_DECLINED',
    'DELIVERED',
    'EXPIRED',
    'FAILED',
    'CANCELLED',
    'REVIEW_REQUIRED'
  ));

ALTER TABLE payment_sessions DROP CONSTRAINT IF EXISTS chk_upsell_status;
ALTER TABLE payment_sessions DROP CONSTRAINT IF EXISTS payment_sessions_upsell_status_check;
ALTER TABLE payment_sessions ADD CONSTRAINT payment_sessions_upsell_status_check
  CHECK (upsell_status IN ('none', 'pending', 'accepted', 'declined', 'timed_out'));

CREATE INDEX IF NOT EXISTS idx_sessions_status_expires ON payment_sessions(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_upsell_expires ON payment_sessions(upsell_expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_entity_reference ON payment_sessions(copied_entity, copied_reference);

-- ============================================================
-- PAYMENT EVENTS: MacroDroid idempotency
-- ============================================================
CREATE TABLE IF NOT EXISTS payment_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fingerprint VARCHAR(255) UNIQUE NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    entity VARCHAR(255),
    reference VARCHAR(255),
    received_at TIMESTAMPTZ,
    raw_message TEXT,
    sender VARCHAR(255),
    payload JSONB DEFAULT '{}',
    status VARCHAR(50) DEFAULT 'received' CHECK (status IN ('received', 'processed', 'duplicate', 'review_required', 'failed')),
    processed_session_id UUID REFERENCES payment_sessions(id) ON DELETE SET NULL,
    result JSONB DEFAULT '{}',
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_events_fingerprint ON payment_events(fingerprint);
CREATE INDEX IF NOT EXISTS idx_payment_events_amount ON payment_events(amount);
CREATE INDEX IF NOT EXISTS idx_payment_events_status ON payment_events(status);
CREATE INDEX IF NOT EXISTS idx_payment_events_received ON payment_events(received_at);

-- ============================================================
-- FUNNELS AND OFFER RULES
-- ============================================================
CREATE TABLE IF NOT EXISTS funnels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    main_product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    checkout_id UUID REFERENCES checkouts(id) ON DELETE SET NULL,
    recovery_url TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'deleted')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_funnels_main_product ON funnels(main_product_id);
CREATE INDEX IF NOT EXISTS idx_funnels_status ON funnels(status);

CREATE TABLE IF NOT EXISTS funnel_steps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    funnel_id UUID NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
    step_type VARCHAR(50) NOT NULL CHECK (step_type IN ('checkout', 'upsell', 'downsell', 'recovery', 'delivery')),
    product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
    url TEXT,
    order_index INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_funnel_steps_funnel ON funnel_steps(funnel_id);
CREATE INDEX IF NOT EXISTS idx_funnel_steps_type ON funnel_steps(step_type);

CREATE TABLE IF NOT EXISTS product_upsells (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    main_product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    upsell_product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    name VARCHAR(255) DEFAULT '',
    description TEXT DEFAULT '',
    price DECIMAL(10,2),
    is_active BOOLEAN DEFAULT true,
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (main_product_id, upsell_product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_upsells_main ON product_upsells(main_product_id);
CREATE INDEX IF NOT EXISTS idx_product_upsells_active ON product_upsells(is_active);

CREATE TABLE IF NOT EXISTS product_downsells (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    main_product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    downsell_product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    name VARCHAR(255) DEFAULT '',
    description TEXT DEFAULT '',
    price DECIMAL(10,2),
    is_active BOOLEAN DEFAULT true,
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (main_product_id, downsell_product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_downsells_main ON product_downsells(main_product_id);
CREATE INDEX IF NOT EXISTS idx_product_downsells_active ON product_downsells(is_active);

CREATE TABLE IF NOT EXISTS product_order_bumps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    main_product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    bump_product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    checkout_id UUID REFERENCES checkouts(id) ON DELETE SET NULL,
    name VARCHAR(255) DEFAULT '',
    description TEXT DEFAULT '',
    price DECIMAL(10,2),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_order_bumps_main ON product_order_bumps(main_product_id);
CREATE INDEX IF NOT EXISTS idx_product_order_bumps_checkout ON product_order_bumps(checkout_id);

INSERT INTO product_upsells (main_product_id, upsell_product_id, name, description, price, is_active, order_index)
SELECT main_product_id, product_id, name, description, price, is_active, order_index
FROM upsells
ON CONFLICT (main_product_id, upsell_product_id) DO NOTHING;

-- ============================================================
-- DELIVERIES AND TRACKING
-- ============================================================
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS delivery_token VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deliveries_token ON deliveries(delivery_token);

ALTER TABLE tracking_events ADD COLUMN IF NOT EXISTS funnel_id UUID REFERENCES funnels(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tracking_funnel_id ON tracking_events(funnel_id);
CREATE INDEX IF NOT EXISTS idx_tracking_event_date ON tracking_events(event_name, created_at);

CREATE TABLE IF NOT EXISTS integrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    config JSONB DEFAULT '{}',
    status VARCHAR(50) NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integrations_provider ON integrations(provider);
CREATE INDEX IF NOT EXISTS idx_integrations_status ON integrations(status);

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
  tables_list TEXT[] := ARRAY[
    'users',
    'checkouts',
    'products',
    'payment_sessions',
    'payment_events',
    'funnels',
    'funnel_steps',
    'product_upsells',
    'product_downsells',
    'product_order_bumps',
    'upsells',
    'order_bumps',
    'integrations'
  ];
BEGIN
  FOREACH t IN ARRAY tables_list LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS update_%s_updated_at ON %I;', t, t);
    EXECUTE format('CREATE TRIGGER update_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();', t, t);
  END LOOP;
END $$;

-- ============================================================
-- RLS: service role only for backend-controlled data access
-- ============================================================
DO $$
DECLARE
  t TEXT;
  tables_list TEXT[] := ARRAY[
    'users',
    'products',
    'checkouts',
    'product_checkouts',
    'payment_sessions',
    'payment_events',
    'deliveries',
    'upsells',
    'order_bumps',
    'product_upsells',
    'product_downsells',
    'product_order_bumps',
    'funnels',
    'funnel_steps',
    'tracking_events',
    'integrations',
    'audit_log'
  ];
BEGIN
  FOREACH t IN ARRAY tables_list LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS service_role_all ON %I;', t);
    EXECUTE format('CREATE POLICY service_role_all ON %I FOR ALL TO service_role USING (true) WITH CHECK (true);', t);
  END LOOP;
END $$;

-- ============================================================
-- QUICK DIAGNOSTIC OUTPUT
-- ============================================================
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'products',
    'checkouts',
    'product_checkouts',
    'payment_sessions',
    'payment_events',
    'funnels',
    'funnel_steps',
    'deliveries'
  )
ORDER BY table_name, ordinal_position;

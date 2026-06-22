-- ============================================================
-- INFOPRODUTOS PLATFORM - PRODUCTION SCHEMA
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- USERS TABLE (Admin Authentication)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'admin',
    is_active BOOLEAN DEFAULT true,
    refresh_token TEXT,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ============================================================
-- CHECKOUTS TABLE (Reusable payment source)
-- ============================================================
CREATE TABLE IF NOT EXISTS checkouts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    entity VARCHAR(255) NOT NULL,
    reference VARCHAR(255) NOT NULL,
    checkout_template VARCHAR(100) DEFAULT 'default',
    payment_template VARCHAR(100) DEFAULT 'default',
    is_default BOOLEAN DEFAULT false,
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'deleted')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checkouts_status ON checkouts(status);
CREATE INDEX IF NOT EXISTS idx_checkouts_default ON checkouts(is_default);
CREATE INDEX IF NOT EXISTS idx_checkouts_entity_reference ON checkouts(entity, reference);

-- ============================================================
-- PRODUCTS TABLE (Source of offer and delivery logic)
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
    content_type VARCHAR(50) NOT NULL CHECK (content_type IN ('ebook', 'link', 'download', 'video', 'course')),
    content_url TEXT,
    cover_url TEXT,
    default_checkout_id UUID REFERENCES checkouts(id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'inactive', 'deleted')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_content_type ON products(content_type);
CREATE INDEX IF NOT EXISTS idx_products_default_checkout ON products(default_checkout_id);

-- ============================================================
-- PRODUCT CHECKOUTS (Many-to-many reusable checkout assignment)
-- ============================================================
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

-- ============================================================
-- PAYMENT SESSIONS TABLE (Source of transaction state)
-- ============================================================
CREATE TABLE IF NOT EXISTS payment_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    checkout_id UUID NOT NULL REFERENCES checkouts(id) ON DELETE RESTRICT,
    customer_name VARCHAR(255) NOT NULL,
    customer_email VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(50),
    expected_amount DECIMAL(10,2) NOT NULL CHECK (expected_amount >= 0),
    selected_order_bumps JSONB DEFAULT '[]',
    status VARCHAR(50) NOT NULL DEFAULT 'WAITING_PAYMENT' CHECK (status IN (
        'CREATED',
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
    )),
    score INTEGER DEFAULT 0,
    processing BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_activity_at TIMESTAMPTZ DEFAULT NOW(),
    copied_entity VARCHAR(255),
    copied_reference VARCHAR(255),
    copied_value VARCHAR(255),
    payment_confirmed_at TIMESTAMPTZ,
    upsell_status VARCHAR(50) DEFAULT 'none' CHECK (upsell_status IN ('none', 'pending', 'accepted', 'declined', 'timed_out')),
    upsell_expires_at TIMESTAMPTZ,
    upsell_resolved_at TIMESTAMPTZ,
    delivery_unlocked_at TIMESTAMPTZ,
    utm_data JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON payment_sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_email ON payment_sessions(customer_email);
CREATE INDEX IF NOT EXISTS idx_sessions_product_id ON payment_sessions(product_id);
CREATE INDEX IF NOT EXISTS idx_sessions_checkout_id ON payment_sessions(checkout_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON payment_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_entity_reference ON payment_sessions(copied_entity, copied_reference);
CREATE INDEX IF NOT EXISTS idx_sessions_status_expires ON payment_sessions(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_upsell_expires ON payment_sessions(upsell_expires_at);

-- ============================================================
-- PAYMENT EVENTS (MacroDroid idempotency and audit trail)
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
-- FUNNELS AND STEPS
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

-- ============================================================
-- PRODUCT OFFER RULES
-- ============================================================
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
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (main_product_id, bump_product_id, checkout_id)
);

CREATE INDEX IF NOT EXISTS idx_product_order_bumps_main ON product_order_bumps(main_product_id);
CREATE INDEX IF NOT EXISTS idx_product_order_bumps_checkout ON product_order_bumps(checkout_id);

-- Legacy compatible tables kept for existing code/data.
CREATE TABLE IF NOT EXISTS upsells (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    main_product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
    is_active BOOLEAN DEFAULT true,
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_main_product UNIQUE (main_product_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_upsells_main_product ON upsells(main_product_id);
CREATE INDEX IF NOT EXISTS idx_upsells_active ON upsells(is_active);

CREATE TABLE IF NOT EXISTS order_bumps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    checkout_id UUID NOT NULL REFERENCES checkouts(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_bumps_checkout ON order_bumps(checkout_id);

-- ============================================================
-- DELIVERIES TABLE (Digital Delivery)
-- ============================================================
CREATE TABLE IF NOT EXISTS deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES payment_sessions(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    customer_email VARCHAR(255) NOT NULL,
    delivery_token VARCHAR(255) UNIQUE NOT NULL,
    content_type VARCHAR(50) NOT NULL,
    content_url TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'unlocked' CHECK (status IN ('unlocked', 'expired')),
    download_count INTEGER DEFAULT 0,
    downloaded_at TIMESTAMPTZ,
    download_ip VARCHAR(45),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deliveries_session_id ON deliveries(session_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_token ON deliveries(delivery_token);
CREATE INDEX IF NOT EXISTS idx_deliveries_status ON deliveries(status);

-- ============================================================
-- TRACKING EVENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS tracking_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_name VARCHAR(100) NOT NULL,
    session_id UUID REFERENCES payment_sessions(id) ON DELETE SET NULL,
    customer_email VARCHAR(255),
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    funnel_id UUID REFERENCES funnels(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}',
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracking_event_name ON tracking_events(event_name);
CREATE INDEX IF NOT EXISTS idx_tracking_session_id ON tracking_events(session_id);
CREATE INDEX IF NOT EXISTS idx_tracking_product_id ON tracking_events(product_id);
CREATE INDEX IF NOT EXISTS idx_tracking_funnel_id ON tracking_events(funnel_id);
CREATE INDEX IF NOT EXISTS idx_tracking_created_at ON tracking_events(created_at);
CREATE INDEX IF NOT EXISTS idx_tracking_event_date ON tracking_events(event_name, created_at);

-- ============================================================
-- INTEGRATIONS TABLE
-- ============================================================
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
-- AUDIT LOG TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id UUID,
    session_id UUID REFERENCES payment_sessions(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    details JSONB DEFAULT '{}',
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_session_id ON audit_log(session_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_checkouts_updated_at ON checkouts;
CREATE TRIGGER update_checkouts_updated_at BEFORE UPDATE ON checkouts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_products_updated_at ON products;
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_payment_sessions_updated_at ON payment_sessions;
CREATE TRIGGER update_payment_sessions_updated_at BEFORE UPDATE ON payment_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_payment_events_updated_at ON payment_events;
CREATE TRIGGER update_payment_events_updated_at BEFORE UPDATE ON payment_events
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_funnels_updated_at ON funnels;
CREATE TRIGGER update_funnels_updated_at BEFORE UPDATE ON funnels
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_funnel_steps_updated_at ON funnel_steps;
CREATE TRIGGER update_funnel_steps_updated_at BEFORE UPDATE ON funnel_steps
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_product_upsells_updated_at ON product_upsells;
CREATE TRIGGER update_product_upsells_updated_at BEFORE UPDATE ON product_upsells
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_product_downsells_updated_at ON product_downsells;
CREATE TRIGGER update_product_downsells_updated_at BEFORE UPDATE ON product_downsells
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_product_order_bumps_updated_at ON product_order_bumps;
CREATE TRIGGER update_product_order_bumps_updated_at BEFORE UPDATE ON product_order_bumps
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_upsells_updated_at ON upsells;
CREATE TRIGGER update_upsells_updated_at BEFORE UPDATE ON upsells
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_order_bumps_updated_at ON order_bumps;
CREATE TRIGGER update_order_bumps_updated_at BEFORE UPDATE ON order_bumps
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_integrations_updated_at ON integrations;
CREATE TRIGGER update_integrations_updated_at BEFORE UPDATE ON integrations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_checkouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnels ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnel_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_upsells ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_downsells ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_order_bumps ENABLE ROW LEVEL SECURITY;
ALTER TABLE upsells ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_bumps ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON users FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON checkouts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON products FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON product_checkouts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON payment_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON payment_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON funnels FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON funnel_steps FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON product_upsells FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON product_downsells FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON product_order_bumps FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON upsells FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON order_bumps FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON deliveries FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON tracking_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON integrations FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON audit_log FOR ALL TO service_role USING (true) WITH CHECK (true);

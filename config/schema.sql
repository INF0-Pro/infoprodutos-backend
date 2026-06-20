-- ============================================================
-- INFOPRODUTOS PLATFORM - SUPABASE SCHEMA
-- ============================================================

-- Enable UUID extension
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

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- ============================================================
-- PRODUCTS TABLE (Source of Offer Logic)
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
    content_type VARCHAR(50) NOT NULL CHECK (content_type IN ('ebook', 'link', 'video', 'course')),
    content_url TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_products_status ON products(status);
CREATE INDEX idx_products_content_type ON products(content_type);

-- ============================================================
-- CHECKOUTS TABLE (Source of Payment Data)
-- ============================================================
CREATE TABLE IF NOT EXISTS checkouts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    entity VARCHAR(255) NOT NULL,
    reference VARCHAR(255) NOT NULL,
    checkout_template VARCHAR(100) DEFAULT 'default',
    payment_template VARCHAR(100) DEFAULT 'default',
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_checkouts_product_id ON checkouts(product_id);
CREATE INDEX idx_checkouts_status ON checkouts(status);
CREATE INDEX idx_checkouts_entity_reference ON checkouts(entity, reference);

-- ============================================================
-- PAYMENT SESSIONS TABLE (Source of Transaction State)
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
    status VARCHAR(50) NOT NULL DEFAULT 'CREATED' CHECK (status IN (
        'CREATED', 'CHECKOUT_OPEN', 'PAYMENT_SESSION_CREATED', 'WAITING_PAYMENT',
        'PAYMENT_CONFIRMED', 'UPSELL_PENDING', 'UPSELL_ACCEPTED', 'UPSELL_DECLINED',
        'DELIVERED', 'EXPIRED', 'FAILED', 'CANCELLED', 'REVIEW_REQUIRED'
    )),
    score INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_activity_at TIMESTAMPTZ DEFAULT NOW(),
    copied_entity VARCHAR(255),
    copied_reference VARCHAR(255),
    copied_value VARCHAR(255),
    payment_confirmed_at TIMESTAMPTZ,
    delivery_unlocked_at TIMESTAMPTZ,
    upsell_status VARCHAR(50) DEFAULT 'none' CHECK (upsell_status IN ('none', 'pending', 'accepted', 'declined', 'timed_out')),
    utm_data JSONB
);

CREATE INDEX idx_sessions_status ON payment_sessions(status);
CREATE INDEX idx_sessions_email ON payment_sessions(customer_email);
CREATE INDEX idx_sessions_product_id ON payment_sessions(product_id);
CREATE INDEX idx_sessions_checkout_id ON payment_sessions(checkout_id);
CREATE INDEX idx_sessions_expires_at ON payment_sessions(expires_at);
CREATE INDEX idx_sessions_entity_reference ON payment_sessions(copied_entity, copied_reference);
CREATE INDEX idx_sessions_status_expires ON payment_sessions(status, expires_at);

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

CREATE INDEX idx_deliveries_session_id ON deliveries(session_id);
CREATE INDEX idx_deliveries_token ON deliveries(delivery_token);
CREATE INDEX idx_deliveries_status ON deliveries(status);

-- ============================================================
-- UPSELLS TABLE (Upsell Products)
-- ============================================================
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

CREATE INDEX idx_upsells_main_product ON upsells(main_product_id);
CREATE INDEX idx_upsells_active ON upsells(is_active);

-- ============================================================
-- ORDER BUMPS TABLE
-- ============================================================
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

CREATE INDEX idx_order_bumps_checkout ON order_bumps(checkout_id);

-- ============================================================
-- TRACKING EVENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS tracking_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_name VARCHAR(100) NOT NULL,
    session_id UUID REFERENCES payment_sessions(id) ON DELETE SET NULL,
    customer_email VARCHAR(255),
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}',
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tracking_event_name ON tracking_events(event_name);
CREATE INDEX idx_tracking_session_id ON tracking_events(session_id);
CREATE INDEX idx_tracking_created_at ON tracking_events(created_at);
CREATE INDEX idx_tracking_event_date ON tracking_events(event_name, created_at);

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

CREATE INDEX idx_audit_action ON audit_log(action);
CREATE INDEX idx_audit_session_id ON audit_log(session_id);
CREATE INDEX idx_audit_created_at ON audit_log(created_at);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_checkouts_updated_at
    BEFORE UPDATE ON checkouts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payment_sessions_updated_at
    BEFORE UPDATE ON payment_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_upsells_updated_at
    BEFORE UPDATE ON upsells
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_order_bumps_updated_at
    BEFORE UPDATE ON order_bumps
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- ROW LEVEL SECURITY (Optional - for multi-tenant)
-- ============================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE upsells ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_bumps ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY service_role_all ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON checkouts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON payment_sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON deliveries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON upsells FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON order_bumps FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON tracking_events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON audit_log FOR ALL USING (true) WITH CHECK (true);
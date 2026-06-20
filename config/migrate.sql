-- ============================================================
-- INFOPRODUTOS PLATFORM - SCRIPT DE MIGRAÇÃO/CORREÇÃO
-- ============================================================
-- Executar no SQL Editor do Supabase se houver erros
-- ============================================================

-- 1. Garantir que a coluna content_type existe em products
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'products' AND column_name = 'content_type'
    ) THEN
        ALTER TABLE products ADD COLUMN content_type VARCHAR(50) DEFAULT 'ebook';
        ALTER TABLE products ADD CONSTRAINT chk_products_content_type 
            CHECK (content_type IN ('ebook', 'link', 'video', 'course'));
    END IF;
END $$;

-- 2. Garantir que a coluna content_url existe em products
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'products' AND column_name = 'content_url'
    ) THEN
        ALTER TABLE products ADD COLUMN content_url TEXT;
    END IF;
END $$;

-- 3. Garantir que a coluna upsell_status existe em payment_sessions
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payment_sessions' AND column_name = 'upsell_status'
    ) THEN
        ALTER TABLE payment_sessions ADD COLUMN upsell_status VARCHAR(50) DEFAULT 'none';
        ALTER TABLE payment_sessions ADD CONSTRAINT chk_upsell_status 
            CHECK (upsell_status IN ('none', 'pending', 'accepted', 'declined', 'timed_out'));
    END IF;
END $$;

-- 4. Garantir que a coluna utm_data existe em payment_sessions
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payment_sessions' AND column_name = 'utm_data'
    ) THEN
        ALTER TABLE payment_sessions ADD COLUMN utm_data JSONB;
    END IF;
END $$;

-- 5. Garantir que a coluna delivery_token existe em deliveries
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'deliveries' AND column_name = 'delivery_token'
    ) THEN
        ALTER TABLE deliveries ADD COLUMN delivery_token VARCHAR(255) UNIQUE;
    END IF;
END $$;

-- 6. Garantir índices críticos
CREATE INDEX IF NOT EXISTS idx_products_content_type ON products(content_type);
CREATE INDEX IF NOT EXISTS idx_sessions_status_expires ON payment_sessions(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_entity_reference ON payment_sessions(copied_entity, copied_reference);
CREATE INDEX IF NOT EXISTS idx_deliveries_token ON deliveries(delivery_token);
CREATE INDEX IF NOT EXISTS idx_tracking_event_date ON tracking_events(event_name, created_at);

-- 7. Garantir permissões RLS para service_role
DO $$
DECLARE
    tables_list TEXT[] := ARRAY['users', 'products', 'checkouts', 'payment_sessions', 'deliveries', 'upsells', 'order_bumps', 'tracking_events', 'audit_log'];
    t TEXT;
BEGIN
    FOREACH t IN ARRAY tables_list
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
        
        -- Drop existing policy if exists
        BEGIN
            EXECUTE format('DROP POLICY IF EXISTS service_role_all ON %I;', t);
        EXCEPTION WHEN OTHERS THEN END;
        
        -- Create policy
        BEGIN
            EXECUTE format('CREATE POLICY service_role_all ON %I FOR ALL USING (true) WITH CHECK (true);', t);
        EXCEPTION WHEN OTHERS THEN END;
    END LOOP;
END $$;

-- 8. Verificar estrutura das tabelas (para diagnóstico)
SELECT 
    table_name, 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
    AND table_name IN ('products', 'checkouts', 'payment_sessions', 'deliveries')
ORDER BY table_name, ordinal_position;

-- 9. Verificar políticas RLS
SELECT 
    schemaname, 
    tablename, 
    policyname, 
    permissive, 
    roles, 
    cmd, 
    qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
-- Create vendors table to track supplier information and purchase history
CREATE TABLE IF NOT EXISTS vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  vendor_name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create vendor_purchases table to track all purchases from vendors
CREATE TABLE IF NOT EXISTS vendor_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  product_name TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  unit_cost NUMERIC NOT NULL,
  total_cost NUMERIC NOT NULL,
  payment_method TEXT,
  paid_from_account_id UUID REFERENCES cash_accounts(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_vendors_store_id ON vendors(store_id);
CREATE INDEX IF NOT EXISTS idx_vendors_name ON vendors(vendor_name);
CREATE INDEX IF NOT EXISTS idx_vendor_purchases_vendor_id ON vendor_purchases(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_purchases_store_id ON vendor_purchases(store_id);
CREATE INDEX IF NOT EXISTS idx_vendor_purchases_date ON vendor_purchases(purchase_date);

-- Add RLS policies
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_purchases ENABLE ROW LEVEL SECURITY;

-- Vendors policies
CREATE POLICY "Users can view vendors for their stores" ON vendors
  FOR SELECT USING (true);

CREATE POLICY "Users can insert vendors" ON vendors
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update vendors" ON vendors
  FOR UPDATE USING (true);

CREATE POLICY "Users can delete vendors" ON vendors
  FOR DELETE USING (true);

-- Vendor purchases policies
CREATE POLICY "Users can view vendor purchases for their stores" ON vendor_purchases
  FOR SELECT USING (true);

CREATE POLICY "Users can insert vendor purchases" ON vendor_purchases
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update vendor purchases" ON vendor_purchases
  FOR UPDATE USING (true);

CREATE POLICY "Users can delete vendor purchases" ON vendor_purchases
  FOR DELETE USING (true);

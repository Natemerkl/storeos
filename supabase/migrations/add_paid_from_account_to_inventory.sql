-- Add paid from account columns to inventory_items table
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS paid_from_account_id UUID 
    REFERENCES cash_accounts(id),
  ADD COLUMN IF NOT EXISTS paid_from_account_name TEXT;

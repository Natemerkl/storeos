-- Rename 'name' column to 'account_name' in cash_accounts table
-- This ensures consistency across the application

ALTER TABLE cash_accounts
RENAME COLUMN name TO account_name;

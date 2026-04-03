-- Add plate_number column to sales table
ALTER TABLE sales ADD COLUMN IF NOT EXISTS plate_number TEXT;

-- Add index for faster lookups by plate number
CREATE INDEX IF NOT EXISTS idx_sales_plate_number ON sales(plate_number);

-- Add comment
COMMENT ON COLUMN sales.plate_number IS 'Vehicle plate/targa number associated with this sale';

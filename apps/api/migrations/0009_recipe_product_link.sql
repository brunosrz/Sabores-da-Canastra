-- Applied once by the versioned D1 migration runner.
ALTER TABLE recipes ADD COLUMN product_id TEXT REFERENCES products(product_id);
UPDATE recipes SET product_id = (SELECT p.product_id FROM products p WHERE p.name = recipes.product_name);
CREATE INDEX IF NOT EXISTS recipes_by_product_id ON recipes(product_id, version);
-- Enforce the same unit rule for every writer, including configuration imports.
CREATE TRIGGER IF NOT EXISTS recipe_lines_unit_insert BEFORE INSERT ON recipe_lines
WHEN EXISTS (SELECT 1 FROM ingredients WHERE ingredient_id = NEW.ingredient_id AND base_unit != NEW.unit)
BEGIN SELECT RAISE(ABORT, 'RECIPE_UNIT_MISMATCH'); END;
CREATE TRIGGER IF NOT EXISTS recipe_lines_unit_update BEFORE UPDATE ON recipe_lines
WHEN EXISTS (SELECT 1 FROM ingredients WHERE ingredient_id = NEW.ingredient_id AND base_unit != NEW.unit)
BEGIN SELECT RAISE(ABORT, 'RECIPE_UNIT_MISMATCH'); END;

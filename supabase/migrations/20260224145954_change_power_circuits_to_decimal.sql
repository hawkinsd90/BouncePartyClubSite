/*
  # Change power_circuits to support decimal values

  1. Changes
    - Alter `units.power_circuits` column from integer to numeric(4,1)
    - This allows values like 0.5, 1.0, 1.5, 2.0, etc.
    - Supports up to 999.9 HP (more than enough for any inflatable)

  2. Notes
    - Existing integer values will be automatically converted
    - The field represents blower horsepower needed to inflate the unit
*/

-- Change power_circuits from integer to numeric to support decimal values like 1.5
ALTER TABLE units
ALTER COLUMN power_circuits TYPE numeric(4,1) USING power_circuits::numeric(4,1);

-- Update the default value (keep it as 1)
ALTER TABLE units
ALTER COLUMN power_circuits SET DEFAULT 1.0;

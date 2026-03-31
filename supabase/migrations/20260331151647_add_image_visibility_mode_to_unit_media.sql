/*
  # Add visibility_mode to unit_media

  ## Summary
  Adds a `visibility_mode` column to `unit_media` to allow images to be
  designated as appearing in the dry view only, wet view only, or both views
  of a unit's detail page.

  ## Changes
  - `unit_media.visibility_mode` (text, default 'dry')
    - 'dry'   = shown only in dry view (default, existing behaviour)
    - 'water' = shown only in wet/water view
    - 'both'  = shown in both dry and wet views

  ## Notes
  - Existing rows where mode='dry'   default to visibility_mode='dry'
  - Existing rows where mode='water' default to visibility_mode='water'
  - This column is separate from `mode`, which continues to determine which
    bucket (dry images section vs wet images section) the image belongs to
    for organizational purposes.
  - No data loss – this is a purely additive change.
*/

ALTER TABLE unit_media ADD COLUMN IF NOT EXISTS visibility_mode text DEFAULT 'dry';

UPDATE unit_media SET visibility_mode = mode WHERE visibility_mode = 'dry' AND mode IS NOT NULL;

/*
  # Seed Sample Units for Bounce Party Club

  1. Sample Data
    - Insert 8 diverse inflatable units (bounce houses, combos, water slides)
    - Each unit includes realistic pricing, dimensions, and specifications
    - Mix of dry-only and combo (dry/water) units
    - Sample media URLs using Pexels stock photos
  
  2. Unit Types
    - Standard bounce houses
    - Combo units (bounce + slide)
    - Water slides
    - Different sizes and capacities for various age groups
*/

-- Insert sample units
INSERT INTO units (slug, name, type, is_combo, price_dry_cents, price_water_cents, dimensions, footprint_sqft, power_circuits, capacity, indoor_ok, outdoor_ok, active)
VALUES
  (
    'tropical-bounce-house',
    'Tropical Bounce House',
    'Bounce House',
    false,
    15000,
    NULL,
    '15L x 15W x 15H',
    225,
    1,
    8,
    true,
    true,
    true
  ),
  (
    'castle-combo',
    'Castle Combo with Slide',
    'Combo',
    true,
    25000,
    30000,
    '20L x 15W x 16H',
    300,
    1,
    10,
    false,
    true,
    true
  ),
  (
    'mega-water-slide',
    'Mega Water Slide',
    'Water Slide',
    true,
    35000,
    40000,
    '30L x 12W x 18H',
    360,
    2,
    12,
    false,
    true,
    true
  ),
  (
    'kiddie-bounce',
    'Kiddie Bounce',
    'Bounce House',
    false,
    12000,
    NULL,
    '10L x 10W x 10H',
    100,
    1,
    6,
    true,
    true,
    true
  ),
  (
    'obstacle-course',
    'Obstacle Course Challenge',
    'Obstacle Course',
    false,
    45000,
    NULL,
    '40L x 12W x 12H',
    480,
    2,
    15,
    false,
    true,
    true
  ),
  (
    'rainbow-combo',
    'Rainbow Combo Jumper',
    'Combo',
    true,
    22000,
    27000,
    '18L x 15W x 15H',
    270,
    1,
    10,
    false,
    true,
    true
  ),
  (
    'double-lane-slide',
    'Double Lane Water Slide',
    'Water Slide',
    true,
    38000,
    42000,
    '32L x 15W x 20H',
    480,
    2,
    16,
    false,
    true,
    true
  ),
  (
    'sports-bounce',
    'Sports Arena Bounce House',
    'Bounce House',
    false,
    18000,
    NULL,
    '15L x 15W x 15H',
    225,
    1,
    8,
    true,
    true,
    true
  )
ON CONFLICT (slug) DO NOTHING;

-- Insert sample media for units
INSERT INTO unit_media (unit_id, url, alt, sort)
SELECT 
  u.id,
  'https://images.pexels.com/photos/1619569/pexels-photo-1619569.jpeg',
  u.name || ' - Main Photo',
  0
FROM units u
WHERE u.slug = 'tropical-bounce-house'
ON CONFLICT DO NOTHING;

INSERT INTO unit_media (unit_id, url, alt, sort)
SELECT 
  u.id,
  'https://images.pexels.com/photos/1619569/pexels-photo-1619569.jpeg',
  u.name || ' - Main Photo',
  0
FROM units u
WHERE u.slug = 'castle-combo'
ON CONFLICT DO NOTHING;

INSERT INTO unit_media (unit_id, url, alt, sort)
SELECT 
  u.id,
  'https://images.pexels.com/photos/1619569/pexels-photo-1619569.jpeg',
  u.name || ' - Main Photo',
  0
FROM units u
WHERE u.slug = 'mega-water-slide'
ON CONFLICT DO NOTHING;

INSERT INTO unit_media (unit_id, url, alt, sort)
SELECT 
  u.id,
  'https://images.pexels.com/photos/1619569/pexels-photo-1619569.jpeg',
  u.name || ' - Main Photo',
  0
FROM units u
WHERE u.slug = 'kiddie-bounce'
ON CONFLICT DO NOTHING;

INSERT INTO unit_media (unit_id, url, alt, sort)
SELECT 
  u.id,
  'https://images.pexels.com/photos/1619569/pexels-photo-1619569.jpeg',
  u.name || ' - Main Photo',
  0
FROM units u
WHERE u.slug = 'obstacle-course'
ON CONFLICT DO NOTHING;

INSERT INTO unit_media (unit_id, url, alt, sort)
SELECT 
  u.id,
  'https://images.pexels.com/photos/1619569/pexels-photo-1619569.jpeg',
  u.name || ' - Main Photo',
  0
FROM units u
WHERE u.slug = 'rainbow-combo'
ON CONFLICT DO NOTHING;

INSERT INTO unit_media (unit_id, url, alt, sort)
SELECT 
  u.id,
  'https://images.pexels.com/photos/1619569/pexels-photo-1619569.jpeg',
  u.name || ' - Main Photo',
  0
FROM units u
WHERE u.slug = 'double-lane-slide'
ON CONFLICT DO NOTHING;

INSERT INTO unit_media (unit_id, url, alt, sort)
SELECT 
  u.id,
  'https://images.pexels.com/photos/1619569/pexels-photo-1619569.jpeg',
  u.name || ' - Main Photo',
  0
FROM units u
WHERE u.slug = 'sports-bounce'
ON CONFLICT DO NOTHING;

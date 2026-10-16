/*
  # Add Carousel Show Arrows Setting

  Inserts a default admin_settings row to control whether navigation arrows
  are visible on the hero carousel. Defaults to 'true' (arrows shown).
*/

INSERT INTO admin_settings (key, value)
VALUES ('carousel_show_arrows', 'true')
ON CONFLICT (key) DO NOTHING;

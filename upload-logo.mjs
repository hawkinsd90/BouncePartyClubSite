import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { config } from 'dotenv';

config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function uploadLogo() {
  try {
    console.log('Reading logo file...');
    const logoBuffer = readFileSync('./public/bounce party club logo.png');

    console.log('Uploading logo to Supabase Storage...');
    const { data, error } = await supabase.storage
      .from('public-assets')
      .upload('bounce-party-club-logo.png', logoBuffer, {
        contentType: 'image/png',
        upsert: true, // Replace if exists
      });

    if (error) {
      console.error('Upload error:', error);
      process.exit(1);
    }

    console.log('Upload successful!');

    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from('public-assets')
      .getPublicUrl('bounce-party-club-logo.png');

    console.log('\n✅ Logo uploaded successfully!');
    console.log('📸 Public URL:', publicUrlData.publicUrl);
    console.log('\n⚠️  Add this to your .env file:');
    console.log(`VITE_LOGO_URL=${publicUrlData.publicUrl}`);

  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

uploadLogo();

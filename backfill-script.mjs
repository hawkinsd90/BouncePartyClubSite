import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';

dotenv.config();

// Get service role key from Supabase CLI config
let serviceRoleKey;
try {
  const configPath = process.env.HOME + '/.supabase/supabase-projects.json';
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const projectRef = process.env.VITE_SUPABASE_URL?.match(/https:\/\/(.+)\.supabase\.co/)?.[1];
  if (projectRef && config[projectRef]) {
    serviceRoleKey = config[projectRef].serviceRoleKey;
  }
} catch (err) {
  // Fallback: will need manual input
}

if (!serviceRoleKey) {
  console.error('Could not find service role key. Please set SUPABASE_SERVICE_ROLE_KEY environment variable.');
  process.exit(1);
}

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  serviceRoleKey
);

async function getStripeKey() {
  // Use the Stripe key from .env directly
  return process.env.STRIPE_SECRET_KEY;
}

async function backfillPaymentMethods() {
  try {
    const stripeKey = await getStripeKey();

    if (!stripeKey) {
      console.error('No Stripe secret key found in admin_settings');
      return;
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: '2024-10-28.acacia',
    });

    // Get all payments that need backfilling
    const { data: payments, error: fetchError } = await supabase
      .from('payments')
      .select('id, stripe_payment_intent_id')
      .not('stripe_payment_intent_id', 'is', null)
      .is('payment_method', null);

    if (fetchError) {
      console.error('Error fetching payments:', fetchError);
      return;
    }

    if (!payments || payments.length === 0) {
      console.log('No payments to backfill');
      return;
    }

    console.log(`Found ${payments.length} payment(s) to backfill`);

    let successCount = 0;
    let failCount = 0;

    for (const payment of payments) {
      try {
        console.log(`Processing payment ${payment.id}...`);

        // Skip placeholder payment intent IDs
        if (payment.stripe_payment_intent_id.startsWith('pi_pending_')) {
          console.log(`  Skipping placeholder payment intent: ${payment.stripe_payment_intent_id}`);
          failCount++;
          continue;
        }

        // Retrieve payment intent from Stripe
        const paymentIntent = await stripe.paymentIntents.retrieve(
          payment.stripe_payment_intent_id,
          { expand: ['payment_method'] }
        );

        let paymentMethodType = null;
        let paymentBrand = null;
        let paymentLast4 = null;

        if (paymentIntent.payment_method) {
          const pm = paymentIntent.payment_method;
          paymentMethodType = pm.type || null;

          if (pm.card) {
            paymentBrand = pm.card.brand || null;
            paymentLast4 = pm.card.last4 || null;
          }
        }

        // Update the payment record
        const { error: updateError } = await supabase
          .from('payments')
          .update({
            payment_method: paymentMethodType,
            payment_brand: paymentBrand,
            payment_last4: paymentLast4,
          })
          .eq('id', payment.id);

        if (updateError) {
          console.error(`  Error updating payment: ${updateError.message}`);
          failCount++;
        } else {
          console.log(`  ✓ Updated with method: ${paymentMethodType}${paymentBrand ? ` (${paymentBrand} ${paymentLast4 ? `****${paymentLast4}` : ''})` : ''}`);
          successCount++;
        }
      } catch (err) {
        console.error(`  Error processing payment: ${err.message}`);
        failCount++;
      }
    }

    console.log(`\nBackfill complete: ${successCount} updated, ${failCount} failed`);
  } catch (error) {
    console.error('Fatal error:', error);
  }
}

backfillPaymentMethods();

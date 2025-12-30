# Netlify Deployment Guide

## Critical: Remove Backend Secrets from Netlify

**IMPORTANT:** If you previously added these environment variables to Netlify, you MUST remove them:
- ❌ `TWILIO_ACCOUNT_SID`
- ❌ `TWILIO_AUTH_TOKEN`
- ❌ `TWILIO_API_KEY_SID`
- ❌ `TWILIO_API_KEY_SECRET`
- ❌ `TWILIO_MESSAGING_SERVICE_SID`
- ❌ `TWILIO_FROM_NUMBER`
- ❌ `STRIPE_SECRET_KEY`
- ❌ `OLD_VITE_SUPABASE_ANON_KEY`
- ❌ `OLD_VITE_SUPABASE_URL`

Go to **Site Settings > Environment Variables** and delete any of the above variables if they exist.

## Environment Variables Configuration

### Required Netlify Environment Variables (Frontend Only)

In your Netlify dashboard, go to **Site Settings > Environment Variables** and add ONLY these:

1. `VITE_SUPABASE_ANON_KEY` - Your Supabase anonymous key (public)
2. `VITE_SUPABASE_URL` - Your Supabase project URL (public)
3. `VITE_GOOGLE_MAPS_API_KEY` - Your Google Maps API key (public)
4. `VITE_STRIPE_PUBLISHABLE_KEY` - Your Stripe publishable key (public)
5. `VITE_LOGO_URL` - Your logo URL from Supabase storage (public)

### Why Backend Secrets Should NOT Be in Netlify

Backend secrets (Twilio, Stripe Secret Key, etc.) are:
- Automatically available in Supabase Edge Functions via environment variables
- Stored in the `admin_settings` database table
- Should NEVER be in your frontend code or Netlify environment

The frontend only needs public keys (VITE_ prefixed variables).

## Deployment Steps

1. Remove all backend secrets from your repository
2. Configure the environment variables in Netlify dashboard
3. Push your changes to trigger a new build
4. The build should complete successfully without secrets scanning errors

## Node Version

This project requires Node 20.17.0 or higher. The `.nvmrc` and `netlify.toml` files are configured to use Node 20.17.0.

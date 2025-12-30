# Netlify Deployment Guide

## Environment Variables Configuration

Your `.env` file should **ONLY** contain public frontend environment variables (those prefixed with `VITE_`). Backend secrets are automatically available in Supabase Edge Functions.

### Required Netlify Environment Variables

In your Netlify dashboard, go to **Site Settings > Environment Variables** and add:

1. `VITE_SUPABASE_ANON_KEY` - Your Supabase anonymous key (public)
2. `VITE_SUPABASE_URL` - Your Supabase project URL (public)
3. `VITE_GOOGLE_MAPS_API_KEY` - Your Google Maps API key (public)
4. `VITE_STRIPE_PUBLISHABLE_KEY` - Your Stripe publishable key (public)
5. `VITE_LOGO_URL` - Your logo URL from Supabase storage (public)

### Backend Secrets (DO NOT add to Netlify)

The following secrets should **NEVER** be in your frontend `.env` file or Netlify environment variables:
- Twilio credentials (Account SID, Auth Token, API keys)
- Stripe Secret Key
- Supabase Service Role Key

These are automatically available in Supabase Edge Functions and are stored in the `admin_settings` database table.

## Deployment Steps

1. Remove all backend secrets from your repository
2. Configure the environment variables in Netlify dashboard
3. Push your changes to trigger a new build
4. The build should complete successfully without secrets scanning errors

## Node Version

This project requires Node 20.17.0 or higher. The `.nvmrc` and `netlify.toml` files are configured to use Node 20.17.0.

# Google Maps API Configuration Guide

The application uses Google Maps API for address autocomplete functionality in the Travel Calculator and other address input fields. If you're seeing "This page can't load Google Maps correctly" errors, your Google Cloud Platform API key needs to be configured properly.

## Prerequisites

- A Google Cloud Platform (GCP) account
- A valid credit card (required for GCP, though the first $200/month is free)
- The API key is already set in `.env` as `VITE_GOOGLE_MAPS_API_KEY`

## Step-by-Step Setup

### 1. Access Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Sign in with your Google account
3. Create a new project or select an existing one

### 2. Enable Billing

**This is the most common reason for the error message:**

1. In the left sidebar, click **Billing**
2. Click **Link a billing account** if you don't have one
3. Follow the prompts to add your credit card
4. Note: Google offers $200/month in free credits, which is more than enough for typical usage

### 3. Enable Required APIs

1. In the left sidebar, click **APIs & Services** → **Library**
2. Search for and enable these APIs:
   - **Maps JavaScript API**
   - **Places API**
   - **Geocoding API**
3. Click **Enable** for each API

### 4. Create or Verify API Key

1. Go to **APIs & Services** → **Credentials**
2. If you need to create a new key:
   - Click **Create Credentials** → **API Key**
   - Copy the generated key
   - Update your `.env` file: `VITE_GOOGLE_MAPS_API_KEY=your-new-key-here`

### 5. Configure API Key Restrictions (Recommended for Production)

#### Application Restrictions
1. Click on your API key to edit it
2. Under **Application restrictions**, choose one:
   - **HTTP referrers (websites)** for web applications
   - Add your domain(s): `*.yourdomain.com/*`
   - For development, add: `localhost:*`

#### API Restrictions
1. Under **API restrictions**, select **Restrict key**
2. Choose these APIs:
   - Maps JavaScript API
   - Places API
   - Geocoding API

### 6. Verify Configuration

After completing the setup:

1. Wait 2-5 minutes for changes to propagate
2. Clear your browser cache
3. Reload your application
4. Test the address autocomplete in the Travel Calculator

## Common Issues

### "This page can't load Google Maps correctly"

**Causes:**
- Billing not enabled (most common)
- API not enabled
- API key restrictions blocking your domain
- Daily quota exceeded

**Solutions:**
1. Enable billing on your GCP project
2. Enable all three required APIs (Maps JavaScript, Places, Geocoding)
3. Check if your domain is allowed in HTTP referrer restrictions
4. Check quota limits in GCP Console → APIs & Services → Quotas

### API Key Not Working

1. Ensure the key is saved in `.env` with the exact variable name: `VITE_GOOGLE_MAPS_API_KEY`
2. Restart your development server after changing `.env`
3. Check that the key has no extra spaces or characters
4. Verify the APIs are enabled in GCP Console

### "RefererNotAllowedMapError"

This means your domain isn't allowed by the API key restrictions:
1. Go to GCP Console → APIs & Services → Credentials
2. Edit your API key
3. Under Application restrictions → HTTP referrers
4. Add your domain or use `*` to allow all domains (not recommended for production)

## Cost Considerations

- Google provides $200/month in free credits
- Maps JavaScript API: $7 per 1,000 requests (covered by free tier)
- Places API (Autocomplete): $2.83 per 1,000 requests (covered by free tier)
- Geocoding API: $5 per 1,000 requests (covered by free tier)

Typical usage for this application should stay well within the free tier.

## Testing

To verify your setup is working:

1. Navigate to Admin Dashboard → Travel Calculator
2. Click in the "Customer Address" field
3. Start typing an address
4. You should see autocomplete suggestions appear
5. No error messages should appear in the browser console

## Support

If you continue to have issues:

1. Check the browser console for specific error messages
2. Verify billing is active in GCP Console
3. Confirm all three APIs are enabled
4. Wait 5 minutes and try again (changes can take time to propagate)
5. Try using a fresh API key if problems persist

## Security Best Practices

For production deployments:

1. **Always use application restrictions** (HTTP referrers)
2. **Always use API restrictions** (limit to only needed APIs)
3. **Set up billing alerts** in GCP to monitor usage
4. **Never commit API keys to version control** (use environment variables)
5. **Rotate keys regularly** (every 90 days recommended)

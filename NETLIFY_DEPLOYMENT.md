# Netlify Deployment Guide for Bounce Party Club

## Prerequisites

1. **GitHub Account** - Your code should be in a GitHub repository
2. **Netlify Account** - Sign up at https://netlify.com (free tier is fine)
3. **Environment Variables Ready** - Have your Supabase credentials ready:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_STRIPE_PUBLISHABLE_KEY`

## Step-by-Step Deployment Instructions

### Step 1: Prepare Your Repository

1. **Ensure your code is committed to GitHub**
   ```bash
   git add .
   git commit -m "Prepare for Netlify deployment"
   git push origin main
   ```

2. **Verify your `package.json` has the correct build script**
   - Should contain: `"build": "vite build"`
   - Should contain: `"preview": "vite preview"`

### Step 2: Connect to Netlify

1. **Go to Netlify Dashboard**
   - Visit https://app.netlify.com/
   - Log in or create an account

2. **Add New Site**
   - Click "Add new site" → "Import an existing project"
   - Choose "Deploy with GitHub"
   - Authorize Netlify to access your GitHub account

3. **Select Your Repository**
   - Find and select your Bounce Party Club repository
   - Click on it to proceed

### Step 3: Configure Build Settings

1. **Build Settings**
   - **Branch to deploy**: `main` (or your default branch)
   - **Build command**: `npm run build`
   - **Publish directory**: `dist`
   - **Base directory**: (leave empty)

2. **Click "Show advanced"** to add environment variables

### Step 4: Add Environment Variables

Click "Add environment variable" for each of these:

1. **VITE_SUPABASE_URL**
   - Value: Your Supabase project URL (e.g., `https://xxxxx.supabase.co`)

2. **VITE_SUPABASE_ANON_KEY**
   - Value: Your Supabase anon/public key

3. **VITE_STRIPE_PUBLISHABLE_KEY**
   - Value: Your Stripe publishable key (starts with `pk_`)

### Step 5: Deploy

1. **Click "Deploy [your-site-name]"**
   - Netlify will start building your site
   - This takes 2-5 minutes typically

2. **Monitor the Build**
   - You'll see a build log in real-time
   - Wait for "Site is live" message

### Step 6: Configure Redirects for SPA

Your app needs proper routing. Create or verify you have a `netlify.toml` in your project root:

```toml
# netlify.toml
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

**If you need to add this file:**
1. Add it to your repository
2. Commit and push
3. Netlify will automatically redeploy

### Step 7: Test Your Deployment

1. **Get Your Site URL**
   - Netlify provides a URL like: `https://your-site-name.netlify.app`
   - This is shown at the top of your site dashboard

2. **Test Core Functionality**
   - Visit the site URL
   - Test the quote form
   - Try creating a booking
   - Test Stripe checkout (the new bridge flow should work!)

### Step 8: Custom Domain (Optional)

1. **In Netlify Dashboard**
   - Go to "Domain settings"
   - Click "Add custom domain"
   - Follow instructions to configure DNS

2. **SSL Certificate**
   - Netlify automatically provisions SSL certificates
   - This takes a few minutes after domain setup

## Troubleshooting

### Build Fails

**Error: "Command failed with exit code 1"**
- Check the build log for specific errors
- Common issues:
  - TypeScript errors: Fix in code and push
  - Missing dependencies: Check `package.json`
  - Node version: Netlify uses Node 18 by default

**To specify Node version:**
Add to `package.json`:
```json
{
  "engines": {
    "node": "18.x"
  }
}
```

### Site Loads But Shows Blank Page

1. **Check Browser Console** (F12)
   - Look for errors
   - Common: Environment variables not set correctly

2. **Verify Environment Variables**
   - In Netlify: Site settings → Environment variables
   - Make sure all `VITE_` prefixed variables are set
   - **Important**: After changing env vars, you must redeploy!

### Stripe Checkout Not Working

1. **Check Supabase Edge Functions Are Deployed**
   - Your edge functions (`stripe-checkout`, `checkout-bridge`) must be deployed to Supabase
   - These are separate from Netlify deployment

2. **Verify Stripe Keys**
   - Test mode keys start with `pk_test_` and `sk_test_`
   - Live mode keys start with `pk_live_` and `sk_live_`
   - Make sure you're using the correct environment

3. **Check CORS**
   - Add your Netlify domain to allowed origins if needed
   - The edge functions should already have `Access-Control-Allow-Origin: *`

### Routing Issues (404 on Refresh)

- Make sure you have `netlify.toml` configured (see Step 6)

### Static Files Not Loading

**Paths are broken:**
- Make sure you're using relative paths or `import.meta.env.BASE_URL`
- In Vite, use `/file.html` for public files (not `./file.html`)

## Post-Deployment Checklist

- [ ] Site loads without errors
- [ ] Environment variables are set correctly
- [ ] Quote form works
- [ ] Can create bookings
- [ ] Stripe checkout opens in new window
- [ ] After payment, bridge page redirects back correctly
- [ ] Booking confirmation page shows
- [ ] Admin panel accessible (if you have auth set up)
- [ ] All images/assets load correctly
- [ ] Mobile responsive (test on phone)

## Continuous Deployment

Once set up, Netlify automatically:
- Watches your GitHub repository
- Builds and deploys on every push to main branch
- Provides deploy previews for pull requests

**To manually trigger a deploy:**
- Netlify Dashboard → Deploys → "Trigger deploy" → "Deploy site"

## Important Notes

1. **Supabase Edge Functions**
   - These are hosted on Supabase, NOT Netlify
   - Already deployed separately using the MCP tools
   - Your Netlify site calls them via the Supabase URL

2. **Environment Variables**
   - All client-side env vars MUST start with `VITE_`
   - They are baked into the build at build time
   - Changing them requires a new deploy

3. **Stripe Webhooks**
   - If using Stripe webhooks, point them to your Supabase function URL
   - Format: `https://[your-project].supabase.co/functions/v1/stripe-webhook`

## Getting Help

**Netlify Deploy Logs:**
- Site Dashboard → Deploys → Click on a deploy → Scroll down to see full log

**Common Commands to Run Locally:**
```bash
# Test production build locally
npm run build
npm run preview

# This simulates what Netlify will build
```

**Netlify Support:**
- Netlify Forums: https://answers.netlify.com/
- Docs: https://docs.netlify.com/

## Success!

Your site should now be live at `https://your-site-name.netlify.app`

The Stripe checkout flow will:
1. Open in a new window
2. Process payment with Stripe
3. Redirect to Supabase bridge page
4. Bridge posts message back to main window
5. Main window navigates to booking confirmation

This works perfectly in both development and production!

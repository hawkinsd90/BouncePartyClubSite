import { createClient } from 'npm:@supabase/supabase-js@2';

export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  retry_after?: number;
  requests_remaining?: number;
  reset_at?: number;
}

export interface RateLimitConfig {
  maxRequests: number;
  windowSeconds: number;
}

export const RATE_LIMIT_CONFIGS: Record<string, RateLimitConfig> = {
  'stripe-checkout': { maxRequests: 5, windowSeconds: 60 },
  'stripe-charge': { maxRequests: 3, windowSeconds: 60 },
  'stripe-refund': { maxRequests: 2, windowSeconds: 60 },
  'customer-balance-payment': { maxRequests: 5, windowSeconds: 60 },
  'charge-deposit': { maxRequests: 3, windowSeconds: 60 },
  'customer-cancel-order': { maxRequests: 3, windowSeconds: 300 },
  'save-signature': { maxRequests: 5, windowSeconds: 60 },
  'send-invoice': { maxRequests: 10, windowSeconds: 60 },
  'send-sms-notification': { maxRequests: 20, windowSeconds: 60 },
};

export function getIdentifier(req: Request): string {
  const forwardedFor = req.headers.get('x-forwarded-for');
  const realIp = req.headers.get('x-real-ip');

  if (forwardedFor) {
    const ips = forwardedFor.split(',').map(ip => ip.trim());
    const firstIp = ips[0];
    // Basic validation - ensure it looks like an IP
    if (firstIp && /^[\d.:a-fA-F]+$/.test(firstIp)) {
      return firstIp;
    }
  }

  if (realIp && /^[\d.:a-fA-F]+$/.test(realIp)) {
    return realIp;
  }

  return ''; // Empty string instead of 'unknown' - caller must handle
}

export function buildRateLimitKey(ip: string, secondaryId?: string, prefix?: string): string {
  const parts: string[] = [];

  if (prefix) parts.push(prefix);
  if (ip) parts.push(`ip:${ip}`);
  if (secondaryId) parts.push(`id:${secondaryId}`);

  return parts.join('|');
}

export async function checkRateLimit(
  endpoint: string,
  identifier: string,
  customConfig?: Partial<RateLimitConfig>,
  requireIdentifier: boolean = false
): Promise<RateLimitResult> {
  // Enforce identifier requirement for payment endpoints
  if (requireIdentifier && !identifier) {
    return {
      allowed: false,
      reason: 'missing_identifier',
    };
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const config = customConfig
      ? { ...RATE_LIMIT_CONFIGS[endpoint], ...customConfig }
      : RATE_LIMIT_CONFIGS[endpoint] || { maxRequests: 10, windowSeconds: 60 };

    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_identifier: identifier,
      p_endpoint: endpoint,
      p_max_requests: config.maxRequests,
      p_window_seconds: config.windowSeconds,
    });

    if (error) {
      console.error('Rate limit check error:', error);
      return { allowed: true };
    }

    return data as RateLimitResult;
  } catch (error) {
    console.error('Rate limit check failed:', error);
    return { allowed: true };
  }
}

export function createRateLimitResponse(result: RateLimitResult, corsHeaders: Record<string, string>): Response {
  const headers = {
    ...corsHeaders,
    'Content-Type': 'application/json',
    'Retry-After': result.retry_after?.toString() || '60',
  };

  if (result.requests_remaining !== undefined) {
    headers['X-RateLimit-Remaining'] = result.requests_remaining.toString();
  }

  if (result.reset_at !== undefined) {
    headers['X-RateLimit-Reset'] = result.reset_at.toString();
  }

  const message = result.reason === 'temporarily_blocked'
    ? 'Too many requests. You have been temporarily blocked. Please try again later.'
    : 'Rate limit exceeded. Please try again later.';

  return new Response(
    JSON.stringify({
      error: message,
      retry_after: result.retry_after
    }),
    {
      status: 429,
      headers
    }
  );
}

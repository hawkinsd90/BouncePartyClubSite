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
    return ips[0];
  }

  if (realIp) {
    return realIp;
  }

  return 'unknown';
}

export async function checkRateLimit(
  endpoint: string,
  identifier: string,
  customConfig?: Partial<RateLimitConfig>
): Promise<RateLimitResult> {
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

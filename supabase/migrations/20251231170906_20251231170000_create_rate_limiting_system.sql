/*
  # Create Rate Limiting System

  1. New Tables
    - `rate_limits`
      - `id` (uuid, primary key)
      - `identifier` (text) - IP address or user ID
      - `endpoint` (text) - The endpoint being rate limited
      - `request_count` (integer) - Number of requests in current window
      - `window_start` (timestamptz) - Start of the current rate limit window
      - `blocked_until` (timestamptz) - Optional block timestamp for temporary bans
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Functions
    - `check_rate_limit(identifier, endpoint, max_requests, window_seconds)` - Returns true if request should be allowed
    - `cleanup_old_rate_limits()` - Removes expired rate limit entries

  3. Security
    - Enable RLS on `rate_limits` table
    - Only service role can access rate limits (edge functions)

  4. Performance
    - Index on (identifier, endpoint) for fast lookups
    - Automatic cleanup of old entries
*/

-- Create rate_limits table
CREATE TABLE IF NOT EXISTS rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  endpoint text NOT NULL,
  request_count integer DEFAULT 1,
  window_start timestamptz DEFAULT now(),
  blocked_until timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup
  ON rate_limits(identifier, endpoint, window_start DESC);

CREATE INDEX IF NOT EXISTS idx_rate_limits_cleanup
  ON rate_limits(window_start);

-- Enable RLS
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- Only service role can access (no policies needed - edge functions use service role)

-- Function to check and update rate limits
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_identifier text,
  p_endpoint text,
  p_max_requests integer DEFAULT 10,
  p_window_seconds integer DEFAULT 60
) RETURNS jsonb AS $$
DECLARE
  v_current_window timestamptz;
  v_window_start timestamptz;
  v_record rate_limits%ROWTYPE;
  v_requests_in_window integer;
  v_blocked_until timestamptz;
BEGIN
  v_current_window := now();

  -- Check if identifier is currently blocked
  SELECT blocked_until INTO v_blocked_until
  FROM rate_limits
  WHERE identifier = p_identifier
    AND endpoint = p_endpoint
    AND blocked_until > v_current_window
  ORDER BY blocked_until DESC
  LIMIT 1;

  IF v_blocked_until IS NOT NULL THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'temporarily_blocked',
      'retry_after', EXTRACT(EPOCH FROM (v_blocked_until - v_current_window))::integer
    );
  END IF;

  -- Get or create rate limit record for current window
  SELECT * INTO v_record
  FROM rate_limits
  WHERE identifier = p_identifier
    AND endpoint = p_endpoint
    AND window_start > (v_current_window - (p_window_seconds || ' seconds')::interval)
  ORDER BY window_start DESC
  LIMIT 1;

  IF v_record.id IS NULL THEN
    -- No recent record, create new one
    INSERT INTO rate_limits (identifier, endpoint, request_count, window_start)
    VALUES (p_identifier, p_endpoint, 1, v_current_window)
    RETURNING * INTO v_record;

    RETURN jsonb_build_object(
      'allowed', true,
      'requests_remaining', p_max_requests - 1,
      'reset_at', EXTRACT(EPOCH FROM (v_current_window + (p_window_seconds || ' seconds')::interval))::integer
    );
  ELSE
    -- Check if we're still in the same window
    v_window_start := v_record.window_start;

    IF v_current_window < (v_window_start + (p_window_seconds || ' seconds')::interval) THEN
      -- Still in same window, check count
      IF v_record.request_count >= p_max_requests THEN
        -- Rate limit exceeded, optionally block for repeat offenders
        IF v_record.request_count >= (p_max_requests * 3) THEN
          -- Block for 5 minutes after excessive attempts
          UPDATE rate_limits
          SET blocked_until = v_current_window + interval '5 minutes',
              updated_at = v_current_window
          WHERE id = v_record.id;

          RETURN jsonb_build_object(
            'allowed', false,
            'reason', 'rate_limit_exceeded_blocked',
            'retry_after', 300
          );
        END IF;

        -- Just rate limited, update count
        UPDATE rate_limits
        SET request_count = request_count + 1,
            updated_at = v_current_window
        WHERE id = v_record.id;

        RETURN jsonb_build_object(
          'allowed', false,
          'reason', 'rate_limit_exceeded',
          'retry_after', EXTRACT(EPOCH FROM ((v_window_start + (p_window_seconds || ' seconds')::interval) - v_current_window))::integer
        );
      ELSE
        -- Increment count
        UPDATE rate_limits
        SET request_count = request_count + 1,
            updated_at = v_current_window
        WHERE id = v_record.id;

        RETURN jsonb_build_object(
          'allowed', true,
          'requests_remaining', p_max_requests - (v_record.request_count + 1),
          'reset_at', EXTRACT(EPOCH FROM (v_window_start + (p_window_seconds || ' seconds')::interval))::integer
        );
      END IF;
    ELSE
      -- Window expired, create new record
      INSERT INTO rate_limits (identifier, endpoint, request_count, window_start)
      VALUES (p_identifier, p_endpoint, 1, v_current_window);

      RETURN jsonb_build_object(
        'allowed', true,
        'requests_remaining', p_max_requests - 1,
        'reset_at', EXTRACT(EPOCH FROM (v_current_window + (p_window_seconds || ' seconds')::interval))::integer
      );
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- Function to cleanup old rate limit entries (call periodically)
CREATE OR REPLACE FUNCTION cleanup_old_rate_limits() RETURNS void AS $$
BEGIN
  DELETE FROM rate_limits
  WHERE window_start < (now() - interval '1 hour')
    AND (blocked_until IS NULL OR blocked_until < now());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

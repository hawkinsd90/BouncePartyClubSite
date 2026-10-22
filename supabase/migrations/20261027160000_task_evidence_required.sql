/*
  # Required delivery / pickup photo evidence, with a controlled Admin override (NI-11 / WP-32, M-5)

  ## Rule
  A task (delivery or pickup) cannot be moved to "completed" by a signed-in crew or admin session unless at least one proof photo is
  stored for it (task_status.delivery_images), or an Admin has recorded an override for that task. The owner can relax the rule per
  kind with the settings require_delivery_photo / require_pickup_photo (seeded 'true' by the start-mileage migration; a missing or
  unreadable value counts as required).

  ## What this adds
  - Table public.task_evidence_overrides: one row per task that an Admin released without a photo (who, why, when). No direct write
    access for anyone: rows are created only by the Admin-only function below. Admins can read it.
  - Trigger public.enforce_task_evidence() on public.task_status: BEFORE INSERT/UPDATE, only for the transition into 'completed'.
    It applies to the browser roles (authenticated, anon). The backend (service_role), migrations and maintenance sessions are not
    affected, and rows that are already completed are never re-checked, so existing tasks are unaffected.
  - public.get_task_evidence_state(task_status_id): crew/admin can ask "is a photo required, how many exist, is it overridden".
  - public.override_task_evidence(task_status_id, reason): Admin/Master only, reason of at least 10 characters.

  ## Security
  - SECURITY DEFINER with search_path = public. The trigger and the helper are not callable by browser roles.
  - Crew cannot create or read overrides; they can only see the state of a task.
  - Additive and idempotent; rollback = drop the trigger (the table and functions are inert without it).
*/

CREATE TABLE IF NOT EXISTS public.task_evidence_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_status_id uuid NOT NULL UNIQUE REFERENCES public.task_status(id) ON DELETE CASCADE,
  order_id uuid NOT NULL,
  task_type text NOT NULL,
  actor_id uuid NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) >= 10),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.task_evidence_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read evidence overrides" ON public.task_evidence_overrides;
CREATE POLICY "Admins can read evidence overrides"
  ON public.task_evidence_overrides
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

REVOKE ALL ON TABLE public.task_evidence_overrides FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.task_evidence_overrides TO authenticated;
GRANT ALL ON TABLE public.task_evidence_overrides TO service_role;

-- Whether a photo is required for this kind of task. Only an explicit 'false' turns the requirement off.
CREATE OR REPLACE FUNCTION public.task_evidence_required(p_task_type text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT COALESCE(
    (SELECT lower(btrim(value)) = 'false'
       FROM public.admin_settings
      WHERE key = CASE WHEN p_task_type = 'pick-up' THEN 'require_pickup_photo' ELSE 'require_delivery_photo' END),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.task_evidence_photo_count(p_images jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN jsonb_typeof(p_images) = 'array' THEN jsonb_array_length(p_images) ELSE 0 END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_task_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := current_setting('role', true);
BEGIN
  -- Only the move INTO 'completed' is checked (rows that are already completed stay as they are).
  IF NEW.status IS DISTINCT FROM 'completed' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'completed' THEN
    RETURN NEW;
  END IF;

  -- Browser roles only. The backend (service_role), migrations and maintenance sessions run as other roles.
  IF v_role IS NULL OR v_role NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF NOT public.task_evidence_required(NEW.task_type) THEN
    RETURN NEW;
  END IF;

  IF public.task_evidence_photo_count(NEW.delivery_images) >= 1 THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.task_evidence_overrides o WHERE o.task_status_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'EVIDENCE_REQUIRED: a photo of the % is required before this task can be completed', CASE WHEN NEW.task_type = 'pick-up' THEN 'pickup' ELSE 'delivery' END
    USING ERRCODE = 'P0001', HINT = 'EVIDENCE_REQUIRED';
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_task_evidence ON public.task_status;
CREATE TRIGGER trg_enforce_task_evidence
  BEFORE INSERT OR UPDATE ON public.task_status
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_task_evidence();

CREATE OR REPLACE FUNCTION public.get_task_evidence_state(p_task_status_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task record;
  v_required boolean;
  v_photos integer;
  v_overridden boolean;
BEGIN
  IF NOT public.is_crew_or_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT id, task_type, delivery_images INTO v_task FROM public.task_status WHERE id = p_task_status_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_required := public.task_evidence_required(v_task.task_type);
  v_photos := public.task_evidence_photo_count(v_task.delivery_images);
  v_overridden := EXISTS (SELECT 1 FROM public.task_evidence_overrides o WHERE o.task_status_id = v_task.id);

  RETURN jsonb_build_object(
    'required', v_required,
    'photo_count', v_photos,
    'overridden', v_overridden,
    'can_complete', (NOT v_required) OR v_photos >= 1 OR v_overridden
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.override_task_evidence(p_task_status_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task record;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR char_length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'A reason of at least 10 characters is required' USING ERRCODE = '22023';
  END IF;

  SELECT id, order_id, task_type INTO v_task FROM public.task_status WHERE id = p_task_status_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.task_evidence_overrides (task_status_id, order_id, task_type, actor_id, reason)
  VALUES (v_task.id, v_task.order_id, v_task.task_type, auth.uid(), btrim(p_reason))
  ON CONFLICT (task_status_id) DO NOTHING;

  RETURN jsonb_build_object('overridden', true);
END;
$$;

REVOKE ALL ON FUNCTION public.task_evidence_required(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.task_evidence_photo_count(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_task_evidence() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_task_evidence_state(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.override_task_evidence(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_evidence_required(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.task_evidence_photo_count(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_task_evidence_state(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.override_task_evidence(uuid, text) TO authenticated, service_role;

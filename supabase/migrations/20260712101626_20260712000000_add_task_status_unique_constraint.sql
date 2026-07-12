ALTER TABLE public.task_status
  ADD CONSTRAINT task_status_order_task_type_task_date_key
  UNIQUE (order_id, task_type, task_date);

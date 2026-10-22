// A future booking of an inflatable unit, as the delete / deactivate warnings select it (order_items joined to orders). Type-only.
export interface FutureBooking {
  order_id: string;
  orders: { id: string; order_number: string; event_date: string; event_end_date: string; status: string; customer_name: string };
}

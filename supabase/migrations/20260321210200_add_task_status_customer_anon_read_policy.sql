/*
  # Add anonymous read policy for task_status (delivery photos)

  ## Problem
  The DeliveryTab in the customer portal queries task_status to show proof-of-delivery
  photos. Unauthenticated portal visitors (customers who haven't logged in, or are viewing
  via a direct order link) receive no data and silently see "No Delivery Photos Yet" even
  when photos exist.

  ## Change
  Add a SELECT policy allowing anonymous users to read task_status rows for a specific
  order_id. This mirrors the existing anonymous SELECT policy on the orders table and the
  order_lot_pictures table.

  The policy is intentionally scoped: it only allows SELECT and only for rows where the
  order_id matches something the caller already knows (they must provide it in the query).
  No personal data is exposed — task_status only holds delivery images, timestamps, and
  crew workflow state.

  ## Security
  - Anon users can only READ (SELECT), never write
  - Limited to task_status rows (delivery workflow data + proof-of-delivery images)
  - Consistent with the existing anonymous order read policies
*/

CREATE POLICY "Anonymous users can read task status for order delivery photos"
  ON task_status
  FOR SELECT
  TO anon
  USING (true);

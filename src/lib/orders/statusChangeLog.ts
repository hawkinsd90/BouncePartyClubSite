// The order_changelog row written when an Admin changes an order's status from the status dialog.
//
// Only columns that exist in the database are used: order_id, user_id, change_type, field_changed, old_value, new_value (and notes).
// The dialog used to send `field_name` and `changed_by`, which are not columns: the insert was refused after the status had already been
// updated, so the Admin saw "Failed to update status" for a change that had in fact been made.
export interface StatusChangeLogRow {
  order_id: string;
  change_type: 'status_change';
  field_changed: 'status';
  old_value: string;
  new_value: string;
  user_id: string | null;
}

export function statusChangeLogRow(input: {
  orderId: string;
  currentStatus: string;
  pendingStatus: string;
  reason: string;
  userId: string | null;
}): StatusChangeLogRow {
  const reason = input.reason.trim();
  const reasonSuffix = reason ? ` (Reason: ${reason})` : '';
  return {
    order_id: input.orderId,
    change_type: 'status_change',
    field_changed: 'status',
    old_value: input.currentStatus,
    new_value: `${input.pendingStatus}${reasonSuffix}`,
    user_id: input.userId,
  };
}

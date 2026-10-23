// The Admin SMS template screens' database contract. The table is public.sms_message_templates with the columns
// id, template_key, template_name, message_template, description, created_at, updated_at (the column that holds the text is message_template; the
// name used by sms_conversations is a different table's column and does not exist here). The SMS-sending Edge Functions (send-sms-notification, customer-cancel-order) read `message_template` by `template_key`.
// Only Admin / master sessions may read or write the table (policy "Admin and master manage SMS templates").

export const SMS_TEMPLATE_SELECT = 'id, template_key, template_name, message_template, description';

export interface SmsTemplate {
  id: string;
  template_name: string;
  description: string | null;
  message_template: string;
}

// The one update the screens make: the message text, nothing else (id, key, name, description are never rewritten from the browser).
export function smsTemplateUpdate(messageTemplate: string): { message_template: string } {
  return { message_template: messageTemplate };
}

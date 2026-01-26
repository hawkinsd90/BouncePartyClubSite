const fs = require('fs');
const path = require('path');

const files = [
  'src/lib/orderCreation.ts',
  'src/lib/orderEmailTemplates.ts',
  'src/lib/orderApprovalService.ts',
  'src/lib/bookingEmailTemplates.ts',
  'src/lib/orderNotificationService.ts',
  'src/hooks/useCalendarTasks.ts',
  'src/components/admin/ChangelogTab.tsx',
  'supabase/functions/send-sms-notification/index.ts',
  'supabase/functions/customer-cancel-order/index.ts',
  'supabase/functions/customer-balance-payment/index.ts',
];

files.forEach(filePath => {
  if (!fs.existsSync(filePath)) {
    console.log(`Skipping ${filePath} - not found`);
    return;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  // Replace order.id.slice(0, 8).toUpperCase() with formatOrderId(order.id)
  if (content.match(/order\.id\.slice\(0,\s*8\)\.toUpperCase\(\)/)) {
    content = content.replace(/order\.id\.slice\(0,\s*8\)\.toUpperCase\(\)/g, 'formatOrderId(order.id)');
    modified = true;
  }

  // Replace orderId.slice(0, 8).toUpperCase() with formatOrderId(orderId)
  if (content.match(/orderId\.slice\(0,\s*8\)\.toUpperCase\(\)/)) {
    content = content.replace(/orderId\.slice\(0,\s*8\)\.toUpperCase\(\)/g, 'formatOrderId(orderId)');
    modified = true;
  }

  // Replace payment.id.slice(0, 8).toUpperCase() with formatOrderId(payment.id)
  if (content.match(/payment\.id\.slice\(0,\s*8\)\.toUpperCase\(\)/)) {
    content = content.replace(/payment\.id\.slice\(0,\s*8\)\.toUpperCase\(\)/g, 'formatOrderId(payment.id)');
    modified = true;
  }

  // Replace orderWithItems.id.slice(0, 8).toUpperCase()
  if (content.match(/orderWithItems\.id\.slice\(0,\s*8\)\.toUpperCase\(\)/)) {
    content = content.replace(/orderWithItems\.id\.slice\(0,\s*8\)\.toUpperCase\(\)/g, 'formatOrderId(orderWithItems.id)');
    modified = true;
  }

  // Replace .substring(0, 8)... with formatOrderId and remove ...
  if (content.match(/\.substring\(0,\s*8\)\.\.\./)) {
    content = content.replace(/(\w+)\.substring\(0,\s*8\)\.\.\./g, 'formatOrderId($1)');
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✓ Fixed ${filePath}`);
  } else {
    console.log(`- No changes needed for ${filePath}`);
  }
});

console.log('Done!');

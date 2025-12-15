# Email Template System Documentation

## Overview

The Bounce Party Club application uses a unified email template system to ensure consistent branding and styling across all customer communications. All email templates are built using reusable components defined in `/src/lib/emailTemplateBase.ts`.

## Core Concepts

### Design Principles

1. **Consistency**: All emails share the same visual language, fonts, colors, and layout structure
2. **Maintainability**: Change styles in one place to update all emails
3. **Reusability**: Compose emails from pre-built, tested components
4. **Responsive**: Table-based layout ensures compatibility across email clients
5. **Branded**: Every email includes the company logo, colors, and contact information

### Visual Elements

- **Logo**: Company logo at the top of every email
- **Themed Headers**: Color-coded headers based on email purpose (blue for info, green for success, red for errors)
- **Consistent Typography**: System fonts for maximum compatibility
- **Professional Footer**: Company contact information at bottom
- **Responsive Width**: 600px content width for optimal mobile/desktop viewing

## File Structure

```
src/lib/
├── emailTemplateBase.ts           # Core template components and utilities
├── bookingEmailTemplates.ts       # Customer & admin booking notifications
├── orderEmailTemplates.ts         # Confirmation receipts and order updates
└── orderNotificationService.ts    # Order update notifications

supabase/functions/
└── send-error-notification/       # Error notification emails (edge function)
```

## Available Components

### 1. `createEmailWrapper()`

Creates the outer HTML structure with logo, header, content, and footer.

**Parameters:**
- `title` (string): HTML page title
- `headerTitle` (string): Main heading text
- `content` (string): HTML content to display
- `theme?` (EmailTheme): Color theme (default: primary)

**Example:**
```typescript
const html = createEmailWrapper({
  title: 'Booking Confirmed',
  headerTitle: 'Booking Confirmed!',
  content: '...',
  theme: EMAIL_THEMES.success,
});
```

### 2. `createGreeting()`

Generates a personalized greeting.

**Parameters:**
- `firstName` (string): Customer's first name

**Returns:** `<p>Hi {firstName},</p>`

### 3. `createParagraph()`

Creates a styled paragraph.

**Parameters:**
- `text` (string): Paragraph content

**Returns:** Formatted paragraph with consistent styling

### 4. `createInfoBox()`

Creates a color-coded information box with key-value pairs.

**Parameters:**
- `title` (string): Box heading
- `rows` (Array): Array of `{label, value}` objects
- `theme?` (EmailTheme): Color scheme

**Example:**
```typescript
createInfoBox({
  title: 'Event Details',
  rows: [
    { label: 'Order ID', value: '#AB12CD34' },
    { label: 'Date', value: 'Saturday, January 15, 2025' },
  ],
  theme: EMAIL_THEMES.primary,
});
```

### 5. `createItemsTable()`

Displays order items in a table format.

**Parameters:**
- `title` (string): Table heading
- `items` (Array): Array of `{description, amount}` objects

**Example:**
```typescript
createItemsTable({
  title: 'Order Items',
  items: [
    { description: '2x Bounce House (Wet)', amount: '$200.00' },
    { description: '1x Water Slide (Dry)', amount: '$150.00' },
  ],
});
```

### 6. `createPricingSummary()`

Creates a pricing breakdown table with optional highlights.

**Parameters:**
- `title` (string): Section heading
- `rows` (Array): Array of pricing rows with optional `bold` and `highlight` flags

**Example:**
```typescript
createPricingSummary({
  title: 'Payment Summary',
  rows: [
    { label: 'Subtotal', value: '$350.00' },
    { label: 'Tax', value: '$21.00' },
    { label: 'Total', value: '$371.00', bold: true },
    { label: 'Deposit Paid', value: '$185.50', bold: true, highlight: true },
  ],
});
```

### 7. `createAlertBox()`

Creates an alert/notice box with themed styling.

**Parameters:**
- `title` (string): Alert heading
- `message` (string): Alert content
- `type?` ('warning' | 'info' | 'success' | 'danger'): Alert type

**Example:**
```typescript
createAlertBox({
  title: 'Action Required',
  message: 'Please review the updated details and approve or request changes.',
  type: 'warning',
});
```

### 8. `createButton()`

Creates a styled call-to-action button.

**Parameters:**
- `text` (string): Button label
- `url` (string): Link destination
- `theme?` (EmailTheme): Button color theme

**Example:**
```typescript
createButton({
  text: 'Review Order Changes',
  url: 'https://example.com/portal/123',
  theme: EMAIL_THEMES.primary,
});
```

### 9. `createBulletList()`

Creates a themed bullet list.

**Parameters:**
- `items` (string[]): List items
- `theme?` ('warning' | 'info' | 'success'): List theme

**Example:**
```typescript
createBulletList({
  items: [
    'Our team will review your request',
    'You will receive confirmation within 24 hours',
  ],
  theme: 'info',
});
```

### 10. `createContactInfo()`

Adds company contact information with phone number.

**Parameters:**
- `message?` (string): Custom message (default: shows phone number)

## Theme System

### Available Themes

```typescript
EMAIL_THEMES.primary   // Blue - General information
EMAIL_THEMES.success   // Green - Confirmations, success messages
EMAIL_THEMES.warning   // Amber - Warnings, action required
EMAIL_THEMES.danger    // Red - Errors, rejections, urgent
```

### Theme Properties

Each theme includes:
- `borderColor`: Main border color
- `headerColor`: Header text color
- `accentColor`: Accent text color
- `bgColor`: Background color for info boxes

### Constants

```typescript
LOGO_URL          // Company logo URL
COMPANY_PHONE     // (313) 889-3860
COMPANY_ADDRESS   // 4426 Woodward Ave, Wayne, MI 48184
THEME_COLORS      // Color palette object
```

## Creating New Email Templates

### Example: Customer Notification

```typescript
import {
  createEmailWrapper,
  createGreeting,
  createParagraph,
  createInfoBox,
  createButton,
  EMAIL_THEMES,
} from './emailTemplateBase';

export function generateCustomNotificationEmail(
  customerName: string,
  orderId: string
): string {
  let content = createGreeting(customerName);

  content += createParagraph(
    'We have an update regarding your order.'
  );

  content += createInfoBox({
    title: 'Order Information',
    rows: [
      { label: 'Order ID', value: orderId },
      { label: 'Status', value: 'Processing' },
    ],
    theme: EMAIL_THEMES.primary,
  });

  content += createButton({
    text: 'View Order Details',
    url: `https://example.com/orders/${orderId}`,
    theme: EMAIL_THEMES.primary,
  });

  return createEmailWrapper({
    title: 'Order Update',
    headerTitle: 'Order Update',
    content,
    theme: EMAIL_THEMES.primary,
  });
}
```

## Email Types

### Customer Emails

1. **Booking Request Received** (`bookingEmailTemplates.ts`)
   - Theme: Primary (blue)
   - Sent when customer submits booking
   - Contains event details, items, and pricing

2. **Booking Confirmed** (`orderEmailTemplates.ts`)
   - Theme: Success (green)
   - Sent after deposit payment processed
   - Includes payment receipt and next steps

3. **Order Update** (`orderNotificationService.ts`)
   - Theme: Primary (blue)
   - Sent when admin modifies order
   - Includes admin message and approval link

### Admin Emails

1. **New Booking Request** (`bookingEmailTemplates.ts`)
   - Theme: Danger (red for urgency)
   - Sent to admin when new booking arrives
   - Contains customer info and event details

2. **Error Notifications** (`send-error-notification/index.ts`)
   - Theme: Danger (red)
   - Sent when application errors occur
   - Includes stack traces and environment info

## Best Practices

### Do's

✅ Use the unified template system for all emails
✅ Choose appropriate theme colors for email purpose
✅ Include relevant customer information
✅ Provide clear calls-to-action with buttons
✅ Test emails across different email clients
✅ Keep content concise and scannable
✅ Always include company contact information

### Don'ts

❌ Create inline HTML emails outside the system
❌ Use inconsistent styling or fonts
❌ Forget to escape HTML special characters
❌ Make emails longer than necessary
❌ Use unclear or vague button text
❌ Include sensitive information without encryption

## Extending the System

### Adding New Components

1. Add function to `emailTemplateBase.ts`
2. Follow existing naming convention (`create[ComponentName]`)
3. Accept parameters object for flexibility
4. Return HTML string with inline styles
5. Use consistent spacing and colors
6. Document parameters and usage

### Adding New Themes

```typescript
// In emailTemplateBase.ts
export const EMAIL_THEMES: Record<string, EmailTheme> = {
  // ... existing themes
  custom: {
    borderColor: '#your-color',
    headerColor: '#your-color',
    accentColor: '#your-color',
    bgColor: '#your-color',
  },
};
```

## Testing

### Manual Testing

1. Generate email HTML using template function
2. Save to `.html` file
3. Open in browser to preview
4. Test in email clients:
   - Gmail (web & mobile)
   - Outlook (desktop & web)
   - Apple Mail (desktop & iOS)
   - Android email clients

### Integration Testing

```typescript
// Test email generation
const html = generateCustomerBookingEmail(testOrderData);
expect(html).toContain('Booking Request Received!');
expect(html).toContain(testOrderData.customer.first_name);
```

## Troubleshooting

### Common Issues

**Issue**: Styles not rendering in email client
- **Solution**: Use inline styles only (no external CSS)
- **Solution**: Use table-based layouts, not flexbox/grid

**Issue**: Images not displaying
- **Solution**: Verify image URLs are absolute and publicly accessible
- **Solution**: Check CORS headers on image hosting

**Issue**: Links not working
- **Solution**: Ensure URLs are absolute (include https://)
- **Solution**: Test URLs in incognito mode

**Issue**: Content looks broken on mobile
- **Solution**: Keep content width at 600px max
- **Solution**: Use responsive table attributes

## Migration Guide

### Converting Old Email Templates

1. **Identify inline HTML**: Search for `<!DOCTYPE html>` or email strings
2. **Extract content sections**: Identify header, body, footer elements
3. **Map to components**: Match sections to available components
4. **Rebuild using system**: Compose email using unified components
5. **Test thoroughly**: Verify output matches original intent
6. **Update references**: Replace old function with new one

### Example Migration

**Before:**
```typescript
const html = `<html>...<h1>Title</h1>...<p>Hello ${name}</p>...</html>`;
```

**After:**
```typescript
let content = createGreeting(name);
content += createParagraph('Your message here');
const html = createEmailWrapper({ title: 'Title', content, ... });
```

## Support

For questions or issues with the email template system:
- Review this documentation
- Check existing email templates for examples
- Test changes in multiple email clients before deploying
- Maintain consistent branding across all communications

---

**Last Updated**: December 2024
**System Version**: 1.0
**Maintained By**: Development Team

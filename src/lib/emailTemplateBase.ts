export const LOGO_URL =
  'https://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object/public/public-assets/bounce-party-club-logo.png';
export const COMPANY_PHONE = '(313) 889-3860';
export const COMPANY_ADDRESS = '4426 Woodward Ave, Wayne, MI 48184';

export const THEME_COLORS = {
  primary: '#3b82f6',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#06b6d4',
};

export interface EmailTheme {
  borderColor: string;
  headerColor: string;
  accentColor: string;
  bgColor: string;
}

export const EMAIL_THEMES: Record<string, EmailTheme> = {
  primary: {
    borderColor: '#3b82f6',
    headerColor: '#3b82f6',
    accentColor: '#1e40af',
    bgColor: '#eff6ff',
  },
  success: {
    borderColor: '#10b981',
    headerColor: '#10b981',
    accentColor: '#15803d',
    bgColor: '#f0fdf4',
  },
  warning: {
    borderColor: '#f59e0b',
    headerColor: '#f59e0b',
    accentColor: '#92400e',
    bgColor: '#fef3c7',
  },
  danger: {
    borderColor: '#ef4444',
    headerColor: '#ef4444',
    accentColor: '#991b1b',
    bgColor: '#fee2e2',
  },
};

interface EmailWrapperOptions {
  title: string;
  headerTitle: string;
  content: string;
  theme?: EmailTheme;
}

export function createEmailWrapper(options: EmailWrapperOptions): string {
  const theme = options.theme || EMAIL_THEMES.primary;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${options.title}</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 40px 20px;">
        <tr>
          <td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); border: 2px solid ${theme.borderColor};">
              <tr>
                <td style="background-color: #ffffff; padding: 30px; text-align: center; border-bottom: 2px solid ${theme.borderColor};">
                  <img src="${LOGO_URL}" alt="Bounce Party Club" style="height: 80px; width: auto;" />
                  <h1 style="margin: 15px 0 0; color: ${theme.headerColor}; font-size: 24px; font-weight: bold;">${options.headerTitle}</h1>
                </td>
              </tr>
              <tr>
                <td style="padding: 30px;">
                  ${options.content}
                </td>
              </tr>
              <tr>
                <td style="background-color: #f8fafc; padding: 25px; text-align: center; border-top: 2px solid ${theme.borderColor};">
                  <p style="margin: 0 0 5px; color: #64748b; font-size: 13px;">
                    Bounce Party Club | ${COMPANY_PHONE}
                  </p>
                  <p style="margin: 0; color: #94a3b8; font-size: 12px;">
                    ${COMPANY_ADDRESS}
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

export function createGreeting(firstName: string): string {
  return `<p style="margin: 0 0 20px; color: #1e293b; font-size: 16px;">Hi ${firstName},</p>`;
}

export function createParagraph(text: string): string {
  return `<p style="margin: 0 0 20px; color: #475569; font-size: 15px; line-height: 1.6;">${text}</p>`;
}

interface InfoBoxOptions {
  title: string;
  rows: Array<{ label: string; value: string }>;
  theme?: EmailTheme;
}

export function createInfoBox(options: InfoBoxOptions): string {
  const theme = options.theme || EMAIL_THEMES.primary;
  const rows = options.rows
    .map(
      (row) => `
      <tr>
        <td style="color: #64748b; font-size: 14px;">${row.label}:</td>
        <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">${row.value}</td>
      </tr>
    `
    )
    .join('');

  return `
    <div style="background-color: ${theme.bgColor}; border: 2px solid ${theme.borderColor}; border-radius: 6px; padding: 20px; margin: 25px 0;">
      <h3 style="margin: 0 0 15px; color: ${theme.accentColor}; font-size: 16px; font-weight: 600;">${options.title}</h3>
      <table width="100%" cellpadding="6" cellspacing="0">
        ${rows}
      </table>
    </div>
  `;
}

interface ItemsTableOptions {
  title: string;
  items: Array<{ description: string; amount: string }>;
}

export function createItemsTable(options: ItemsTableOptions): string {
  const rows = options.items
    .map(
      (item) => `
    <tr>
      <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0; color: #1e293b;">
        ${item.description}
      </td>
      <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0; text-align: right; color: #1e293b;">
        ${item.amount}
      </td>
    </tr>
  `
    )
    .join('');

  return `
    <div style="margin: 25px 0;">
      <h3 style="margin: 0 0 15px; color: #1e293b; font-size: 16px; font-weight: 600;">${options.title}</h3>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${rows}
      </table>
    </div>
  `;
}

interface PricingSummaryOptions {
  title: string;
  rows: Array<{ label: string; value: string; bold?: boolean; highlight?: boolean }>;
}

export function createPricingSummary(options: PricingSummaryOptions): string {
  const rows = options.rows
    .map(
      (row) => `
    <tr${row.bold ? ' style="border-top: 2px solid #e2e8f0;"' : ''}>
      <td style="color: ${row.bold ? '#1e293b' : '#64748b'}; font-size: ${row.bold ? '15px' : '14px'}; font-weight: ${row.bold ? '600' : 'normal'}; ${row.bold ? 'padding-top: 10px;' : ''}">${row.label}:</td>
      <td style="color: ${row.highlight ? '#10b981' : row.bold ? '#1e293b' : '#1e293b'}; font-size: ${row.bold ? '15px' : '14px'}; font-weight: ${row.bold ? '700' : 'normal'}; text-align: right; ${row.bold ? 'padding-top: 10px;' : ''}">${row.value}</td>
    </tr>
  `
    )
    .join('');

  return `
    <div style="background-color: #f8fafc; border-radius: 6px; padding: 20px; margin: 25px 0;">
      <h3 style="margin: 0 0 15px; color: #1e293b; font-size: 16px; font-weight: 600;">${options.title}</h3>
      <table width="100%" cellpadding="6" cellspacing="0">
        ${rows}
      </table>
    </div>
  `;
}

interface AlertBoxOptions {
  title: string;
  message: string;
  type?: 'warning' | 'info' | 'success' | 'danger';
}

export function createAlertBox(options: AlertBoxOptions): string {
  const type = options.type || 'warning';
  const colors = {
    warning: { bg: '#fef3c7', border: '#f59e0b', text: '#92400e' },
    info: { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af' },
    success: { bg: '#f0fdf4', border: '#10b981', text: '#15803d' },
    danger: { bg: '#fee2e2', border: '#ef4444', text: '#991b1b' },
  };

  const theme = colors[type];

  return `
    <div style="background-color: ${theme.bg}; border: 2px solid ${theme.border}; border-radius: 6px; padding: 18px; margin: 25px 0;">
      <h3 style="margin: 0 0 12px; color: ${theme.text}; font-size: 15px; font-weight: 600;">${options.title}</h3>
      <p style="margin: 0; color: ${theme.text}; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">${options.message}</p>
    </div>
  `;
}

interface ButtonOptions {
  text: string;
  url: string;
  theme?: EmailTheme;
}

export function createButton(options: ButtonOptions): string {
  const theme = options.theme || EMAIL_THEMES.primary;

  return `
    <div style="text-align: center; margin: 30px 0;">
      <a href="${options.url}" style="display: inline-block; background-color: ${theme.borderColor}; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-weight: 600;">
        ${options.text}
      </a>
    </div>
  `;
}

export function createContactInfo(message?: string): string {
  const defaultMessage = `Questions? Call us at <strong style="color: #1e293b;">${COMPANY_PHONE}</strong>`;

  return `
    <p style="margin: 25px 0 0; color: #475569; font-size: 14px; line-height: 1.6;">
      ${message || defaultMessage}
    </p>
  `;
}

interface BulletListOptions {
  items: string[];
  theme?: 'warning' | 'info' | 'success';
}

export function createBulletList(options: BulletListOptions): string {
  const theme = options.theme || 'info';
  const colors = {
    warning: { bg: '#fef3c7', border: '#f59e0b', text: '#92400e' },
    info: { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af' },
    success: { bg: '#f0fdf4', border: '#10b981', text: '#15803d' },
  };

  const themeColors = colors[theme];
  const items = options.items.map((item) => `<li>${item}</li>`).join('');

  return `
    <ul style="margin: 0; padding-left: 20px; color: ${themeColors.text}; font-size: 14px; line-height: 1.8;">
      ${items}
    </ul>
  `;
}

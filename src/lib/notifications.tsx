import { createRoot } from 'react-dom/client';
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react';

type NotificationType = 'success' | 'error' | 'warning' | 'info';

interface NotificationOptions {
  duration?: number;
  onClose?: () => void;
}

let notificationContainer: HTMLDivElement | null = null;

function getNotificationContainer() {
  if (!notificationContainer) {
    notificationContainer = document.createElement('div');
    notificationContainer.id = 'notification-container';
    notificationContainer.style.position = 'fixed';
    notificationContainer.style.top = '20px';
    notificationContainer.style.right = '20px';
    notificationContainer.style.zIndex = '9999';
    notificationContainer.style.display = 'flex';
    notificationContainer.style.flexDirection = 'column';
    notificationContainer.style.gap = '12px';
    notificationContainer.style.pointerEvents = 'none';
    document.body.appendChild(notificationContainer);
  }
  return notificationContainer;
}

function Notification({
  type,
  message,
  onClose,
}: {
  type: NotificationType;
  message: string;
  onClose: () => void;
}) {
  const icons = {
    success: CheckCircle,
    error: XCircle,
    warning: AlertCircle,
    info: Info,
  };

  const colors = {
    success: 'bg-green-50 border-green-200 text-green-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800',
  };

  const iconColors = {
    success: 'text-green-600',
    error: 'text-red-600',
    warning: 'text-yellow-600',
    info: 'text-blue-600',
  };

  const Icon = icons[type];

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 rounded-lg border shadow-lg max-w-md pointer-events-auto animate-slide-in ${colors[type]}`}
      style={{
        animation: 'slideIn 0.3s ease-out',
      }}
    >
      <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${iconColors[type]}`} />
      <p className="flex-1 text-sm font-medium">{message}</p>
      <button
        onClick={onClose}
        className="flex-shrink-0 hover:opacity-70 transition-opacity"
        aria-label="Close notification"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function showNotification(
  type: NotificationType,
  message: string,
  options: NotificationOptions = {}
) {
  const { duration = 5000, onClose } = options;
  const container = getNotificationContainer();

  const wrapper = document.createElement('div');
  container.appendChild(wrapper);

  const root = createRoot(wrapper);

  const handleClose = () => {
    wrapper.style.animation = 'slideOut 0.3s ease-in';
    setTimeout(() => {
      root.unmount();
      container.removeChild(wrapper);
      onClose?.();
    }, 300);
  };

  root.render(<Notification type={type} message={message} onClose={handleClose} />);

  if (duration > 0) {
    setTimeout(handleClose, duration);
  }
}

// Main notification functions
export function notify(message: string, options?: NotificationOptions) {
  showNotification('info', message, options);
}

export function notifySuccess(message: string, options?: NotificationOptions) {
  showNotification('success', message, options);
}

export function notifyError(message: string, options?: NotificationOptions) {
  showNotification('error', message, options);
}

export function notifyWarning(message: string, options?: NotificationOptions) {
  showNotification('warning', message, options);
}

// Drop-in replacement for alert()
export function showAlert(message: string) {
  showNotification('info', message, { duration: 0 });
}

// Add animation styles
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    @keyframes slideOut {
      from {
        transform: translateX(0);
        opacity: 1;
      }
      to {
        transform: translateX(400px);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);
}

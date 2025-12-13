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

// Toast notification with type
export function showToast(message: string, type: NotificationType = 'info', options?: NotificationOptions) {
  showNotification(type, message, options);
}

// Drop-in replacement for alert()
export function showAlert(message: string) {
  showNotification('info', message, { duration: 0 });
}

// Drop-in replacement for confirm()
export function showConfirm(
  message: string,
  options?: {
    confirmText?: string;
    cancelText?: string;
    type?: 'warning' | 'info';
  }
): Promise<boolean> {
  return new Promise((resolve) => {
    const container = getNotificationContainer();
    const wrapper = document.createElement('div');

    wrapper.style.position = 'fixed';
    wrapper.style.top = '0';
    wrapper.style.left = '0';
    wrapper.style.right = '0';
    wrapper.style.bottom = '0';
    wrapper.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.justifyContent = 'center';
    wrapper.style.zIndex = '10000';
    wrapper.style.pointerEvents = 'auto';

    document.body.appendChild(wrapper);
    const root = createRoot(wrapper);

    const handleClose = (confirmed: boolean) => {
      root.unmount();
      document.body.removeChild(wrapper);
      resolve(confirmed);
    };

    const ConfirmDialog = () => {
      const { confirmText = 'Confirm', cancelText = 'Cancel', type = 'warning' } = options || {};
      const Icon = type === 'warning' ? AlertCircle : Info;
      const iconColor = type === 'warning' ? 'text-yellow-600' : 'text-blue-600';

      return (
        <div className="bg-white rounded-lg shadow-xl p-6 max-w-md mx-4 animate-scale-in">
          <div className="flex items-start gap-3 mb-4">
            <Icon className={`w-6 h-6 flex-shrink-0 ${iconColor}`} />
            <p className="text-gray-800 text-base">{message}</p>
          </div>
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => handleClose(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              {cancelText}
            </button>
            <button
              onClick={() => handleClose(true)}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              {confirmText}
            </button>
          </div>
        </div>
      );
    };

    root.render(<ConfirmDialog />);
  });
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
    @keyframes scaleIn {
      from {
        transform: scale(0.95);
        opacity: 0;
      }
      to {
        transform: scale(1);
        opacity: 1;
      }
    }
    .animate-scale-in {
      animation: scaleIn 0.2s ease-out;
    }
  `;
  document.head.appendChild(style);
}

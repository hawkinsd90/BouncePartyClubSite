import { createRoot } from 'react-dom/client';
import { X, AlertCircle, Info, CheckCircle } from 'lucide-react';

type ModalType = 'info' | 'warning' | 'success' | 'confirm';

interface ModalOptions {
  title?: string;
  message: string;
  type?: ModalType;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  showLogo?: boolean;
}

function ConfirmModal({
  title,
  message,
  type = 'info',
  confirmText = 'OK',
  cancelText,
  onConfirm,
  onCancel,
  showLogo = true,
}: ModalOptions) {
  const icons = {
    info: Info,
    warning: AlertCircle,
    success: CheckCircle,
    confirm: AlertCircle,
  };

  const iconColors = {
    info: 'text-blue-600',
    warning: 'text-amber-600',
    success: 'text-green-600',
    confirm: 'text-blue-600',
  };

  const Icon = icons[type];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10000] p-4 animate-fade-in">
      <div className="bg-white rounded-lg shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto animate-scale-in">
        <div className="p-6">
          {showLogo && (
            <div className="text-center mb-4">
              <img
                src="/bounce party club logo.png"
                alt="Bounce Party Club"
                className="h-12 w-auto mx-auto"
              />
            </div>
          )}

          <div className="flex items-start gap-4 mb-6">
            <div className={`flex-shrink-0 ${iconColors[type]}`}>
              <Icon className="w-8 h-8" />
            </div>
            <div className="flex-1">
              {title && (
                <h3 className="text-lg font-bold text-slate-900 mb-2">{title}</h3>
              )}
              <p className="text-slate-700 whitespace-pre-wrap">{message}</p>
            </div>
          </div>

          <div className="flex gap-3">
            {cancelText && onCancel && (
              <button
                onClick={onCancel}
                className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold py-3 px-4 rounded-lg transition-colors"
              >
                {cancelText}
              </button>
            )}
            <button
              onClick={onConfirm}
              className={`flex-1 font-bold py-3 px-4 rounded-lg transition-colors ${
                type === 'warning'
                  ? 'bg-amber-600 hover:bg-amber-700 text-white'
                  : type === 'success'
                  ? 'bg-green-600 hover:bg-green-700 text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

let activeModal: { root: any; wrapper: HTMLDivElement } | null = null;

export function showModal(options: ModalOptions): Promise<boolean> {
  return new Promise((resolve) => {
    // Close any existing modal
    if (activeModal) {
      activeModal.root.unmount();
      document.body.removeChild(activeModal.wrapper);
      activeModal = null;
    }

    const wrapper = document.createElement('div');
    document.body.appendChild(wrapper);

    const root = createRoot(wrapper);

    const handleConfirm = () => {
      options.onConfirm?.();
      cleanup();
      resolve(true);
    };

    const handleCancel = () => {
      options.onCancel?.();
      cleanup();
      resolve(false);
    };

    const cleanup = () => {
      wrapper.style.animation = 'fadeOut 0.2s ease-in';
      setTimeout(() => {
        root.unmount();
        document.body.removeChild(wrapper);
        if (activeModal?.wrapper === wrapper) {
          activeModal = null;
        }
      }, 200);
    };

    root.render(
      <ConfirmModal
        {...options}
        onConfirm={handleConfirm}
        onCancel={options.cancelText ? handleCancel : undefined}
      />
    );

    activeModal = { root, wrapper };
  });
}

export function showAlert(message: string, title?: string) {
  return showModal({
    title,
    message,
    type: 'info',
    confirmText: 'OK',
  });
}

export function showConfirm(message: string, title?: string) {
  return showModal({
    title,
    message,
    type: 'confirm',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
  });
}

export function showWarning(message: string, title?: string) {
  return showModal({
    title,
    message,
    type: 'warning',
    confirmText: 'OK',
  });
}

export function showSuccess(message: string, title?: string) {
  return showModal({
    title,
    message,
    type: 'success',
    confirmText: 'OK',
  });
}

// Add animation styles
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }
    @keyframes fadeOut {
      from {
        opacity: 1;
      }
      to {
        opacity: 0;
      }
    }
    @keyframes scaleIn {
      from {
        transform: scale(0.9);
        opacity: 0;
      }
      to {
        transform: scale(1);
        opacity: 1;
      }
    }
    .animate-fade-in {
      animation: fadeIn 0.2s ease-out;
    }
    .animate-scale-in {
      animation: scaleIn 0.2s ease-out;
    }
  `;
  document.head.appendChild(style);
}

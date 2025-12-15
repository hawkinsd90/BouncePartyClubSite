import { notify, notifySuccess, notifyError, notifyWarning } from './notifications';
import { showAlert, showConfirm } from '../components/common/CustomModal';

// Automatically replace window.alert and window.confirm with custom modals
if (typeof window !== 'undefined') {
  // Replace alert with custom modal
  (window as any).alert = (message: string) => {
    // Determine type based on message content
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('success') || lowerMessage.includes('approved') || lowerMessage.includes('saved') || lowerMessage.includes('signed') || lowerMessage.includes('generated') || lowerMessage.includes('copied')) {
      notifySuccess(message);
    } else if (lowerMessage.includes('error') || lowerMessage.includes('failed') || lowerMessage.includes('denied') || lowerMessage.includes('cannot') || lowerMessage.includes('unable')) {
      notifyError(message);
    } else if (lowerMessage.includes('please') || lowerMessage.includes('minimum') || lowerMessage.includes('consent') || lowerMessage.includes('required')) {
      notifyWarning(message);
    } else {
      // For modal-worthy alerts (longer messages or important confirmations), use custom modal
      if (message.length > 80 || lowerMessage.includes('confirm') || lowerMessage.includes('sure')) {
        showAlert(message);
      } else {
        notify(message);
      }
    }
  };

  // Replace confirm with custom modal
  const originalConfirm = window.confirm;
  (window as any).confirm = (message: string): boolean => {
    // Show custom confirm modal (note: this makes it async, but we return false for now)
    // For actual async handling, code should be refactored to use showConfirm directly
    showConfirm(message).then((result) => {
      return result;
    });
    // Fallback to original for synchronous compatibility
    return originalConfirm(message);
  };
}

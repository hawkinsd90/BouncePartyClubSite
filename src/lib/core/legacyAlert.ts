import { notify, notifySuccess, notifyError, notifyWarning } from '../toasts';
import { showAlert } from '../../components/common/CustomModal';

// Automatically replace window.alert with a custom notification.
// window.confirm is NOT replaced: a confirmation has to return an answer, which a modal can only do asynchronously. The previous
// override showed the custom dialog, discarded its answer and then asked again with the browser's own dialog (two prompts). Code that
// needs a confirmation awaits showConfirm() from CustomModal.
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

}

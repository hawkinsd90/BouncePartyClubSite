import { notify, notifySuccess, notifyError, notifyWarning } from './notifications';

// Automatically replace window.alert with custom notification
if (typeof window !== 'undefined') {
  (window as any).alert = (message: string) => {
    // Determine notification type based on message content
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('success') || lowerMessage.includes('approved') || lowerMessage.includes('saved') || lowerMessage.includes('signed') || lowerMessage.includes('generated') || lowerMessage.includes('copied')) {
      notifySuccess(message);
    } else if (lowerMessage.includes('error') || lowerMessage.includes('failed') || lowerMessage.includes('denied') || lowerMessage.includes('cannot') || lowerMessage.includes('unable')) {
      notifyError(message);
    } else if (lowerMessage.includes('please') || lowerMessage.includes('minimum') || lowerMessage.includes('consent')) {
      notifyWarning(message);
    } else {
      notify(message);
    }
  };
}

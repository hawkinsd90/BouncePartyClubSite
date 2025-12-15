import { useState } from 'react';
import { format } from 'date-fns';

interface SmsMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  message_body: string;
  created_at: string;
}

interface SmsConversationProps {
  messages: SmsMessage[];
  onSendMessage: (message: string) => Promise<boolean>;
  onSendTestMessage: () => Promise<void>;
  isSending: boolean;
}

export function SmsConversation({
  messages,
  onSendMessage,
  onSendTestMessage,
  isSending,
}: SmsConversationProps) {
  const [showReply, setShowReply] = useState(false);
  const [replyMessage, setReplyMessage] = useState('');

  const handleSend = async () => {
    const success = await onSendMessage(replyMessage);
    if (success) {
      setReplyMessage('');
      setShowReply(false);
      alert('SMS sent successfully!');
    }
  };

  return (
    <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
      <h4 className="text-sm font-semibold text-blue-900 mb-2">SMS Conversation</h4>
      {messages.length > 0 ? (
        <div className="space-y-2 max-h-40 overflow-y-auto mb-3">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`text-sm ${msg.direction === 'inbound' ? 'text-blue-900' : 'text-slate-700'}`}
            >
              <span className="font-medium">
                {msg.direction === 'inbound' ? 'Customer' : 'You'}:
              </span>{' '}
              {msg.message_body}
              <div className="text-xs text-slate-500">
                {format(new Date(msg.created_at), 'MMM d, h:mm a')}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-blue-800 mb-3">No messages yet</p>
      )}
      {!showReply && (
        <button
          onClick={() => setShowReply(true)}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          Reply via SMS
        </button>
      )}
      {showReply && (
        <div className="mt-3">
          <textarea
            value={replyMessage}
            onChange={(e) => setReplyMessage(e.target.value)}
            placeholder="Type your message..."
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            rows={3}
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleSend}
              disabled={isSending || !replyMessage.trim()}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white px-4 py-1 rounded text-sm font-medium"
            >
              {isSending ? 'Sending...' : 'Send'}
            </button>
            <button
              onClick={() => {
                setShowReply(false);
                setReplyMessage('');
              }}
              className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-1 rounded text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <button
        onClick={onSendTestMessage}
        disabled={isSending}
        className="mt-2 text-sm text-slate-600 hover:text-slate-800 underline"
      >
        Send test SMS
      </button>
    </div>
  );
}

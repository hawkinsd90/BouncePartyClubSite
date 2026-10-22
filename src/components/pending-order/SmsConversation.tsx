import { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { showToast } from '../../lib/toasts';

interface SmsMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  message_body: string;
  created_at: string;
}

interface SmsConversationProps {
  messages: SmsMessage[];
  onSendMessage: (message: string) => Promise<boolean>;
  isSending: boolean;
}

export function SmsConversation({
  messages,
  onSendMessage,
  isSending,
}: SmsConversationProps) {
  const [showReply, setShowReply] = useState(false);
  const [replyMessage, setReplyMessage] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  // The thread opens on the newest message (it is a short scroll box inside a long card, so older messages are the ones scrolled off).
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const handleSend = async () => {
    const success = await onSendMessage(replyMessage);
    if (success) {
      setReplyMessage('');
      setShowReply(false);
      showToast('SMS sent.', 'success', { duration: 2000 });
    }
  };

  return (
    <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
      <h4 className="text-sm font-semibold text-blue-900 mb-2">SMS Conversation</h4>
      {messages.length > 0 ? (
        <div ref={listRef} className="space-y-2 max-h-60 overflow-y-auto overscroll-contain mb-3 pr-1" tabIndex={0} role="log" aria-label="SMS conversation">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`text-sm ${msg.direction === 'inbound' ? 'text-blue-900' : 'text-slate-700'}`}
            >
              <span className="font-medium">
                {msg.direction === 'inbound' ? 'Customer' : 'You'}:
              </span>{' '}
              <span className="break-words whitespace-pre-wrap">{msg.message_body}</span>
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
          className="text-sm text-blue-600 hover:text-blue-800 font-medium min-h-[44px]"
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
            aria-label="SMS reply"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-base sm:text-sm"
            rows={3}
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleSend}
              disabled={isSending || !replyMessage.trim()}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white px-4 py-2 min-h-[44px] rounded text-sm font-medium"
            >
              {isSending ? 'Sending...' : 'Send'}
            </button>
            <button
              onClick={() => {
                setShowReply(false);
                setReplyMessage('');
              }}
              className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 min-h-[44px] rounded text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

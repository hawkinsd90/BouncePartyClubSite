import { useState } from 'react';
import { format } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../lib/notifications';

interface Note {
  id: string;
  note: string;
  created_at: string;
  user?: {
    email: string;
  };
}

interface OrderNotesTabProps {
  orderId: string;
  notes: Note[];
  onNotesChanged: () => void;
}

export function OrderNotesTab({ orderId, notes, onNotesChanged }: OrderNotesTabProps) {
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  async function handleAddNote() {
    if (!newNote.trim()) return;

    setSavingNote(true);
    try {
      const { error } = await supabase.from('order_notes' as any).insert({
        order_id: orderId,
        user_id: (await supabase.auth.getUser()).data.user?.id || null,
        note: newNote,
      });

      if (error) throw error;

      setNewNote('');
      onNotesChanged();
    } catch (error) {
      console.error('Error adding note:', error);
      showToast('Failed to add note', 'error');
    } finally {
      setSavingNote(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-slate-900 mb-3">Add Note</h3>
        <textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          className="w-full px-3 py-2 border border-slate-300 rounded mb-2 h-24"
          placeholder="Enter note..."
        />
        <button
          onClick={handleAddNote}
          disabled={savingNote || !newNote.trim()}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded font-medium disabled:opacity-50"
        >
          {savingNote ? 'Saving...' : 'Add Note'}
        </button>
      </div>

      <div>
        <h3 className="font-semibold text-slate-900 mb-3">Notes History</h3>
        {notes.length === 0 ? (
          <p className="text-slate-600">No notes yet</p>
        ) : (
          <div className="space-y-2">
            {notes.map(note => (
              <div key={note.id} className="bg-slate-50 rounded-lg p-3">
                <p className="text-sm mb-2">{note.note}</p>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>{note.user?.email}</span>
                  <span>•</span>
                  <span>{format(new Date(note.created_at), 'MMM d, yyyy h:mm a')}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

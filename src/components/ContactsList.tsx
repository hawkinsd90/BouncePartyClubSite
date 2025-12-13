import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Mail, Phone, Calendar, Edit2, X } from 'lucide-react';
import { format } from 'date-fns';
import { notifySuccess, notifyError } from '../lib/notifications';

export function ContactsList() {
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [editingContact, setEditingContact] = useState<any>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadContacts();
  }, []);

  async function loadContacts() {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('contacts')
        .select('*')
        .order('created_at', { ascending: false });

      if (data) setContacts(data);
    } catch (error) {
      console.error('Error loading contacts:', error);
    } finally {
      setLoading(false);
    }
  }

  const filteredContacts = contacts.filter(contact => {
    if (filter === 'email') return contact.opt_in_email;
    if (filter === 'sms') return contact.opt_in_sms;
    return true;
  });

  function handleEditClick(contact: any) {
    setEditingContact({ ...contact });
    setShowEditModal(true);
  }

  async function handleSaveContact() {
    if (!editingContact) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('contacts')
        .update({
          business_name: editingContact.business_name || null,
          first_name: editingContact.first_name,
          last_name: editingContact.last_name,
          email: editingContact.email,
          phone: editingContact.phone,
          opt_in_email: editingContact.opt_in_email,
          opt_in_sms: editingContact.opt_in_sms,
        })
        .eq('id', editingContact.id);

      if (error) throw error;

      notifySuccess('Contact updated successfully!');
      setShowEditModal(false);
      setEditingContact(null);
      await loadContacts();
    } catch (error) {
      console.error('Error updating contact:', error);
      notifyError('Failed to update contact. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-center py-8">Loading contacts...</div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Contacts & Phonebook</h2>
          <p className="text-slate-600 mt-1">
            {contacts.length} total contacts | {contacts.filter(c => c.opt_in_email).length} email subscribers | {contacts.filter(c => c.opt_in_sms).length} SMS subscribers
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              filter === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-700 border border-slate-300'
            }`}
          >
            All Contacts
          </button>
          <button
            onClick={() => setFilter('email')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              filter === 'email'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-700 border border-slate-300'
            }`}
          >
            Email List
          </button>
          <button
            onClick={() => setFilter('sms')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              filter === 'sms'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-700 border border-slate-300'
            }`}
          >
            SMS List
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider">
                Contact
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider">
                Email
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider">
                Phone
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider">
                Stats
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider">
                Opt-Ins
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider">
                Added
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-200">
            {filteredContacts.map((contact) => (
              <tr key={contact.id} className="hover:bg-slate-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  {contact.business_name && (
                    <div className="font-bold text-slate-900 text-base">
                      {contact.business_name}
                    </div>
                  )}
                  <div className="font-medium text-slate-900">
                    {contact.first_name} {contact.last_name}
                  </div>
                  <div className="text-sm text-slate-500">{contact.source}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center text-sm text-slate-900">
                    <Mail className="w-4 h-4 mr-2 text-slate-400" />
                    {contact.email}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center text-sm text-slate-900">
                    <Phone className="w-4 h-4 mr-2 text-slate-400" />
                    {contact.phone || 'N/A'}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <div className="text-slate-900">{contact.total_bookings} bookings</div>
                  <div className="text-slate-500">
                    ${(contact.total_spent_cents / 100).toFixed(2)} spent
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <div className="flex gap-2">
                    {contact.opt_in_email && (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        Email
                      </span>
                    )}
                    {contact.opt_in_sms && (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        SMS
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                  <div className="flex items-center">
                    <Calendar className="w-4 h-4 mr-2" />
                    {format(new Date(contact.created_at), 'MMM d, yyyy')}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <button
                    onClick={() => handleEditClick(contact)}
                    className="inline-flex items-center px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <Edit2 className="w-4 h-4 mr-1" />
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showEditModal && editingContact && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center">
              <h3 className="text-xl font-bold text-slate-900">Edit Contact</h3>
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setEditingContact(null);
                }}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Business Name (Optional)
                </label>
                <input
                  type="text"
                  value={editingContact.business_name || ''}
                  onChange={(e) =>
                    setEditingContact({ ...editingContact, business_name: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    First Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingContact.first_name}
                    onChange={(e) =>
                      setEditingContact({ ...editingContact, first_name: e.target.value })
                    }
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Last Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingContact.last_name}
                    onChange={(e) =>
                      setEditingContact({ ...editingContact, last_name: e.target.value })
                    }
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Email *
                </label>
                <input
                  type="email"
                  required
                  value={editingContact.email}
                  onChange={(e) =>
                    setEditingContact({ ...editingContact, email: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Phone
                </label>
                <input
                  type="tel"
                  value={editingContact.phone || ''}
                  onChange={(e) =>
                    setEditingContact({ ...editingContact, phone: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="border-t border-slate-200 pt-4">
                <label className="block text-sm font-medium text-slate-700 mb-3">
                  Marketing Preferences
                </label>
                <div className="space-y-2">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={editingContact.opt_in_email}
                      onChange={(e) =>
                        setEditingContact({ ...editingContact, opt_in_email: e.target.checked })
                      }
                      className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                    />
                    <span className="ml-2 text-sm text-slate-700">Opt-in to Email Marketing</span>
                  </label>

                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={editingContact.opt_in_sms}
                      onChange={(e) =>
                        setEditingContact({ ...editingContact, opt_in_sms: e.target.checked })
                      }
                      className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                    />
                    <span className="ml-2 text-sm text-slate-700">Opt-in to SMS Marketing</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 bg-slate-50 border-t border-slate-200 px-6 py-4 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setEditingContact(null);
                }}
                className="px-4 py-2 bg-white text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
                disabled={saving}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveContact}
                disabled={saving || !editingContact.first_name || !editingContact.last_name || !editingContact.email}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

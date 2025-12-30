import { useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { Mail, Phone, Calendar, Edit2, X } from 'lucide-react';
import { format } from 'date-fns';
import { useSupabaseQuery, useMutation } from '../../hooks/useDataFetch';

interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  business_name: string | null;
  opt_in_email: boolean;
  opt_in_sms: boolean;
  source: string;
  total_bookings: number;
  total_spent_cents: number;
  created_at: string;
}

export function ContactsList() {
  const [filter, setFilter] = useState('all');
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  const fetchContacts = useCallback(async () => {
    const result = await supabase
      .from('contacts')
      .select('*')
      .order('created_at', { ascending: false });
    return result;
  }, []);

  const { data: contactsData, loading, refetch } = useSupabaseQuery<Contact[]>(
    fetchContacts,
    { errorMessage: 'Failed to load contacts' }
  );

  const contacts = contactsData || [];

  const updateContactFn = useCallback(async (contact: Contact) => {
    const { data, error } = await supabase
      .from('contacts')
      .update({
        business_name: contact.business_name || null,
        first_name: contact.first_name,
        last_name: contact.last_name,
        email: contact.email,
        phone: contact.phone,
        opt_in_email: contact.opt_in_email,
        opt_in_sms: contact.opt_in_sms,
      })
      .eq('id', contact.id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }, []);

  const handleUpdateSuccess = useCallback(() => {
    setShowEditModal(false);
    setEditingContact(null);
    refetch();
  }, [refetch]);

  const { mutate: updateContact, loading: saving } = useMutation<Contact, Contact>(
    updateContactFn,
    {
      successMessage: 'Contact updated successfully!',
      errorMessage: 'Failed to update contact',
      onSuccess: handleUpdateSuccess,
    }
  );

  const filteredContacts = contacts.filter((contact: Contact) => {
    if (filter === 'email') return contact.opt_in_email;
    if (filter === 'sms') return contact.opt_in_sms;
    return true;
  });

  function handleEditClick(contact: Contact) {
    setEditingContact({ ...contact });
    setShowEditModal(true);
  }

  function handleSaveContact() {
    if (!editingContact) return;
    updateContact(editingContact);
  }

  if (loading) {
    return <div className="text-center py-8">Loading contacts...</div>;
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Contacts & Phonebook</h2>
          <p className="text-xs sm:text-sm text-slate-600 mt-1">
            {contacts.length} total contacts | {contacts.filter((c: Contact) => c.opt_in_email).length} email subscribers | {contacts.filter((c: Contact) => c.opt_in_sms).length} SMS subscribers
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium ${
              filter === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-700 border border-slate-300'
            }`}
          >
            All Contacts
          </button>
          <button
            onClick={() => setFilter('email')}
            className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium ${
              filter === 'email'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-700 border border-slate-300'
            }`}
          >
            Email List
          </button>
          <button
            onClick={() => setFilter('sms')}
            className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium ${
              filter === 'sms'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-700 border border-slate-300'
            }`}
          >
            SMS List
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-x-auto -mx-4 sm:mx-0">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 sm:px-6 py-2 sm:py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider whitespace-nowrap">
                Contact
              </th>
              <th className="px-3 sm:px-6 py-2 sm:py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider whitespace-nowrap">
                Email
              </th>
              <th className="px-3 sm:px-6 py-2 sm:py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider whitespace-nowrap">
                Phone
              </th>
              <th className="px-3 sm:px-6 py-2 sm:py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider whitespace-nowrap">
                Stats
              </th>
              <th className="px-3 sm:px-6 py-2 sm:py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider whitespace-nowrap">
                Opt-Ins
              </th>
              <th className="px-3 sm:px-6 py-2 sm:py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider whitespace-nowrap">
                Added
              </th>
              <th className="px-3 sm:px-6 py-2 sm:py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider whitespace-nowrap">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-200">
            {filteredContacts.map((contact: Contact) => (
              <tr key={contact.id} className="hover:bg-slate-50">
                <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
                  {contact.business_name && (
                    <div className="font-bold text-slate-900 text-sm sm:text-base">
                      {contact.business_name}
                    </div>
                  )}
                  <div className="font-medium text-slate-900 text-sm">
                    {contact.first_name} {contact.last_name}
                  </div>
                  <div className="text-xs text-slate-500">{contact.source}</div>
                </td>
                <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
                  <div className="flex items-center text-xs sm:text-sm text-slate-900">
                    <Mail className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2 text-slate-400 flex-shrink-0" />
                    <span className="truncate max-w-[150px]">{contact.email}</span>
                  </div>
                </td>
                <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
                  <div className="flex items-center text-xs sm:text-sm text-slate-900">
                    <Phone className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2 text-slate-400 flex-shrink-0" />
                    {contact.phone || 'N/A'}
                  </div>
                </td>
                <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm">
                  <div className="text-slate-900">{contact.total_bookings} bookings</div>
                  <div className="text-slate-500">
                    ${(contact.total_spent_cents / 100).toFixed(2)} spent
                  </div>
                </td>
                <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm">
                  <div className="flex gap-1 sm:gap-2">
                    {contact.opt_in_email && (
                      <span className="inline-flex items-center px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        Email
                      </span>
                    )}
                    {contact.opt_in_sms && (
                      <span className="inline-flex items-center px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        SMS
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-slate-500">
                  <div className="flex items-center">
                    <Calendar className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2 flex-shrink-0" />
                    <span className="hidden sm:inline">{format(new Date(contact.created_at), 'MMM d, yyyy')}</span>
                    <span className="sm:hidden">{format(new Date(contact.created_at), 'MM/dd/yy')}</span>
                  </div>
                </td>
                <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm">
                  <button
                    onClick={() => handleEditClick(contact)}
                    className="inline-flex items-center px-2 sm:px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs sm:text-sm"
                  >
                    <Edit2 className="w-3 h-3 sm:w-4 sm:h-4 sm:mr-1" />
                    <span className="hidden sm:inline">Edit</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showEditModal && editingContact && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 sm:p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-4 sm:px-6 py-3 sm:py-4 flex justify-between items-center">
              <h3 className="text-lg sm:text-xl font-bold text-slate-900">Edit Contact</h3>
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

            <div className="p-4 sm:p-6 space-y-3 sm:space-y-4">
              <div>
                <label className="block text-xs sm:text-sm font-medium text-slate-700 mb-1 sm:mb-2">
                  Business Name (Optional)
                </label>
                <input
                  type="text"
                  value={editingContact.business_name || ''}
                  onChange={(e) =>
                    setEditingContact({ ...editingContact, business_name: e.target.value })
                  }
                  className="w-full px-3 sm:px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label className="block text-xs sm:text-sm font-medium text-slate-700 mb-1 sm:mb-2">
                    First Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingContact.first_name}
                    onChange={(e) =>
                      setEditingContact({ ...editingContact, first_name: e.target.value })
                    }
                    className="w-full px-3 sm:px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs sm:text-sm font-medium text-slate-700 mb-1 sm:mb-2">
                    Last Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingContact.last_name}
                    onChange={(e) =>
                      setEditingContact({ ...editingContact, last_name: e.target.value })
                    }
                    className="w-full px-3 sm:px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-medium text-slate-700 mb-1 sm:mb-2">
                  Email *
                </label>
                <input
                  type="email"
                  required
                  value={editingContact.email}
                  onChange={(e) =>
                    setEditingContact({ ...editingContact, email: e.target.value })
                  }
                  className="w-full px-3 sm:px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                />
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-medium text-slate-700 mb-1 sm:mb-2">
                  Phone
                </label>
                <input
                  type="tel"
                  value={editingContact.phone || ''}
                  onChange={(e) =>
                    setEditingContact({ ...editingContact, phone: e.target.value })
                  }
                  className="w-full px-3 sm:px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                />
              </div>

              <div className="border-t border-slate-200 pt-3 sm:pt-4">
                <label className="block text-xs sm:text-sm font-medium text-slate-700 mb-2 sm:mb-3">
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
                    <span className="ml-2 text-xs sm:text-sm text-slate-700">Opt-in to Email Marketing</span>
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
                    <span className="ml-2 text-xs sm:text-sm text-slate-700">Opt-in to SMS Marketing</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 bg-slate-50 border-t border-slate-200 px-4 sm:px-6 py-3 sm:py-4 flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3">
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setEditingContact(null);
                }}
                className="px-4 py-2 bg-white text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 text-sm sm:text-base"
                disabled={saving}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveContact}
                disabled={saving || !editingContact.first_name || !editingContact.last_name || !editingContact.email}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base"
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

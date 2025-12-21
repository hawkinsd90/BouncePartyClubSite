import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Shield, UserPlus, Trash2, History, Mail } from 'lucide-react';
import { notify } from '../../lib/notifications';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { ConfirmationModal } from '../shared/ConfirmationModal';

interface UserRole {
  id: string;
  user_id: string;
  role: 'master' | 'admin' | 'crew';
  created_at: string;
  email?: string;
  full_name?: string;
}

interface ChangelogEntry {
  id: string;
  action: string;
  old_role: string | null;
  new_role: string | null;
  changed_by_email: string;
  notes: string | null;
  created_at: string;
}

interface CurrentUser {
  role: 'master' | 'admin' | 'crew' | null;
}

export function PermissionsTab() {
  const [users, setUsers] = useState<UserRole[]>([]);
  const [currentUserRole, setCurrentUserRole] = useState<CurrentUser['role']>(null);
  const [loading, setLoading] = useState(true);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<'admin' | 'crew'>('crew');
  const [addingUser, setAddingUser] = useState(false);
  const [selectedUserChangelog, setSelectedUserChangelog] = useState<string | null>(null);
  const [changelog, setChangelog] = useState<ChangelogEntry[]>([]);
  const [loadingChangelog, setLoadingChangelog] = useState(false);
  const [userToDelete, setUserToDelete] = useState<UserRole | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle();

      setCurrentUserRole(roleData?.role || null);

      const { data: usersData, error } = await supabase
        .from('user_roles')
        .select(`
          id,
          user_id,
          role,
          created_at
        `)
        .order('role', { ascending: true })
        .order('created_at', { ascending: false });

      if (error) throw error;

      const usersWithEmails = await Promise.all(
        (usersData || []).map(async (userRole) => {
          const { data: userData } = await supabase.auth.admin.getUserById(userRole.user_id);
          return {
            ...userRole,
            email: userData?.user?.email || 'Unknown',
            full_name: userData?.user?.user_metadata?.full_name || userData?.user?.email || 'Unknown User',
          };
        })
      );

      setUsers(usersWithEmails);
    } catch (error: any) {
      notify(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleAddUser() {
    if (!newUserEmail.trim()) {
      notify('Please enter an email address', 'error');
      return;
    }

    if (currentUserRole === 'admin' && newUserRole === 'admin') {
      notify('Only Master users can create Admin accounts', 'error');
      return;
    }

    setAddingUser(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-admin-user`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            email: newUserEmail.trim(),
            role: newUserRole,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create user');
      }

      await sendPermissionChangeEmail('added', newUserEmail, newUserRole);

      notify(`${newUserRole.charAt(0).toUpperCase() + newUserRole.slice(1)} user created successfully`, 'success');
      setNewUserEmail('');
      setNewUserRole('crew');
      fetchData();
    } catch (error: any) {
      notify(error.message, 'error');
    } finally {
      setAddingUser(false);
    }
  }

  async function handleChangeRole(user: UserRole, newRole: 'master' | 'admin' | 'crew') {
    if (currentUserRole === 'admin' && (newRole === 'master' || newRole === 'admin')) {
      notify('Only Master users can assign Master or Admin roles', 'error');
      return;
    }

    if (currentUserRole === 'admin' && user.role === 'admin') {
      notify('Only Master users can modify Admin accounts', 'error');
      return;
    }

    try {
      const { error } = await supabase
        .from('user_roles')
        .update({ role: newRole })
        .eq('user_id', user.user_id);

      if (error) throw error;

      await sendPermissionChangeEmail('changed', user.email || '', newRole, user.role);

      notify('Role updated successfully', 'success');
      fetchData();
    } catch (error: any) {
      notify(error.message, 'error');
    }
  }

  async function handleDeleteUser(user: UserRole) {
    if (currentUserRole === 'admin' && (user.role === 'admin' || user.role === 'master')) {
      notify('Only Master users can delete Admin or Master accounts', 'error');
      return;
    }

    try {
      const { error } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', user.user_id);

      if (error) throw error;

      await sendPermissionChangeEmail('removed', user.email || '', user.role);

      notify('User removed successfully', 'success');
      setUserToDelete(null);
      fetchData();
    } catch (error: any) {
      notify(error.message, 'error');
    }
  }

  async function sendPermissionChangeEmail(action: string, userEmail: string, role: string, oldRole?: string) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const changedByEmail = user?.email || 'Unknown';

      let subject = '';
      let message = '';

      if (action === 'added') {
        subject = `New ${role} account created`;
        message = `A new ${role} account has been created for ${userEmail} by ${changedByEmail}.`;
      } else if (action === 'changed') {
        subject = `User role changed from ${oldRole} to ${role}`;
        message = `User ${userEmail}'s role has been changed from ${oldRole} to ${role} by ${changedByEmail}.`;
      } else if (action === 'removed') {
        subject = `${role} account removed`;
        message = `The ${role} account for ${userEmail} has been removed by ${changedByEmail}.`;
      }

      await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            to: import.meta.env.VITE_ADMIN_EMAIL || 'admin@bouncepartyclub.com',
            subject,
            html: `<p>${message}</p><p>This is an automated notification for security and audit purposes.</p>`,
          }),
        }
      );
    } catch (error) {
      console.error('Failed to send permission change email:', error);
    }
  }

  async function loadChangelog(userId: string) {
    setSelectedUserChangelog(userId);
    setLoadingChangelog(true);
    try {
      const { data, error } = await supabase
        .from('user_permissions_changelog')
        .select(`
          id,
          action,
          old_role,
          new_role,
          notes,
          created_at,
          changed_by_user_id
        `)
        .eq('target_user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const changelogWithEmails = await Promise.all(
        (data || []).map(async (entry) => {
          let changedByEmail = 'System';
          if (entry.changed_by_user_id) {
            const { data: userData } = await supabase.auth.admin.getUserById(entry.changed_by_user_id);
            changedByEmail = userData?.user?.email || 'Unknown';
          }
          return {
            ...entry,
            changed_by_email: changedByEmail,
          };
        })
      );

      setChangelog(changelogWithEmails);
    } catch (error: any) {
      notify(error.message, 'error');
    } finally {
      setLoadingChangelog(false);
    }
  }

  function getRoleColor(role: string) {
    switch (role) {
      case 'master': return 'bg-purple-100 text-purple-800 border-purple-300';
      case 'admin': return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'crew': return 'bg-green-100 text-green-800 border-green-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  }

  function canModifyUser(targetRole: string): boolean {
    if (currentUserRole === 'master') return true;
    if (currentUserRole === 'admin' && targetRole === 'crew') return true;
    return false;
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100">
        <LoadingSpinner />
      </div>
    );
  }

  if (!currentUserRole || (currentUserRole !== 'admin' && currentUserRole !== 'master')) {
    return (
      <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100">
        <p className="text-red-600">You do not have permission to manage user roles.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 flex items-center">
              <Shield className="w-7 h-7 mr-3 text-blue-600" />
              User Permissions
            </h2>
            <p className="text-slate-600 mt-2">
              Manage user roles and access levels. Your role: <span className="font-bold">{currentUserRole}</span>
            </p>
          </div>
        </div>

        <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4 mb-6">
          <h3 className="font-bold text-blue-900 mb-2">Permission Levels:</h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li><strong>Master:</strong> Full access - can manage all users including admins and masters</li>
            <li><strong>Admin:</strong> Can manage crew members only</li>
            <li><strong>Crew:</strong> Limited access for day-of execution tasks</li>
          </ul>
        </div>

        <div className="bg-slate-50 rounded-xl p-6 mb-6">
          <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center">
            <UserPlus className="w-5 h-5 mr-2" />
            Add New User
          </h3>
          <div className="flex gap-4">
            <input
              type="email"
              value={newUserEmail}
              onChange={(e) => setNewUserEmail(e.target.value)}
              placeholder="Enter email address"
              className="flex-1 px-4 py-3 border-2 border-slate-300 rounded-lg focus:border-blue-500 focus:outline-none"
            />
            <select
              value={newUserRole}
              onChange={(e) => setNewUserRole(e.target.value as 'admin' | 'crew')}
              className="px-4 py-3 border-2 border-slate-300 rounded-lg focus:border-blue-500 focus:outline-none"
              disabled={currentUserRole === 'admin'}
            >
              <option value="crew">Crew</option>
              {currentUserRole === 'master' && <option value="admin">Admin</option>}
              {currentUserRole === 'master' && <option value="master">Master</option>}
            </select>
            <button
              onClick={handleAddUser}
              disabled={addingUser}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-bold transition-colors disabled:opacity-50"
            >
              {addingUser ? 'Adding...' : 'Add User'}
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {users.map((user) => (
            <div key={user.id} className="border-2 border-slate-200 rounded-xl p-6 hover:border-blue-300 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h4 className="text-lg font-bold text-slate-900">{user.full_name}</h4>
                    <span className={`px-3 py-1 rounded-full text-sm font-bold border-2 ${getRoleColor(user.role)}`}>
                      {user.role.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-slate-600">{user.email}</p>
                  <p className="text-sm text-slate-500">Added: {new Date(user.created_at).toLocaleDateString()}</p>
                </div>

                <div className="flex items-center gap-2">
                  {canModifyUser(user.role) && (
                    <>
                      <select
                        value={user.role}
                        onChange={(e) => handleChangeRole(user, e.target.value as any)}
                        className="px-4 py-2 border-2 border-slate-300 rounded-lg focus:border-blue-500 focus:outline-none"
                        disabled={!canModifyUser(user.role)}
                      >
                        <option value="crew">Crew</option>
                        {currentUserRole === 'master' && <option value="admin">Admin</option>}
                        {currentUserRole === 'master' && <option value="master">Master</option>}
                      </select>
                      <button
                        onClick={() => loadChangelog(user.user_id)}
                        className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                        title="View changelog"
                      >
                        <History className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => setUserToDelete(user)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Remove user"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </>
                  )}
                  {!canModifyUser(user.role) && (
                    <span className="text-sm text-slate-500 italic">Cannot modify</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {selectedUserChangelog && (
        <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-bold text-slate-900 flex items-center">
              <History className="w-6 h-6 mr-3 text-slate-600" />
              Permission Change History
            </h3>
            <button
              onClick={() => setSelectedUserChangelog(null)}
              className="text-slate-600 hover:text-slate-900 font-medium"
            >
              Close
            </button>
          </div>

          {loadingChangelog ? (
            <LoadingSpinner />
          ) : changelog.length === 0 ? (
            <p className="text-center text-slate-500 py-8">No permission changes recorded</p>
          ) : (
            <div className="space-y-3">
              {changelog.map((entry) => (
                <div key={entry.id} className="border-l-4 border-blue-500 bg-slate-50 p-4 rounded-r-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-slate-900">{entry.action.replace('_', ' ').toUpperCase()}</span>
                    <span className="text-sm text-slate-500">{new Date(entry.created_at).toLocaleString()}</span>
                  </div>
                  {entry.old_role && entry.new_role && (
                    <p className="text-slate-700">
                      Role changed from <strong>{entry.old_role}</strong> to <strong>{entry.new_role}</strong>
                    </p>
                  )}
                  {entry.new_role && !entry.old_role && (
                    <p className="text-slate-700">Role set to <strong>{entry.new_role}</strong></p>
                  )}
                  {entry.old_role && !entry.new_role && (
                    <p className="text-slate-700">Role <strong>{entry.old_role}</strong> removed</p>
                  )}
                  <p className="text-sm text-slate-600 mt-1">
                    <Mail className="w-4 h-4 inline mr-1" />
                    Changed by: {entry.changed_by_email}
                  </p>
                  {entry.notes && (
                    <p className="text-sm text-slate-600 italic mt-2">{entry.notes}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {userToDelete && (
        <ConfirmationModal
          isOpen={true}
          title="Remove User"
          message={`Are you sure you want to remove ${userToDelete.full_name} (${userToDelete.email})? This will revoke their access immediately.`}
          confirmLabel="Remove User"
          confirmStyle="danger"
          onConfirm={() => handleDeleteUser(userToDelete)}
          onCancel={() => setUserToDelete(null)}
        />
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Shield, Trash2, History, UserPlus } from 'lucide-react';
import { notifyError, notifySuccess, showConfirm } from '../../lib/notifications';
import { LoadingSpinner } from '../common/LoadingSpinner';

interface UserRole {
  user_id: string;
  role: 'master' | 'admin' | 'crew' | null;
  created_at: string;
  email: string;
}

interface ChangelogEntry {
  id: string;
  action: string;
  old_role: string | null;
  new_role: string | null;
  changed_by_user_id: string | null;
  notes: string | null;
  created_at: string;
}

export function PermissionsTab() {
  const [users, setUsers] = useState<UserRole[]>([]);
  const [currentUserRole, setCurrentUserRole] = useState<'master' | 'admin' | 'crew' | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedUserChangelog, setSelectedUserChangelog] = useState<string | null>(null);
  const [changelog, setChangelog] = useState<ChangelogEntry[]>([]);
  const [loadingChangelog, setLoadingChangelog] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState<'admin' | 'crew'>('crew');
  const [addingUser, setAddingUser] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error('Not authenticated');

      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle();

      setCurrentUserRole((roleData?.role?.toLowerCase() as typeof currentUserRole) ?? null);

      const { data: allRoleUsers, error: rolesError } = await supabase.rpc('get_all_role_users');

      if (rolesError) throw rolesError;

      if (!allRoleUsers || allRoleUsers.length === 0) {
        setUsers([]);
        return;
      }

      const enriched: UserRole[] = allRoleUsers.map((r: any) => ({
        user_id: r.user_id,
        role: r.user_role ? (r.user_role.toLowerCase() as UserRole['role']) : null,
        created_at: r.created_at,
        email: r.email || r.user_id,
      }));

      setUsers(enriched);
    } catch (error: any) {
      notifyError(error.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }

  async function handleRoleChange(user: UserRole, newRole: 'master' | 'admin' | 'crew') {
    if (newRole === user.role) return;

    const confirmed = await showConfirm(
      `Change role for ${user.email} from ${user.role || 'none'} to ${newRole}?`
    );
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('user_roles')
        .update({ role: newRole })
        .eq('user_id', user.user_id);

      if (error) throw error;

      notifySuccess('Role updated');
      sendPermissionChangeEmail('changed', user.email, newRole, user.role || undefined);
      fetchData();
    } catch (error: any) {
      notifyError(error.message || 'Failed to update role');
    }
  }

  async function handleRemoveRole(user: UserRole) {
    const confirmed = await showConfirm(
      `Remove all roles for ${user.email}? They will lose admin/crew access.`
    );
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', user.user_id);

      if (error) throw error;

      notifySuccess('Role removed');
      sendPermissionChangeEmail('removed', user.email, user.role || '');
      fetchData();
    } catch (error: any) {
      notifyError(error.message || 'Failed to remove role');
    }
  }

  async function handleAddUserByEmail() {
    if (!addEmail.trim()) {
      notifyError('Enter an email address');
      return;
    }
    setAddingUser(true);
    try {
      const { data, error } = await supabase.rpc('assign_role_by_email', {
        p_email: addEmail.trim().toLowerCase(),
        p_role: addRole,
      });

      if (error) throw error;
      if (data === false || data === null) {
        throw new Error('User not found. They must sign up before being assigned a role.');
      }

      notifySuccess(`Role ${addRole} assigned to ${addEmail}`);
      sendPermissionChangeEmail('added', addEmail.trim(), addRole);
      setAddEmail('');
      setShowAddForm(false);
      fetchData();
    } catch (error: any) {
      notifyError(error.message || 'Failed to assign role');
    } finally {
      setAddingUser(false);
    }
  }

  async function fetchChangelog(userId: string) {
    setLoadingChangelog(true);
    try {
      const { data, error } = await supabase
        .from('user_permissions_changelog')
        .select('*')
        .eq('target_user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      setChangelog(data || []);
      setSelectedUserChangelog(userId);
    } catch (error: any) {
      notifyError(error.message || 'Failed to load changelog');
    } finally {
      setLoadingChangelog(false);
    }
  }

  async function sendPermissionChangeEmail(
    action: string,
    userEmail: string,
    role: string,
    oldRole?: string
  ) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

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

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            to: import.meta.env.VITE_ADMIN_EMAIL || 'admin@bouncepartyclub.com',
            subject,
            html: `<p>${message}</p><p>This is an automated notification for security and audit purposes.</p>`,
          }),
        }
      );

      if (!response.ok) {
        console.warn('Permission change email returned non-2xx:', response.status);
      }
    } catch (error) {
      console.error('Failed to send permission change email:', error);
    }
  }

  const filteredUsers = users.filter(u => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      u.email.toLowerCase().includes(q) ||
      u.role?.toLowerCase().includes(q)
    );
  });

  const canManageUser = (targetRole: string | null) => {
    if (currentUserRole === 'master') return true;
    if (currentUserRole === 'admin') return targetRole === 'crew' || targetRole === null;
    return false;
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-slate-700" />
          <h2 className="text-xl font-bold text-slate-900">Permissions Management</h2>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm text-slate-500">
            Your role: <span className="font-semibold text-slate-700 capitalize">{currentUserRole || 'unknown'}</span>
          </p>
          {(currentUserRole === 'master' || currentUserRole === 'admin') && (
            <button
              onClick={() => setShowAddForm(v => !v)}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              Add User
            </button>
          )}
        </div>
      </div>

      {showAddForm && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
          <p className="text-sm font-semibold text-blue-800">Assign Role to Existing User</p>
          <p className="text-xs text-blue-600">The user must have already signed up before a role can be assigned.</p>
          <div className="flex gap-2 flex-wrap">
            <input
              type="email"
              placeholder="user@email.com"
              value={addEmail}
              onChange={e => setAddEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddUserByEmail()}
              className="flex-1 min-w-48 border border-blue-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select
              value={addRole}
              onChange={e => setAddRole(e.target.value as 'admin' | 'crew')}
              className="border border-blue-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              {currentUserRole === 'master' && <option value="admin">Admin</option>}
              <option value="crew">Crew</option>
            </select>
            <button
              onClick={handleAddUserByEmail}
              disabled={addingUser}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {addingUser ? 'Assigning...' : 'Assign'}
            </button>
            <button
              onClick={() => { setShowAddForm(false); setAddEmail(''); }}
              className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div>
        <input
          type="text"
          placeholder="Search by email or role..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="w-full border border-slate-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="space-y-3">
        {filteredUsers.length === 0 && (
          <p className="text-slate-500 text-sm text-center py-8">No users found.</p>
        )}
        {filteredUsers.map(user => (
          <div
            key={user.user_id}
            className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3"
          >
            <div className="flex-1 min-w-0">
              <p className="font-medium text-slate-900 truncate">{user.email}</p>
              <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-semibold capitalize ${
                user.role === 'master' ? 'bg-red-100 text-red-700' :
                user.role === 'admin' ? 'bg-blue-100 text-blue-700' :
                user.role === 'crew' ? 'bg-green-100 text-green-700' :
                'bg-slate-100 text-slate-500'
              }`}>
                {user.role || 'no role'}
              </span>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {canManageUser(user.role ?? null) && (
                <>
                  {currentUserRole === 'master' && (
                    <>
                      <button
                        onClick={() => handleRoleChange(user, 'master')}
                        disabled={user.role === 'master'}
                        className="text-xs px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Master
                      </button>
                      <button
                        onClick={() => handleRoleChange(user, 'admin')}
                        disabled={user.role === 'admin'}
                        className="text-xs px-2 py-1 rounded border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Admin
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => handleRoleChange(user, 'crew')}
                    disabled={user.role === 'crew'}
                    className="text-xs px-2 py-1 rounded border border-green-300 text-green-700 hover:bg-green-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Crew
                  </button>
                  <button
                    onClick={() => handleRemoveRole(user)}
                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                    title="Remove role"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}
              <button
                onClick={() => fetchChangelog(user.user_id)}
                className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                title="View changelog"
              >
                <History className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {selectedUserChangelog && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-slate-600" />
              <h3 className="font-semibold text-slate-800 text-sm">Permission History</h3>
            </div>
            <button
              onClick={() => setSelectedUserChangelog(null)}
              className="text-slate-400 hover:text-slate-600 text-sm"
            >
              Close
            </button>
          </div>
          {loadingChangelog ? (
            <div className="flex justify-center py-4">
              <LoadingSpinner />
            </div>
          ) : changelog.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-4">No history found.</p>
          ) : (
            <div className="space-y-2">
              {changelog.map(entry => (
                <div key={entry.id} className="text-sm bg-white border border-slate-100 rounded p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="font-medium text-slate-700 capitalize">
                        {entry.action === 'role_added' ? 'Role Added' :
                         entry.action === 'role_changed' ? 'Role Changed' :
                         entry.action === 'role_removed' ? 'Role Removed' :
                         entry.action}
                      </span>
                      {entry.old_role && entry.new_role && (
                        <span className="text-slate-500">
                          : <span className="capitalize">{entry.old_role}</span> → <span className="capitalize">{entry.new_role}</span>
                        </span>
                      )}
                      {!entry.old_role && entry.new_role && (
                        <span className="text-slate-500">: added as <span className="capitalize">{entry.new_role}</span></span>
                      )}
                      {entry.old_role && !entry.new_role && (
                        <span className="text-slate-500">: removed <span className="capitalize">{entry.old_role}</span></span>
                      )}
                    </div>
                    <span className="text-xs text-slate-400 flex-shrink-0">
                      {new Date(entry.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  {entry.notes ? (
                    <p className="text-xs text-slate-500 mt-1">{entry.notes}</p>
                  ) : entry.changed_by_user_id ? (
                    <p className="text-xs text-slate-400 mt-1">Changed by: {entry.changed_by_user_id.slice(0, 8)}…</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Shield, UserPlus, Trash2, History, Mail } from 'lucide-react';
import { notify } from '../../lib/notifications';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { ConfirmationModal } from '../shared/ConfirmationModal';

interface UserRole {
  id: string | null;
  user_id: string;
  role: 'master' | 'admin' | 'crew' | null;
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
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error('Not authenticated');

      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle();

      setCurrentUserRole(roleData?.role?.toLowerCase() as any || null);

      // Fetch all user roles
      const { data: userRolesData, error: rolesError } = await supabase
        .from('user_roles')
        .select(`
          id,
          user_id,
          role,
          created_at
        `)
        .order('role', { ascending: true })
        .order('created_at', { ascending: false });

      if (rolesError) throw rolesError;

      // Get session for API calls
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No session');

      // Fetch ALL authenticated users
      const allUsersResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-user-info`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ user_ids: 'all' }),
        }
      );

      if (!allUsersResponse.ok) {
        throw new Error('Failed to fetch all users');
      }

      const { userInfo } = await allUsersResponse.json();

      // Create a map of user roles
      const rolesMap = new Map<string, any>();
      (userRolesData || []).forEach(roleEntry => {
        rolesMap.set(roleEntry.user_id, roleEntry);
      });

      // Combine all users with their roles (or null if no role)
      const allUsers: UserRole[] = Object.entries(userInfo).map(([userId, info]: [string, any]) => {
        const roleEntry = rolesMap.get(userId);
        return {
          id: roleEntry?.id || null,
          user_id: userId,
          role: roleEntry?.role?.toLowerCase() || null,
          created_at: roleEntry?.created_at || info.created_at || new Date().toISOString(),
          email: info.email || 'Unknown',
          full_name: info.full_name || info.email || 'Unknown User',
        };
      });

      // Sort: users with roles first, then by role, then alphabetically
      allUsers.sort((a, b) => {
        if (a.role && !b.role) return -1;
        if (!a.role && b.role) return 1;
        if (a.role && b.role) {
          const roleOrder = { master: 0, admin: 1, crew: 2 };
          const aOrder = roleOrder[a.role];
          const bOrder = roleOrder[b.role];
          if (aOrder !== bOrder) return aOrder - bOrder;
        }
        return (a.email || '').localeCompare(b.email || '');
      });

      setUsers(allUsers);
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

  async function handleChangeRole(user: UserRole, newRole: 'master' | 'admin' | 'crew' | null) {
    if (!newRole) return;

    if (currentUserRole === 'admin' && (newRole === 'master' || newRole === 'admin')) {
      notify('Only Master users can assign Master or Admin roles', 'error');
      return;
    }

    if (currentUserRole === 'admin' && user.role === 'admin') {
      notify('Only Master users can modify Admin accounts', 'error');
      return;
    }

    try {
      // If user has no role yet, insert a new role
      if (!user.role) {
        const { error } = await supabase
          .from('user_roles')
          .insert({
            user_id: user.user_id,
            role: newRole.toUpperCase(),
          });

        if (error) throw error;

        await sendPermissionChangeEmail('added', user.email || '', newRole);
        notify('Role assigned successfully', 'success');
      } else {
        // Update existing role
        const { error } = await supabase
          .from('user_roles')
          .update({ role: newRole.toUpperCase() })
          .eq('user_id', user.user_id);

        if (error) throw error;

        await sendPermissionChangeEmail('changed', user.email || '', newRole, user.role);
        notify('Role updated successfully', 'success');
      }

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

      const userIds = (data || [])
        .map(entry => entry.changed_by_user_id)
        .filter(id => id != null) as string[];

      if (userIds.length === 0) {
        setChangelog((data || []).map(entry => ({
          ...entry,
          changed_by_email: 'System',
        })));
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No session');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-user-info`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ user_ids: userIds }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch user info');
      }

      const { userInfo } = await response.json();

      const changelogWithEmails = (data || []).map(entry => ({
        ...entry,
        changed_by_email: entry.changed_by_user_id
          ? userInfo[entry.changed_by_user_id]?.email || 'Unknown'
          : 'System',
      }));

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

  function canModifyUser(targetRole: string | null): boolean {
    if (currentUserRole === 'master') return true;
    if (currentUserRole === 'admin' && (!targetRole || targetRole === 'crew')) return true;
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

        <div className="space-y-4">
          {users.map((user) => (
            <div key={user.id} className="border-2 border-slate-200 rounded-xl p-6 hover:border-blue-300 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h4 className="text-lg font-bold text-slate-900">{user.full_name}</h4>
                    {user.role ? (
                      <span className={`px-3 py-1 rounded-full text-sm font-bold border-2 ${getRoleColor(user.role)}`}>
                        {user.role.toUpperCase()}
                      </span>
                    ) : (
                      <span className="px-3 py-1 rounded-full text-sm font-bold border-2 bg-gray-100 text-gray-600 border-gray-300">
                        NO ROLE
                      </span>
                    )}
                  </div>
                  <p className="text-slate-600">{user.email}</p>
                  <p className="text-sm text-slate-500">Added: {new Date(user.created_at).toLocaleDateString()}</p>
                </div>

                <div className="flex items-center gap-2">
                  {canModifyUser(user.role) && (
                    <>
                      <select
                        value={user.role || ''}
                        onChange={(e) => handleChangeRole(user, e.target.value as any)}
                        className="px-4 py-2 border-2 border-slate-300 rounded-lg focus:border-blue-500 focus:outline-none"
                        disabled={!canModifyUser(user.role)}
                      >
                        {!user.role && <option value="">Select Role...</option>}
                        <option value="crew">Crew</option>
                        {currentUserRole === 'master' && <option value="admin">Admin</option>}
                        {currentUserRole === 'master' && <option value="master">Master</option>}
                      </select>
                      {user.role && (
                        <>
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
                            title="Remove role"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </>
                      )}
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

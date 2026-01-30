import { supabase } from '../supabase';
import { executeQuery, QueryOptions } from './base';

export async function getAllAdminSettings(options?: QueryOptions) {
  return executeQuery(
    async () =>
      await supabase
        .from('admin_settings')
        .select('*'),
    { context: 'getAllAdminSettings', ...options }
  );
}

export async function getAdminSetting(key: string, options?: QueryOptions) {
  return executeQuery(
    async () =>
      await supabase
        .from('admin_settings')
        .select('*')
        .eq('key', key)
        .maybeSingle(),
    { context: 'getAdminSetting', ...options }
  );
}

export async function updateAdminSetting(
  key: string,
  value: any,
  options?: QueryOptions
) {
  return executeQuery(
    async () =>
      await supabase
        .from('admin_settings')
        .update({ value })
        .eq('key', key)
        .select()
        .maybeSingle(),
    { context: 'updateAdminSetting', ...options }
  );
}

export async function getAdminSettingsMap(options?: QueryOptions) {
  return executeQuery(
    async () => {
      const { data, error } = await supabase
        .from('admin_settings')
        .select('*');

      if (error) return { data: null, error };

      const settingsMap: Record<string, any> = {};
      data?.forEach((setting: any) => {
        settingsMap[setting.key] = setting.value;
      });

      return { data: settingsMap, error: null };
    },
    { context: 'getAdminSettingsMap', ...options }
  );
}

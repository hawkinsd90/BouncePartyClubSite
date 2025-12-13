# Standardized Data Fetching Patterns

This document outlines the standardized data fetching patterns implemented across the application.

## Overview

The application now uses custom hooks and centralized error handling to ensure consistent data fetching, loading states, and error management throughout all components.

## Core Components

### 1. Custom Hooks (`src/hooks/useDataFetch.ts`)

Three primary hooks are available for data operations:

#### `useDataFetch<T>`
General-purpose hook for fetching data with automatic loading and error state management.

```typescript
const { data, loading, error, refetch } = useDataFetch<MyDataType>(
  async () => {
    // Your fetch logic here
    return fetchedData;
  },
  {
    errorMessage: 'Failed to load data',
    autoFetch: true,
    showErrorNotification: true,
    onSuccess: (data) => console.log('Success!'),
    onError: (error) => console.error('Error!'),
  }
);
```

**Features:**
- Automatic loading state management
- Error handling with user notifications
- Manual refetch capability
- Optional callbacks for success/error

#### `useSupabaseQuery<T>`
Specialized hook for Supabase queries with built-in error handling.

```typescript
const { data, loading, error, refetch } = useSupabaseQuery(
  () => supabase
    .from('table_name')
    .select('*')
    .order('created_at', { ascending: false }),
  { errorMessage: 'Failed to load records' }
);
```

**Features:**
- Automatically handles Supabase response format
- Extracts data and error from Supabase response
- Throws errors for proper error boundary handling
- Shows formatted error messages to users

#### `useMutation<TData, TVariables>`
Hook for data mutations (create, update, delete operations).

```typescript
const { mutate, loading, error, data } = useMutation(
  async (variables) => {
    const { data, error } = await supabase
      .from('table')
      .update(variables)
      .eq('id', variables.id);

    if (error) throw error;
    return data;
  },
  {
    successMessage: 'Record updated successfully!',
    errorMessage: 'Failed to update record',
    onSuccess: (data) => refetchList(),
  }
);

// Use it
mutate({ id: '123', name: 'New Name' });
```

**Features:**
- Loading state during mutation
- Success/error notifications
- Callbacks for post-mutation actions
- Returns mutation result

### 2. Error Handling (`src/lib/errorHandling.ts`)

Enhanced error handling utilities with Supabase-specific support:

#### `handleError(error, context?, silent?)`
Centralized error handler with smart error formatting.

```typescript
try {
  await riskyOperation();
} catch (error) {
  handleError(error, 'MyComponent.operation');
}
```

**Features:**
- Detects and formats Supabase-specific errors
- Handles RLS permission errors gracefully
- Shows user-friendly error messages
- Logs errors with context for debugging

#### `formatSupabaseError(error)`
Formats common Supabase error codes into user-friendly messages.

**Handled Error Codes:**
- Row-level security violations → "Permission denied"
- PGRST116 → "No data found"
- 23505 → "Record already exists"
- 23503 → "Cannot delete (referenced by other data)"

#### `withErrorHandling<T>(fn, context?, silent?)`
Wrapper for async functions with automatic error handling.

```typescript
const result = await withErrorHandling(
  async () => await fetchData(),
  'MyComponent.fetchData'
);
```

#### `queryWithErrorHandling<T>(queryFn, options)`
Specialized wrapper for Supabase queries.

```typescript
const data = await queryWithErrorHandling(
  () => supabase.from('table').select('*'),
  {
    errorMessage: 'Failed to load data',
    context: 'MyComponent',
    silent: false,
  }
);
```

## Implementation Examples

### Example 1: Simple List Component

```typescript
import { useSupabaseQuery } from '../hooks/useDataFetch';
import { supabase } from '../lib/supabase';

export function UsersList() {
  const { data: users = [], loading, refetch } = useSupabaseQuery(
    () => supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false }),
    { errorMessage: 'Failed to load users' }
  );

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <button onClick={refetch}>Refresh</button>
      {users.map(user => (
        <div key={user.id}>{user.name}</div>
      ))}
    </div>
  );
}
```

### Example 2: Component with Mutations

```typescript
import { useSupabaseQuery, useMutation } from '../hooks/useDataFetch';
import { supabase } from '../lib/supabase';

export function ContactsList() {
  const { data: contacts = [], loading, refetch } = useSupabaseQuery(
    () => supabase.from('contacts').select('*').order('created_at'),
    { errorMessage: 'Failed to load contacts' }
  );

  const { mutate: updateContact, loading: saving } = useMutation(
    async (contact) => {
      const { data, error } = await supabase
        .from('contacts')
        .update(contact)
        .eq('id', contact.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    {
      successMessage: 'Contact updated!',
      errorMessage: 'Failed to update contact',
      onSuccess: () => refetch(),
    }
  );

  const handleUpdate = (contact) => {
    updateContact(contact);
  };

  // ... rest of component
}
```

### Example 3: Complex Data Loading

```typescript
import { useDataFetch } from '../hooks/useDataFetch';
import { supabase } from '../lib/supabase';
import { handleError } from '../lib/errorHandling';

interface AdminData {
  units: any[];
  orders: any[];
  settings: any;
}

export function AdminDashboard() {
  const { data, loading, refetch } = useDataFetch<AdminData>(
    async () => {
      const [unitsRes, ordersRes, settingsRes] = await Promise.all([
        supabase.from('units').select('*'),
        supabase.from('orders').select('*, customers(*)'),
        supabase.from('settings').select('*'),
      ]);

      if (unitsRes.error) throw unitsRes.error;
      if (ordersRes.error) throw ordersRes.error;
      if (settingsRes.error) throw settingsRes.error;

      return {
        units: unitsRes.data || [],
        orders: ordersRes.data || [],
        settings: settingsRes.data?.[0],
      };
    },
    {
      errorMessage: 'Failed to load dashboard data',
      onError: (error) => handleError(error, 'AdminDashboard.load'),
    }
  );

  const units = data?.units || [];
  const orders = data?.orders || [];
  const settings = data?.settings;

  // ... rest of component
}
```

## Migration Guide

### Before (Old Pattern)
```typescript
const [data, setData] = useState([]);
const [loading, setLoading] = useState(true);

useEffect(() => {
  loadData();
}, []);

async function loadData() {
  setLoading(true);
  try {
    const { data } = await supabase.from('table').select('*');
    if (data) setData(data);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    setLoading(false);
  }
}
```

### After (New Pattern)
```typescript
const { data = [], loading, refetch } = useSupabaseQuery(
  () => supabase.from('table').select('*'),
  { errorMessage: 'Failed to load data' }
);
```

## Benefits

1. **Consistency**: All components use the same patterns
2. **Less Boilerplate**: Reduced code duplication
3. **Better Error Handling**: Automatic user notifications with smart formatting
4. **Type Safety**: Full TypeScript support with generics
5. **Loading States**: Automatic loading state management
6. **Refetch Capability**: Easy data refresh without rewriting logic
7. **Testability**: Easier to test with centralized logic
8. **Maintainability**: Changes to data fetching logic update all components

## Best Practices

1. **Always specify error messages**: Provide user-friendly error messages
2. **Use appropriate hooks**: `useSupabaseQuery` for queries, `useMutation` for mutations
3. **Handle loading states**: Show loading indicators during data fetches
4. **Refetch after mutations**: Call `refetch()` after successful mutations
5. **Type your data**: Use TypeScript generics for type safety
6. **Add context to errors**: Use the context parameter for better debugging
7. **Don't silence errors unnecessarily**: Only use `silent: true` when appropriate

## Refactored Components

The following components have been updated to use the new patterns:

- `src/components/ContactsList.tsx`
- `src/components/InvoicesList.tsx`
- `src/components/OrdersManager.tsx`
- `src/pages/Admin.tsx`

## Future Improvements

Potential enhancements to consider:

1. **Caching**: Add request caching to reduce API calls
2. **Optimistic Updates**: Update UI before server confirmation
3. **Retry Logic**: Automatic retry for failed requests
4. **Debouncing**: Debounce rapid refetch calls
5. **Request Cancellation**: Cancel in-flight requests on component unmount
6. **Query Keys**: Add query key management for better cache control
7. **Suspense Support**: Add React Suspense integration

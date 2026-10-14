interface StorageOptions {
  expirationDays?: number;
  validate?: (data: any) => boolean;
}

interface StorageData<T> {
  value: T;
  timestamp: number;
  expiration?: number;
}

export class SafeStorage {
  private static isAvailable(): boolean {
    try {
      const test = '__storage_test__';
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch {
      return false;
    }
  }

  static getItem<T>(key: string, options?: StorageOptions): T | null {
    if (!this.isAvailable()) {
      console.warn('localStorage not available');
      return null;
    }

    try {
      const item = localStorage.getItem(key);
      if (!item) return null;

      const data: StorageData<T> = JSON.parse(item);

      if (data.expiration && Date.now() > data.expiration) {
        this.removeItem(key);
        return null;
      }

      if (options?.validate && !options.validate(data.value)) {
        console.warn(`Invalid data for key: ${key}`);
        this.removeItem(key);
        return null;
      }

      return data.value;
    } catch (error) {
      console.error(`Error reading from localStorage (${key}):`, error);
      this.removeItem(key);
      return null;
    }
  }

  static setItem<T>(key: string, value: T, options?: StorageOptions): boolean {
    if (!this.isAvailable()) {
      console.warn('localStorage not available');
      return false;
    }

    try {
      const data: StorageData<T> = {
        value,
        timestamp: Date.now(),
        expiration: options?.expirationDays
          ? Date.now() + (options.expirationDays * 24 * 60 * 60 * 1000)
          : undefined
      };

      localStorage.setItem(key, JSON.stringify(data));
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        console.error('localStorage quota exceeded, clearing old items...');
        this.clearOldestItems(3);

        try {
          localStorage.setItem(key, JSON.stringify({ value, timestamp: Date.now() }));
          return true;
        } catch {
          return false;
        }
      }
      console.error(`Error writing to localStorage (${key}):`, error);
      return false;
    }
  }

  static removeItem(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error(`Error removing from localStorage (${key}):`, error);
    }
  }

  private static clearOldestItems(count: number): void {
    try {
      const items: Array<{ key: string; timestamp: number }> = [];

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;

        try {
          const data = JSON.parse(localStorage.getItem(key) || '{}');
          if (data.timestamp) {
            items.push({ key, timestamp: data.timestamp });
          }
        } catch {
          continue;
        }
      }

      items.sort((a, b) => a.timestamp - b.timestamp);
      items.slice(0, count).forEach(item => localStorage.removeItem(item.key));
    } catch (error) {
      console.error('Error clearing old items:', error);
    }
  }
}

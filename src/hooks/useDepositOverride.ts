import { useState, useMemo } from 'react';

export function useDepositOverride(defaultDeposit: number) {
  const [customDepositCents, setCustomDepositCents] = useState<number | null>(null);
  const [customDepositInput, setCustomDepositInput] = useState('');

  const depositRequired = useMemo(
    () => (customDepositCents !== null ? customDepositCents : defaultDeposit),
    [customDepositCents, defaultDeposit]
  );

  function applyDepositOverride() {
    // Blank is not zero: only an explicit amount (including a typed 0) becomes an override.
    if (customDepositInput.trim() === '') return;
    const cents = Math.round(parseFloat(customDepositInput) * 100);
    if (!Number.isFinite(cents) || cents < 0) return;
    setCustomDepositCents(cents);
  }

  function clearDepositOverride() {
    setCustomDepositCents(null);
    setCustomDepositInput('');
  }

  function resetDeposit() {
    setCustomDepositCents(null);
    setCustomDepositInput('');
  }

  return {
    customDepositCents,
    customDepositInput,
    setCustomDepositInput,
    depositRequired,
    applyDepositOverride,
    clearDepositOverride,
    resetDeposit,
  };
}

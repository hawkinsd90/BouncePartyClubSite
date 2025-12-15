import { useState, useMemo } from 'react';

export function useDepositOverride(defaultDeposit: number) {
  const [customDepositCents, setCustomDepositCents] = useState<number | null>(null);
  const [customDepositInput, setCustomDepositInput] = useState('');

  const depositRequired = useMemo(
    () => (customDepositCents !== null ? customDepositCents : defaultDeposit),
    [customDepositCents, defaultDeposit]
  );

  function applyDepositOverride() {
    const cents = Math.round(parseFloat(customDepositInput || '0') * 100);
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

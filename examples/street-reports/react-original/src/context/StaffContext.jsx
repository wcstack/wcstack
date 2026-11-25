import { createContext, use, useMemo } from 'react';
import { useFetch } from '../hooks/useFetch.js';
import { useLocalStorage } from '../hooks/useLocalStorage.js';

const StaffContext = createContext(null);
const EMPTY = [];

/** The staff list and the staff member currently using the app (persisted per browser). */
export function StaffProvider({ children }) {
  const { data } = useFetch('/api/staff');
  const staff = data ?? EMPTY;
  const [storedId, setCurrentStaffId] = useLocalStorage('street-reports:staffId', null);
  const currentStaff = staff.find((s) => s.id === storedId) ?? staff[0] ?? null;

  const value = useMemo(
    () => ({ staff, currentStaff, currentStaffId: currentStaff?.id ?? null, setCurrentStaffId }),
    [staff, currentStaff, setCurrentStaffId],
  );
  return <StaffContext value={value}>{children}</StaffContext>;
}

export function useStaff() {
  return use(StaffContext);
}

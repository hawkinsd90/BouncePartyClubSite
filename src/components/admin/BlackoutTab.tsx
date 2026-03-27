import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { Calendar, ChevronLeft, ChevronRight, Ban, Clock, RefreshCw } from 'lucide-react';
import { notifyError, notifySuccess } from '../../lib/notifications';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { showConfirm } from '../../lib/notifications';
import { BlackoutDateForm } from './BlackoutDateForm';
import { BlackoutDatesList } from './BlackoutDatesList';
import type { BlackoutDate } from '../../types/index';

function annualMatchesDay(bd: BlackoutDate, d: Date): boolean {
  const bStart = new Date(bd.start_date + 'T00:00:00');
  const bEnd   = new Date(bd.end_date   + 'T00:00:00');
  const sm = bStart.getMonth();
  const sd = bStart.getDate();
  const em = bEnd.getMonth();
  const ed = bEnd.getDate();
  const y  = d.getFullYear();

  const wraps = em < sm || (em === sm && ed < sd);

  if (!wraps) {
    const ps = new Date(y, sm, sd);
    const pe = new Date(y, em, ed);
    return d >= ps && d <= pe;
  }

  const curStart  = new Date(y,     sm, sd);
  const curEnd    = new Date(y + 1, em, ed);
  if (d >= curStart && d <= curEnd) return true;

  const prevStart = new Date(y - 1, sm, sd);
  const prevEnd   = new Date(y,     em, ed);
  return d >= prevStart && d <= prevEnd;
}

function annualBlackoutMatchesDay(bd: BlackoutDate, d: Date): boolean {
  if (bd.expires_at) {
    const exp = new Date(bd.expires_at + 'T00:00:00');
    if (d > exp) return false;
  }
  if (bd.recurrence === 'one_time') {
    const start = new Date(bd.start_date + 'T00:00:00');
    const end   = new Date(bd.end_date   + 'T00:00:00');
    return d >= start && d <= end;
  }
  return annualMatchesDay(bd, d);
}

function getBlockedDaysInMonth(
  year: number,
  month: number,
  dates: BlackoutDate[],
): Set<number> {
  const blocked = new Set<number>();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    for (const bd of dates) {
      if (bd.block_type === 'full' && annualBlackoutMatchesDay(bd, d)) {
        blocked.add(day);
        break;
      }
    }
  }
  return blocked;
}

function getSameDayOnlyDaysInMonth(
  year: number,
  month: number,
  dates: BlackoutDate[],
): Set<number> {
  const sameDay = new Set<number>();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    let hasFullBlock = false;
    let hasSameDayBlock = false;

    for (const bd of dates) {
      if (annualBlackoutMatchesDay(bd, d)) {
        if (bd.block_type === 'full') hasFullBlock = true;
        if (bd.block_type === 'same_day_pickup') hasSameDayBlock = true;
      }
    }
    if (!hasFullBlock && hasSameDayBlock) sameDay.add(day);
  }
  return sameDay;
}

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const DAY_INITIALS = ['S','M','T','W','T','F','S'];

interface MiniCalendarProps {
  year: number;
  month: number;
  blockedDays: Set<number>;
  sameDayOnlyDays: Set<number>;
}

function MiniCalendar({ year, month, blockedDays, sameDayOnlyDays }: MiniCalendarProps) {
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth();
  const todayDay = today.getDate();

  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 text-center">
      <p className="text-sm font-semibold text-slate-700 mb-2">
        {MONTH_NAMES[month]} {year}
      </p>
      <div className="grid grid-cols-7 gap-0.5">
        {DAY_INITIALS.map((d, i) => (
          <div key={i} className="text-xs font-medium text-slate-400 py-0.5">{d}</div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const isToday = year === todayYear && month === todayMonth && day === todayDay;
          const isBlocked = blockedDays.has(day);
          const isSameDay = sameDayOnlyDays.has(day);

          let cellClass = 'text-xs rounded py-0.5 font-medium ';
          if (isBlocked) {
            cellClass += 'bg-red-500 text-white';
          } else if (isSameDay) {
            cellClass += 'bg-amber-400 text-white';
          } else if (isToday) {
            cellClass += 'bg-blue-100 text-blue-700 ring-1 ring-blue-400';
          } else {
            cellClass += 'text-slate-600';
          }

          return (
            <div key={i} className={cellClass}>
              {day}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function BlackoutTab() {
  const [dates, setDates] = useState<BlackoutDate[]>([]);
  const [loading, setLoading] = useState(true);
  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());

  useEffect(() => {
    fetchDates();
  }, []);

  async function fetchDates() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('blackout_dates' as any)
        .select('*')
        .order('start_date', { ascending: false });
      if (error) throw error;
      setDates((data as any) || []);
    } catch (error: any) {
      notifyError(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    const confirmed = await showConfirm(
      'Are you sure you want to remove this blackout? This action cannot be undone.',
      { confirmText: 'Remove', type: 'warning' }
    );
    if (!confirmed) return;

    try {
      const { error } = await supabase.from('blackout_dates' as any).delete().eq('id', id);
      if (error) throw error;
      notifySuccess('Blackout removed successfully');
      fetchDates();
    } catch (error: any) {
      notifyError(error.message);
    }
  }

  const calMonths = useMemo(() => {
    return Array.from({ length: 3 }, (_, i) => {
      const d = new Date(calYear, calMonth + i, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }, [calYear, calMonth]);

  function prevMonth() {
    const d = new Date(calYear, calMonth - 1, 1);
    setCalYear(d.getFullYear());
    setCalMonth(d.getMonth());
  }
  function nextMonth() {
    const d = new Date(calYear, calMonth + 1, 1);
    setCalYear(d.getFullYear());
    setCalMonth(d.getMonth());
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100">
        <LoadingSpinner />
      </div>
    );
  }

  const hasAnnual = dates.some((d) => d.recurrence === 'annual');
  const hasFull = dates.some((d) => d.block_type === 'full');
  const hasSameDay = dates.some((d) => d.block_type === 'same_day_pickup');

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100">
        <div className="flex items-center gap-3 mb-2">
          <Calendar className="w-6 h-6 text-blue-600" />
          <h2 className="text-2xl font-bold text-slate-900">Blackout Dates</h2>
        </div>
        <p className="text-slate-600 mb-6">
          Block specific date ranges from accepting bookings. Full blocks prevent all orders;
          same-day pickup blocks restrict only same-day and commercial orders on those dates.
          Annual blackouts repeat every year automatically.
        </p>

        {dates.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-4">
                <h3 className="text-sm font-semibold text-slate-700">Calendar Preview</h3>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  {hasFull && (
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 rounded-sm bg-red-500 inline-block" />
                      Full block
                    </span>
                  )}
                  {hasSameDay && (
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 rounded-sm bg-amber-400 inline-block" />
                      Same-day only
                    </span>
                  )}
                  {hasAnnual && (
                    <span className="flex items-center gap-1">
                      <RefreshCw className="w-3 h-3 text-blue-500" />
                      Annual
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={prevMonth}
                  className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4 text-slate-600" />
                </button>
                <button
                  onClick={nextMonth}
                  className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                >
                  <ChevronRight className="w-4 h-4 text-slate-600" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {calMonths.map(({ year, month }) => (
                <MiniCalendar
                  key={`${year}-${month}`}
                  year={year}
                  month={month}
                  blockedDays={getBlockedDaysInMonth(year, month, dates)}
                  sameDayOnlyDays={getSameDayOnlyDaysInMonth(year, month, dates)}
                />
              ))}
            </div>
          </div>
        )}

        <div className="space-y-6">
          <BlackoutDateForm onSuccess={fetchDates} />

          {dates.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <h3 className="text-lg font-bold text-slate-900">
                  Active Blackouts
                </h3>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">
                  {dates.length}
                </span>
                {hasAnnual && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
                    <RefreshCw className="w-3 h-3" />
                    {dates.filter((d) => d.recurrence === 'annual').length} annual
                  </span>
                )}
                {hasFull && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                    <Ban className="w-3 h-3" />
                    {dates.filter((d) => d.block_type === 'full').length} full
                  </span>
                )}
                {hasSameDay && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                    <Clock className="w-3 h-3" />
                    {dates.filter((d) => d.block_type === 'same_day_pickup').length} same-day
                  </span>
                )}
              </div>
              <BlackoutDatesList dates={dates} onDelete={handleDelete} />
            </div>
          )}

          {dates.length === 0 && (
            <p className="text-center text-slate-500 py-8">No blackout dates configured</p>
          )}
        </div>
      </div>
    </div>
  );
}

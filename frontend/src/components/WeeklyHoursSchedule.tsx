'use client';

import React from 'react';
import { formatTimePreference, formatOpeningHours } from '@/utils/time';

export interface WeeklyHoursScheduleProps {
  label?: string;
  hours: any;
  timeFormat?: '12h' | '24h';
  theme?: 'slate' | 'violet' | 'amber' | 'emerald' | 'blue' | 'rose' | 'red';
}

const WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

const DAY_ZH_NAMES: Record<string, string> = {
  Monday: '週一',
  Tuesday: '週二',
  Wednesday: '週三',
  Thursday: '週四',
  Friday: '週五',
  Saturday: '週六',
  Sunday: '週日',
  Holidays: '節假日／特別排程',
  Holidays_and_Seasonal: '節假日／特別排程',
};

// Map JS getDay() (0 = Sun, 1 = Mon ... 6 = Sat) to day name
const JS_DOW_TO_DAY: Record<number, string> = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
};

function parseStringSchedule(s: string): Record<string, string | null> | null {
  const parts = s.split(';').map(p => p.trim()).filter(Boolean);
  if (parts.length <= 1 && !/\b(?:mo|tu|we|th|fr|sa|su|週[一二三四五六日]|ph)\b/i.test(s)) {
    return null;
  }

  const result: Record<string, string | null> = {
    Monday: null,
    Tuesday: null,
    Wednesday: null,
    Thursday: null,
    Friday: null,
    Saturday: null,
    Sunday: null,
    Holidays: null,
  };

  const weekDayKeys = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  for (const part of parts) {
    if (/^(?:PH|公眾假期|節假日)\s*(?:off|closed|休息|公休)?$/i.test(part)) {
      result.Holidays = '公眾假期休息';
      continue;
    }
    const m = part.match(/^([A-Za-z,\s\-\u4e00-\u9fa5]+)\s+([0-9].*)$/);
    if (m) {
      const daySpec = m[1].trim();
      const timeSpec = m[2].trim();
      const matchedDays: string[] = [];

      if (daySpec.includes('-') || daySpec.includes('至')) {
        const [startD, endD] = daySpec.split(/[-至]/).map(d => d.trim().toLowerCase().replace(/週/g, ''));
        const shortKeys = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'];
        const zhShort = ['一', '二', '三', '四', '五', '六', '日'];
        let startIdx = shortKeys.findIndex(k => startD.startsWith(k));
        if (startIdx === -1) startIdx = zhShort.indexOf(startD);
        let endIdx = shortKeys.findIndex(k => endD.startsWith(k));
        if (endIdx === -1) endIdx = zhShort.indexOf(endD);
        if (startIdx !== -1 && endIdx !== -1) {
          for (let i = startIdx; i <= endIdx; i++) {
            matchedDays.push(weekDayKeys[i]);
          }
        }
      } else {
        const tokens = daySpec.split(/[,、\s]+/).map(t => t.trim().toLowerCase().replace(/週/g, ''));
        const shortKeys = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'];
        const zhShort = ['一', '二', '三', '四', '五', '六', '日'];
        for (const t of tokens) {
          let idx = shortKeys.findIndex(k => t.startsWith(k));
          if (idx === -1) idx = zhShort.indexOf(t);
          if (idx !== -1) matchedDays.push(weekDayKeys[idx]);
        }
      }
      for (const d of matchedDays) {
        result[d] = timeSpec;
      }
    }
  }

  const anySet = weekDayKeys.some(d => result[d]);
  if (anySet) {
    for (const d of weekDayKeys) {
      if (!result[d]) result[d] = '休息';
    }
    return result;
  }
  return null;
}

export default function FacilityWeeklyHoursSchedule({
  label = '開放時間',
  hours,
  timeFormat = '24h',
  theme = 'slate'
}: WeeklyHoursScheduleProps) {
  if (!hours) return null;

  const todayDayName = JS_DOW_TO_DAY[new Date().getDay()] || 'Monday';
  const todayZhName = DAY_ZH_NAMES[todayDayName] || '今日';

  // Normalize hours into schedule object if applicable
  let scheduleMap: Record<string, string | null> | null = null;
  if (typeof hours === 'object' && hours !== null && !Array.isArray(hours)) {
    scheduleMap = {};
    for (const [k, v] of Object.entries(hours)) {
      // Find matching standard day name
      const lower = k.toLowerCase().trim();
      const standardKey = Object.keys(DAY_ZH_NAMES).find(
        key => key.toLowerCase() === lower || key.toLowerCase().startsWith(lower)
      ) || k;
      if (v !== null && v !== undefined && String(v).toLowerCase() !== 'null' && String(v).trim() !== '') {
        scheduleMap[standardKey] = String(v).trim();
      }
    }
  } else if (typeof hours === 'string') {
    scheduleMap = parseStringSchedule(hours);
  }

  // Check if days are NOT identical
  let isVariableSchedule = false;
  let parsedDays: { key: string; label: string; hours: string; isToday: boolean }[] = [];
  let todayHoursStr = '';

  if (scheduleMap) {
    const rawTodayVal = scheduleMap[todayDayName];
    if (rawTodayVal) {
      todayHoursStr = formatOpeningHours(rawTodayVal, timeFormat);
    } else {
      todayHoursStr = label.includes('營運') || label.includes('營業') ? '休息' : '休館';
    }

    const dayValues: string[] = [];
    for (const day of WEEK_DAYS) {
      const val = scheduleMap[day];
      if (val) {
        dayValues.push(val.trim());
      }
    }

    // Variable if some days differ, or some days missing, or holidays present
    const uniqueValues = new Set(dayValues);
    const hasHolidays = Boolean(scheduleMap['Holidays'] || scheduleMap['Holidays_and_Seasonal']);
    if (uniqueValues.size > 1 || dayValues.length < 7 || hasHolidays) {
      isVariableSchedule = true;
    }

    // Build ordered list
    for (const day of WEEK_DAYS) {
      const val = scheduleMap[day];
      const isToday = day === todayDayName;
      let displayHours = val ? formatOpeningHours(val, timeFormat) : (label.includes('營運') || label.includes('營業') ? '休息' : '休館');
      if (displayHours.toLowerCase() === 'closed') {
        displayHours = label.includes('營運') || label.includes('營業') ? '休息' : '休館';
      }
      parsedDays.push({
        key: day,
        label: DAY_ZH_NAMES[day] || day,
        hours: displayHours,
        isToday
      });
    }

    // Append holidays if not null
    for (const holidayKey of ['Holidays', 'Holidays_and_Seasonal']) {
      const hVal = scheduleMap[holidayKey];
      if (hVal && hVal !== 'null' && hVal.trim() !== '') {
        parsedDays.push({
          key: holidayKey,
          label: DAY_ZH_NAMES[holidayKey] || '節假日／特別排程',
          hours: formatOpeningHours(hVal, timeFormat),
          isToday: false
        });
      }
    }
  }

  // Theme highlighting colors
  const themeTodayClass = {
    slate: 'font-semibold text-slate-900',
    violet: 'font-semibold text-violet-800',
    amber: 'font-semibold text-amber-900',
    emerald: 'font-semibold text-emerald-800',
    blue: 'font-semibold text-blue-900',
    rose: 'font-semibold text-rose-900',
    red: 'font-semibold text-red-900',
  }[theme] || 'font-semibold text-slate-900';

  // If not variable (every day is the same), display single row
  if (!isVariableSchedule || parsedDays.length === 0) {
    const singleDisplay = typeof hours === 'string'
      ? formatOpeningHours(hours, timeFormat)
      : (todayHoursStr || formatOpeningHours(Object.values(hours)[0] as string, timeFormat));

    return (
      <div className="flex justify-between items-center text-gray-600">
        <span>{label}</span>
        <span className="text-gray-900 font-medium text-right font-mono">{singleDisplay}</span>
      </div>
    );
  }

  // Variable schedule: display museum-style collapsible list
  return (
    <details className="group">
      <summary className="flex justify-between items-center text-gray-600 cursor-pointer list-none hover:text-slate-800 select-none">
        <span>{label}</span>
        <span className="text-gray-800 text-right font-medium flex items-center gap-1 font-mono">
          <span>{todayZhName}: {todayHoursStr || '未公佈'}</span>
          <span className="text-[9px] text-gray-400 group-open:rotate-180 transition-transform">▼</span>
        </span>
      </summary>
      <div className="mt-1.5 pt-1.5 border-t border-gray-100 flex flex-col gap-1 text-[10.5px]">
        {parsedDays.map((d) => (
          <div
            key={d.key}
            className={`flex justify-between gap-2 py-0.5 px-0.5 rounded ${
              d.isToday ? themeTodayClass : 'text-gray-600'
            }`}
          >
            <span className="shrink-0">{d.label}</span>
            <span className="text-right leading-tight font-mono">{d.hours}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

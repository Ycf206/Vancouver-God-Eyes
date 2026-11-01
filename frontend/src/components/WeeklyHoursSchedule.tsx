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
  const weekDayKeys = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const dayIndices: Record<string, number> = {
    monday: 0, mon: 0, '週一': 0, '一': 0,
    tuesday: 1, tue: 1, tues: 1, '週二': 1, '二': 1,
    wednesday: 2, wed: 2, '週三': 2, '三': 2,
    thursday: 3, thu: 3, thur: 3, thurs: 3, '週四': 3, '四': 3,
    friday: 4, fri: 4, '週五': 4, '五': 4,
    saturday: 5, sat: 5, '週六': 5, '六': 5,
    sunday: 6, sun: 6, '週日': 6, '日': 6
  };

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

  const parseDaysSpec = (spec: string): string[] => {
    const list: string[] = [];
    const rangeMatch = spec.match(/([a-zA-Z\u4e00-\u9fa5]+)\s*(?:to|-|至)\s*([a-zA-Z\u4e00-\u9fa5]+)/i);
    if (rangeMatch) {
      const d1 = rangeMatch[1].toLowerCase().replace(/週/g, '');
      const d2 = rangeMatch[2].toLowerCase().replace(/週/g, '');
      const i1 = dayIndices[d1];
      const i2 = dayIndices[d2];
      if (i1 !== undefined && i2 !== undefined) {
        let cur = i1;
        while (true) {
          list.push(weekDayKeys[cur]);
          if (cur === i2) break;
          cur = (cur + 1) % 7;
        }
      }
    }
    const tokens = spec.split(/[,、\s&]+|\band\b/i).map(t => t.trim().toLowerCase().replace(/週/g, ''));
    for (const t of tokens) {
      const idx = dayIndices[t];
      if (idx !== undefined && !list.includes(weekDayKeys[idx])) {
        list.push(weekDayKeys[idx]);
      }
    }
    return list;
  };

  // 1. 7 days a week / daily / 365 days (7天相同營業時間)
  if (/(?:7\s*days\s*a\s*week|seven\s*days\s*a\s*week|daily|every\s*day|365\s*days)/i.test(s)) {
    const time = s
      .replace(/,?\s*(?:7\s*days\s*a\s*week|seven\s*days\s*a\s*week|daily|every\s*day|365\s*days\s*(?:a\s*year)?|We offer our hot morning meal at)\b/gi, '')
      .replace(/^[,;\s]+|[,;\s]+$/g, '')
      .trim();
    if (time) {
      weekDayKeys.forEach(d => result[d] = time);
      return result;
    }
  }

  // 2. Colon-prefixed day sections: e.g. 'Monday – Saturday: 9 AM – 8 PM Sunday & Holidays: 9:30 AM – 8 PM'
  const dayHeaderRegex = /(?:^|\b)(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Holidays?)(?:\s*(?:to|[-–—~至])\s*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun))?(?:\s*(?:&|and)\s*Holidays?)?\s*:/gi;
  const headerMatches: { header: string; index: number; length: number }[] = [];
  let hm: RegExpExecArray | null;
  while ((hm = dayHeaderRegex.exec(s)) !== null) {
    headerMatches.push({ header: hm[0], index: hm.index, length: hm[0].length });
  }

  if (headerMatches.length > 0) {
    for (let i = 0; i < headerMatches.length; i++) {
      const cur = headerMatches[i];
      const start = cur.index + cur.length;
      const end = i + 1 < headerMatches.length ? headerMatches[i + 1].index : s.length;
      const timeVal = s.slice(start, end).replace(/^[,;\s]+|[,;\s]+$/g, '').trim();
      const daySection = cur.header.replace(/:$/, '').trim();
      const hasHolidays = /holiday/i.test(daySection);
      if (hasHolidays) {
        result.Holidays = timeVal;
      }
      const days = parseDaysSpec(daySection);
      days.forEach(d => result[d] = timeVal);
    }
    weekDayKeys.forEach(d => { if (!result[d]) result[d] = '休息'; });
    return result;
  }

  // 3. Narrative schedule extraction (e.g. "11:30 AM - 8:30 PM, Sunday, Tuesday to Thursday 11:30 AM - 9 PM Friday and Saturday Closed Monday")
  const rTimeFirst = /(?:(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)?\s*[-–—~至to]+\s*\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)\s*,?\s*([A-Za-z\s,toand\u4e00-\u9fa5]+?)(?=\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)?|Closed|休息|$))|(?:(?:Closed|休息)\s+([A-Za-z\s,toand\u4e00-\u9fa5]+))/gi;
  let match;
  let count = 0;
  while ((match = rTimeFirst.exec(s)) !== null) {
    const time = match[1];
    const daysSpec = match[2];
    const closedSpec = match[3];
    if (closedSpec) {
      const days = parseDaysSpec(closedSpec);
      days.forEach(d => result[d] = '休息');
      count++;
    } else if (time && daysSpec) {
      const days = parseDaysSpec(daysSpec);
      days.forEach(d => result[d] = time.trim());
      count++;
    }
  }

  if (count > 0 && weekDayKeys.some(k => result[k])) {
    for (const d of weekDayKeys) {
      if (!result[d]) result[d] = '休息';
    }
    return result;
  }

  // 4. Days followed by time (e.g. 'Monday to Friday 10:00-14:00' or 'Mon - Fri, 8:30am - 4:30pm')
  const rDaysFirst = /([A-Za-z\s,toand\u4e00-\u9fa5\-–—~]+?)\s*[,:\-–—~]?\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)?\s*[-–—~至to]+\s*\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)?|\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm))/gi;
  while ((match = rDaysFirst.exec(s)) !== null) {
    const daysSpec = match[1].trim();
    const time = match[2].trim();
    const days = parseDaysSpec(daysSpec);
    if (days.length > 0) {
      days.forEach(d => result[d] = time);
      count++;
    }
  }
  if (count > 0 && weekDayKeys.some(k => result[k])) {
    weekDayKeys.forEach(d => { if (!result[d]) result[d] = '休息'; });
    return result;
  }

  // 5. Days-only range e.g. "Monday to Friday" without explicit hours
  const pureDays = parseDaysSpec(s);
  if (pureDays.length > 0 && pureDays.length < 7) {
    pureDays.forEach(d => result[d] = '開放營業');
    weekDayKeys.forEach(d => { if (!result[d]) result[d] = '休息'; });
    return result;
  }

  // 2. Standard semicolon or comma separated days+time
  const parts = s.split(/[;,]/).map(p => p.trim()).filter(Boolean);
  if (parts.length <= 1 && !/\b(?:mo|tu|we|th|fr|sa|su|週[一二三四五六日]|ph)\b/i.test(s)) {
    return null;
  }

  for (const part of parts) {
    if (/^(?:PH|公眾假期|節假日)\s*(?:off|closed|休息|公休)?$/i.test(part)) {
      result.Holidays = '公眾假期休息';
      continue;
    }
    const m = part.match(/^([A-Za-z,\s\-\u4e00-\u9fa5]+)\s+([0-9].*)$/);
    if (m) {
      const daySpec = m[1].trim();
      const timeSpec = m[2].trim();
      const matchedDays = parseDaysSpec(daySpec);
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

  // 統一成圖2風格：只要成功解析出週間時程，一律呈現完整的 7 日時程列表
  if (parsedDays.length > 0) {
    return (
      <details className="group" open>
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

  // 僅在完全無法解析為星期結構時作為單行 / 單區塊備用呈現
  const singleDisplay = typeof hours === 'string'
    ? formatOpeningHours(hours, timeFormat)
    : (todayHoursStr || formatOpeningHours(Object.values(hours)[0] as string, timeFormat));

  if (typeof singleDisplay === 'string' && singleDisplay.length > 25) {
    return (
      <div className="flex flex-col gap-1 text-gray-600">
        <span className="font-semibold text-gray-700">{label}</span>
        <div className="text-gray-900 font-medium font-mono text-xs leading-relaxed bg-white/70 p-1.5 rounded border border-gray-100 break-words">
          {singleDisplay}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-between items-center text-gray-600">
      <span>{label}</span>
      <span className="text-gray-900 font-medium text-right font-mono">{singleDisplay}</span>
    </div>
  );
}

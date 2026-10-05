import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import 'dayjs/locale/zh-cn';
import type { ISODate, Millis } from '@/types/common';

/**
 * 时间工具（架构文档 §6.4）。
 * 存储一律 ISO 8601 UTC；显示统一转 UTC+8（Asia/Shanghai）。
 */

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale('zh-cn');

/** 默认时区（欣然是 UTC+8 的人） */
export const DEFAULT_TZ = 'Asia/Shanghai';

/** 当前时间 ISO 字符串（UTC） */
export function nowISO(): ISODate {
  return new Date().toISOString();
}

/** 当前毫秒时间戳 */
export function nowMs(): Millis {
  return Date.now();
}

/**
 * 时间感知字符串（FN-34）：
 * `当前时间：2026-10-04 01:08 星期六 (UTC+8)`
 */
export function formatTimeAware(d: Date | ISODate = new Date()): string {
  return `${dayjs(d).tz(DEFAULT_TZ).format('YYYY-MM-DD HH:mm dddd')} (UTC+8)`;
}

/** 常用展示格式：HH:mm */
export function formatClock(d: Date | ISODate = new Date()): string {
  return dayjs(d).tz(DEFAULT_TZ).format('HH:mm');
}

/** 常用展示格式：YYYY-MM-DD */
export function formatDate(d: Date | ISODate = new Date()): string {
  return dayjs(d).tz(DEFAULT_TZ).format('YYYY-MM-DD');
}

/** 会话列表用：今天显示时间，昨天显示「昨天」，更早显示日期 */
export function formatRelative(d: Date | ISODate): string {
  const target = dayjs(d).tz(DEFAULT_TZ);
  const today = dayjs().tz(DEFAULT_TZ);
  if (target.isSame(today, 'day')) return target.format('HH:mm');
  if (target.isSame(today.subtract(1, 'day'), 'day')) return `昨天 ${target.format('HH:mm')}`;
  if (target.isSame(today, 'year')) return target.format('M月D日');
  return target.format('YYYY-M-D');
}

/** 人类可读的相对时长（「3 分钟前」） */
export function formatAgo(d: Date | ISODate): string {
  const diff = Date.now() - dayjs(d).valueOf();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  return `${Math.floor(hour / 24)} 天前`;
}

/** 天键：YYYY-MM-DD（按 UTC+8 划分，用于按天聚合统计 PG-01） */
export function dayKey(d: Date | ISODate = new Date()): string {
  return dayjs(d).tz(DEFAULT_TZ).format('YYYY-MM-DD');
}

/** 时段判断（主动消息 quietHours 用）：返回 0~23 的小时数（UTC+8） */
export function hourOfDay(d: Date | ISODate = new Date()): number {
  return dayjs(d).tz(DEFAULT_TZ).hour();
}

/** 时段标签（时间感知提示词里也会用到） */
export type DayPart = 'lateNight' | 'morning' | 'noon' | 'afternoon' | 'evening' | 'night';

export function partOfDay(hour = hourOfDay()): DayPart {
  if (hour >= 0 && hour < 6) return 'lateNight';
  if (hour < 11) return 'morning';
  if (hour < 14) return 'noon';
  if (hour < 18) return 'afternoon';
  if (hour < 22) return 'evening';
  return 'night';
}

export const DAY_PART_LABEL: Record<DayPart, string> = {
  lateNight: '凌晨',
  morning: '早上',
  noon: '中午',
  afternoon: '下午',
  evening: '晚上',
  night: '夜里',
};

/** 'HH:mm' 是否落在 [from, to] 区间内（支持跨零点，如 23:00 → 07:00） */
export function inQuietHours(now: Date | ISODate, from: string, to: string): boolean {
  const cur = hourOfDay(now) * 60 + dayjs(now).tz(DEFAULT_TZ).minute();
  const [fh, fm] = from.split(':').map(Number);
  const [th, tm] = to.split(':').map(Number);
  const f = (fh || 0) * 60 + (fm || 0);
  const t = (th || 0) * 60 + (tm || 0);
  if (f <= t) return cur >= f && cur < t;
  return cur >= f || cur < t; // 跨零点
}

/** 两个时间点之间的分钟差 */
export function diffMinutes(a: Date | ISODate, b: Date | ISODate = new Date()): number {
  return Math.floor(Math.abs(dayjs(a).valueOf() - dayjs(b).valueOf()) / 60_000);
}

export { dayjs };

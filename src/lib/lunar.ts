// Vietnamese lunar calendar, offline (Hồ Ngọc Đức's algorithm, UTC+7): solar ↔ lunar dates,
// can chi names and the usual holidays.

const INT = Math.floor;
const TZ = 7;

export type LunarDate = { day: number; month: number; year: number; leap: boolean; jd: number };

/** Julian day number of a Gregorian date. */
export function jdFromDate(dd: number, mm: number, yy: number) {
  const a = INT((14 - mm) / 12);
  const y = yy + 4800 - a;
  const m = mm + 12 * a - 3;
  return dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - INT(y / 100) + INT(y / 400) - 32045;
}

/** [day, month, year] of a Julian day number. */
export function jdToDate(jd: number): [number, number, number] {
  const a = jd + 32044;
  const b = INT((4 * a + 3) / 146097);
  const c = a - INT((b * 146097) / 4);
  const d = INT((4 * c + 3) / 1461);
  const e = c - INT((1461 * d) / 4);
  const m = INT((5 * e + 2) / 153);
  return [e - INT((153 * m + 2) / 5) + 1, m + 3 - 12 * INT(m / 10), b * 100 + d - 4800 + INT(m / 10)];
}

/** Julian day of the k-th new moon after 1900-01-01. */
function newMoon(k: number) {
  const T = k / 1236.85;
  const T2 = T * T;
  const T3 = T2 * T;
  const dr = Math.PI / 180;
  let jd = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
  jd += 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
  const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
  const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
  const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
  let c = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
  c += -0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr) - 0.0004 * Math.sin(dr * 3 * Mpr);
  c += 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr)) - 0.0074 * Math.sin(dr * (M - Mpr));
  c += 0.0004 * Math.sin(dr * (2 * F + M)) - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr));
  c += 0.001 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
  const deltat = T < -11 ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3 : -0.000278 + 0.000265 * T + 0.000262 * T2;
  return jd + c - deltat;
}

/** Sun's longitude in radians at a Julian day. */
function sunLongitude(jdn: number) {
  const T = (jdn - 2451545.0) / 36525;
  const T2 = T * T;
  const dr = Math.PI / 180;
  const M = 357.5291 + 35999.0503 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
  const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
  const DL = (1.9146 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M) + (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.00029 * Math.sin(dr * 3 * M);
  const L = (L0 + DL) * dr;
  return L - Math.PI * 2 * INT(L / (Math.PI * 2));
}

const newMoonDay = (k: number) => INT(newMoon(k) + 0.5 + TZ / 24);
/** Which of the 12 solar terms (0–11) the day starts in. */
const sunSector = (jdn: number) => INT((sunLongitude(jdn - 0.5 - TZ / 24) / Math.PI) * 6);

/** Start of the lunar month holding the winter solstice of year `yy`. */
function lunarMonth11(yy: number) {
  const k = INT((jdFromDate(31, 12, yy) - 2415021) / 29.530588853);
  const nm = newMoonDay(k);
  return sunSector(nm) >= 9 ? newMoonDay(k - 1) : nm;
}

/** Index (after month 11) of the leap month in a 13-month year starting at `a11`. */
function leapMonthOffset(a11: number) {
  const k = INT((a11 - 2415021.076998695) / 29.530588853 + 0.5);
  let i = 1;
  let arc = sunSector(newMoonDay(k + i));
  let last;
  do {
    last = arc;
    i++;
    arc = sunSector(newMoonDay(k + i));
  } while (arc !== last && i < 14);
  return i - 1;
}

export function solarToLunar(dd: number, mm: number, yy: number): LunarDate {
  const jd = jdFromDate(dd, mm, yy);
  const k = INT((jd - 2415021.076998695) / 29.530588853);
  let monthStart = newMoonDay(k + 1);
  if (monthStart > jd) monthStart = newMoonDay(k);
  let a11 = lunarMonth11(yy);
  let b11 = a11;
  let year: number;
  if (a11 >= monthStart) {
    year = yy;
    a11 = lunarMonth11(yy - 1);
  } else {
    year = yy + 1;
    b11 = lunarMonth11(yy + 1);
  }
  const diff = INT((monthStart - a11) / 29);
  let leap = false;
  let month = diff + 11;
  if (b11 - a11 > 365) {
    const leapDiff = leapMonthOffset(a11);
    if (diff >= leapDiff) {
      month = diff + 10;
      leap = diff === leapDiff;
    }
  }
  if (month > 12) month -= 12;
  if (month >= 11 && diff < 4) year -= 1;
  return { day: jd - monthStart + 1, month, year, leap, jd };
}

/** [day, month, year] of a lunar date, or null if that leap month does not exist. */
export function lunarToSolar(day: number, month: number, year: number, leap = false): [number, number, number] | null {
  const [a11, b11] = month < 11 ? [lunarMonth11(year - 1), lunarMonth11(year)] : [lunarMonth11(year), lunarMonth11(year + 1)];
  const k = INT(0.5 + (a11 - 2415021.076998695) / 29.530588853);
  let off = month - 11;
  if (off < 0) off += 12;
  if (b11 - a11 > 365) {
    const leapOff = leapMonthOffset(a11);
    let leapMonth = leapOff - 2;
    if (leapMonth < 0) leapMonth += 12;
    if (leap && month !== leapMonth) return null;
    if (leap || off >= leapOff) off += 1;
  } else if (leap) return null;
  return jdToDate(newMoonDay(k + off) + day - 1);
}

export const lunarOf = (d: Date) => solarToLunar(d.getDate(), d.getMonth() + 1, d.getFullYear());

const CAN = ["Giáp", "Ất", "Bính", "Đinh", "Mậu", "Kỷ", "Canh", "Tân", "Nhâm", "Quý"];
const CHI = ["Tý", "Sửu", "Dần", "Mão", "Thìn", "Tỵ", "Ngọ", "Mùi", "Thân", "Dậu", "Tuất", "Hợi"];

export const yearName = (y: number) => `${CAN[(y + 6) % 10]} ${CHI[(y + 8) % 12]}`;
export const monthName = (m: number, y: number) => `${CAN[(y * 12 + m + 3) % 10]} ${CHI[(m + 1) % 12]}`;
export const dayName = (jd: number) => `${CAN[(jd + 9) % 10]} ${CHI[(jd + 1) % 12]}`;

const LUNAR_HOLIDAYS: Record<string, string> = {
  "1/1": "Tết Nguyên Đán",
  "2/1": "Tết Nguyên Đán",
  "3/1": "Tết Nguyên Đán",
  "15/1": "Rằm tháng Giêng",
  "3/3": "Tết Hàn thực",
  "10/3": "Giỗ Tổ Hùng Vương",
  "15/4": "Lễ Phật đản",
  "5/5": "Tết Đoan ngọ",
  "15/7": "Vu Lan",
  "15/8": "Tết Trung thu",
  "23/12": "Ông Công Ông Táo",
};
const SOLAR_HOLIDAYS: Record<string, string> = {
  "1/1": "Tết Dương lịch",
  "14/2": "Valentine",
  "8/3": "Quốc tế Phụ nữ",
  "30/4": "Giải phóng miền Nam",
  "1/5": "Quốc tế Lao động",
  "1/6": "Quốc tế Thiếu nhi",
  "2/9": "Quốc khánh",
  "20/10": "Phụ nữ Việt Nam",
  "20/11": "Nhà giáo Việt Nam",
  "24/12": "Đêm Giáng sinh",
  "25/12": "Giáng sinh",
};

/** Holiday names on a day (solar first). */
export function holidays(d: Date, l: LunarDate = lunarOf(d)): string[] {
  const out: string[] = [];
  const s = SOLAR_HOLIDAYS[`${d.getDate()}/${d.getMonth() + 1}`];
  if (s) out.push(s);
  if (!l.leap) {
    const name = LUNAR_HOLIDAYS[`${l.day}/${l.month}`];
    if (name) out.push(name);
    // Giao thừa: the last day of month 12, whether it has 29 or 30 days.
    if (l.month === 12 && lunarOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)).day === 1) out.push("Giao thừa");
  }
  return out;
}

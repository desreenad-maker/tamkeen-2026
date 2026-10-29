#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const SHEET_ID = '1VuBWtzN7tl-kalbRoDAgUK10TEx1DDw_VTT4HP2uIn4';
const MONTH_CONFIG = {
  8: { name: 'سبتمبر', gid: '850342778' },
  9: { name: 'أكتوبر', gid: '1102473470' },
  10: { name: 'نوفمبر', gid: '' },
};

function argValue(name){
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : '';
}

function cleanText(value){
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeArabic(value){
  return cleanText(value)
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function displayValue(value){
  const text = cleanText(value);
  return text === '-' ? '' : text;
}

function parseJsonp(raw){
  const start = raw.indexOf('(');
  const end = raw.lastIndexOf(')');
  if(start === -1 || end === -1 || end <= start) {
    throw new Error('تعذر قراءة ملف الشيت: صيغة JSONP غير صحيحة.');
  }
  return JSON.parse(raw.slice(start + 1, end));
}

function parseTsv(raw){
  const rows = raw.replace(/\r/g, '').split('\n').map(line => ({
    c: line.split('\t').map(value => value ? { v: value, f: value } : null),
  }));
  return { table: { rows } };
}

function findMatchingBlock(source, startToken, openChar, closeChar){
  const start = source.indexOf(startToken);
  if(start === -1) throw new Error(`لم أجد ${startToken} داخل ملف الرزنامة.`);
  const open = source.indexOf(openChar, start);
  if(open === -1) throw new Error(`لم أجد بداية الكتلة ${openChar} بعد ${startToken}.`);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for(let i = open; i < source.length; i += 1){
    const ch = source[i];
    if(quote){
      if(escaped){
        escaped = false;
      } else if(ch === '\\'){
        escaped = true;
      } else if(ch === quote){
        quote = '';
      }
      continue;
    }
    if(ch === '\'' || ch === '"' || ch === '`'){
      quote = ch;
      continue;
    }
    if(ch === openChar) depth += 1;
    if(ch === closeChar) {
      depth -= 1;
      if(depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`لم أستطع إغلاق كتلة ${startToken}.`);
}

function loadCalendar(htmlPath){
  const html = fs.readFileSync(htmlPath, 'utf8');
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  if(!scriptMatch) throw new Error('ملف الرزنامة لا يحتوي على سكربت البيانات.');
  const script = scriptMatch[1];
  const programsBlock = findMatchingBlock(script, 'const PROGRAMS', '{', '}');
  const monthsBlock = findMatchingBlock(script, 'const MONTHS', '[', ']');
  const evaluated = new Function(`${programsBlock};\n${monthsBlock};\nreturn { PROGRAMS, MONTHS };`)();
  return evaluated;
}

function getCell(row, index){
  const cell = row.c?.[index];
  return cleanText(cell?.f || cell?.v || '');
}

function getDateText(row){
  const cell = row.c?.[2];
  return cleanText(cell?.f || cell?.v || '');
}

function getDayFromDateCell(row, monthIndex, monthName){
  const cell = row.c?.[2];
  const raw = cleanText(cell?.v || '');
  const formatted = cleanText(cell?.f || '');
  const dateMatch = raw.match(new RegExp(`Date\\(2026,${monthIndex},(\\d+)\\)`));
  if(dateMatch) return Number(dateMatch[1]);
  const textMatch = formatted.match(new RegExp(`(\\d{1,2})\\s*-\\s*${monthName}`));
  return textMatch ? Number(textMatch[1]) : null;
}

function programKey(programName){
  const key = normalizeArabic(programName);
  if(!key) return '';
  if(key.includes('حاضنهالتوظيف')) {
    if(key.includes('6')) return 'tawzeef6';
    return key.includes('5') ? 'tawzeef5' : 'tawzeef';
  }
  if(key.includes('عنايه')) return 'inaya';
  if(key.includes('قناديل')) return 'qanadeel';
  if(key.includes('قفلناالقدرات')) return 'qiflna';
  if(key.includes('تحصيلي') || key.includes('القدرات')) return 'tahseeli';
  if(key.includes('مهاراتai') || key.includes('مهاراتالai') || key.includes('مهاراتالـai')) return 'ai';
  if(key.includes('هندسهالتفكير')) return 'fikr';
  if(key.includes('قرناس')) return 'qurnas';
  if(key.includes('مساحهام')) return 'masaha';
  if(key.includes('البرنامجالصيفي')) return 'sayfi';
  if(key.includes('امتقنيه')) return 'umtaq';
  if(key.includes('اناقوي')) return 'anaqawi';
  if(key.includes('شدن')) return 'shadn';
  if(key.includes('تاهيلالامهاتلسوقالعمل')) return 'taheel';
  if(key.includes('التدريبالتعاوني')) return 'cooperative';
  if(key.includes('اليومالوطني')) return 'national';
  if(key.includes('اليومالعالميللطفل') || key.includes('يومالطفلالعالمي')) return 'tifl';
  if(key.includes('امملهمه')) return 'mulhima';
  if(key.includes('بيتممكن')) return 'bayt';
  if(key.includes('التطوعالاحترافي')) return 'volunteer';
  return '';
}

function usefulFields(rowData){
  return [
    rowData.programName,
    rowData.course,
    rowData.action,
    rowData.trainer,
    rowData.mode,
    rowData.venue,
    rowData.supervisor,
  ].some(value => {
    const text = cleanText(value);
    return text && text !== '-';
  });
}

function isOnlyProgramName(rowData){
  return cleanText(rowData.programName)
    && [rowData.course, rowData.action, rowData.trainer, rowData.mode, rowData.venue, rowData.supervisor]
      .every(value => {
        const text = cleanText(value);
        return !text || text === '-';
      });
}

function eventSignature(event){
  return [
    event.day,
    event.p,
    cleanText(event.topic),
    cleanText(event.action),
    displayValue(event.trainer),
    displayValue(event.mode),
    displayValue(event.supervisor),
    displayValue(event.venue),
  ].join('||');
}

function eventLabel(event, programs, monthName){
  const program = programs[event.p]?.name || event.p || 'برنامج غير معروف';
  return `${event.day} ${monthName}: ${program}${event.topic ? ` - ${event.topic}` : ''}`;
}

function parseSheetRows(table, programs, monthIndex, monthName){
  const expected = [];
  const errors = [];
  const warnings = [];
  let currentDay = null;
  let carryBlocked = false;

  (table.rows || []).forEach((row, index) => {
    const rowNumber = index + 1;
    const explicitDay = getDayFromDateCell(row, monthIndex, monthName);
    const rowData = {
      programName: getCell(row, 0),
      course: getCell(row, 3),
      action: getCell(row, 4),
      trainer: getCell(row, 5),
      mode: getCell(row, 6),
      venue: getCell(row, 7),
      supervisor: getCell(row, 8),
    };
    if(normalizeArabic(rowData.programName).includes('جدولالبرامج') || normalizeArabic(rowData.programName) === 'البرنامج') return;

    if(explicitDay){
      currentDay = explicitDay;
      carryBlocked = false;
    }

    if(!usefulFields(rowData)) return;

    if(monthIndex === 8 && normalizeArabic(rowData.action) === 'بوست' && normalizeArabic(rowData.supervisor).includes('دره')){
      expected.push({
        rowNumber,
        day: 23,
        p: 'national',
        topic: 'إجازة بمناسبة اليوم الوطني',
        action: 'إجازة',
        trainer: '',
        mode: '',
        supervisor: 'درة',
        venue: '',
      });
      warnings.push(`صف ${rowNumber}: صف اليوم الوطني بلا تاريخ واضح في الشيت، وتمت مطابقته على 23 سبتمبر حسب تعليمتك السابقة.`);
      if(!explicitDay) carryBlocked = true;
      return;
    }

    const day = explicitDay || currentDay;
    let resolvedDay = day;
    let p = programKey(rowData.programName);
    const normalizedCourse = normalizeArabic(rowData.course);
    const normalizedAction = normalizeArabic(rowData.action);
    const normalizedSupervisor = normalizeArabic(rowData.supervisor);

    if(monthIndex === 8 && !explicitDay && p === 'tawzeef5' && normalizedCourse.includes('مقابلات') && normalizedAction.includes('الاستعدادوالتجهيز')) {
      resolvedDay = 1;
      warnings.push(`صف ${rowNumber}: لا يوجد تاريخ، وتمت مطابقته على 1 سبتمبر حسب ترتيب الشيت قبل 2 سبتمبر.`);
    }
    if(monthIndex === 8 && !explicitDay && p === 'tawzeef5' && isOnlyProgramName(rowData)) {
      resolvedDay = 14;
      warnings.push(`صف ${rowNumber}: لا يوجد تاريخ، وتمت مطابقته على 14 سبتمبر لأن الشيت يضع حاضنة التوظيف بين 12 و15 سبتمبر.`);
    }
    if(!explicitDay && isOnlyProgramName(rowData) && !(monthIndex === 8 && p === 'tawzeef5' && resolvedDay === 14)) {
      warnings.push(`صف ${rowNumber}: مكتوب اسم البرنامج "${rowData.programName}" فقط بدون تاريخ أو تفاصيل، فتم اعتباره عنوانًا وليس زرًا في الرزنامة.`);
      return;
    }
    if(monthIndex === 8 && !explicitDay && p === 'tawzeef5' && normalizedCourse.includes('العاداتالسبع') && normalizedSupervisor.includes('منار')) {
      resolvedDay = 27;
      warnings.push(`صف ${rowNumber}: لا يوجد تاريخ، وتمت مطابقته على 27 سبتمبر حسب موضعه قبل 28 سبتمبر.`);
    }
    if(monthIndex === 8 && !p && explicitDay === 28 && normalizedCourse.includes('الاخلاقياتالمهنيه')) {
      p = 'tawzeef5';
      warnings.push(`صف ${rowNumber}: اسم البرنامج فارغ في خلية 28 سبتمبر، وتمت قراءته كحاضنة التوظيف 5 لأن البرنامج مدموج مع الصف السابق في الشيت.`);
    }

    if(!resolvedDay){
      errors.push(`صف ${rowNumber}: لا يوجد تاريخ، ولا يوجد تاريخ سابق واضح يمكن ربط الصف به.`);
      return;
    }

    if(!explicitDay && resolvedDay === currentDay){
      warnings.push(`صف ${rowNumber}: لا يوجد تاريخ، فتم ربطه بنفس تاريخ الصف السابق: ${resolvedDay} ${monthName}.`);
    }

    if(!p){
      errors.push(`صف ${rowNumber}: اسم البرنامج غير واضح أو فارغ "${rowData.programName || '(فارغ)'}" لتاريخ ${resolvedDay} ${monthName}. اكتبي اسم البرنامج في الشيت.`);
      return;
    }

    if(!programs[p]){
      errors.push(`صف ${rowNumber}: البرنامج "${rowData.programName}" غير موجود في ألوان/تعريفات الرزنامة.`);
      return;
    }

    expected.push({
      rowNumber,
      day: resolvedDay,
      p,
      topic: rowData.course,
      action: rowData.action,
      trainer: displayValue(rowData.trainer),
      mode: displayValue(rowData.mode),
      supervisor: displayValue(rowData.supervisor),
      venue: displayValue(rowData.venue),
    });
  });

  return { expected, errors, warnings };
}

function calendarEventsForMonth(month){
  const events = [];
  Object.entries(month.data || {}).forEach(([day, dayEvents]) => {
    dayEvents.forEach(event => {
      events.push({
        day: Number(day),
        p: event.p || '',
        topic: event.topic || '',
        action: event.action || '',
        trainer: displayValue(event.trainer),
        mode: displayValue(event.mode),
        supervisor: displayValue(event.supervisor),
        venue: displayValue(event.venue),
      });
    });
  });
  return events;
}

function countBySignature(events){
  const map = new Map();
  events.forEach(event => {
    const signature = eventSignature(event);
    if(!map.has(signature)) map.set(signature, { event, count: 0 });
    map.get(signature).count += 1;
  });
  return map;
}

function compareEvents(expected, actual, programs, monthName){
  const missing = [];
  const extra = [];
  const expectedMap = countBySignature(expected);
  const actualMap = countBySignature(actual);

  expectedMap.forEach((item, signature) => {
    const actualCount = actualMap.get(signature)?.count || 0;
    if(actualCount < item.count){
      missing.push(`${eventLabel(item.event, programs, monthName)} (${item.count - actualCount} ناقص)`);
    }
  });

  actualMap.forEach((item, signature) => {
    const expectedCount = expectedMap.get(signature)?.count || 0;
    if(expectedCount < item.count){
      extra.push(`${eventLabel(item.event, programs, monthName)} (${item.count - expectedCount} زائد)`);
    }
  });

  return { missing, extra };
}

async function main(){
  const projectRoot = process.cwd();
  const htmlPath = path.resolve(projectRoot, argValue('--html') || 'index.html');
  const sheetPath = argValue('--sheet');
  const fetchSheet = process.argv.includes('--fetch');
  const allowIncompleteSheet = process.argv.includes('--allow-incomplete-sheet');
  const monthIndex = Number(argValue('--month-index') || 8);
  const monthConfig = MONTH_CONFIG[monthIndex];
  if(!monthConfig) throw new Error(`الشهر ${monthIndex + 1} غير مدعوم في فحص الرزنامة.`);
  const monthName = monthConfig.name;
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json;responseHandler=tamkeenNow&gid=${monthConfig.gid}&headers=0`;
  let rawSheet = '';

  if(sheetPath){
    rawSheet = fs.readFileSync(path.resolve(projectRoot, sheetPath), 'utf8');
  } else if(fetchSheet) {
    const response = await fetch(sheetUrl);
    if(!response.ok) throw new Error(`تعذر تحميل الشيت: ${response.status}`);
    rawSheet = await response.text();
  } else {
    throw new Error('استخدمي --sheet لمسار ملف الشيت أو --fetch للتحميل المباشر.');
  }

  const sheet = sheetPath?.toLowerCase().endsWith('.tsv') ? parseTsv(rawSheet) : parseJsonp(rawSheet);
  const { PROGRAMS, MONTHS } = loadCalendar(htmlPath);
  const month = MONTHS[monthIndex];
  if(!month) throw new Error(`ملف الرزنامة لا يحتوي على الشهر ${monthName}.`);
  const { expected, errors, warnings } = parseSheetRows(sheet.table, PROGRAMS, monthIndex, monthName);
  const actual = calendarEventsForMonth(month);
  const comparison = compareEvents(expected, actual, PROGRAMS, monthName);
  const failed = comparison.missing.length || comparison.extra.length || (!allowIncompleteSheet && errors.length);

  console.log(`فحص رزنامة ${monthName} 2026`);
  console.log(`مصدر الشيت: ${sheetPath ? path.resolve(projectRoot, sheetPath) : sheetUrl}`);
  console.log(`ملف الرزنامة: ${htmlPath}`);
  console.log(`صفوف الشيت المحولة إلى برامج: ${expected.length}`);
  console.log(`برامج الرزنامة الحالية: ${actual.length}`);
  console.log('');

  if(warnings.length){
    console.log('تنبيهات:');
    warnings.forEach(item => console.log(`- ${item}`));
    console.log('');
  }

  if(errors.length){
    console.log(allowIncompleteSheet ? 'صفوف في الشيت غير قابلة للعرض وتم تجاهلها بدون اختراع بيانات:' : 'أخطاء في الشيت تمنع النشر:');
    errors.forEach(item => console.log(`- ${item}`));
    console.log('');
  }

  if(comparison.missing.length){
    console.log('موجود في الشيت وغير موجود بنفس التفاصيل في الرزنامة:');
    comparison.missing.forEach(item => console.log(`- ${item}`));
    console.log('');
  }

  if(comparison.extra.length){
    console.log('موجود في الرزنامة وليس مطابقا للشيت:');
    comparison.extra.forEach(item => console.log(`- ${item}`));
    console.log('');
  }

  if(failed){
    console.log('النتيجة: غير مطابق. ممنوع النشر قبل تصحيح البنود أعلاه.');
    process.exit(1);
  }

  console.log(allowIncompleteSheet ? 'النتيجة: الرزنامة مطابقة للصفوف القابلة للعرض في الشيت. مسموح النشر مع تجاهل الصفوف الناقصة أعلاه.' : 'النتيجة: مطابق. مسموح النشر.');
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});

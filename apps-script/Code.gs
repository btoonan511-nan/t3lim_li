/**
 * نظام تسجيل أعمال الصيانة - شركة سماء الميدان المحدودة
 * تطبيق ويب (Google Apps Script) مرتبط بجدول Google Sheets.
 * المشرف يسجّل العمل من جواله، والصور تُحفظ في Google Drive وروابطها في الجدول.
 */

const CONFIG = {
  SHEET_NAME: 'الأعمال',
  FOLDER_NAME: 'صور أعمال الصيانة - سماء الميدان',
  // رمز دخول اختياري يعطى للمشرفين. اتركه فارغاً '' لتعطيله.
  ACCESS_CODE: '',
  MAX_PHOTOS: 4,
  MAX_PHOTO_BYTES: 5 * 1024 * 1024,
  TIME_ZONE: 'Asia/Riyadh',
};

const MAINT_TYPES = ['وقائية', 'تصحيحية'];
const REF_TYPES = ['أمر عمل', 'إشعار', 'طلب'];
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const HEADERS = [
  'رقم السجل',
  'تاريخ ووقت الإدخال',
  'اسم المشرف',
  'نوع الصيانة',
  'نوع الرقم',
  'الرقم',
  'وصف العمل',
  'مهندس الكهرباء / القسم',
  'صورة 1',
  'صورة 2',
  'صورة 3',
  'صورة 4',
  'مجلد الصور',
];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('تسجيل أعمال الصيانة')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** إعدادات تحتاجها الواجهة عند الفتح. */
function getAppConfig() {
  return {
    needsCode: CONFIG.ACCESS_CODE !== '',
    maintTypes: MAINT_TYPES,
    refTypes: REF_TYPES,
    maxPhotos: CONFIG.MAX_PHOTOS,
  };
}

/**
 * يستقبل العمل من الواجهة ويحفظه.
 * payload: {code, supervisor, maintType, refType, refNumber, description, engineer,
 *           photos: [{name, dataUrl}]}
 */
function submitWork(payload) {
  const data = validate_(payload);

  const now = new Date();
  const stamp = Utilities.formatDate(now, CONFIG.TIME_ZONE, 'yyyy-MM-dd HH:mm');

  // رفع الصور قبل القفل حتى لا يتعطل المشرفون الآخرون أثناء الرفع
  const folderName = data.refNumber + ' - ' +
    Utilities.formatDate(now, CONFIG.TIME_ZONE, 'yyyyMMdd-HHmmss');
  const folder = getRootFolder_().createFolder(folderName);
  const photoUrls = data.photos.map(function (photo, i) {
    const ext = photo.mime === 'image/png' ? 'png' : photo.mime === 'image/webp' ? 'webp' : 'jpg';
    const blob = Utilities.newBlob(photo.bytes, photo.mime, data.refNumber + '_' + (i + 1) + '.' + ext);
    return folder.createFile(blob).getUrl();
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet_();
    const row = sheet.getLastRow() + 1;
    const recordId = 'SM-' + ('00000' + (row - 1)).slice(-5);

    const photoCells = [];
    for (let i = 0; i < CONFIG.MAX_PHOTOS; i++) {
      photoCells.push(photoUrls[i] ? link_(photoUrls[i], 'صورة ' + (i + 1)) : '');
    }

    const values = [
      recordId,
      stamp,
      asText_(data.supervisor),
      data.maintType,
      data.refType,
      asText_(data.refNumber),
      asText_(data.description),
      asText_(data.engineer),
    ].concat(photoCells, [link_(folder.getUrl(), 'فتح المجلد')]);

    sheet.getRange(row, 1, 1, values.length).setValues([values]);
    return { recordId: recordId, date: stamp };
  } finally {
    lock.releaseLock();
  }
}

/** تشغيل يدوي مرة واحدة من المحرر لتجهيز الجدول والمجلد ومنح الصلاحيات. */
function setup() {
  getSheet_();
  getRootFolder_();
}

function validate_(p) {
  if (!p || typeof p !== 'object') throw new Error('بيانات غير صالحة');
  if (CONFIG.ACCESS_CODE !== '' && String(p.code || '').trim() !== CONFIG.ACCESS_CODE) {
    throw new Error('رمز الدخول غير صحيح');
  }

  const data = {
    supervisor: clean_(p.supervisor, 100),
    maintType: String(p.maintType || ''),
    refType: String(p.refType || ''),
    refNumber: clean_(p.refNumber, 50),
    description: clean_(p.description, 2000),
    engineer: clean_(p.engineer, 150),
  };

  if (!data.supervisor) throw new Error('اكتب اسم المشرف');
  if (MAINT_TYPES.indexOf(data.maintType) === -1) throw new Error('اختر نوع الصيانة');
  if (REF_TYPES.indexOf(data.refType) === -1) throw new Error('اختر نوع الرقم');
  if (!data.refNumber) throw new Error('اكتب رقم ' + data.refType);
  if (!data.description) throw new Error('اكتب وصف العمل');
  if (!data.engineer) throw new Error('اكتب اسم مهندس الكهرباء أو القسم');

  const photos = Array.isArray(p.photos) ? p.photos : [];
  if (photos.length === 0) throw new Error('أضف صورة واحدة على الأقل');
  if (photos.length > CONFIG.MAX_PHOTOS) throw new Error('الحد الأقصى ' + CONFIG.MAX_PHOTOS + ' صور');

  data.photos = photos.map(function (photo, i) {
    const match = /^data:([\w\/+.-]+);base64,(.+)$/.exec(String(photo && photo.dataUrl || ''));
    if (!match || IMAGE_TYPES.indexOf(match[1]) === -1) {
      throw new Error('الصورة ' + (i + 1) + ' غير صالحة');
    }
    const bytes = Utilities.base64Decode(match[2]);
    if (bytes.length > CONFIG.MAX_PHOTO_BYTES) throw new Error('الصورة ' + (i + 1) + ' حجمها كبير');
    return { mime: match[1], bytes: bytes };
  });

  return data;
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
    sheet.setRightToLeft(true);
    sheet.getRange(1, 1, 1, HEADERS.length)
      .setValues([HEADERS])
      .setFontWeight('bold')
      .setBackground('#0b5394')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(7, 320);
  }
  return sheet;
}

function getRootFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('ROOT_FOLDER_ID');
  if (id) {
    try {
      return DriveApp.getFolderById(id);
    } catch (e) {
      // المجلد حُذف، ننشئ مجلداً جديداً
    }
  }
  const folder = DriveApp.createFolder(CONFIG.FOLDER_NAME);
  props.setProperty('ROOT_FOLDER_ID', folder.getId());
  return folder;
}

function clean_(value, maxLen) {
  return String(value == null ? '' : value).trim().slice(0, maxLen);
}

/** يحفظ النص كما هو (بدون تحويل لأرقام أو معادلات) مثل أرقام أوامر العمل ذات الأصفار البادئة. */
function asText_(value) {
  return "'" + value;
}

function link_(url, label) {
  return '=HYPERLINK("' + url + '","' + label + '")';
}

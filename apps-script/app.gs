/**
 * نظام تسجيل أعمال الصيانة - شركة سماء الميدان المحدودة
 * ملف واحد جاهز: الصقه كاملاً في مشروع Apps Script ثم انشره كتطبيق ويب.
 * (مولّد من Code.gs و Index.html عبر build.py)
 */

const CONFIG = {
  // جدول Google Sheets ومجلد الصور في Drive
  SPREADSHEET_ID: '1vN17vKyfg6eXyLrD3yW6A0ugBa0ZE_1cE-LxVmSYzHs',
  PHOTOS_FOLDER_ID: '1S5SWqLTWbq9rmrozSUJr6dt9XToQ9EB4',
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
  return HtmlService.createHtmlOutput(INDEX_HTML)
    .setTitle('تسجيل أعمال الصيانة')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * واجهة الموقع الخارجي (GitHub Pages): يستقبل {action, payload} ويرجع {ok, data} أو {ok:false, error}.
 */
function doPost(e) {
  let result;
  try {
    const req = JSON.parse(e.postData.contents);
    if (req.action === 'submitWork') {
      result = { ok: true, data: submitWork(req.payload) };
    } else if (req.action === 'getAppConfig') {
      result = { ok: true, data: getAppConfig() };
    } else {
      throw new Error('طلب غير معروف');
    }
  } catch (err) {
    result = { ok: false, error: err.message || String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
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
  const ss = CONFIG.SPREADSHEET_ID
    ? SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
    sheet.setRightToLeft(true);
    sheet.getRange(1, 1, 1, HEADERS.length)
      .setValues([HEADERS])
      .setFontWeight('bold')
      .setBackground('#7f1d2d')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(7, 320);
  }
  return sheet;
}

function getRootFolder_() {
  if (CONFIG.PHOTOS_FOLDER_ID) return DriveApp.getFolderById(CONFIG.PHOTOS_FOLDER_ID);
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

// واجهة التطبيق (منسوخة من Index.html)
const INDEX_HTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <base target="_top">
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #ffffff;
      --text: #3a1016;
      --muted: #8a6a5e;
      --line: #c2410c;          /* برتقالي غامق */
      --line-soft: #f3c6a8;
      --wine: #7f1d2d;          /* عنابي */
      --red: #b3261e;           /* أحمر */
      --grad: linear-gradient(135deg, var(--red), var(--wine));
      --danger: #b3261e;
      --success: #2e7d32;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: 'Tajawal', system-ui, -apple-system, 'Segoe UI', sans-serif;
      background: var(--bg);
      color: var(--text);
      font-size: 16px;
    }
    header {
      background: #fff;
      padding: 18px 16px 14px;
      text-align: center;
      border-bottom: 3px solid var(--line);
    }
    header h1 {
      margin: 0;
      font-size: 22px;
      font-weight: 700;
      background: var(--grad);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    header p { margin: 4px 0 0; font-size: 13px; color: var(--line); font-weight: 500; }
    main { max-width: 560px; margin: 0 auto; padding: 16px; }
    .card {
      background: #fff;
      border: 1.5px solid var(--line);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 14px;
    }
    .title { display: block; font-weight: 700; margin-bottom: 8px; color: var(--wine); }
    .title .req { color: var(--line); }
    input[type=text], input[type=password], textarea {
      width: 100%;
      padding: 12px;
      font: inherit;
      border: 1px solid var(--line-soft);
      border-radius: 8px;
      background: #fff;
      color: var(--text);
    }
    input:focus, textarea:focus { outline: 2px solid var(--line); border-color: transparent; }
    textarea { min-height: 110px; resize: vertical; }
    .field + .field { margin-top: 16px; }
    .seg { display: flex; gap: 8px; }
    .seg input { position: absolute; opacity: 0; pointer-events: none; }
    .seg label {
      flex: 1;
      text-align: center;
      padding: 11px 6px;
      border: 1.5px solid var(--line);
      border-radius: 8px;
      cursor: pointer;
      font-weight: 500;
      color: var(--wine);
      background: #fff;
      user-select: none;
    }
    .seg input:checked + label {
      background: var(--grad);
      border-color: var(--wine);
      color: #fff;
    }
    .photos { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .slot {
      position: relative;
      aspect-ratio: 4 / 3;
      border: 2px dashed var(--line);
      border-radius: 10px;
      background: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      cursor: pointer;
      color: var(--line);
      font-weight: 500;
    }
    .slot img { width: 100%; height: 100%; object-fit: cover; }
    .slot input { display: none; }
    .slot .remove {
      position: absolute;
      top: 6px;
      left: 6px;
      width: 30px;
      height: 30px;
      border-radius: 50%;
      border: 0;
      background: var(--wine);
      color: #fff;
      font-size: 18px;
      line-height: 30px;
      cursor: pointer;
    }
    .hint { color: var(--muted); font-size: 13px; margin: 8px 0 0; }
    button.submit {
      width: 100%;
      padding: 14px;
      font: inherit;
      font-weight: 700;
      font-size: 18px;
      border: 0;
      border-radius: 10px;
      background: var(--grad);
      color: #fff;
      cursor: pointer;
      box-shadow: 0 3px 0 var(--line);
    }
    button.submit:disabled { opacity: .6; cursor: wait; }
    .msg { border-radius: 10px; padding: 14px; margin-bottom: 14px; display: none; border: 1.5px solid; }
    .msg.error { display: block; background: #fff; color: var(--danger); border-color: var(--danger); }
    .msg.ok { display: block; background: #fff; color: var(--success); border-color: var(--success); }
    .msg strong { font-size: 18px; color: var(--wine); }
    .hidden { display: none; }
  </style>
</head>
<body>
  <header>
    <h1>تسجيل أعمال الصيانة</h1>
    <p>شركة سماء الميدان المحدودة</p>
  </header>

  <main>
    <div id="msg" class="msg" role="status"></div>

    <form id="form" novalidate>
      <div class="card">
        <div class="field">
          <label class="title" for="supervisor">اسم المشرف <span class="req">*</span></label>
          <input type="text" id="supervisor" autocomplete="name">
        </div>
        <div class="field hidden" id="codeField">
          <label class="title" for="code">رمز الدخول <span class="req">*</span></label>
          <input type="password" id="code" inputmode="numeric">
        </div>
      </div>

      <div class="card">
        <div class="field">
          <span class="title">نوع الصيانة <span class="req">*</span></span>
          <div class="seg" id="maintType"></div>
        </div>
        <div class="field">
          <span class="title">نوع الرقم <span class="req">*</span></span>
          <div class="seg" id="refType"></div>
        </div>
        <div class="field">
          <label class="title" for="refNumber"><span id="refLabel">الرقم</span> <span class="req">*</span></label>
          <input type="text" id="refNumber" autocomplete="off" dir="ltr" style="text-align:right">
        </div>
        <div class="field">
          <label class="title" for="description">وصف العمل <span class="req">*</span></label>
          <textarea id="description" placeholder="مثال: استبدال فيوزات محول رقم ... بحي ..."></textarea>
        </div>
        <div class="field">
          <label class="title" for="engineer">مهندس الكهرباء / القسم المسند للعمل <span class="req">*</span></label>
          <input type="text" id="engineer" list="engineerList" autocomplete="off">
          <datalist id="engineerList"></datalist>
        </div>
      </div>

      <div class="card">
        <label class="title">الصور (حتى 4) <span class="req">*</span></label>
        <div class="photos" id="photos"></div>
        <p class="hint">اضغط على المربع لتصوير أو اختيار صورة. صورة واحدة على الأقل.</p>
      </div>

      <button type="submit" class="submit" id="submitBtn">حفظ العمل</button>
    </form>
  </main>

  <script>
    // رابط Apps Script (ينتهي بـ /exec) عند تشغيل الواجهة من موقع خارجي. يبقى فارغاً داخل Apps Script.
    var API_URL = '';
    var MAX_SIDE = 1600;
    var JPEG_QUALITY = 0.75;
    var STORE = {
      supervisor: 'sm.supervisor',
      code: 'sm.code',
      engineers: 'sm.engineers',
    };

    var config = {
      needsCode: false,
      maintTypes: ['وقائية', 'تصحيحية'],
      refTypes: ['أمر عمل', 'إشعار', 'طلب'],
      maxPhotos: 4,
    };
    var photos = [];
    var busy = false;

    function $(id) { return document.getElementById(id); }

    // يستدعي دالة في الخادم: مباشرة داخل Apps Script، أو عبر الرابط من الموقع الخارجي
    function callServer(action, payload) {
      if (window.google && google.script && google.script.run) {
        return new Promise(function (resolve, reject) {
          google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[action](payload);
        });
      }
      return fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: action, payload: payload }),
      }).then(function (r) {
        if (!r.ok) throw new Error('تعذر الاتصال بالخادم');
        return r.json();
      }).then(function (res) {
        if (!res.ok) throw new Error(res.error);
        return res.data;
      });
    }

    function storeGet(key) {
      try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
    }
    function storeSet(key, value) {
      try { localStorage.setItem(key, value); } catch (e) {}
    }

    function showMsg(type, html) {
      var el = $('msg');
      el.className = 'msg ' + type;
      el.innerHTML = html;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function clearMsg() { $('msg').className = 'msg'; }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    function renderSeg(containerId, name, options) {
      var box = $(containerId);
      box.innerHTML = '';
      options.forEach(function (opt, i) {
        var id = name + '_' + i;
        var input = document.createElement('input');
        input.type = 'radio';
        input.name = name;
        input.id = id;
        input.value = opt;
        var label = document.createElement('label');
        label.htmlFor = id;
        label.textContent = opt;
        box.appendChild(input);
        box.appendChild(label);
      });
    }

    function selected(name) {
      var el = document.querySelector('input[name="' + name + '"]:checked');
      return el ? el.value : '';
    }

    function renderPhotos() {
      var box = $('photos');
      box.innerHTML = '';
      for (var i = 0; i < config.maxPhotos; i++) {
        (function (i) {
          var slot = document.createElement('label');
          slot.className = 'slot';
          if (photos[i]) {
            var img = document.createElement('img');
            img.src = photos[i];
            img.alt = 'صورة ' + (i + 1);
            slot.appendChild(img);
            var rm = document.createElement('button');
            rm.type = 'button';
            rm.className = 'remove';
            rm.setAttribute('aria-label', 'حذف الصورة');
            rm.textContent = '×';
            rm.addEventListener('click', function (e) {
              e.preventDefault();
              photos[i] = null;
              renderPhotos();
            });
            slot.appendChild(rm);
          } else {
            slot.appendChild(document.createTextNode('+ صورة ' + (i + 1)));
            var input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.addEventListener('change', function () {
              if (input.files && input.files[0]) addPhoto(i, input.files[0]);
            });
            slot.appendChild(input);
          }
          box.appendChild(slot);
        })(i);
      }
    }

    // تصغير الصورة قبل الرفع لتوفير البيانات وتسريع الإرسال
    function compress(file) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onerror = function () { reject(new Error('تعذر قراءة الصورة')); };
        reader.onload = function () {
          var img = new Image();
          img.onerror = function () { reject(new Error('صيغة الصورة غير مدعومة')); };
          img.onload = function () {
            var scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
            var canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(file);
      });
    }

    function addPhoto(i, file) {
      compress(file).then(function (dataUrl) {
        photos[i] = dataUrl;
        renderPhotos();
      }).catch(function (err) {
        showMsg('error', escapeHtml(err.message));
      });
    }

    function rememberEngineer(name) {
      var list = storeGet(STORE.engineers) ? JSON.parse(storeGet(STORE.engineers)) : [];
      list = [name].concat(list.filter(function (n) { return n !== name; })).slice(0, 30);
      storeSet(STORE.engineers, JSON.stringify(list));
      renderEngineers(list);
    }

    function renderEngineers(list) {
      var dl = $('engineerList');
      dl.innerHTML = '';
      list.forEach(function (n) {
        var opt = document.createElement('option');
        opt.value = n;
        dl.appendChild(opt);
      });
    }

    function collect() {
      return {
        code: $('code').value.trim(),
        supervisor: $('supervisor').value.trim(),
        maintType: selected('maintType'),
        refType: selected('refType'),
        refNumber: $('refNumber').value.trim(),
        description: $('description').value.trim(),
        engineer: $('engineer').value.trim(),
        photos: photos.filter(Boolean).map(function (dataUrl, i) {
          return { name: 'photo' + (i + 1) + '.jpg', dataUrl: dataUrl };
        }),
      };
    }

    function checkLocal(d) {
      if (!d.supervisor) return 'اكتب اسم المشرف';
      if (config.needsCode && !d.code) return 'اكتب رمز الدخول';
      if (!d.maintType) return 'اختر نوع الصيانة';
      if (!d.refType) return 'اختر نوع الرقم';
      if (!d.refNumber) return 'اكتب رقم ' + d.refType;
      if (!d.description) return 'اكتب وصف العمل';
      if (!d.engineer) return 'اكتب اسم مهندس الكهرباء أو القسم';
      if (d.photos.length === 0) return 'أضف صورة واحدة على الأقل';
      return '';
    }

    function resetForm() {
      ['refNumber', 'description', 'engineer'].forEach(function (id) { $(id).value = ''; });
      document.querySelectorAll('.seg input').forEach(function (el) { el.checked = false; });
      photos = [];
      renderPhotos();
    }

    function setBusy(on, text) {
      busy = on;
      $('submitBtn').disabled = on;
      $('submitBtn').textContent = text || 'حفظ العمل';
    }

    $('form').addEventListener('input', function () {
      if ($('msg').classList.contains('error')) clearMsg();
    });

    $('refType').addEventListener('change', function () {
      $('refLabel').textContent = 'رقم ' + selected('refType');
    });

    $('form').addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy) return;
      clearMsg();
      var d = collect();
      var err = checkLocal(d);
      if (err) { showMsg('error', escapeHtml(err)); return; }

      storeSet(STORE.supervisor, d.supervisor);
      if (config.needsCode) storeSet(STORE.code, d.code);
      setBusy(true, 'جاري الحفظ...');

      callServer('submitWork', d)
        .then(function (res) {
          setBusy(false);
          rememberEngineer(d.engineer);
          resetForm();
          showMsg('ok', 'تم حفظ العمل ✔<br><strong>' + escapeHtml(res.recordId) + '</strong><br>' +
            escapeHtml(d.refType + ' ' + d.refNumber) + ' — ' + escapeHtml(res.date));
        })
        .catch(function (error) {
          setBusy(false);
          var text = (error && error.message) || 'تعذر الحفظ، تأكد من الاتصال وحاول مرة ثانية';
          if (/fetch|network/i.test(text)) text = 'تعذر الحفظ، تأكد من الاتصال وحاول مرة ثانية';
          showMsg('error', escapeHtml(text));
        });
    });

    function init() {
      $('supervisor').value = storeGet(STORE.supervisor);
      $('code').value = storeGet(STORE.code);
      var engineers = storeGet(STORE.engineers);
      renderEngineers(engineers ? JSON.parse(engineers) : []);
      renderSeg('maintType', 'maintType', config.maintTypes);
      renderSeg('refType', 'refType', config.refTypes);
      $('codeField').classList.toggle('hidden', !config.needsCode);
      renderPhotos();
    }

    init();
    callServer('getAppConfig').then(function (c) {
      config.needsCode = c.needsCode;
      $('codeField').classList.toggle('hidden', !config.needsCode);
    }).catch(function () {});
  </script>
</body>
</html>
`;

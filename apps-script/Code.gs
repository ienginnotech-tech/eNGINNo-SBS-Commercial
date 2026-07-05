/**
 * eNGINNo SBS · Commercial — Google Apps Script Web API
 * -----------------------------------------------------------
 * สะพานเชื่อมระหว่าง Google Sheets (ฐานข้อมูลจริง เก็บบน Google Drive) กับเว็บแอป (index.html)
 * รูปแบบเดียวกับ eNGINNO CHILLER & AHU/apps-script/Code.gs แต่เพิ่ม doPost สำหรับเขียนข้อมูล
 * เพราะ Commercial module ต้องอ่าน+เขียนได้ ไม่ใช่แค่อ่านอย่างเดียว
 *
 * วิธีติดตั้ง (ดูละเอียดใน README.md):
 * 1. สร้าง Google Sheet ใหม่ (จะเป็นฐานข้อมูลของระบบ)
 * 2. Extensions > Apps Script > ลบโค้ดเดิมทั้งหมด แล้ววางไฟล์นี้แทน
 * 3. Deploy > New deployment > Web app
 *      - Execute as: Me
 *      - Who has access: Anyone
 * 4. คัดลอก Web app URL ที่ได้ ไปวางใน Settings ของแอป (จะถูกเก็บเป็น sbs_gas_url ใน localStorage)
 *
 * ชีตทั้งหมดจะถูกสร้างอัตโนมัติเมื่อมีการเขียนข้อมูลครั้งแรก (ไม่ต้องสร้างเองล่วงหน้า)
 */

// ── Sheets ที่จัดการแบบเฉพาะทาง (มี action เฉพาะของตัวเอง) ──
const WR_SHEET = 'WR';
const USERS_SHEET = 'Users';
const CDKEYS_SHEET = 'CDKeys';
const CONFIG_SHEET = 'Config';

// ── Sheets ที่ sync แบบทั่วไป (เขียนทับทั้งอาเรย์ทุกครั้งที่มีการเปลี่ยนแปลงฝั่ง client) ──
const GENERIC_ENTITY_SHEETS = [
  'assets', 'ppm', 'ma', 'inv', 'energy', 'access', 'parking', 'ptw',
  'incidents', 'tenants', 'retail', 'events', 'training', 'competency', 'certs'
];

function doGet(e) {
  try {
    const action = e.parameter.action || 'query';
    if (action === 'getWR') return jsonResponse({ ok: true, data: getWRData(parseInt(e.parameter.limit, 10) || 5000) });
    if (action === 'health') return jsonResponse({ ok: true, ...getHealth() });
    if (action === 'query') return jsonResponse({ ok: true, data: queryRows(e.parameter.sheet, e.parameter.filter) });
    return jsonResponse({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const action = body.action;
    switch (action) {
      case 'insert':        return jsonResponse(actionInsert(body));
      case 'update':         return jsonResponse(actionUpdate(body));
      case 'importFixtab':   return jsonResponse(actionImportFixtab(body));
      case 'saveEntity':     return jsonResponse(actionSaveEntity(body));
      case 'login':          return jsonResponse(actionLogin(body));
      case 'register':       return jsonResponse(actionRegister(body));
      case 'approveUser':    return jsonResponse(actionSetUserStatus(body.username, 'approved'));
      case 'rejectUser':     return jsonResponse(actionSetUserStatus(body.username, 'rejected', body.reason));
      case 'suspendUser':    return jsonResponse(actionSetUserStatus(body.username, 'suspended'));
      case 'changeRole':     return jsonResponse(actionChangeRole(body.username, body.role));
      case 'deleteUser':     return jsonResponse(actionDeleteUser(body.username));
      case 'uploadFile':     return jsonResponse(actionUploadFile(body));
      case 'deleteWR':       return jsonResponse(actionDeleteWR(body.id));
      default:                return jsonResponse({ ok: false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

// ════════════════════════════════════════════════════
//  GENERIC SHEET HELPERS
// ════════════════════════════════════════════════════
function getSheet(name, create) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet && create) sheet = ss.insertSheet(name);
  return sheet;
}

/** Converts a sheet (row 1 = headers) into an array of objects. */
function sheetToObjects(sheet) {
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(function (h) { return String(h).trim(); });
  const rows = values.slice(1).filter(function (row) {
    return row.some(function (cell) { return cell !== '' && cell !== null; });
  });
  return rows.map(function (row) {
    const obj = {};
    headers.forEach(function (header, i) {
      let val = row[i];
      if (val instanceof Date) {
        val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
      }
      obj[header] = val;
    });
    return obj;
  });
}

/** Overwrites a sheet's contents (header + rows) from an array of objects. Header = union of all keys.
 *  เขียนเป็น Plain Text เสมอ (setNumberFormat('@')) ป้องกัน Sheets แปลง string วันที่/เวลา
 *  (เช่น "13:13:03") เป็น serial datetime อัตโนมัติ ซึ่งจะอ่านกลับมาผิดเพี้ยนเป็น "1899-12-30 13:13" */
function objectsToSheet(sheet, objects) {
  sheet.clearContents();
  if (!objects || objects.length === 0) return;
  const headerSet = {};
  objects.forEach(function (o) { Object.keys(o).forEach(function (k) { headerSet[k] = true; }); });
  const headers = Object.keys(headerSet);
  const rows = objects.map(function (o) { return headers.map(function (h) { return o[h] !== undefined ? o[h] : ''; }); });
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) {
    const dataRange = sheet.getRange(2, 1, rows.length, headers.length);
    dataRange.setNumberFormat('@');
    dataRange.setValues(rows);
  }
}

/** Appends one row to a sheet, creating the sheet/header from the object's own keys if needed.
 *  เขียนเป็น Plain Text เสมอเช่นเดียวกับ objectsToSheet ด้านบน */
function appendRow(sheet, obj) {
  const headers = sheet.getLastRow() > 0
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String)
    : [];
  if (headers.length === 0) {
    const newHeaders = Object.keys(obj);
    sheet.getRange(1, 1, 1, newHeaders.length).setValues([newHeaders]);
    const dataRange = sheet.getRange(2, 1, 1, newHeaders.length);
    dataRange.setNumberFormat('@');
    dataRange.setValues([newHeaders.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; })]);
    return;
  }
  const rowRange = sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length);
  rowRange.setNumberFormat('@');
  rowRange.setValues([headers.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; })]);
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ════════════════════════════════════════════════════
//  QUERY / INSERT / UPDATE  (ใช้กับ Config และชีตทั่วไปอื่น ๆ)
// ════════════════════════════════════════════════════
function queryRows(sheetName, filterJson) {
  const rows = sheetToObjects(getSheet(sheetName, false));
  if (!filterJson) return rows;
  let filter;
  try { filter = JSON.parse(filterJson); } catch (e) { return rows; }
  return rows.filter(function (row) {
    return Object.keys(filter).every(function (k) { return String(row[k]) === String(filter[k]); });
  });
}

function actionInsert(body) {
  const sheet = getSheet(body.sheet, true);
  appendRow(sheet, body.data || {});
  return { ok: true };
}

function actionUpdate(body) {
  const sheet = getSheet(body.sheet, false);
  if (!sheet) return { ok: false };
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return { ok: false };
  const headers = values[0].map(String);
  const idCol = headers.indexOf('id') >= 0 ? headers.indexOf('id') : headers.indexOf('key');
  if (idCol < 0) return { ok: false };
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][idCol]) === String(body.id)) {
      headers.forEach(function (h, c) {
        if (body.data[h] !== undefined) sheet.getRange(r + 1, c + 1).setValue(body.data[h]);
      });
      return { ok: true };
    }
  }
  return { ok: false };
}

// ════════════════════════════════════════════════════
//  WORK REQUEST (WR) — เฉพาะทาง เพราะมี import จำนวนมากจาก Fixtab
// ════════════════════════════════════════════════════
function getWRData(limit) {
  const rows = sheetToObjects(getSheet(WR_SHEET, false));
  return rows.slice(-limit);
}

function actionDeleteWR(id) {
  const sheet = getSheet(WR_SHEET, false);
  if (!sheet) return { ok: false };
  const rows = sheetToObjects(sheet).filter(function (r) { return r.id !== id; });
  objectsToSheet(sheet, rows);
  return { ok: true };
}

function actionImportFixtab(body) {
  const sheet = getSheet(WR_SHEET, true);
  const rows = sheetToObjects(sheet);
  const byId = {};
  rows.forEach(function (r) { byId[r.id] = r; });
  let inserted = 0, updated = 0;
  (body.rows || []).forEach(function (r) {
    if (byId[r.id]) { Object.assign(byId[r.id], r); updated++; }
    else { byId[r.id] = r; inserted++; }
  });
  objectsToSheet(sheet, Object.values(byId));
  return { ok: true, inserted: inserted, updated: updated };
}

// ════════════════════════════════════════════════════
//  GENERIC ENTITY SYNC (assets/ppm/ma/inv/energy/access/parking/ptw/
//  incidents/tenants/retail/events/training/competency/certs)
// ════════════════════════════════════════════════════
function actionSaveEntity(body) {
  if (GENERIC_ENTITY_SHEETS.indexOf(body.sheet) < 0) return { ok: false, error: 'Not a syncable entity: ' + body.sheet };
  const sheet = getSheet(body.sheet, true);
  objectsToSheet(sheet, body.data || []);
  return { ok: true, count: (body.data || []).length };
}

// ════════════════════════════════════════════════════
//  AUTH — Users sheet, รหัสผ่านถูก hash ฝั่ง server (salt + SHA-256) เท่านั้น
//  ไม่มีรหัสผ่านใดถูกฝังไว้ใน source code
// ════════════════════════════════════════════════════
function hashPassword(password, salt) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + password);
  return digest.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function actionLogin(body) {
  const users = sheetToObjects(getSheet(USERS_SHEET, false));
  const u = users.find(function (x) { return x.username === body.username; });
  if (!u) return { ok: false };
  if (u.status === 'pending') return { ok: false, pending: true };
  if (u.status !== 'approved') return { ok: false };
  if (hashPassword(body.password, u.salt || '') !== u.passHash) return { ok: false };
  const safeUser = {};
  Object.keys(u).forEach(function (k) { if (k !== 'passHash' && k !== 'salt') safeUser[k] = u[k]; });
  return { ok: true, user: safeUser };
}

function actionRegister(body) {
  const sheet = getSheet(USERS_SHEET, true);
  const users = sheetToObjects(sheet);
  if (users.some(function (x) { return x.username === body.username; })) {
    return { ok: false, error: 'Username นี้ถูกใช้แล้ว' };
  }
  // Bootstrap: ถ้ายังไม่มี user เลยใน Sheet นี้ ให้คนแรกที่สมัครเป็น admin ที่อนุมัติแล้วทันที
  // (ไม่งั้นจะไม่มีทางสร้าง admin คนแรกได้เลย เพราะการอนุมัติปกติต้องมี admin อยู่ก่อน)
  const isFirstUser = users.length === 0;
  const salt = Utilities.getUuid();
  appendRow(sheet, {
    id: 'U-' + Date.now(),
    username: body.username,
    name: body.name || '',
    pos: body.pos || '',
    email: body.email || '',
    dept: body.dept || '',
    building: body.building || '',
    role: isFirstUser ? 'admin' : (body.role || 'viewer'),
    bg: 'commercial',
    salt: salt,
    passHash: hashPassword(body.password, salt),
    status: isFirstUser ? 'approved' : 'pending',
    regDate: new Date().toISOString()
  });
  return { ok: true, bootstrapAdmin: isFirstUser };
}

function actionSetUserStatus(username, status, reason) {
  const sheet = getSheet(USERS_SHEET, false);
  if (!sheet) return { ok: false };
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const userCol = headers.indexOf('username');
  const statusCol = headers.indexOf('status');
  if (userCol < 0 || statusCol < 0) return { ok: false };
  for (let r = 1; r < values.length; r++) {
    if (values[r][userCol] === username) {
      sheet.getRange(r + 1, statusCol + 1).setValue(status);
      if (reason) {
        const reasonCol = headers.indexOf('rejectReason');
        if (reasonCol >= 0) sheet.getRange(r + 1, reasonCol + 1).setValue(reason);
      }
      return { ok: true };
    }
  }
  return { ok: false };
}

function actionChangeRole(username, role) {
  const sheet = getSheet(USERS_SHEET, false);
  if (!sheet) return { ok: false };
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const userCol = headers.indexOf('username');
  const roleCol = headers.indexOf('role');
  if (userCol < 0 || roleCol < 0) return { ok: false };
  for (let r = 1; r < values.length; r++) {
    if (values[r][userCol] === username) { sheet.getRange(r + 1, roleCol + 1).setValue(role); return { ok: true }; }
  }
  return { ok: false };
}

function actionDeleteUser(username) {
  const sheet = getSheet(USERS_SHEET, false);
  if (!sheet) return { ok: false };
  const users = sheetToObjects(sheet).filter(function (u) { return u.username !== username; });
  objectsToSheet(sheet, users);
  return { ok: true };
}

// ════════════════════════════════════════════════════
//  FILE UPLOAD — เก็บรูปแนบ/ลายเซ็นเป็นไฟล์ใน Google Drive โฟลเดอร์เดียวกับ Sheet
//  (ไม่เก็บเป็น base64 ในเซลล์ของ Sheet เพราะจะทำให้ไฟล์โตและช้าลงเรื่อยๆ)
// ════════════════════════════════════════════════════
const ATTACHMENTS_FOLDER_NAME = 'eNGINNo_SBS_Attachments';

function getAttachmentsFolder() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const file = DriveApp.getFileById(ss.getId());
  const parents = file.getParents();
  const parentFolder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const existing = parentFolder.getFoldersByName(ATTACHMENTS_FOLDER_NAME);
  return existing.hasNext() ? existing.next() : parentFolder.createFolder(ATTACHMENTS_FOLDER_NAME);
}

/** body: { filename, mimeType, base64Data, subfolder (เช่น WR ticket id) } */
function actionUploadFile(body) {
  if (!body.base64Data) return { ok: false, error: 'Missing base64Data' };
  const root = getAttachmentsFolder();
  let targetFolder = root;
  if (body.subfolder) {
    const existing = root.getFoldersByName(String(body.subfolder));
    targetFolder = existing.hasNext() ? existing.next() : root.createFolder(String(body.subfolder));
  }
  const bytes = Utilities.base64Decode(body.base64Data);
  const blob = Utilities.newBlob(bytes, body.mimeType || 'application/octet-stream', body.filename || 'file');
  const file = targetFolder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return {
    ok: true,
    fileId: file.getId(),
    url: file.getUrl(),
    directUrl: 'https://drive.google.com/uc?export=view&id=' + file.getId()
  };
}

// ════════════════════════════════════════════════════
//  SYSTEM HEALTH — สำหรับให้ agent/ผู้ดูแลระบบตรวจสอบภาพรวมได้ทาง API
// ════════════════════════════════════════════════════
function getHealth() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const allSheets = [WR_SHEET, USERS_SHEET, CDKEYS_SHEET, CONFIG_SHEET].concat(GENERIC_ENTITY_SHEETS);
  const counts = {};
  allSheets.forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    counts[name] = sheet ? Math.max(0, sheet.getLastRow() - 1) : 0;
  });
  return { counts: counts, generatedAt: new Date().toISOString(), spreadsheetId: ss.getId() };
}

/**
 * Pemulihan Attendance Web App (Google Apps Script)
 *
 * Required Script Properties:
 * - API_BASE_URL       e.g. https://your-backend.com/api
 * - API_TOKEN          optional bearer token
 *
 * Expected backend endpoints:
 * - GET  /meta/options
 * - GET  /auth/verify-access?email=...
 * - GET  /sessions?date=YYYY-MM-DD&teacherId=...
 * - GET  /attendance/roster?sessionId=...
 * - POST /attendance/bulk-upsert
 * - POST /kemahiran/attempt
 */

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Pemulihan Attendance')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getBootstrapData() {
  var access = getAccessContext();
  return {
    today: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    options: apiGet('/meta/options', {}),
    access: access
  };
}

function getAccessContext() {
  var email = '';
  try {
    email = Session.getActiveUser().getEmail() || '';
  } catch (err) {
    email = '';
  }

  // If email cannot be read (common for public deployments), default to read-only.
  if (!email) {
    return {
      email: '',
      verified: false,
      canEnterData: false,
      canViewAnalytics: true,
      reason: 'No signed-in Google email detected.'
    };
  }

  var res = apiGet('/auth/verify-access', { email: email });
  return {
    email: email,
    verified: Boolean(res.verified),
    canEnterData: Boolean(res.canEnterData),
    canViewAnalytics: res.canViewAnalytics !== false,
    role: res.role || '',
    reason: res.reason || ''
  };
}

function getSessions(payload) {
  payload = payload || {};
  var teacherId = payload.teacherId || getDefaultTeacherId_();
  return apiGet('/sessions', {
    date: payload.date,
    teacherId: teacherId
  });
}

function getAttendanceRoster(payload) {
  payload = payload || {};
  return apiGet('/attendance/roster', {
    sessionId: payload.sessionId
  });
}

function saveAttendance(payload) {
  payload = payload || {};
  var body = {
    sessionId: payload.sessionId,
    records: payload.records || []
  };
  return apiPost('/attendance/bulk-upsert', body);
}

function saveKemahiranAttempt(payload) {
  payload = payload || {};
  var body = {
    studentId: payload.studentId,
    kemahiranId: payload.kemahiranId,
    sessionId: payload.sessionId,
    attemptDate: payload.attemptDate,
    masteryLevel: payload.masteryLevel,
    score: payload.score,
    observedInterest: payload.observedInterest,
    teacherNote: payload.teacherNote
  };
  return apiPost('/kemahiran/attempt', body);
}

function apiGet(path, query) {
  return callApi_('get', path, null, query || {});
}

function apiPost(path, body) {
  return callApi_('post', path, body || {}, {});
}

function callApi_(method, path, body, query) {
  var scriptProps = PropertiesService.getScriptProperties();
  var baseUrl = scriptProps.getProperty('API_BASE_URL');
  var token = scriptProps.getProperty('API_TOKEN');

  if (!baseUrl) {
    throw new Error('Missing Script Property: API_BASE_URL');
  }

  var normalizedBase = baseUrl.replace(/\/$/, '');
  var url = normalizedBase + path;

  var params = query || {};
  var queryKeys = Object.keys(params).filter(function(key) {
    return params[key] !== undefined && params[key] !== null && params[key] !== '';
  });

  if (queryKeys.length > 0) {
    var encoded = queryKeys.map(function(key) {
      return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
    }).join('&');
    url += '?' + encoded;
  }

  var headers = {
    'Content-Type': 'application/json'
  };
  if (token) {
    headers.Authorization = 'Bearer ' + token;
  }

  var options = {
    method: method,
    muteHttpExceptions: true,
    headers: headers
  };

  if (method !== 'get') {
    options.payload = JSON.stringify(body || {});
  }

  var response = UrlFetchApp.fetch(url, options);
  var status = response.getResponseCode();
  var text = response.getContentText() || '{}';

  var json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error('Invalid JSON from backend: ' + text);
  }

  if (status < 200 || status > 299) {
    var message = (json && json.message) ? json.message : ('HTTP ' + status);
    throw new Error('Backend error: ' + message);
  }

  return json;
}

function getDefaultTeacherId_() {
  var teacherId = PropertiesService.getScriptProperties().getProperty('DEFAULT_TEACHER_ID');
  if (!teacherId) {
    throw new Error('Missing Script Property: DEFAULT_TEACHER_ID');
  }
  return teacherId;
}

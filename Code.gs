/**
 * Pemulihan Attendance Web App (Pure Google Sheet Backend)
 *
 * Optional Script Property:
 * - SHEET_ID (if not set, uses bound active spreadsheet)
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
  return {
    today: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    options: getOptions_(),
    access: getAccessContext()
  };
}

function getAccessContext() {
  var email = '';
  try {
    email = Session.getActiveUser().getEmail() || '';
  } catch (err) {
    email = '';
  }

  // Default behavior for GAS-only setup: allow data entry.
  // If teachers sheet has matching email and a permission column, honor it.
  var ctx = {
    email: email,
    verified: true,
    canEnterData: true,
    canViewAnalytics: true,
    role: 'teacher',
    reason: ''
  };

  var teachers = readObjects_('teachers');
  if (teachers.length && email) {
    var match = teachers.find(function(t) {
      var e = String(t.email || t.teacher_email || '').trim().toLowerCase();
      return e && e === String(email).trim().toLowerCase();
    });
    if (match) {
      var can = toBool_(match.can_enter_data, true);
      ctx.verified = true;
      ctx.canEnterData = can;
      ctx.role = String(match.role || 'teacher');
      ctx.reason = can ? '' : 'Email found but data entry disabled.';
    }
  }

  return ctx;
}

function getOptions_() {
  var subjects = readObjects_('subjects');
  var kem = readObjects_('kemahiran_master').filter(function(k) {
    return toBool_(k.is_active, true);
  });

  var kemBySubject = {};
  kem.forEach(function(k) {
    var groupCode = String(k.group_code || '').toUpperCase(); // BM / MT
    var subject = subjects.find(function(s) {
      return String(s.code || s.id || '').toUpperCase() === groupCode;
    });

    var key1 = groupCode;
    var key2 = subject ? String(subject.id || '') : '';

    var row = {
      id: k.id,
      code: String(k.code || ''),
      title: String(k.title || ''),
      topic: String(k.topic || '')
    };

    if (key1) {
      kemBySubject[key1] = kemBySubject[key1] || [];
      kemBySubject[key1].push(row);
    }
    if (key2) {
      kemBySubject[key2] = kemBySubject[key2] || [];
      kemBySubject[key2].push(row);
    }
  });

  return {
    kemahiranBySubject: kemBySubject
  };
}

function getSessions(payload) {
  payload = payload || {};
  var date = String(payload.date || '').trim();
  if (!date) {
    return { sessions: [] };
  }

  var scheduleRows = readObjects_('teacher_schedules').filter(function(r) {
    return toBool_(r.is_active, true);
  });

  var dow = dayOfWeekFromDate_(date); // 1..7

  var sessions = scheduleRows
    .filter(function(r) {
      var day = Number(r.day_of_week || r.day || 0);
      if (day && day !== dow) return false;

      var start = String(r.start_date || r.effective_from || '').trim();
      var end = String(r.end_date || r.effective_to || '').trim();
      if (start && date < normalizeDateStr_(start)) return false;
      if (end && date > normalizeDateStr_(end)) return false;
      return true;
    })
    .map(function(r) {
      var classId = String(r.class_id || r.class || '').trim();
      var subjectId = String(r.subject_id || '').trim();
      var subjectCode = String(r.group_code || r.subject_code || subjectId || '').toUpperCase();
      var className = resolveClassName_(classId);
      return {
        id: buildSessionId_(r.id, date, r.start_time || r.start, classId, subjectCode),
        classId: classId,
        className: className || classId,
        subjectId: subjectId || subjectCode,
        subjectCode: subjectCode,
        sessionDate: date,
        startTime: String(r.start_time || r.start || ''),
        endTime: String(r.end_time || r.end || '')
      };
    });

  return { sessions: sessions };
}

function getAttendanceRoster(payload) {
  payload = payload || {};
  var sessionId = String(payload.sessionId || '').trim();
  if (!sessionId) return { roster: [] };

  var parsed = parseSessionId_(sessionId);
  if (!parsed) return { roster: [] };

  var enrollments = readObjects_('student_group_enrollments').filter(function(e) {
    if (!toBool_(e.is_active, true)) return false;

    var classOk = String(e.class_id || '').trim() === parsed.classId;
    var subject = String(e.subject_id || '').toUpperCase();
    var subjectOk = subject === parsed.subjectCode || subject === parsed.subjectId;

    if (!classOk || !subjectOk) return false;

    var start = String(e.start_date || '').trim();
    var end = String(e.end_date || '').trim();
    var d = parsed.date;
    if (start && d < normalizeDateStr_(start)) return false;
    if (end && d > normalizeDateStr_(end)) return false;

    return true;
  });

  var students = readObjects_('students');
  var existing = readObjects_('attendance_records').filter(function(a) {
    return String(a.session_id || '') === sessionId;
  });

  var roster = enrollments.map(function(e) {
    var sid = String(e.student_id || '').trim();
    var stu = students.find(function(s) { return String(s.id || '') === sid; }) || {};
    var attendance = existing.find(function(a) { return String(a.student_id || '') === sid; }) || {};

    return {
      studentId: sid,
      studentName: String(stu.full_name || stu.name || sid),
      className: resolveClassName_(String(e.class_id || '')),
      subjectId: parsed.subjectId || parsed.subjectCode,
      subjectCode: parsed.subjectCode,
      attendanceStatus: String(attendance.attendance_status || 'present')
    };
  });

  return { roster: roster };
}

function saveAttendance(payload) {
  payload = payload || {};
  var sessionId = String(payload.sessionId || '').trim();
  var records = payload.records || [];
  if (!sessionId) throw new Error('Missing sessionId');

  var sheet = getSheet_('attendance_records');
  var data = getTable_('attendance_records');
  var headers = data.headers;
  var rows = data.rows;

  records.forEach(function(r) {
    var sid = String(r.studentId || '').trim();
    if (!sid) return;
    var key = sessionId + '|' + sid;

    var idx = rows.findIndex(function(row) {
      return String(row.session_id || '') + '|' + String(row.student_id || '') === key;
    });

    var now = new Date();
    if (idx >= 0) {
      rows[idx].attendance_status = String(r.attendanceStatus || 'present');
      rows[idx].recorded_at = now;
    } else {
      rows.push({
        id: nextId_('ATT', rows),
        session_id: sessionId,
        student_id: sid,
        attendance_status: String(r.attendanceStatus || 'present'),
        recorded_at: now
      });
    }
  });

  writeObjects_(sheet, headers, rows);
  return { ok: true };
}

function saveKemahiranAttempt(payload) {
  payload = payload || {};
  var rows = getTable_('kemahiran').rows;
  rows.push({
    id: nextId_('KLOG', rows),
    student_id: String(payload.studentId || ''),
    kemahiran_id: String(payload.kemahiranId || ''),
    session_id: String(payload.sessionId || ''),
    attempt_date: String(payload.attemptDate || ''),
    mastery_level: String(payload.masteryLevel || ''),
    score: payload.score === null || payload.score === undefined ? '' : payload.score,
    observed_interest: payload.observedInterest === null || payload.observedInterest === undefined ? '' : payload.observedInterest,
    teacher_note: String(payload.teacherNote || ''),
    created_at: new Date()
  });

  var tbl = getTable_('kemahiran');
  writeObjects_(getSheet_('kemahiran'), tbl.headers, rows);
  return { ok: true };
}

function getStudentGroupSettings() {
  var students = readObjects_('students');
  var enrollments = readObjects_('student_group_enrollments').filter(function(e) {
    return toBool_(e.is_active, true);
  });

  var rows = students.map(function(s) {
    var sid = String(s.id || '');
    var classId = String(s.class_id || '');
    var mine = enrollments.filter(function(e) {
      return String(e.student_id || '') === sid && String(e.class_id || '') === classId;
    });

    var hasBM = mine.some(function(e) { return String(e.subject_id || '').toUpperCase() === 'BM'; });
    var hasMT = mine.some(function(e) { return String(e.subject_id || '').toUpperCase() === 'MT'; });

    return {
      studentId: sid,
      fullName: String(s.full_name || ''),
      classId: classId,
      className: resolveClassName_(classId),
      groupMode: hasBM && hasMT ? 'BOTH' : (hasMT ? 'MT' : 'BM')
    };
  });

  return { rows: rows };
}

function saveStudentGroupSettings(payload) {
  payload = payload || {};
  var inputRows = payload.rows || [];
  var tbl = getTable_('student_group_enrollments');
  var rows = tbl.rows;

  inputRows.forEach(function(r) {
    var sid = String(r.studentId || '').trim();
    var classId = String(r.classId || '').trim();
    var mode = String(r.groupMode || 'BM').toUpperCase();
    if (!sid || !classId) return;

    rows = rows.filter(function(e) {
      if (String(e.student_id || '') !== sid) return true;
      if (String(e.class_id || '') !== classId) return true;
      var sub = String(e.subject_id || '').toUpperCase();
      return sub !== 'BM' && sub !== 'MT';
    });

    if (mode === 'BM' || mode === 'BOTH') {
      rows.push({
        id: nextId_('ENR', rows),
        student_id: sid,
        class_id: classId,
        subject_id: 'BM',
        start_date: today_(),
        end_date: '',
        is_active: true
      });
    }
    if (mode === 'MT' || mode === 'BOTH') {
      rows.push({
        id: nextId_('ENR', rows),
        student_id: sid,
        class_id: classId,
        subject_id: 'MT',
        start_date: today_(),
        end_date: '',
        is_active: true
      });
    }
  });

  writeObjects_(getSheet_('student_group_enrollments'), tbl.headers, rows);
  return { ok: true };
}

function getTeacherSchedules() {
  var rows = readObjects_('teacher_schedules').map(function(r) {
    return {
      id: String(r.id || ''),
      classId: String(r.class_id || ''),
      className: resolveClassName_(String(r.class_id || '')),
      groupCode: String(r.group_code || r.subject_code || r.subject_id || '').toUpperCase(),
      dayOfWeek: String(r.day_of_week || r.day || '1'),
      startTime: String(r.start_time || r.start || ''),
      endTime: String(r.end_time || r.end || ''),
      isActive: toBool_(r.is_active, true)
    };
  });
  return { rows: rows };
}

function saveTeacherSchedules(payload) {
  payload = payload || {};
  var inputRows = payload.rows || [];
  var tbl = getTable_('teacher_schedules');
  var rows = tbl.rows;

  inputRows.forEach(function(r) {
    var id = String(r.id || '').trim();
    var mapped = {
      id: id || nextId_('TS', rows),
      class_id: String(r.classId || ''),
      group_code: String(r.groupCode || '').toUpperCase(),
      day_of_week: Number(r.dayOfWeek || 1),
      start_time: String(r.startTime || ''),
      end_time: String(r.endTime || ''),
      is_active: r.isActive !== false
    };

    var idx = rows.findIndex(function(x) { return String(x.id || '') === mapped.id; });
    if (idx >= 0) rows[idx] = Object.assign({}, rows[idx], mapped);
    else rows.push(mapped);
  });

  writeObjects_(getSheet_('teacher_schedules'), tbl.headers, rows);
  return { ok: true };
}

// ---------- Helpers ----------

function getSpreadsheet_() {
  var propId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (propId) return SpreadsheetApp.openById(propId);
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet_(name) {
  var sh = getSpreadsheet_().getSheetByName(name);
  if (!sh) throw new Error('Missing sheet: ' + name);
  return sh;
}

function getTable_(name) {
  var sh = getSheet_(name);
  var values = sh.getDataRange().getValues();
  if (!values.length) return { headers: [], rows: [] };

  var headers = values[0].map(function(h) { return String(h || '').trim(); });
  var rows = values.slice(1)
    .filter(function(r) { return r.join('') !== ''; })
    .map(function(r) {
      var obj = {};
      headers.forEach(function(h, i) { obj[h] = r[i]; });
      return obj;
    });

  return { headers: headers, rows: rows };
}

function readObjects_(name) {
  return getTable_(name).rows;
}

function writeObjects_(sheet, headers, rows) {
  var out = [headers];
  rows.forEach(function(r) {
    out.push(headers.map(function(h) {
      return r[h] === undefined ? '' : r[h];
    }));
  });

  sheet.clearContents();
  sheet.getRange(1, 1, out.length, headers.length).setValues(out);
}

function toBool_(val, fallback) {
  if (val === true || val === false) return val;
  if (val === null || val === undefined || val === '') return fallback;
  var s = String(val).toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return fallback;
}

function resolveClassName_(classId) {
  var id = String(classId || '').trim();
  if (!id) return '';
  var cls = readObjects_('classes').find(function(c) {
    return String(c.id || '') === id || String(c.class_name || '') === id;
  });
  return cls ? String(cls.class_name || cls.id || id) : id;
}

function dayOfWeekFromDate_(yyyyMmDd) {
  var d = new Date(yyyyMmDd + 'T00:00:00');
  var jsDay = d.getDay(); // 0=Sun..6=Sat
  return jsDay === 0 ? 7 : jsDay;
}

function normalizeDateStr_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(v).trim().slice(0, 10);
}

function today_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function nextId_(prefix, rows) {
  var max = 0;
  rows.forEach(function(r) {
    var id = String(r.id || '');
    if (id.indexOf(prefix) !== 0) return;
    var n = Number(id.replace(prefix, '').replace(/[^0-9]/g, ''));
    if (!isNaN(n) && n > max) max = n;
  });
  var next = max + 1;
  return prefix + Utilities.formatString('%03d', next);
}

function buildSessionId_(scheduleId, date, startTime, classId, subjectCode) {
  return [
    'S',
    String(scheduleId || ''),
    String(date || ''),
    String(startTime || ''),
    String(classId || ''),
    String(subjectCode || '')
  ].join('|');
}

function parseSessionId_(sessionId) {
  var parts = String(sessionId || '').split('|');
  if (parts.length < 6 || parts[0] !== 'S') return null;
  return {
    scheduleId: parts[1],
    date: parts[2],
    startTime: parts[3],
    classId: parts[4],
    subjectCode: parts[5],
    subjectId: parts[5]
  };
}

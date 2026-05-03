/**
 * Pemulihan Attendance Web App (Pure Google Sheet Backend)
 *
 * Optional Script Property:
 * - SHEET_ID (if not set, uses bound active spreadsheet)
 */

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Pemulihan Manager')
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

function getAttendanceDashboard(payload) {
  payload = payload || {};
  var studentId = String(payload.studentId || '').trim();
  var month = String(payload.month || '').trim(); // yyyy-mm
  if (!studentId || !month) return { student: null, month: month, subjects: [] };

  var students = readObjects_('students');
  var student = students.find(function(s) { return String(s.id || '') === studentId; }) || null;
  if (!student) return { student: null, month: month, subjects: [] };

  var enrollments = readObjects_('student_group_enrollments').filter(function(e) {
    return String(e.student_id || '') === studentId && toBool_(e.is_active, true);
  });
  var subjectCodes = {};
  enrollments.forEach(function(e) {
    var code = resolveSubjectCode_(e.subject_id || '');
    if (code === 'BM' || code === 'MT') subjectCodes[code] = true;
  });

  var attendance = readObjects_('attendance_records').filter(function(a) {
    return String(a.student_id || '') === studentId;
  });

  var kemLog = readObjects_('kemahiran').filter(function(k) {
    return String(k.student_id || '') === studentId;
  });
  var kemMaster = readObjects_('kemahiran_master');

  function calc(code) {
    var subjectId = resolveSubjectId_(code);
    var rows = attendance.filter(function(a) {
      return resolveSubjectCode_(a.subject_id || '') === code;
    });
    var monthRows = rows.filter(function(a) {
      var d = normalizeDateInput_(a.attendance_date || '');
      return d.slice(0, 7) === month;
    });

    function summarize(list) {
      var denom = 0;
      var hadir = 0;
      list.forEach(function(r) {
        var s = String(r.attendance_status || '').toLowerCase();
        if (s === 'present' || s === 'absent' || s === 'excused' || s === 'late') {
          denom += 1;
          if (s === 'present' || s === 'late') hadir += 1;
        }
      });
      return denom ? Math.round((hadir / denom) * 100) : 0;
    }

    var latest = findLatestKemahiran_(kemLog, kemMaster, code);
    return {
      code: code,
      subjectId: subjectId,
      selectedPercent: summarize(monthRows),
      totalPercent: summarize(rows),
      latestKemahiran: latest
    };
  }

  var subjects = [];
  if (subjectCodes.BM) subjects.push(calc('BM'));
  if (subjectCodes.MT) subjects.push(calc('MT'));

  return {
    student: {
      id: String(student.id || ''),
      fullName: String(student.full_name || student.name || ''),
      classId: String(student.class_id || '')
    },
    month: month,
    subjects: subjects
  };
}

function getAttendanceDashboardView(payload) {
  payload = payload || {};
  var mode = String(payload.mode || 'INDIVIDU').toUpperCase();
  var studentId = String(payload.studentId || '').trim();
  var subjectCode = resolveSubjectCode_(String(payload.subjectCode || 'BM'));

  var students = readObjects_('students');
  var enrollments = readObjects_('student_group_enrollments');
  var cumulative = readObjects_('attendance_cumulative');
  var kemMaster = readObjects_('kemahiran_master');

  var cumMap = {};
  cumulative.forEach(function(r) {
    cumMap[String(r.student_id || '').trim()] = r;
  });

  function latestKemahiranLabel_(raw) {
    var v = String(raw || '').trim();
    if (!v || v.toLowerCase() === 'no record') return 'no record';
    var m = kemMaster.find(function(k) { return String(k.id || '') === v; });
    if (!m) return v;
    var code = String(m.code || '').trim();
    var title = String(m.title || '').trim();
    return code ? (code + '. ' + title) : title;
  }

  if (mode === 'INDIVIDU') {
    var stu = students.find(function(s) { return String(s.id || '') === studentId; });
    if (!stu) return { student: null, subjects: [] };

    var sEnroll = enrollments.filter(function(e) {
      return String(e.student_id || '') === studentId;
    });
    var hasBM = sEnroll.some(function(e) { return resolveSubjectCode_(e.subject_id || '') === 'BM'; });
    var hasMT = sEnroll.some(function(e) { return resolveSubjectCode_(e.subject_id || '') === 'MT'; });
    var c = cumMap[studentId] || {};
    var total = String(c.total_attendance || c.peratus_kehadiran || c.peratus || '0%');
    var latest = latestKemahiranLabel_(c.latest_kemahiran || c.kemahiran_terkini || 'no record');
    var subjects = [];
    if (hasBM) subjects.push({ code: 'BM', totalPercent: total, latestKemahiran: latest });
    if (hasMT) subjects.push({ code: 'MT', totalPercent: total, latestKemahiran: latest });
    return {
      student: {
        id: String(stu.id || ''),
        fullName: String(stu.full_name || ''),
        classId: String(stu.class_id || ''),
        status: String(stu.status || 'active')
      },
      subjects: subjects
    };
  }

  // SEMUA MURID mode
  var allowedStatuses = { active: true, perdana: true };
  var rows = [];
  students.forEach(function(s) {
    var status = String(s.status || 'active').toLowerCase();
    if (!allowedStatuses[status]) return;
    var sid = String(s.id || '');
    var stuEnroll = enrollments.filter(function(e) {
      return String(e.student_id || '') === sid && resolveSubjectCode_(e.subject_id || '') === subjectCode;
    });
    if (!stuEnroll.length) return;
    var c = cumMap[sid] || {};
    rows.push({
      studentId: sid,
      fullName: String(s.full_name || ''),
      classId: String(s.class_id || ''),
      totalAttendance: String(c.total_attendance || c.peratus_kehadiran || c.peratus || '0%'),
      latestKemahiran: latestKemahiranLabel_(c.latest_kemahiran || c.kemahiran_terkini || 'no record'),
      status: status
    });
  });

  rows.sort(function(a, b) {
    if (a.classId < b.classId) return -1;
    if (a.classId > b.classId) return 1;
    if (a.fullName < b.fullName) return -1;
    if (a.fullName > b.fullName) return 1;
    return 0;
  });

  return {
    subjectCode: subjectCode,
    rows: rows
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
  var date = normalizeDateInput_(payload.date);
  if (!date) {
    return { sessions: [] };
  }

  var scheduleRows = readObjects_('teacher_schedules').filter(function(r) {
    return toBool_(r.is_active, true);
  });

  var dow = dayOfWeekFromDate_(date); // 1..7

  var sessions = scheduleRows
    .filter(function(r) {
      var day = normalizeDayOfWeek_(r.day_of_week || r.day);
      if (day && day !== dow) return false;
      return true;
    })
    .map(function(r) {
      var classId = String(r.class_id || r.class || r.class_name || '').trim();
      var subjectId = String(r.subject_id || r.subject || r.group || '').trim();
      var subjectCode = resolveSubjectCode_(
        r.group_code || r.subject_code || r.group || r.subject || r.kumpulan || subjectId || ''
      );
      var className = resolveClassName_(classId);
      var startTime = normalizeTime_(r.start_time || r.start || '');
      var endTime = normalizeTime_(r.end_time || r.end || '');
      return {
        id: buildSessionId_(r.id, date, startTime, classId, subjectCode),
        classId: classId,
        className: className || classId,
        subjectId: subjectId || subjectCode,
        subjectCode: subjectCode,
        sessionDate: date,
        startTime: startTime,
        endTime: endTime
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

  var classes = readObjects_('classes');
  var subjects = readObjects_('subjects');
  var parsedClassId = resolveClassIdWithList_(parsed.classId, classes);
  var parsedSubjectCode = resolveSubjectCodeWithList_(parsed.subjectCode, subjects);

  var allEnrollments = readObjects_('student_group_enrollments').filter(function(e) {
    return toBool_(e.is_active, true);
  });
  var classMatchedCount = 0;
  var subjectMatchedCount = 0;
  var dateMatchedCount = 0;

  var enrollments = allEnrollments.filter(function(e) {
    if (!toBool_(e.is_active, true)) return false;

    var classOk = resolveClassIdWithList_(e.class_id, classes) === parsedClassId;
    if (classOk) classMatchedCount += 1;
    var subject = resolveSubjectCodeWithList_(e.subject_id || '', subjects);
    var subjectOk = subject === parsedSubjectCode;
    if (classOk && subjectOk) subjectMatchedCount += 1;

    if (!classOk || !subjectOk) return false;

    // Enrollment date range intentionally ignored.
    // Roster is driven by class + group + active enrollment.
    dateMatchedCount += 1;

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

  return {
    roster: roster,
    debug: {
      sessionId: sessionId,
      classId: parsed.classId,
      subjectCode: parsedSubjectCode,
      enrollmentsActive: allEnrollments.length,
      classMatched: classMatchedCount,
      subjectMatched: subjectMatchedCount,
      dateMatched: dateMatchedCount
    }
  };
}

function saveAttendance(payload) {
  payload = payload || {};
  var sessionId = String(payload.sessionId || '').trim();
  var records = payload.records || [];
  if (!sessionId) throw new Error('Missing sessionId');
  var parsed = parseSessionId_(sessionId) || {};

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
      rows[idx].attendance_date = parsed.date || rows[idx].attendance_date || '';
      rows[idx].class_id = parsed.classId || rows[idx].class_id || '';
      rows[idx].subject_id = resolveSubjectId_(parsed.subjectCode || parsed.subjectId || rows[idx].subject_id || '');
      rows[idx].recorded_at = now;
    } else {
      rows.push({
        id: nextId_('ATT', rows),
        session_id: sessionId,
        student_id: sid,
        attendance_status: String(r.attendanceStatus || 'present'),
        attendance_date: parsed.date || '',
        class_id: parsed.classId || '',
        subject_id: resolveSubjectId_(parsed.subjectCode || parsed.subjectId || ''),
        checkin_time: '',
        remarks: '',
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

function findLatestKemahiran_(kemLog, kemMaster, code) {
  var filtered = kemLog.filter(function(k) {
    var mid = String(k.kemahiran_id || '');
    var m = kemMaster.find(function(mm) { return String(mm.id || '') === mid; });
    if (!m) return false;
    return resolveSubjectCode_(m.subject_id || m.group_code || '') === code;
  });
  if (!filtered.length) return '-';
  filtered.sort(function(a, b) {
    var da = String(a.created_at || a.attempt_date || '');
    var db = String(b.created_at || b.attempt_date || '');
    if (da < db) return 1;
    if (da > db) return -1;
    return 0;
  });
  var latest = filtered[0];
  var m2 = kemMaster.find(function(mm) { return String(mm.id || '') === String(latest.kemahiran_id || ''); }) || {};
  var codeTxt = String(m2.code || '');
  var title = String(m2.title || latest.kemahiran_id || '-');
  return codeTxt ? (codeTxt + ' - ' + title) : title;
}

function getStudentGroupSettings() {
  var cached = cacheGetJson_('student_group_settings_v1');
  if (cached) return cached;

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

    var hasBM = mine.some(function(e) { return resolveSubjectCode_(e.subject_id || '') === 'BM'; });
    var hasMT = mine.some(function(e) { return resolveSubjectCode_(e.subject_id || '') === 'MT'; });
    var status = String(s.status || '').toLowerCase();
    var isPerdana = status === 'perdana';

    return {
      studentId: sid,
      fullName: String(s.full_name || ''),
      classId: classId,
      className: resolveClassName_(classId),
      groupMode: isPerdana ? 'PERDANA' : (hasBM && hasMT ? 'BOTH' : (hasMT ? 'MT' : 'BM'))
    };
  });

  var result = { rows: rows };
  cachePutJson_('student_group_settings_v1', result, 300);
  return result;
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

    // End current BM/MT enrollments for this student-class (kept for audit/history).
    rows = rows.map(function(e) {
      if (String(e.student_id || '') !== sid) return e;
      if (String(e.class_id || '') !== classId) return e;
      var sub = resolveSubjectCode_(e.subject_id || '');
      if (sub === 'BM' || sub === 'MT') {
        e.is_active = false;
        e.end_date = today_();
      }
      return e;
    });

    var bmSubjectId = resolveSubjectId_('BM');
    var mtSubjectId = resolveSubjectId_('MT');

    if (mode === 'BM' || mode === 'BOTH') {
      rows.push({
        id: nextId_('ENR', rows),
        student_id: sid,
        class_id: classId,
        subject_id: bmSubjectId,
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
        subject_id: mtSubjectId,
        start_date: today_(),
        end_date: '',
        is_active: true
      });
    }

    updateStudentStatus_(sid, mode === 'PERDANA' ? 'perdana' : 'active');
  });

  writeObjects_(getSheet_('student_group_enrollments'), tbl.headers, rows);
  cacheRemove_('student_group_settings_v1');
  return { ok: true };
}

function updateStudentStatus_(studentId, status) {
  var tbl = getTable_('students');
  var rows = tbl.rows;
  var idx = rows.findIndex(function(r) { return String(r.id || '') === String(studentId || ''); });
  if (idx < 0) return;
  rows[idx].status = status;
  if (status === 'perdana') {
    rows[idx].perdana_at = today_();
  }
  writeObjects_(getSheet_('students'), tbl.headers, rows);
}

function addStudent(payload) {
  payload = payload || {};
  var studentId = String(payload.studentId || '').trim();
  var fullName = String(payload.fullName || '').trim();
  var classId = String(payload.classId || '').trim();
  var groupMode = String(payload.groupMode || 'BM').toUpperCase();
  if (!studentId || !fullName || !classId) {
    throw new Error('studentId, fullName, and classId are required');
  }

  var tbl = getTable_('students');
  var rows = tbl.rows;
  var idx = rows.findIndex(function(r) { return String(r.id || '') === studentId; });
  if (idx >= 0) {
    rows[idx].full_name = fullName;
    rows[idx].class_id = classId;
    rows[idx].status = rows[idx].status || 'active';
  } else {
    rows.push({
      id: studentId,
      full_name: fullName,
      class_id: classId,
      status: 'active'
    });
  }
  writeObjects_(getSheet_('students'), tbl.headers, rows);

  saveStudentGroupSettings({
    rows: [{ studentId: studentId, classId: classId, groupMode: groupMode }]
  });
  cacheRemove_('student_group_settings_v1');
  return { ok: true };
}

function removeStudents(payload) {
  payload = payload || {};
  var ids = (payload.studentIds || []).map(function(x) { return String(x || '').trim(); }).filter(Boolean);
  if (!ids.length) return { ok: true };

  var studentsTbl = getTable_('students');
  var studentsRows = studentsTbl.rows.filter(function(r) {
    return ids.indexOf(String(r.id || '')) < 0;
  });
  writeObjects_(getSheet_('students'), studentsTbl.headers, studentsRows);

  var enrTbl = getTable_('student_group_enrollments');
  var enrRows = enrTbl.rows.filter(function(r) {
    return ids.indexOf(String(r.student_id || '')) < 0;
  });
  writeObjects_(getSheet_('student_group_enrollments'), enrTbl.headers, enrRows);
  cacheRemove_('student_group_settings_v1');

  return { ok: true };
}

function getTeacherSchedules() {
  var cached = cacheGetJson_('teacher_schedules_v1');
  if (cached) return cached;

  var rows = readObjects_('teacher_schedules').map(function(r) {
    var classId = String(r.class_id || r.class || r.class_name || '');
    var groupCode = resolveSubjectCode_(r.group_code || r.subject_code || r.subject_id || r.subject || r.group || '');
    return {
      id: String(r.id || ''),
      classId: classId,
      className: resolveClassName_(classId),
      groupCode: groupCode,
      dayOfWeek: String(normalizeDayOfWeek_(r.day_of_week || r.day || '1') || 1),
      startTime: normalizeTime_(r.start_time || r.start || ''),
      endTime: normalizeTime_(r.end_time || r.end || ''),
      isActive: toBool_(r.is_active, true)
    };
  });
  var result = { rows: rows };
  cachePutJson_('teacher_schedules_v1', result, 300);
  return result;
}

function saveTeacherSchedules(payload) {
  payload = payload || {};
  var inputRows = payload.rows || [];
  var tbl = getTable_('teacher_schedules');
  var rows = tbl.rows;

  inputRows.forEach(function(r) {
    var id = String(r.id || '').trim();
    var normalizedGroup = resolveSubjectCode_(r.groupCode || '');
    var mapped = {
      id: id || nextId_('TS', rows),
      class_id: String(r.classId || ''),
      subject_id: resolveSubjectId_(normalizedGroup),
      group_code: normalizedGroup,
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
  cacheRemove_('teacher_schedules_v1');
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

function resolveClassId_(classRef) {
  var ref = String(classRef || '').trim();
  if (!ref) return '';
  var cls = readObjects_('classes').find(function(c) {
    return String(c.id || '').trim() === ref || String(c.class_name || '').trim().toUpperCase() === ref.toUpperCase();
  });
  return cls ? String(cls.id || ref) : ref;
}

function isSameClass_(a, b) {
  var aa = resolveClassId_(a);
  var bb = resolveClassId_(b);
  if (aa && bb) return aa === bb;
  return String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();
}

function dayOfWeekFromDate_(yyyyMmDd) {
  var parts = String(yyyyMmDd).split('-');
  if (parts.length !== 3) return 0;
  var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  var jsDay = d.getDay(); // 0=Sun..6=Sat
  return jsDay === 0 ? 7 : jsDay;
}

function normalizeDateStr_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(v).trim().slice(0, 10);
}

function normalizeDateInput_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    var p = s.split('/');
    return p[2] + '-' + p[1] + '-' + p[0];
  }
  return s.slice(0, 10);
}

function toDateKey_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyyMMdd');
  }
  var s = normalizeDateInput_(v); // returns yyyy-mm-dd when possible
  if (!s || s.length < 10) return '';
  return s.slice(0, 10).replaceAll('-', '');
}

function normalizeGroupCode_(v) {
  var s = String(v || '').toUpperCase();
  if (s.indexOf('BM') >= 0) return 'BM';
  if (s.indexOf('MT') >= 0) return 'MT';
  return s.trim();
}

function resolveSubjectCode_(v) {
  var subjects = readObjects_('subjects');
  return resolveSubjectCodeWithList_(v, subjects);
}

function resolveSubjectCodeWithList_(v, subjects) {
  var direct = normalizeGroupCode_(v);
  if (direct === 'BM' || direct === 'MT') return direct;

  var key = String(v || '').trim();
  if (!key) return '';

  var match = subjects.find(function(s) {
    return String(s.id || '').trim() === key || String(s.code || '').trim().toUpperCase() === key.toUpperCase();
  });
  if (!match) return direct;

  var viaCode = normalizeGroupCode_(match.code || '');
  if (viaCode === 'BM' || viaCode === 'MT') return viaCode;

  return normalizeGroupCode_(match.id || '');
}

function resolveSubjectId_(groupOrSubjectValue) {
  var subjects = readObjects_('subjects');
  var normalizedCode = resolveSubjectCodeWithList_(groupOrSubjectValue, subjects);
  var match = subjects.find(function(s) {
    return normalizeGroupCode_(s.code || s.id || '') === normalizedCode;
  });
  return match ? String(match.id || normalizedCode) : normalizedCode;
}

function resolveClassIdWithList_(classRef, classes) {
  var ref = String(classRef || '').trim();
  if (!ref) return '';
  var cls = classes.find(function(c) {
    return String(c.id || '').trim() === ref || String(c.class_name || '').trim().toUpperCase() === ref.toUpperCase();
  });
  return cls ? String(cls.id || ref) : ref;
}

function normalizeDayOfWeek_(v) {
  var s = String(v || '').trim().toLowerCase();
  var n = Number(s);
  if (!isNaN(n) && n >= 1 && n <= 7) return n;
  var map = {
    monday: 1, mon: 1, isnin: 1,
    tuesday: 2, tue: 2, selasa: 2,
    wednesday: 3, wed: 3, rabu: 3,
    thursday: 4, thu: 4, khamis: 4,
    friday: 5, fri: 5, jumaat: 5, jumat: 5,
    saturday: 6, sat: 6, sabtu: 6,
    sunday: 7, sun: 7, ahad: 7
  };
  return map[s] || 0;
}

function normalizeTime_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm');
  }
  var s = String(v || '').trim();
  if (!s) return '';
  var m = s.match(/^(\d{1,2}):(\d{2})/);
  if (m) return Utilities.formatString('%02d:%02d', Number(m[1]), Number(m[2]));
  return s;
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

function cacheGetJson_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var raw = cache.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function cachePutJson_(key, obj, ttlSeconds) {
  try {
    var cache = CacheService.getScriptCache();
    cache.put(key, JSON.stringify(obj), ttlSeconds || 300);
  } catch (err) {}
}

function cacheRemove_(key) {
  try {
    CacheService.getScriptCache().remove(key);
  } catch (err) {}
}

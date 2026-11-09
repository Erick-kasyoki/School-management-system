'use strict';
/* crud/schemas.js — field schemas and small helpers shared by every generic module screen.
   Part of the EraMaster frontend — loaded after core.js. */

const FEE_TYPES = ['Tuition', 'Transport', 'Boarding', 'Uniform', 'Exam Fee', 'Lunch', 'Activity Fee', 'Other'];
const PAYMENT_METHODS = ['Cash', 'Mobile Money', 'Bank Transfer', 'Cheque', 'Card'];
const MODULE_SCHEMAS = {
  students: { fields: ['admNo', 'name', 'gender', 'grade', 'stream', 'dob', 'house', 'admissionDate', 'address',
      'guardian', 'guardianPhone', 'guardianEmail', 'parentId', 'balance', 'status'],
    select: { gender: ['Male', 'Female'], status: ['Active', 'Inactive'] },
    relations: { parentId: { source: 'parents', display: 'name' } } },
  classes: { fields: ['grade', 'stream', 'classTeacherId', 'room', 'capacity'],
    relations: { classTeacherId: { source: 'teachers', display: 'name' } } },
  allocations: { fields: ['grade', 'subject', 'teacherId', 'periods'],
    relations: { teacherId: { source: 'teachers', display: 'name' } } },
  lessonplans: { fields: ['grade', 'subject', 'teacherId', 'term', 'week', 'topic', 'objectives', 'resources', 'status'],
    relations: { teacherId: { source: 'teachers', display: 'name' } },
    select: { status: ['Draft', 'Submitted', 'Reviewed'] } },
  parents: { fields: ['name', 'relationship', 'phone', 'email', 'address'] },
  payments: { fields: ['studentId', 'feeType', 'amount', 'method', 'date', 'term', 'receipt'],
    relations: { studentId: { source: 'students', display: 'name' } },
    select: { feeType: FEE_TYPES, method: PAYMENT_METHODS } },
  transactions: { fields: ['date', 'type', 'category', 'partyType', 'partyName', 'description', 'method', 'amount'],
    select: { type: ['Income', 'Expense'] } },
  feestructures: { fields: ['grade', 'term', 'feeType', 'amount'],
    select: { feeType: FEE_TYPES } },
  teachers: { fields: ['name', 'staffNo', 'nationalId', 'gender', 'phone', 'email', 'jobTitle', 'departmentId', 'qualification', 'experience', 'assignedClass', 'bankAccount', 'status'],
    relations: { departmentId: { source: 'departments', display: 'name' } },
    select: { gender: ['Male', 'Female'], status: ['Active', 'Inactive'] } },
  subjects: { fields: ['code', 'name', 'type', 'level', 'credits', 'status'],
    select: { type: ['Core', 'Elective'], level: ['All Levels', 'Lower Primary', 'Upper Primary', 'JHS', 'SHS'], status: ['Active', 'Inactive'] } },
  applications: { fields: ['admNo', 'name', 'gender', 'dob', 'nationality', 'status'],
    select: { gender: ['Male', 'Female'], status: ['Pending', 'Admitted', 'Rejected'] } },
  clubs: { fields: ['clubName', 'memberName', 'role', 'status'],
    select: { role: ['Member', 'Leader', 'Patron'], status: ['Active', 'Inactive'] } },
  memberships: { fields: ['clubName', 'activities'] },
  achievements: { fields: ['achievement', 'year', 'principal'] },
  exams: { fields: ['examType', 'grade', 'stream', 'academicYear', 'term', 'examDate', 'endDate', 'open', 'status'],
    select: { examType: ['CAT', 'Mid Term Exam', 'End Term Exam'], open: ['No', 'Yes'],
      status: ['Draft', 'Scheduled', 'Ongoing', 'Completed', 'In Review', 'Published'] } },
  discipline: { fields: ['admNo', 'studentName', 'grade', 'stream', 'incidentDate', 'misconductType', 'description',
      'actionTaken', 'counsellingNotes', 'correctiveAction', 'parentNotified', 'notificationDate', 'status', 'reportedBy'],
    select: { misconductType: ['Bullying', 'Fighting', 'Absenteeism', 'Truancy', 'Cheating', 'Dress Code', 'Noise Making', 'Disrespect', 'Vandalism', 'Other'],
      parentNotified: ['Yes', 'No'], status: ['Pending', 'Resolved'] } },
  welfare: { fields: ['admNo', 'studentName', 'grade', 'stream', 'counsellingDate', 'counsellingType', 'reason',
      'counsellorName', 'sessionNumber', 'sessionSummary', 'recommendedAction', 'followUpDate', 'parentInvolvement',
      'referral', 'caseStatus', 'nextAppointment'],
    select: { counsellingType: ['Academic', 'Behavioral', 'Emotional/Social', 'Family', 'Career', 'Other'],
      parentInvolvement: ['Yes', 'No'], referral: ['None', 'External Counsellor', 'Medical/Clinic', 'Social Services', 'Other'],
      caseStatus: ['Open', 'Ongoing', 'Closed'] } },
  // The modules below have no demo/seed rows, so before this fix keyFields()
  // fell back to inferring columns from an existing record — on a fresh
  // workspace that meant an empty list, which collapsed the Add form, the
  // table and Import/Export down to a single "Name" column and silently
  // dropped every other field on import. A real schema fixes that for good.
  invoices: { fields: ['studentId', 'invoiceNo', 'term', 'feeType', 'amount', 'dueDate', 'status'],
    relations: { studentId: { source: 'students', display: 'name' } },
    select: { feeType: FEE_TYPES, status: ['Unpaid', 'Partially Paid', 'Paid', 'Overdue'] } },
  discounts: { fields: ['studentId', 'type', 'amount', 'reason', 'term', 'status'],
    relations: { studentId: { source: 'students', display: 'name' } },
    select: { type: ['Scholarship', 'Sibling Discount', 'Staff Discount', 'Bursary', 'Other'], status: ['Active', 'Expired'] } },
  purchases: { fields: ['item', 'supplierId', 'quantity', 'unitCost', 'totalCost', 'department', 'requestedBy', 'dateRequested', 'status'],
    relations: { supplierId: { source: 'suppliers', display: 'name' } },
    select: { status: ['Pending', 'Reviewed', 'Approved', 'Authorised', 'Paid', 'Rejected'] } },
  maintenance: { fields: ['assetId', 'issue', 'reportedBy', 'dateReported', 'priority', 'status', 'resolvedDate'],
    relations: { assetId: { source: 'assets', display: 'name' } },
    select: { priority: ['Low', 'Medium', 'High', 'Critical'], status: ['Open', 'In Progress', 'Resolved'] } },
  leave: { fields: ['teacherId', 'leaveType', 'startDate', 'endDate', 'reason', 'status', 'dateRequested'],
    relations: { teacherId: { source: 'teachers', display: 'name' } },
    select: { leaveType: ['Sick Leave', 'Annual Leave', 'Maternity/Paternity', 'Compassionate', 'Study Leave', 'Other'],
      // 'Completed' and 'Expired' are set by the app itself once the dates pass
      // (see autoLeaveSync in core.js) — nobody has to close a request by hand.
      status: ['Pending', 'Approved', 'Rejected', 'Completed', 'Expired'] } },
  reviews: { fields: ['teacherId', 'period', 'reviewerName', 'rating', 'strengths', 'areasForImprovement', 'status', 'reviewDate'],
    relations: { teacherId: { source: 'teachers', display: 'name' } },
    select: { rating: ['Excellent', 'Good', 'Fair', 'Poor'], status: ['Draft', 'Completed'] } },
  training: { fields: ['title', 'teacherId', 'provider', 'startDate', 'endDate', 'status'],
    relations: { teacherId: { source: 'teachers', display: 'name' } },
    select: { status: ['Scheduled', 'Completed', 'Cancelled'] } },
  boarding: { fields: ['studentId', 'dormId', 'bedNo', 'term', 'status'],
    relations: { studentId: { source: 'students', display: 'name' }, dormId: { source: 'dorms', display: 'name' } },
    select: { status: ['Active', 'Checked Out'] } },
  passes: { fields: ['studentId', 'reason', 'dateOut', 'timeOut', 'expectedReturn', 'actualReturn', 'approvedBy', 'status'],
    relations: { studentId: { source: 'students', display: 'name' } },
    select: { status: ['Issued', 'Returned', 'Overdue'] } },
  clinic_visits: { fields: ['studentId', 'visitDate', 'complaint', 'treatment', 'nurseName', 'followUp', 'status'],
    relations: { studentId: { source: 'students', display: 'name' } },
    select: { followUp: ['Yes', 'No'], status: ['Resolved', 'Follow-up Needed', 'Referred'] } },
  medical: { fields: ['studentId', 'condition', 'allergies', 'medication', 'bloodGroup', 'emergencyContact', 'notes'],
    relations: { studentId: { source: 'students', display: 'name' } } },
  // 'reply' is what the parent / student sees in their portal and in their bell (portal messages arrive with status "New").
  inquiries: { fields: ['name', 'phone', 'email', 'source', 'subject', 'message', 'reply', 'status', 'date'],
    select: { source: ['Walk-in', 'Phone call', 'Website', 'Email', 'Referral', 'Social media', 'Portal', 'Other'],
      status: ['New', 'Open', 'In Progress', 'Closed'] } },
  documents: { fields: ['title', 'category', 'description', 'uploadedBy', 'date', 'status'],
    select: { category: ['Policy', 'Circular', 'Form', 'Report', 'Other'], status: ['Draft', 'Published', 'Archived'] } },
  policies: { fields: ['title', 'category', 'description', 'effectiveDate', 'status'],
    select: { status: ['Draft', 'Active', 'Archived'] } },
  alumni: { fields: ['name', 'admNo', 'gradYear', 'occupation', 'employer', 'phone', 'email', 'address'] },
  // School Setup, Operations, HR and Communication modules that used to have no
  // schema at all: their columns were guessed from whichever record happened to
  // be first, so on an empty list Export CSV wrote a single "Name" column and
  // Import dropped every other field. A real schema fixes both for good.
  vehicles: { fields: ['regNo', 'route', 'stops', 'driver', 'driverPhone', 'capacity', 'assigned', 'fee',
      'insuranceExpiry', 'nextService', 'status'],
    select: { status: ['Active', 'Under Service', 'Inactive'] } },
  events: { fields: ['title', 'type', 'date', 'day', 'time', 'endTime', 'endDate', 'venue', 'audience', 'notes'],
    select: { type: ['Parents meeting', 'Staff meeting', 'Exam', 'Sports day', 'Prize giving', 'Trip', 'Holiday', 'Other'],
      audience: ['Everyone', 'Students', 'Parents', 'Staff'] } },
  years: { fields: ['name', 'start', 'end', 'term1Start', 'term1End', 'term2Start', 'term2End',
      'term3Start', 'term3End', 'current'],
    select: { current: ['Yes', 'No'] } },
  terms: { fields: ['name', 'year', 'start', 'end', 'current'],
    select: { current: ['Yes', 'No'] } },
  departments: { fields: ['name', 'head', 'notes'] },
  houses: { fields: ['name', 'colour', 'patron', 'motto'] },
  announcements: { fields: ['title', 'type', 'description', 'audience', 'priority', 'date', 'postedBy'],
    select: { type: ['General', 'Academic', 'Event', 'Fees', 'Holiday', 'Sports', 'Meeting', 'Emergency', 'Other'],
      audience: ['Everyone', 'Students', 'Parents', 'Staff'], priority: ['Normal', 'Important', 'Urgent'] } },
};
// Display labels that don't come out right from the auto camelCase splitter.
const FIELD_LABEL_OVERRIDES = { open: 'Open for marks entry?',
  studentId: 'Student', feeType: 'Fee Type', receipt: 'Receipt No.',
  admNo: 'Adm No', dob: 'DOB', nationalId: 'National ID', clubName: 'Club Name',
  memberName: "Member's Name", academicYear: 'Academic Year', examDate: 'Exam Date',
  examType: 'Exam Name', bankAccount: 'Bank Account', jobTitle: 'Job Title', assignedClass: 'Assigned Class', staffNo: 'Staff ID', partyType: 'Paid by / to', partyName: 'Person', experience: 'Experience (years)',
  departmentId: 'Department', code: 'Code', credits: 'Credits',
  parentId: 'Linked Parent Record ID',
  studentName: 'Student Name', incidentDate: 'Incident Date', misconductType: 'Misconduct Type',
  actionTaken: 'Action Taken', counsellingNotes: 'Counselling Notes', correctiveAction: 'Corrective Action',
  parentNotified: 'Parent Notified', notificationDate: 'Notification Date', reportedBy: 'Reported By',
  counsellingDate: 'Counselling Date', counsellingType: 'Counselling Type', counsellorName: "Counsellor's Name",
  sessionNumber: 'Session Number', sessionSummary: 'Session Summary', recommendedAction: 'Recommended Action',
  followUpDate: 'Follow-up Date', parentInvolvement: 'Parent Involvement', caseStatus: 'Case Status',
  nextAppointment: 'Next Appointment',
  classTeacherId: 'Class Teacher', teacherId: 'Teacher', periods: 'Lessons / Week',
  topic: 'Topic', objectives: 'Objectives', resources: 'Resources / Materials', week: 'Week', term: 'Term',
  supplierId: 'Supplier', assetId: 'Asset', dormId: 'Dorm', invoiceNo: 'Invoice No.', dueDate: 'Due Date',
  unitCost: 'Unit Cost', totalCost: 'Total Cost', dateRequested: 'Date Requested', dateReported: 'Date Reported',
  resolvedDate: 'Resolved Date', leaveType: 'Leave Type', reviewDate: 'Review Date', reviewerName: "Reviewer's Name",
  areasForImprovement: 'Areas for Improvement', bedNo: 'Bed No.', dateOut: 'Date Out', timeOut: 'Time Out',
  expectedReturn: 'Expected Return', actualReturn: 'Actual Return', approvedBy: 'Approved By',
  visitDate: 'Visit Date', nurseName: "Nurse's Name", followUp: 'Follow-up Needed', bloodGroup: 'Blood Group',
  emergencyContact: 'Emergency Contact', uploadedBy: 'Uploaded By', effectiveDate: 'Effective Date',
  gradYear: 'Graduation Year',
  regNo: 'Registration No.', driverPhone: "Driver's Phone", insuranceExpiry: 'Insurance Expiry',
  nextService: 'Next Service', assigned: 'Learners Assigned', reply: 'Reply to sender', fee: 'Termly Fee (KSh)', amount: 'Amount (KSh)', balance: 'Balance (KSh)', stops: 'Stops',
  title: 'Title', day: 'Day Scheduled', time: 'Start Time', endTime: 'End Time', endDate: 'End Date',
  venue: 'Venue', audience: 'Audience', notes: 'Notes', priority: 'Priority', postedBy: 'Posted By',
  start: 'Opening Date', end: 'Closing Date', current: 'Current',
  term1Start: 'Term 1 Opening', term1End: 'Term 1 Closing',
  term2Start: 'Term 2 Opening', term2End: 'Term 2 Closing',
  term3Start: 'Term 3 Opening', term3End: 'Term 3 Closing',
  year: 'Academic Year', head: 'Head of Department', colour: 'Colour', patron: 'Patron', motto: 'Motto',
  source: 'Source', subject: 'Subject', message: 'Message',
};
function fieldLabel(f){ return FIELD_LABEL_OVERRIDES[f] || f.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()); }
function keyFields(key){
  const schema = MODULE_SCHEMAS[key];
  let base;
  if (schema) {
    base = schema.fields.slice();
  } else {
    const arr = DB[key] || [];
    base = (arr.length && arr[0] && typeof arr[0] === 'object') ? Object.keys(arr[0]).filter(f => f !== 'id') : ['name'];
  }
  // 'photo' always has its own dedicated avatar column/upload button (see
  // PHOTO_KEYS below) — it must never also show up as a plain text field,
  // since that would print the raw base64 image data into the table/form.
  return base.filter(f => f !== 'photo');
}
function selectOptionsFor(key, field){ return (MODULE_SCHEMAS[key] && MODULE_SCHEMAS[key].select && MODULE_SCHEMAS[key].select[field]) || null; }
// A "relation" field stores another module's record id (e.g. allocations.teacherId
// points at a row in DB.teachers) — the form shows a picker by name instead of a
// raw id text box, and the table shows the name instead of the id.
function relationFor(key, field){ return (MODULE_SCHEMAS[key] && MODULE_SCHEMAS[key].relations && MODULE_SCHEMAS[key].relations[field]) || null; }
function relationOptionsFor(key, field){
  const rel = relationFor(key, field);
  if (!rel) return null;
  return (DB[rel.source] || []).map(r => [r.id, r[rel.display] || r.id]);
}
function relationLabel(key, field, id){
  const rel = relationFor(key, field);
  if (!rel || !id) return null;
  const rec = (DB[rel.source] || []).find(r => r.id === id);
  return rec ? (rec[rel.display] || id) : id;
}
function blankRecord(key){
  const o = {};
  keyFields(key).forEach(f => { const opts = selectOptionsFor(key, f); o[f] = opts ? opts[0] : ''; });
  if (key === 'teachers') o.staffNo = nextStaffId();
  if (key === 'subjects') o.status = 'Active';
  const me = (S.user && S.user.name) || '';
  // Sensible starting values, so the person adding a record doesn't have to
  // retype today's date or their own name every single time.
  if (key === 'inquiries') { o.date = today(); o.status = 'Open'; o.source = 'Walk-in'; }
  if (key === 'announcements') { o.date = today(); o.postedBy = me || 'Administration'; o.type = 'General'; }
  if (key === 'events') { o.date = today(); o.day = dayName(today()); o.time = '09:00'; }
  if (key === 'documents') { o.date = today(); o.uploadedBy = me; }
  if (key === 'maintenance') { o.dateReported = today(); o.reportedBy = me; }
  if (key === 'leave') o.dateRequested = today();
  if (key === 'transactions') { o.date = today(); o.partyType = ''; o.partyId = ''; o.partyName = ''; }
  if (key === 'payments') { o.date = today(); const t = currentTerm(); if (t) o.term = t.name; }
  if (key === 'reviews') o.reviewDate = today();
  if (key === 'years') Object.assign(o, blankYear(String(new Date().getFullYear())), { id: undefined });
  return o;
}
// The value a field should have in an exported CSV: relation fields export the
// name a person recognises (and can re-import), not the internal record id.
function exportValue(key, field, r){
  const v = r ? r[field] : '';
  const rel = relationLabel(key, field, v);
  if (rel !== null && rel !== undefined) return rel;
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  if (v && typeof v === 'object') return JSON.stringify(v);
  return v == null ? '' : v;
}
function cellHtml(v, key, field){
  if (key && field) {
    const rel = relationLabel(key, field, v);
    if (rel !== null) v = rel;
  }
  if (v === null || v === undefined || v === '') return '<span style="color:var(--muted)">—</span>';
  if (typeof v === 'object') return esc(JSON.stringify(v));
  const s = String(v);
  if (GOOD.has(s) || BAD.has(s) || WARN.has(s)) return badge(s);
  return esc(s);
}

const PHOTO_KEYS = ['students', 'teachers', 'applications'];  // modules with a photo/dp column
// Every generic module now supports both Export and Import — no whitelist.
// Modules with a hand-tuned alias map (IMPORT_ALIASES, below) use it; anything
// else falls back to matching the CSV header text against its own field names,
// which is exactly what Export CSV produces — so export-then-reimport always works.

// Modules where the list can be filtered by grade/class, in addition to search.
const GRADE_FILTER_KEYS = ['students', 'discipline', 'welfare'];
// Modules that also get a dropdown filter on one extra field (e.g. misconduct type).
const TYPE_FILTER_KEYS = {
  discipline: { field: 'misconductType', allLabel: 'All misconduct types' },
  inquiries: { field: 'status', allLabel: 'All statuses' },
  announcements: { field: 'type', allLabel: 'All announcement types' },
  events: { field: 'type', allLabel: 'All event types' },
  leave: { field: 'status', allLabel: 'All leave statuses' },
  maintenance: { field: 'status', allLabel: 'All job statuses' },
};
// Modules that also get a from/to date-range filter on one field.
const DATE_FILTER_KEYS = { discipline: 'incidentDate', inquiries: 'date', events: 'date',
  announcements: 'date', maintenance: 'dateReported', documents: 'date' };
// Modules with a "Generate report" print button (gated on the module's manage permission).
const REPORT_KEYS = { discipline: { title: 'Discipline Report' }, inquiries: { title: 'Inquiries Report' },
  events: { title: 'Calendar of Events' }, maintenance: { title: 'Maintenance Report' } };
// Modules that show a small pending/resolved-style status summary above the table.
const STATUS_SUMMARY_KEYS = { discipline: 'status', welfare: 'caseStatus', inquiries: 'status',
  maintenance: 'status', leave: 'status' };
// Modules whose list is shown newest-first on a date field (instead of insertion order).
const SORT_DESC_KEYS = { inquiries: 'date', announcements: 'date', documents: 'date', maintenance: 'dateReported' };
// Modules sorted oldest-first (a calendar reads forwards).
const SORT_ASC_KEYS = { events: 'date', years: 'start', terms: 'start' };
function distinctGrades(){
  const fromClasses = (DB.classes || []).map(c => c.grade).filter(Boolean);
  const fromStudents = (DB.students || []).map(s => s.grade).filter(Boolean);
  return Array.from(new Set(fromClasses.concat(fromStudents))).sort();
}
const LRN_PALETTE = [
  { c: '#175537', tint: '#dcefe3' },  // green (matches app accent)
  { c: '#b8860b', tint: '#faf1da' },  // gold
  { c: '#1f6f78', tint: '#e0f2f2' },  // teal
  { c: '#7a4fb5', tint: '#f0eafc' },  // purple
  { c: '#2a5adb', tint: '#e2ecff' },  // blue
];
function lrnAvatarColor(name){ return LRN_PALETTE[ttHash(String(name || '')) % LRN_PALETTE.length]; }
// Set just before goTo('students') to land on the Learners screen pre-filtered
// to one grade (e.g. from a "Students" button on a class card) — consumed once
// then cleared so it doesn't stick on later, unrelated visits.
let LRN_GRADE_PRESET = '';
// Purpose-built "Learners" screen for the students module — styled to spec,
// separate from the generic table+form CRUD every other module uses.

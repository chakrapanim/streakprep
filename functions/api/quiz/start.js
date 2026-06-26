import { getSession } from '../../_lib/auth.js';
import { json } from '../../_lib/db.js';

const SUBJECT_KEYS = {
  mathematics:   { 6:['mathematics'], 7:['mathematics_part1','mathematics_part2'], 8:['mathematics_part1','mathematics_part2'], 9:['mathematics'], 10:['mathematics'] },
  science:       { 6:['science'], 7:['science'], 8:['science'], 9:['science'], 10:['science'] },
  english:       { 6:['english'], 7:['english'], 8:['english'], 9:['english'], 10:['english_first_flight','english_footprints','english_words_and_expr'] },
  hindi:         { 6:['hindi'], 7:['hindi'], 8:['hindi'], 9:['hindi'], 10:['hindi_kritika','hindi_kshitij','hindi_sanchayan','hindi_sparsh'] },
  social_science:{ 6:['social_science_part1'], 7:['social_science_part1','social_science_part2'], 8:['social_science_part1'], 9:[], 10:['civics','economics','geography','history'] },
};

export async function onRequestGet({ request, env }) {
  const db      = env.streakprep_db;
  const session = await getSession(request, db);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const studentId = session.active_student_id;
  const now       = Math.floor(Date.now() / 1000);
  const today     = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  const student = await db.prepare(
    'SELECT id, name, class, subjects, is_reviewer, reviewer_classes FROM students WHERE id = ? AND is_active = 1'
  ).bind(studentId).first();
  if (!student) return json({ error: 'student_not_found' }, 404);

  const isReviewer = student.is_reviewer === 1;

  // Subscription check — reviewers bypass
  if (!isReviewer) {
    const sub = await db.prepare(
      'SELECT status, trial_ends_at, current_period_end, grace_until FROM subscriptions WHERE student_id = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(studentId).first();
    const canQuiz = sub && (
      (sub.status === 'trial'  && sub.trial_ends_at > now) ||
      (sub.status === 'active' && sub.current_period_end > now) ||
      (sub.status === 'grace'  && sub.grace_until > now)
    );
    if (!canQuiz) return json({ error: 'subscription_required' }, 403);
  }

  const url    = new URL(request.url);
  const params = url.searchParams;

  // Reviewer: return metadata only (no subject param) so frontend can show picker
  if (isReviewer && !params.get('subject')) {
    const reviewerClasses = student.reviewer_classes
      ? JSON.parse(student.reviewer_classes)
      : [parseInt(student.class)];
    return json({
      isReviewer: true,
      needsPicker: true,
      studentName: student.name,
      ownClass: parseInt(student.class),
      reviewerClasses,
      allSubjects: Object.keys(SUBJECT_KEYS),
    });
  }

  const studentSubjects = JSON.parse(student.subjects || '[]');
  const studentGrade    = parseInt(student.class);

  // Resolve subject
  let subject = params.get('subject');
  if (!subject) {
    // Regular student: pick first pending subject
    const doneRes = await db.prepare(
      "SELECT subject FROM quiz_sessions WHERE student_id=? AND quiz_date=? AND status='completed'"
    ).bind(studentId, today).all();
    const done = (doneRes.results || []).map(r => r.subject);
    subject = studentSubjects.find(s => !done.includes(s));
    if (!subject) return json({ error: 'all_done' }, 200);
  }
  if (!Object.keys(SUBJECT_KEYS).includes(subject)) {
    return json({ error: 'invalid_subject' }, 400);
  }
  if (!isReviewer && !studentSubjects.includes(subject)) {
    return json({ error: 'subject_not_subscribed' }, 400);
  }

  // Resolve grade (reviewers can override)
  let grade = studentGrade;
  if (isReviewer && params.get('grade')) {
    const requested = parseInt(params.get('grade'));
    const allowed   = student.reviewer_classes ? JSON.parse(student.reviewer_classes) : [studentGrade];
    if (!allowed.includes(requested)) return json({ error: 'grade_not_allowed' }, 403);
    grade = requested;
  }

  // Resolve question count (reviewers can override, max 50; regular always 5)
  const count = isReviewer
    ? Math.min(50, Math.max(1, parseInt(params.get('count') || '10')))
    : 5;

  // Regular students: block if already completed this subject today
  if (!isReviewer) {
    const existing = await db.prepare(
      "SELECT status FROM quiz_sessions WHERE student_id=? AND quiz_date=? AND subject=? LIMIT 1"
    ).bind(studentId, today, subject).first();
    if (existing?.status === 'completed') return json({ error: 'already_completed', subject }, 409);
  }

  const keys = (SUBJECT_KEYS[subject]?.[grade] || []);
  if (keys.length === 0) return json({ error: 'no_questions_for_subject', subject, grade }, 404);

  // Reviewer-only filters
  const reviewerOpts = isReviewer ? {
    chapterKey: params.get('chapter_key') || null,
    difficulty: ['easy','medium','hard'].includes(params.get('difficulty')) ? params.get('difficulty') : null,
    qtype:      ['pictorial','conceptual'].includes(params.get('type'))      ? params.get('type')       : null,
  } : {};

  const placeholders = keys.map(() => '?').join(',');
  const questions    = await pickQuestions(db, grade, subject, keys, placeholders, count, reviewerOpts);

  if (questions.length === 0) return json({ error: 'no_questions_available', subject }, 404);

  // Compute current streak
  let streak = 0;
  try {
    const streakRows = await db.prepare(
      "SELECT quiz_date FROM quiz_sessions WHERE student_id=? AND status='completed' GROUP BY quiz_date ORDER BY quiz_date DESC LIMIT 60"
    ).bind(studentId).all();
    const dates = (streakRows.results || []).map(r => r.quiz_date);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yd = yesterday.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    let checkDate = dates.includes(today) ? today : (dates.includes(yd) ? yd : null);
    for (const d of dates) {
      if (!checkDate) break;
      if (d === checkDate) {
        streak++;
        const prev = new Date(checkDate + 'T12:00:00Z');
        prev.setUTCDate(prev.getUTCDate() - 1);
        checkDate = prev.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      } else break;
    }
  } catch {}

  // Create (or reset) quiz session. There is a UNIQUE(student_id, quiz_date, subject)
  // constraint, so a second quiz of the same subject on the same day (reviewers re-reviewing,
  // or a student restarting a still-pending session) would violate it and 500. Upsert instead:
  // reuse the existing row and reset it for the new attempt.
  const questionIds = JSON.stringify(questions.map(q => q.id));
  await db.prepare(
    `INSERT INTO quiz_sessions (student_id, quiz_date, subject, question_ids, status, score, started_at)
     VALUES (?, ?, ?, ?, 'pending', 0, ?)
     ON CONFLICT(student_id, quiz_date, subject)
     DO UPDATE SET question_ids=excluded.question_ids, status='pending', score=0, started_at=excluded.started_at`
  ).bind(studentId, today, subject, questionIds, now).run();
  const newRow = await db.prepare(
    `SELECT id FROM quiz_sessions WHERE student_id=? AND quiz_date=? AND subject=? ORDER BY started_at DESC LIMIT 1`
  ).bind(studentId, today, subject).first();

  return json({
    isReviewer,
    quizSessionId: newRow?.id,
    subject,
    grade,
    count,
    streak,
    studentName: student.name,
    questions: questions.map(q => ({
      id: q.id,
      text: q.question_text,
      options: { A: q.option_a, B: q.option_b, C: q.option_c, D: q.option_d },
      correct: q.correct,
      explanation: q.explanation,
      difficulty: q.difficulty,
      concept: q.concept,
      chapterKey: q.chapter_key,
      subjectKey: q.subject_key,
      imagePath: q.image_path
        ? `${(env.PUBLIC_BASE_URL || '').replace(/\/$/, '')}/${q.image_path}`
        : null,
    })),
  });
}

async function pickQuestions(db, grade, subject, keys, placeholders, count, opts = {}) {
  const { chapterKey, difficulty, qtype } = opts;

  const extraWhere = [];
  const extraBinds = [];
  if (chapterKey) { extraWhere.push('AND chapter_key = ?'); extraBinds.push(chapterKey); }
  if (difficulty) { extraWhere.push('AND difficulty = ?');  extraBinds.push(difficulty); }
  if (qtype === 'pictorial')  extraWhere.push("AND image_path IS NOT NULL AND image_path != ''");
  if (qtype === 'conceptual') extraWhere.push("AND (image_path IS NULL OR image_path = '')");

  const pool = await db.prepare(
    `SELECT id, question_text, option_a, option_b, option_c, option_d,
            correct, explanation, difficulty, concept, chapter_key, subject_key, image_path
     FROM questions
     WHERE grade = ? AND subject_can = ? AND subject_key IN (${placeholders}) AND is_active = 1
     ${extraWhere.join(' ')}
     ORDER BY RANDOM() LIMIT ?`
  ).bind(grade, subject, ...keys, ...extraBinds, count * 3).all();

  const candidates = pool.results || [];
  const usedConcepts = new Set();
  const picked = [];

  for (const q of candidates) {
    if (picked.length >= count) break;
    if (!q.concept || !usedConcepts.has(q.concept)) {
      picked.push(q);
      if (q.concept) usedConcepts.add(q.concept);
    }
  }
  if (picked.length < count) {
    for (const q of candidates) {
      if (picked.length >= count) break;
      if (!picked.find(p => p.id === q.id)) picked.push(q);
    }
  }
  return picked.slice(0, count);
}

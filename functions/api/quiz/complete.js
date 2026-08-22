import { getSession } from '../../_lib/auth.js';
import { json } from '../../_lib/db.js';

export async function onRequestPost({ request, env }) {
  const db      = env.streakprep_db;
  const session = await getSession(request, db);
  if (!session) return json({ error: 'unauthorized' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  const { quizSessionId, answers } = body;
  // answers: [{ questionId, chosen }]  e.g. chosen = 'A'

  if (!quizSessionId || !Array.isArray(answers) || answers.length === 0) {
    return json({ error: 'missing_fields' }, 400);
  }

  const studentId = session.active_student_id;
  const now       = Math.floor(Date.now() / 1000);
  const today     = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  // Verify quiz session belongs to this student and is still pending (not yet completed)
  const qs = await db.prepare(
    'SELECT id, subject, status FROM quiz_sessions WHERE id = ? AND student_id = ?'
  ).bind(quizSessionId, studentId).first();

  if (!qs) return json({ error: 'session_not_found' }, 404);
  if (qs.status === 'completed') return json({ error: 'already_completed' }, 409);

  // Fetch the question correct answers from D1 questions table
  const qIds = answers.map(a => a.questionId);
  const placeholders = qIds.map(() => '?').join(',');
  const qRows = await db.prepare(
    `SELECT id, correct FROM questions WHERE id IN (${placeholders})`
  ).bind(...qIds).all();

  const correctMap = {};
  for (const q of (qRows.results || [])) correctMap[q.id] = q.correct;

  // Score + insert answers  (answer = A/B/C/D TEXT, question_id = TEXT)
  let score = 0;
  const insertStmts = [];
  for (const ans of answers) {
    const isCorrect = correctMap[ans.questionId] === ans.chosen ? 1 : 0;
    if (isCorrect) score++;
    insertStmts.push(
      db.prepare(
        `INSERT OR IGNORE INTO student_answers (quiz_session_id, question_id, answer, is_correct, answered_at)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(quizSessionId, ans.questionId, ans.chosen, isCorrect, now)
    );
  }

  // Batch insert answers + update quiz session
  await db.batch([
    ...insertStmts,
    db.prepare(
      `UPDATE quiz_sessions SET status='completed', score=?, completed_at=? WHERE id=?`
    ).bind(score, now, quizSessionId),
  ]);

  // Update streak
  const streakRow = await db.prepare(
    'SELECT current_streak, longest_streak, last_quiz_date FROM streaks WHERE student_id = ?'
  ).bind(studentId).first();

  // Check if all subjects done today
  const student = await db.prepare(
    'SELECT subjects FROM students WHERE id = ?'
  ).bind(studentId).first();
  const subjects     = JSON.parse(student.subjects || '[]');
  const completedRes = await db.prepare(
    "SELECT subject FROM quiz_sessions WHERE student_id=? AND quiz_date=? AND status='completed'"
  ).bind(studentId, today).all();
  const completedSubjects = (completedRes.results || []).map(r => r.subject);
  const allDone = subjects.every(s => completedSubjects.includes(s));

  let newStreak = streakRow?.current_streak || 0;
  let newLongest = streakRow?.longest_streak || 0;

  // Streak lights on the FIRST completed subject of the day. A student who does
  // today's quiz keeps their streak alive — they don't have to finish all 5
  // subjects (`allDone` is still returned for the "perfect day" UI). The
  // `lastDate === today` guard makes every later subject the same day a no-op,
  // so the streak increments at most once per day.
  {
    const lastDate  = streakRow?.last_quiz_date;
    const yesterday = getPreviousDateIST(today);

    if (lastDate === today) {
      // Already counted today — leave the streak as-is.
    } else if (lastDate === yesterday) {
      newStreak = (streakRow?.current_streak || 0) + 1;
    } else {
      newStreak = 1; // first-ever quiz, or a missed day resets the streak
    }
    newLongest = Math.max(newStreak, newLongest);

    await db.prepare(
      `UPDATE streaks SET current_streak=?, longest_streak=?, last_quiz_date=? WHERE student_id=?`
    ).bind(newStreak, newLongest, today, studentId).run();
  }

  return json({
    ok: true,
    score,
    total: answers.length,
    allDone,
    streak: newStreak,
    subject: qs.subject,
  });
}

function getPreviousDateIST(dateStr) {
  // dateStr = 'YYYY-MM-DD'; subtract 1 calendar day
  const [y, m, d] = dateStr.split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  return prev.toISOString().slice(0, 10);
}

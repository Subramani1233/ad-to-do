// ══════════════════════════════════════════════════════════════════════════════
//  FIREBASE CONFIG
//  ⚠️  REPLACE THESE VALUES with your own Firebase project config
//  Get it from: console.firebase.google.com → Project Settings → Your apps
// ══════════════════════════════════════════════════════════════════════════════
const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// ══════════════════════════════════════════════════════════════════════════════
//  ANTHROPIC API KEY (for AI evidence verification)
//  ⚠️  Replace with your actual Anthropic API key
// ══════════════════════════════════════════════════════════════════════════════
const ANTHROPIC_KEY = "YOUR_ANTHROPIC_API_KEY";

// ── Init Firebase ─────────────────────────────────────────────────────────────
firebase.initializeApp(FIREBASE_CONFIG);
const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;
let unsubscribeTasks = null;
let allTasks = [];

// ══════════════════════════════════════════════════════════════════════════════
//  AUTH PAGES
// ══════════════════════════════════════════════════════════════════════════════
function showLogin() {
  document.getElementById('loginPage').style.display = 'flex';
  document.getElementById('signupPage').style.display = 'none';
  document.getElementById('forgotPage').style.display = 'none';
  document.getElementById('appPage').style.display = 'none';
}
function showSignup() {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('signupPage').style.display = 'flex';
  document.getElementById('forgotPage').style.display = 'none';
}
function showForgot() {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('forgotPage').style.display = 'flex';
}

// Google Sign In
async function googleSignIn() {
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    await auth.signInWithPopup(provider);
  } catch (e) {
    document.getElementById('loginMsg').textContent = '❌ ' + e.message;
  }
}

// Email Login
async function emailLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass = document.getElementById('loginPassword').value;
  const msg = document.getElementById('loginMsg');
  if (!email || !pass) { msg.textContent = '❌ Enter email and password'; return; }
  try {
    await auth.signInWithEmailAndPassword(email, pass);
  } catch (e) {
    msg.textContent = '❌ ' + e.message;
  }
}

// Create Account
async function createAccount() {
  const name = document.getElementById('signupName').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const pass = document.getElementById('signupPassword').value;
  const msg = document.getElementById('signupMsg');
  if (!name || !email || !pass) { msg.textContent = '❌ Fill all fields'; return; }
  if (pass.length < 6) { msg.textContent = '❌ Password must be at least 6 characters'; return; }
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, pass);
    await cred.user.updateProfile({ displayName: name });
    // Init user doc
    await db.collection('users').doc(cred.user.uid).set({
      name, email, createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      activeDays: [], darkMode: false
    }, { merge: true });
  } catch (e) {
    msg.textContent = '❌ ' + e.message;
  }
}

// Forgot Password
async function sendReset() {
  const email = document.getElementById('forgotEmail').value.trim();
  const msg = document.getElementById('forgotMsg');
  if (!email) { msg.textContent = '❌ Enter your email'; return; }
  try {
    await auth.sendPasswordResetEmail(email);
    msg.style.color = '#1e8449';
    msg.textContent = '✅ Reset link sent! Check your email.';
  } catch (e) {
    msg.style.color = '';
    msg.textContent = '❌ ' + e.message;
  }
}

function logout() {
  if (!confirm('Logout?')) return;
  if (unsubscribeTasks) unsubscribeTasks();
  stopReminderLoop();
  auth.signOut();
}

// ── Auth State Listener ───────────────────────────────────────────────────────
auth.onAuthStateChanged(user => {
  if (user) {
    currentUser = user;
    showApp();
  } else {
    currentUser = null;
    allTasks = [];
    showLogin();
  }
});

function showApp() {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('signupPage').style.display = 'none';
  document.getElementById('forgotPage').style.display = 'none';
  document.getElementById('appPage').style.display = 'block';

  // Set user avatar initial
  const av = document.getElementById('userAvatar');
  const name = currentUser.displayName || currentUser.email || '?';
  av.textContent = name.charAt(0).toUpperCase();
  av.title = `Logout (${name})`;

  // Load user prefs
  loadUserPrefs();

  // Subscribe to tasks
  subscribeToTasks();

  recordDailyVisit();
  updateStreakPill();
  initNotifications();
  startReminderLoop();
  checkDailyNotification();
}

// ══════════════════════════════════════════════════════════════════════════════
//  FIRESTORE — REAL-TIME TASK SYNC
// ══════════════════════════════════════════════════════════════════════════════
function userDoc() {
  return db.collection('users').doc(currentUser.uid);
}
function tasksCol() {
  return userDoc().collection('tasks');
}

function subscribeToTasks() {
  if (unsubscribeTasks) unsubscribeTasks();
  unsubscribeTasks = tasksCol()
    .orderBy('createdAt', 'desc')
    .onSnapshot(snap => {
      allTasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      render();
      updateStreakPill();
      updateMiniView();
    }, err => console.error('Task sync error:', err));
}

async function addTaskToFirestore(task) {
  await tasksCol().add({
    ...task,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}
async function updateTaskInFirestore(id, data) {
  await tasksCol().doc(id).update(data);
}
async function deleteTaskFromFirestore(id) {
  await tasksCol().doc(id).delete();
}

// ══════════════════════════════════════════════════════════════════════════════
//  USER PREFS (dark mode, etc.)
// ══════════════════════════════════════════════════════════════════════════════
async function loadUserPrefs() {
  try {
    const doc = await userDoc().get();
    if (doc.exists) {
      const data = doc.data();
      if (data.darkMode) {
        document.body.classList.add('dark');
        document.getElementById('darkModeBtn').textContent = '☀️';
      }
    }
  } catch(e) {}
}

async function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark');
  document.getElementById('darkModeBtn').textContent = isDark ? '☀️' : '🌙';
  try { await userDoc().set({ darkMode: isDark }, { merge: true }); } catch(e) {}
}

// ══════════════════════════════════════════════════════════════════════════════
//  DAILY VISIT & STREAK
// ══════════════════════════════════════════════════════════════════════════════
function todayKey() { return new Date().toISOString().slice(0, 10); }
function dateOffset(n) {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function offsetFromKey(key, n) {
  const d = new Date(key + 'T00:00:00'); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round(Math.abs((new Date(b+'T00:00:00') - new Date(a+'T00:00:00')) / 86400000));
}

// Use Firestore to store active days (so streak syncs across devices)
async function recordDailyVisit() {
  if (!currentUser) return;
  const today = todayKey();
  try {
    await userDoc().set({
      activeDays: firebase.firestore.FieldValue.arrayUnion(today)
    }, { merge: true });
    updateStreakPill();
  } catch(e) {}
}

async function getActiveDays() {
  if (!currentUser) return new Set();
  try {
    const doc = await userDoc().get();
    if (doc.exists && doc.data().activeDays) {
      return new Set(doc.data().activeDays);
    }
  } catch(e) {}
  return new Set();
}

function calcStreakFromDays(days) {
  if (days.size === 0) return { current: 0, longest: 0, total: 0 };
  const sorted = [...days].sort((a, b) => b.localeCompare(a));
  const today = todayKey();
  const yesterday = dateOffset(-1);
  let current = 0;
  if (days.has(today) || days.has(yesterday)) {
    let check = days.has(today) ? today : yesterday;
    while (days.has(check)) { current++; check = offsetFromKey(check, -1); }
  }
  let longest = 0, run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const diff = daysBetween(sorted[i], sorted[i-1]);
    if (diff === 1) { run++; longest = Math.max(longest, run); }
    else { run = 1; }
  }
  longest = Math.max(longest, run, current);
  return { current, longest, total: days.size };
}

async function updateStreakPill() {
  const days = await getActiveDays();
  const { current } = calcStreakFromDays(days);
  document.getElementById('streakCount').textContent = current;
}

// ── Streak Modal ──────────────────────────────────────────────────────────────
let calYear, calMonth;

async function openStreakModal() {
  const days = await getActiveDays();
  const { current, longest, total } = calcStreakFromDays(days);
  const doneTasks = allTasks.filter(t => t.done).length;

  document.getElementById('streakModalCount').textContent = current;
  document.getElementById('statLongest').textContent = longest;
  document.getElementById('statTotal').textContent = total;
  document.getElementById('statDone').textContent = doneTasks;

  const subs = ["Keep going, you're on fire! 🔥","Every day counts. Don't break the chain!","Consistency builds greatness 💪","You're crushing it!"];
  document.getElementById('streakModalSub').textContent = current > 0 ? subs[current % subs.length] : 'Complete a task today to start your streak!';

  const now = new Date();
  calYear = now.getFullYear(); calMonth = now.getMonth();
  renderCalendar(days);
  document.getElementById('streakModal').style.display = 'flex';
}
function closeStreakModal() { document.getElementById('streakModal').style.display = 'none'; }
async function calPrev() { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(await getActiveDays()); }
async function calNext() { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar(await getActiveDays()); }

function renderCalendar(activeDays) {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('calMonthLabel').textContent = `${months[calMonth]} ${calYear}`;
  const today = todayKey();
  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';
  ['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(d => {
    const h = document.createElement('div'); h.className = 'cal-day-header'; h.textContent = d; grid.appendChild(h);
  });
  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();
  for (let i = 0; i < firstDay; i++) {
    const e = document.createElement('div'); e.className = 'cal-day empty'; grid.appendChild(e);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const cell = document.createElement('div');
    let cls = 'cal-day';
    if (activeDays && activeDays.has(key)) cls += ' active';
    if (key === today) cls += ' today';
    cell.className = cls; cell.textContent = d; grid.appendChild(cell);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  FILTER STATE
// ══════════════════════════════════════════════════════════════════════════════
let currentFilter = 'all';
function setFilter(f, btn) {
  currentFilter = f;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  render();
}

// ══════════════════════════════════════════════════════════════════════════════
//  DEADLINE HELPERS (12-hr ↔ ISO)
// ══════════════════════════════════════════════════════════════════════════════
function buildDeadlineISO(dateVal, hourVal, minVal, ampm) {
  if (!dateVal) return '';
  let h = parseInt(hourVal) || 0;
  const m = parseInt(minVal) || 0;
  if (ampm === 'PM' && h !== 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return `${dateVal}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function parseDeadlineTo12(isoStr) {
  if (!isoStr) return { date: '', hour: '', min: '', ampm: 'AM' };
  const d = new Date(isoStr);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return {
    date: isoStr.slice(0, 10),
    hour: String(h),
    min: String(m).padStart(2, '0'),
    ampm
  };
}

function formatDeadline12(isoStr) {
  if (!isoStr) return 'No deadline';
  const d = new Date(isoStr);
  return d.toLocaleString('en-IN', { dateStyle: 'medium', hour: 'numeric', minute: '2-digit', hour12: true });
}

// ══════════════════════════════════════════════════════════════════════════════
//  ADD TASK
// ══════════════════════════════════════════════════════════════════════════════
async function addTask() {
  const text = document.getElementById('task').value.trim();
  if (!text) { alert('Please enter a task title.'); return; }

  const dateVal = document.getElementById('deadlineDate').value;
  const hourVal = document.getElementById('deadlineHour').value;
  const minVal = document.getElementById('deadlineMin').value;
  const ampm = document.getElementById('deadlineAmPm').value;
  const deadline = buildDeadlineISO(dateVal, hourVal, minVal, ampm);

  const task = {
    text,
    desc: document.getElementById('taskDesc').value.trim(),
    deadline,
    priority: document.getElementById('priority').value,
    category: document.getElementById('category').value.trim(),
    taskType: document.getElementById('taskType').value,
    done: false,
    evidence: null
  };

  await addTaskToFirestore(task);

  // Clear form
  ['task','taskDesc','deadlineDate','deadlineHour','deadlineMin','category'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('priority').value = 'medium';
  document.getElementById('taskType').value = 'temporary';
  document.getElementById('deadlineAmPm').value = 'AM';

  showToast('Task added!', '✅');
}

// ══════════════════════════════════════════════════════════════════════════════
//  EDIT TASK
// ══════════════════════════════════════════════════════════════════════════════
let editTargetId = null;

function openEditModal(id) {
  const t = allTasks.find(x => x.id === id);
  if (!t) return;
  editTargetId = id;
  document.getElementById('editTitle').value = t.text;
  document.getElementById('editDesc').value = t.desc || '';
  document.getElementById('editCategory').value = t.category || '';
  document.getElementById('editPriority').value = t.priority || 'medium';

  const p = parseDeadlineTo12(t.deadline);
  document.getElementById('editDate').value = p.date;
  document.getElementById('editHour').value = p.hour;
  document.getElementById('editMin').value = p.min;
  document.getElementById('editAmPm').value = p.ampm;

  document.getElementById('editModal').style.display = 'flex';
}

function closeEditModal() {
  document.getElementById('editModal').style.display = 'none';
  editTargetId = null;
}

async function saveEdit() {
  if (!editTargetId) return;
  const dateVal = document.getElementById('editDate').value;
  const hourVal = document.getElementById('editHour').value;
  const minVal = document.getElementById('editMin').value;
  const ampm = document.getElementById('editAmPm').value;
  const deadline = buildDeadlineISO(dateVal, hourVal, minVal, ampm);

  await updateTaskInFirestore(editTargetId, {
    text: document.getElementById('editTitle').value.trim(),
    desc: document.getElementById('editDesc').value.trim(),
    category: document.getElementById('editCategory').value.trim(),
    priority: document.getElementById('editPriority').value,
    deadline
  });

  closeEditModal();
  showToast('Task updated!', '✏️');
}

// ══════════════════════════════════════════════════════════════════════════════
//  DELETE TASK
// ══════════════════════════════════════════════════════════════════════════════
async function deleteTask(id) {
  if (!confirm('Delete this task?')) return;
  await deleteTaskFromFirestore(id);
  showToast('Task deleted', '🗑️');
}

// ══════════════════════════════════════════════════════════════════════════════
//  RENDER
// ══════════════════════════════════════════════════════════════════════════════
function render() {
  const list = document.getElementById('list');
  const search = (document.getElementById('searchBox')?.value || '').toLowerCase();
  const now = new Date();

  let filtered = allTasks.filter(t => {
    if (currentFilter === 'pending' && t.done) return false;
    if (currentFilter === 'done' && !t.done) return false;
    if (currentFilter === 'constant' && t.taskType !== 'constant') return false;
    if (search && !t.text.toLowerCase().includes(search) &&
        !(t.category || '').toLowerCase().includes(search)) return false;
    return true;
  });

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>No tasks found. Add one above!</p></div>`;
    updateMiniView();
    return;
  }

  filtered.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.deadline && b.deadline) return new Date(a.deadline) - new Date(b.deadline);
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return 0;
  });

  list.innerHTML = '';
  filtered.forEach(t => {
    const isOverdue = !t.done && t.deadline && new Date(t.deadline) < now;
    const deadlineStr = formatDeadline12(t.deadline);

    let classes = `task-item priority-${t.priority}`;
    if (t.done) classes += ' done';
    if (isOverdue) classes += ' overdue';
    if (t.taskType === 'constant') classes += ' constant-task';

    const priorityEmoji = { high:'🔴', medium:'🟡', low:'🟢' }[t.priority] || '⚪';
    const priorityLabel = (t.priority||'').charAt(0).toUpperCase() + (t.priority||'').slice(1);

    const badges = `
      <span class="badge badge-${t.priority}">${priorityEmoji} ${priorityLabel}</span>
      ${t.taskType === 'constant' ? `<span class="badge badge-constant">🔁 Daily</span>` : ''}
      ${t.category ? `<span class="badge badge-category">🏷️ ${esc(t.category)}</span>` : ''}
      ${t.done ? `<span class="badge badge-done">✅ Done</span>` : ''}
      ${isOverdue ? `<span class="badge badge-overdue">⚠️ Overdue</span>` : ''}
    `;

    const actions = t.done
      ? `<button class="btn-sm btn-view-evidence" onclick="viewEvidence('${t.id}')">📎 Evidence</button>
         <button class="btn-sm btn-delete" onclick="deleteTask('${t.id}')">🗑️ Delete</button>`
      : `<button class="btn-sm btn-complete" onclick="openEvidenceModal('${t.id}')">✅ Complete</button>
         <button class="btn-sm btn-edit" onclick="openEditModal('${t.id}')">✏️ Edit</button>
         <button class="btn-sm btn-delete" onclick="deleteTask('${t.id}')">🗑️ Delete</button>`;

    const item = document.createElement('li');
    item.className = classes;
    item.innerHTML = `
      <div class="task-top">
        <span class="task-title">${esc(t.text)}</span>
        <div class="task-badges">${badges}</div>
      </div>
      ${t.desc ? `<p class="task-desc">${esc(t.desc)}</p>` : ''}
      <div class="task-meta">
        <span>⏰ ${deadlineStr}</span>
        ${t.completedAt ? `<span>✅ Completed ${new Date(t.completedAt.toDate ? t.completedAt.toDate() : t.completedAt).toLocaleDateString('en-IN')}</span>` : ''}
        ${t.evidence && t.evidence.aiVerified ? `<span style="color:#1e8449">🤖 AI Verified</span>` : ''}
      </div>
      <div class="task-actions">${actions}</div>
    `;
    list.appendChild(item);
  });

  updateMiniView();
}

function updateMiniView() {
  const pending = allTasks.filter(t => !t.done).length;
  const done = allTasks.filter(t => t.done).length;
  const overdue = allTasks.filter(t => !t.done && t.deadline && new Date(t.deadline) < new Date()).length;
  document.getElementById('miniPending').textContent = `${pending} pending`;
  document.getElementById('miniDone').textContent = `${done} done`;
  document.getElementById('miniOverdue').textContent = `${overdue} overdue`;
  // streak is updated separately
}

// ══════════════════════════════════════════════════════════════════════════════
//  EVIDENCE MODAL + AI VERIFICATION
// ══════════════════════════════════════════════════════════════════════════════
let evidenceTargetId = null;

function openEvidenceModal(id) {
  evidenceTargetId = id;
  const t = allTasks.find(x => x.id === id);
  document.getElementById('evidenceTaskName').textContent = t ? t.text : '';
  document.getElementById('evidenceFile').value = '';
  document.getElementById('evidenceNote').value = '';
  document.getElementById('evidencePreview').style.display = 'none';
  document.getElementById('previewImg').style.display = 'none';
  document.getElementById('previewImg').src = '';
  document.getElementById('previewFileName').textContent = '';
  document.getElementById('aiVerifyResult').style.display = 'none';
  document.getElementById('aiVerifyResult').className = 'ai-result-box';
  document.getElementById('aiVerifyResult').textContent = '';
  document.getElementById('evidenceModal').style.display = 'flex';
}

function closeEvidenceModal() {
  document.getElementById('evidenceModal').style.display = 'none';
  evidenceTargetId = null;
}

function previewEvidence() {
  const file = document.getElementById('evidenceFile').files[0];
  if (!file) return;
  document.getElementById('evidencePreview').style.display = 'block';
  document.getElementById('previewFileName').textContent = '📎 ' + file.name;
  if (file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = e => {
      const img = document.getElementById('previewImg');
      img.src = e.target.result; img.style.display = 'block';
    };
    reader.readAsDataURL(file);
  } else {
    document.getElementById('previewImg').style.display = 'none';
  }
}

async function verifyEvidenceWithAI(taskText, note, imageBase64, imageType) {
  // Build content for Claude
  const content = [];

  if (imageBase64 && imageType && imageType.startsWith('image/')) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: imageType, data: imageBase64 }
    });
  }

  content.push({
    type: 'text',
    text: `Task: "${taskText}"\nEvidence note from user: "${note || '(none)'}"\n\nDoes this evidence (image and/or note) reasonably support completing the task? Consider the type of task — for example, language practice, exercise, work tasks, reading, etc. Reply in 2 parts:\n1. VERIFIED or UNVERIFIED\n2. One sentence explanation in simple English.\nKeep it encouraging.`
  });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 200, messages: [{ role: 'user', content }] })
  });

  if (!response.ok) throw new Error('AI verification failed');
  const data = await response.json();
  return data.content[0]?.text || '';
}

async function submitEvidence() {
  if (!evidenceTargetId) return;
  const file = document.getElementById('evidenceFile').files[0];
  const note = document.getElementById('evidenceNote').value.trim();
  const t = allTasks.find(x => x.id === evidenceTargetId);

  if (!file && !note) { alert('Please upload a file or add a note as evidence.'); return; }

  const btn = document.getElementById('submitEvidenceBtn');
  btn.disabled = true;
  btn.textContent = '🤖 AI Verifying...';

  const aiBox = document.getElementById('aiVerifyResult');
  aiBox.style.display = 'block';
  aiBox.className = 'ai-result-box';
  aiBox.textContent = 'Checking evidence with AI...';

  const finalize = async (fileData, fileType, fileName) => {
    let aiVerified = false;
    let aiMessage = '';

    // Try AI verification
    if (ANTHROPIC_KEY && ANTHROPIC_KEY !== 'YOUR_ANTHROPIC_API_KEY') {
      try {
        const rawBase64 = fileData ? fileData.split(',')[1] : null;
        const result = await verifyEvidenceWithAI(t ? t.text : '', note, rawBase64, fileType);
        aiVerified = result.toUpperCase().includes('VERIFIED') && !result.toUpperCase().includes('UNVERIFIED');
        aiMessage = result.replace(/^(VERIFIED|UNVERIFIED)[:\s]*/i, '').trim();
      } catch(e) {
        aiMessage = 'AI verification skipped.';
      }
    } else {
      aiMessage = 'AI key not configured — marking complete without verification.';
      aiVerified = true;
    }

    // Show result
    aiBox.className = 'ai-result-box ' + (aiVerified ? 'verified' : 'unverified');
    aiBox.textContent = (aiVerified ? '✅ Verified — ' : '⚠️ Needs review — ') + aiMessage;

    // Still allow saving regardless
    const evidence = {
      note,
      fileName: fileName || null,
      fileType: fileType || null,
      fileData: fileData || null,
      aiVerified,
      aiMessage,
      submittedAt: new Date().toISOString()
    };

    await updateTaskInFirestore(evidenceTargetId, {
      done: true,
      completedAt: firebase.firestore.Timestamp.now(),
      evidence
    });

    // Record active day & update streak
    await recordDailyVisit();
    const days = await getActiveDays();
    const { current } = calcStreakFromDays(days);
    updateStreakPill();

    btn.disabled = false;
    btn.textContent = '✅ Mark Complete';

    // Celebration
    setTimeout(() => {
      closeEvidenceModal();
      showCelebration(t ? t.text : 'Task', current);
    }, 1200);

    // Browser notification
    if (Notification.permission === 'granted') {
      new Notification('✅ Task Completed!', { body: `"${t ? t.text : 'Task'}" — ${current} day streak! 🔥` });
    }
  };

  if (file) {
    const reader = new FileReader();
    reader.onload = e => finalize(e.target.result, file.type, file.name);
    reader.readAsDataURL(file);
  } else {
    finalize(null, null, null);
  }
}

// ── View Evidence ─────────────────────────────────────────────────────────────
function viewEvidence(id) {
  const t = allTasks.find(x => x.id === id);
  if (!t) return;
  document.getElementById('viewTaskName').textContent = t.text;
  const ev = t.evidence;
  let html = '';
  if (ev) {
    if (ev.fileData && ev.fileType && ev.fileType.startsWith('image/')) {
      html += `<img src="${ev.fileData}" alt="Evidence" style="max-width:100%;border-radius:8px;border:1px solid var(--border);margin-bottom:10px;">`;
    }
    if (ev.fileName) {
      html += `<p class="file-name-label">📎 ${esc(ev.fileName)}</p>`;
      if (ev.fileData && !ev.fileType.startsWith('image/')) {
        html += `<a href="${ev.fileData}" download="${ev.fileName}" class="btn-sm btn-view-evidence" style="display:inline-block;margin-top:8px;text-decoration:none">⬇️ Download</a>`;
      }
    }
    if (ev.note) {
      html += `<div style="background:var(--bg);border-radius:8px;padding:12px 14px;margin-top:10px;font-size:13px;color:var(--text)"><strong>Note:</strong><br>${esc(ev.note)}</div>`;
    }
    if (ev.aiVerified !== undefined) {
      html += `<div class="ai-result-box ${ev.aiVerified?'verified':'unverified'}" style="margin-top:10px">${ev.aiVerified?'✅ AI Verified':'⚠️ Unverified'} — ${esc(ev.aiMessage||'')}</div>`;
    }
    if (ev.submittedAt) {
      html += `<p style="font-size:12px;color:var(--text3);margin-top:8px">Submitted: ${new Date(ev.submittedAt).toLocaleString('en-IN')}</p>`;
    }
  } else {
    html = '<p style="color:var(--text3);font-size:14px">No evidence submitted.</p>';
  }
  document.getElementById('viewEvidenceContent').innerHTML = html;
  document.getElementById('viewEvidenceModal').style.display = 'flex';
}

function closeViewModal() { document.getElementById('viewEvidenceModal').style.display = 'none'; }

// ══════════════════════════════════════════════════════════════════════════════
//  CELEBRATION
// ══════════════════════════════════════════════════════════════════════════════
function showCelebration(taskName, streakCount) {
  const milestones = [
    { days: 30, emoji: '🏆', title: '30-Day Legend!', msg: `"${taskName}" done & 30-day streak! You're unstoppable!` },
    { days: 7,  emoji: '🔥', title: 'Week Warrior!', msg: `"${taskName}" done & ${streakCount}-day streak! On fire!` },
    { days: 1,  emoji: '🎉', title: 'Task Complete!', msg: `"${taskName}" — Great job! Keep the momentum going!` },
  ];
  const m = milestones.find(x => streakCount >= x.days) || milestones[milestones.length-1];

  document.getElementById('celebEmoji').textContent = m.emoji;
  document.getElementById('celebTitle').textContent = m.title;
  document.getElementById('celebMsg').textContent = m.msg;
  document.getElementById('celebrationOverlay').style.display = 'flex';
  runConfetti();
}

function closeCelebration() {
  document.getElementById('celebrationOverlay').style.display = 'none';
}

function runConfetti() {
  const canvas = document.getElementById('confettiCanvas');
  const ctx = canvas.getContext('2d');
  const particles = Array.from({length: 60}, () => ({
    x: Math.random() * 300, y: Math.random() * -100,
    r: Math.random() * 6 + 3,
    color: ['#4f6ef7','#ff6b35','#27ae60','#f39c12','#a78bfa','#ff4499'][Math.floor(Math.random()*6)],
    vx: (Math.random()-0.5)*4, vy: Math.random()*3+1,
    rotation: Math.random()*360
  }));
  let frame = 0;
  function draw() {
    ctx.clearRect(0, 0, 300, 200);
    particles.forEach(p => {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rotation * Math.PI/180);
      ctx.fillStyle = p.color; ctx.fillRect(-p.r/2, -p.r/2, p.r, p.r);
      ctx.restore();
      p.x += p.vx; p.y += p.vy; p.rotation += 4;
    });
    frame++;
    if (frame < 90) requestAnimationFrame(draw);
  }
  draw();
}

// ══════════════════════════════════════════════════════════════════════════════
//  YESTERDAY / HISTORY VIEW (last 7 days)
// ══════════════════════════════════════════════════════════════════════════════
function showYesterdayView() {
  const now = new Date();
  const content = document.getElementById('yesterdayContent');
  let html = '';

  for (let i = 1; i <= 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dayStr = d.toISOString().slice(0, 10);
    const label = i === 1 ? 'Yesterday' : d.toLocaleDateString('en-IN', { weekday: 'long', month: 'short', day: 'numeric' });

    // Tasks that were created on this day OR completed on this day
    const dayTasks = allTasks.filter(t => {
      const created = t.createdAt ? (t.createdAt.toDate ? t.createdAt.toDate() : new Date(t.createdAt)).toISOString().slice(0,10) : null;
      const completed = t.completedAt ? (t.completedAt.toDate ? t.completedAt.toDate() : new Date(t.completedAt)).toISOString().slice(0,10) : null;
      return created === dayStr || completed === dayStr;
    });

    html += `<div class="history-day">
      <div class="history-day-label">${label}</div>`;

    if (dayTasks.length === 0) {
      html += `<div style="font-size:13px;color:var(--text3);padding:8px 0">No tasks for this day.</div>`;
    } else {
      dayTasks.forEach(t => {
        html += `<div class="history-task-row">
          <span class="history-status">${t.done ? '✅' : '⏳'}</span>
          <span class="history-task-name ${t.done?'history-task-done':''}">${esc(t.text)}</span>
          <span style="font-size:11px;color:var(--text3)">${t.priority||''}</span>
        </div>`;
      });
    }
    html += `</div>`;
  }

  content.innerHTML = html || '<p style="color:var(--text3);font-size:14px">No history found.</p>';
  document.getElementById('yesterdayModal').style.display = 'flex';
}

function closeYesterdayModal() { document.getElementById('yesterdayModal').style.display = 'none'; }

// ══════════════════════════════════════════════════════════════════════════════
//  NOTIFICATIONS
// ══════════════════════════════════════════════════════════════════════════════
function initNotifications() {
  if (!('Notification' in window)) return;
  const badge = document.getElementById('notifStatus');
  if (Notification.permission === 'granted') {
    badge.classList.add('on');
    badge.textContent = '🔔';
    badge.title = 'Notifications ON';
  } else {
    badge.textContent = '🔕';
    badge.title = 'Enable Notifications';
  }
}

function toggleNotifications() {
  if (!('Notification' in window)) { alert('Notifications not supported in this browser.'); return; }
  if (Notification.permission === 'granted') {
    showToast('Notifications already enabled!', '🔔');
  } else {
    Notification.requestPermission().then(p => {
      const badge = document.getElementById('notifStatus');
      if (p === 'granted') {
        badge.classList.add('on');
        badge.textContent = '🔔';
        badge.title = 'Notifications ON';
        showToast('Notifications enabled!', '🔔');
      } else {
        showToast('Notifications blocked by browser.', '❌');
      }
    });
  }
}

function checkDailyNotification() {
  if (Notification.permission !== 'granted') return;
  const today = new Date().toDateString();
  const lastDaily = localStorage.getItem('subu_daily_notif_' + (currentUser?.uid||''));
  if (lastDaily === today) return;

  const pending = allTasks.filter(t => !t.done);
  const todayTasks = pending.filter(t => {
    if (!t.deadline) return false;
    return new Date(t.deadline).toDateString() === today;
  });

  let title = '📋 Good morning!';
  let body = '';
  if (todayTasks.length > 0) {
    title = `📋 ${todayTasks.length} task(s) due today!`;
    body = todayTasks.slice(0,2).map(t => `• ${t.text}`).join('\n');
  } else if (pending.length > 0) {
    title = `📋 ${pending.length} pending tasks!`;
    body = 'Open the app to check what needs to be done.';
  } else {
    title = '🎉 All tasks done!';
    body = 'Great work! Add new tasks to keep going.';
  }

  new Notification(title, { body });
  localStorage.setItem('subu_daily_notif_' + (currentUser?.uid||''), today);
}

let reminderInterval = null;
function startReminderLoop() {
  stopReminderLoop();
  reminderInterval = setInterval(() => {
    if (Notification.permission !== 'granted') return;
    const now = new Date();
    allTasks.forEach(t => {
      if (t.done || !t.deadline) return;
      const d = new Date(t.deadline);
      const diffMin = (d - now) / 60000;
      if (diffMin >= 1439 && diffMin < 1441) new Notification('⏰ Task due tomorrow!', { body: t.text });
      if (diffMin >= 59 && diffMin < 61) new Notification('🚨 Task due in 1 hour!', { body: t.text });
      if (diffMin >= -1 && diffMin < 1) new Notification('❗ Deadline reached!', { body: `"${t.text}" is due now!` });
    });
  }, 60000);
}
function stopReminderLoop() {
  if (reminderInterval) { clearInterval(reminderInterval); reminderInterval = null; }
}

// ══════════════════════════════════════════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════════════════════════════════════════
function showToast(msg, icon = 'ℹ️') {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'toast';
  toast.textContent = icon + ' ' + msg;
  Object.assign(toast.style, {
    position: 'fixed', bottom: '24px', right: '24px',
    background: '#1a1a2e', color: '#fff',
    padding: '12px 20px', borderRadius: '10px',
    fontSize: '14px', fontWeight: '500',
    boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
    zIndex: '999', opacity: '0', transition: 'opacity .3s'
  });
  document.body.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; });
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 400); }, 2800);
}

// ══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════════════════
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

document.addEventListener('click', e => {
  if (e.target.id === 'evidenceModal') closeEvidenceModal();
  if (e.target.id === 'viewEvidenceModal') closeViewModal();
  if (e.target.id === 'streakModal') closeStreakModal();
  if (e.target.id === 'editModal') closeEditModal();
  if (e.target.id === 'yesterdayModal') closeYesterdayModal();
  if (e.target.id === 'celebrationOverlay') closeCelebration();
});

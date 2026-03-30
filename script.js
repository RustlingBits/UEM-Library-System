/* ============ DATA STORE ============ */
const LS = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v))
};

const DEFAULT_BOOKS = [
  {id:'b1',t:'The Midnight Library',a:'Matt Haig',g:'Fiction',c:3,e:'🌌',cf:'#1e3a5f',ct:'#4a90d9'},
  {id:'b2',t:'Atomic Habits',a:'James Clear',g:'Self-Help',c:2,e:'⚡',cf:'#1a4731',ct:'#2ecc71'},
  {id:'b3',t:'Dune',a:'Frank Herbert',g:'Sci-Fi',c:4,e:'🏜️',cf:'#5c3a1e',ct:'#c9852c'},
  {id:'b4',t:'The Name of the Wind',a:'Patrick Rothfuss',g:'Fantasy',c:2,e:'🌬️',cf:'#2d1b4e',ct:'#8e44ad'},
  {id:'b5',t:'Sapiens',a:'Yuval Noah Harari',g:'History',c:3,e:'🧬',cf:'#1a3a4a',ct:'#16a085'},
  {id:'b6',t:'The Great Gatsby',a:'F. Scott Fitzgerald',g:'Classic',c:5,e:'✨',cf:'#3d2700',ct:'#f39c12'},
  {id:'b7',t:'Thinking, Fast and Slow',a:'Daniel Kahneman',g:'Psychology',c:2,e:'🧠',cf:'#1a1a2e',ct:'#e94560'},
  {id:'b8',t:'1984',a:'George Orwell',g:'Dystopia',c:4,e:'👁️',cf:'#1c1c1c',ct:'#cc0000'},
  {id:'b9',t:'The Alchemist',a:'Paulo Coelho',g:'Fiction',c:3,e:'⭐',cf:'#2c2c54',ct:'#ffd32a'},
  {id:'b10',t:'Project Hail Mary',a:'Andy Weir',g:'Sci-Fi',c:2,e:'🚀',cf:'#0a0a23',ct:'#00b4d8'},
  {id:'b11',t:'The Body Keeps the Score',a:'Bessel van der Kolk',g:'Psychology',c:2,e:'🌿',cf:'#1b3a2c',ct:'#52b788'},
  {id:'b12',t:'Normal People',a:'Sally Rooney',g:'Fiction',c:3,e:'💫',cf:'#3d1a1a',ct:'#e76f51'},
];
const DEFAULT_USERS = [
  {id:'u1', name:'Alice Johnson', role:'student', password:'pass123'},
  {id:'u2', name:'Bob Williams', role:'student', password:'pass123'},
  {id:'u3', name:'Dr. Sarah Chen', role:'teacher', password:'pass123'},
];

let books    = LS.get('bib_books', DEFAULT_BOOKS);
let users    = LS.get('bib_users', DEFAULT_USERS);
let records  = LS.get('bib_records', []);  // {id,bk,uid,issued,due,returned?}
let budget   = LS.get('bib_budget', {total:50000, spent:18500});
let wishlist = LS.get('bib_wishlist', []); // 🟢 NEW: Store wishlist items
let me = null, role = null, tab = null, editId = null, currentDetailId = null, scannedBookTemp = null;
let logsPage = 1; const PER = 8;
let logsSort = {col:'due', asc:true};

// 🟢 NEW: Update the save function
function save() {
  LS.set('bib_books',books); LS.set('bib_users',users);
  LS.set('bib_records',records); LS.set('bib_budget',budget);
  LS.set('bib_wishlist', wishlist); 
}

/* ============ SERVICE WORKER REGISTRATION ============ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .then(reg => console.log('✅ Service Worker registered:', reg))
      .catch(err => console.log('❌ Service Worker registration failed:', err));
  });
}

/* ============ THEME TOGGLE ============ */
let isLightMode = LS.get('bib_theme', false);

// Apply theme instantly on load
if (isLightMode) {
  document.body.classList.add('light-theme');
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('themeToggle');
    if(btn) btn.textContent = '🌙';
  });
}

function toggleTheme() {
  isLightMode = !isLightMode;
  document.body.classList.toggle('light-theme', isLightMode);
  document.getElementById('themeToggle').textContent = isLightMode ? '🌙' : '☀️';
  LS.set('bib_theme', isLightMode);
}

/* ============ NOTIFICATION CENTER ============ */
function toggleNotifs() {
  document.getElementById('notifPanel').classList.toggle('open');
}

// Close the dropdown if the user clicks anywhere else on the screen
document.addEventListener('click', (e) => {
  const panel = document.getElementById('notifPanel');
  if (panel && panel.classList.contains('open') && !e.target.closest('#notifPanel') && !e.target.closest('button[onclick="toggleNotifs()"]')) {
    panel.classList.remove('open');
  }
});

function checkNotifications() {
  if (!me) return;
  
  let alerts = [];
  const now = new Date();

  if (me.role === 'student') {
    // 🎓 STUDENT LOGIC: Check for due or overdue books
    const myBorrows = records.filter(r => r.uid === me.id && !r.returned);
    
    myBorrows.forEach(r => {
      const bk = books.find(b => b.id === r.bk);
      const title = bk ? bk.t : 'A book';
      const dueDate = new Date(r.due);
      const daysLeft = Math.ceil((dueDate - now) / 86400000);

      if (daysLeft < 0) {
        alerts.push({ type: 'danger', msg: `🚨 Overdue: "${title}" is ${Math.abs(daysLeft)} days late! Please return it.` });
      } else if (daysLeft <= 2) {
        alerts.push({ type: 'warning', msg: `⚠️ Reminder: "${title}" is due in ${daysLeft} day(s).` });
      }
    });
    
    // Add a welcome info alert if they have no other alerts
    if(alerts.length === 0) alerts.push({ type: 'info', msg: `👋 Welcome back, ${me.name.split(' ')[0]}! You have no pending deadlines.` });

  } else if (me.role === 'teacher') {
    // 👩‍🏫 ADMIN LOGIC: Check for students with high fines or extreme overdues
    const students = users.filter(u => u.role === 'student');
    
    students.forEach(student => {
      // Calculate this student's fines
      let calcFine = 0;
      records.filter(r => r.uid === student.id).forEach(r => calcFine += fineFor(r));
      let currentFine = calcFine - (student.paidFines || 0);

      if (currentFine >= 100 && !student.blocked) {
        alerts.push({ type: 'danger', msg: `💰 Action Required: ${student.name} has outstanding fines of ₹${currentFine}. Consider blocking their account.` });
      }
      
      const extremeOverdue = records.filter(r => r.uid === student.id && !r.returned && Math.floor((now - new Date(r.due)) / 86400000) > 7);
      if (extremeOverdue.length > 0) {
         alerts.push({ type: 'warning', msg: `📅 Review: ${student.name} has a book overdue by more than 7 days.` });
      }
    });

    if(alerts.length === 0) alerts.push({ type: 'info', msg: `✅ All clear! Library operations are running smoothly.` });
  }

  // Update the UI Badge
  const badge = document.getElementById('notifBadge');
  const actualAlerts = alerts.filter(a => a.type === 'danger' || a.type === 'warning'); // Don't count 'info' welcomes as critical badges
  
  if (actualAlerts.length > 0) {
    badge.style.display = 'block';
    badge.textContent = actualAlerts.length;
  } else {
    badge.style.display = 'none';
  }

  // Populate the Dropdown List
  const listContainer = document.getElementById('notifList');
  listContainer.innerHTML = alerts.map(a => 
    `<div class="notif-item ${a.type}">${a.msg}</div>`
  ).join('');
}

/* ============ LOGIN FLOW ============ */
let selectedLoginRole = null;

function showLoginForm(role) {
  selectedLoginRole = role;
  
  // Hide Step 1, Show Step 2
  document.getElementById('roleSelectionStep').style.display = 'none';
  document.getElementById('loginFormStep').style.display = 'block';
  
  // Dynamically update the form text based on the clicked role
  document.getElementById('loginFormTitle').textContent = role === 'teacher' ? 'Admin Portal ⚡' : 'Student Portal 🎓';
  document.getElementById('loginEmail').placeholder = role === 'teacher' ? 'e.g., u3' : 'e.g., u1';
}

function showRoleSelection() {
  selectedLoginRole = null;
  
  // Hide Step 2, Show Step 1
  document.getElementById('loginFormStep').style.display = 'none';
  document.getElementById('roleSelectionStep').style.display = 'block';
  
  // Clear the inputs
  document.getElementById('loginEmail').value = '';
  document.getElementById('loginPass').value = '';
}

/* ============ AUTH ============ */
function doLogin(e) {
  const emailInput = document.getElementById('loginEmail').value.trim().toLowerCase();
  const passInput = document.getElementById('loginPass').value;

  const foundUser = users.find(u => u.id === emailInput || (u.email && u.email === emailInput));

  // 🟢 NEW: Validate existence, password, AND that they are using the correct portal
  if (!foundUser || foundUser.password !== passInput) {
    handleLoginError('Invalid ID or Password.');
    return;
  }
  
  if (foundUser.role !== selectedLoginRole) {
    handleLoginError(`Please use the ${foundUser.role === 'teacher' ? 'Admin' : 'Student'} portal to log in.`);
    return;
  }

  // If successful, set the current user
  me = foundUser;
  if(e) addRipple(e, document.getElementById('loginBtn'));
  
  // Transition to the app
  const ls = document.getElementById('loginScreen');
  ls.style.animation = 'panelIn .5s ease reverse both';
  setTimeout(() => {
    ls.classList.add('gone');
    const app = document.getElementById('appShell');
    app.classList.remove('gone');
    requestAnimationFrame(() => { app.classList.add('vis'); initApp(); });
  }, 450);
}

// Helper for the shake animation on error
function handleLoginError(msg) {
  toast(msg, 'err');
  const wrap = document.querySelector('.login-form-wrap');
  wrap.style.transform = 'translateX(10px)';
  setTimeout(() => wrap.style.transform = 'translateX(-10px)', 100);
  setTimeout(() => wrap.style.transform = 'translateX(0)', 200);
}

function doLogout() {
  me = null; role = null; tab = null; editId = null;
  const app = document.getElementById('appShell');
  app.classList.remove('vis');
  setTimeout(() => {
    app.classList.add('gone');
    const ls = document.getElementById('loginScreen');
    ls.classList.remove('gone');
    ls.style.animation = 'loginIn .7s cubic-bezier(.22,1,.36,1) both';
    
    // 🟢 NEW: Reset back to step 1
    showRoleSelection();
  }, 500);
}

/* ============ APP ============ */
function initApp() {
  const isT = me.role === 'teacher';
  document.getElementById('appShell').classList.toggle('teacher-shell', isT);
  
  // 🟢 NEW: Make the profile name clickable (for students)
  const pip = document.getElementById('rolePip');
  if (pip) {
    // We only add the 'onclick' event if they are NOT a teacher
    const clickAction = !isT ? `onclick="goTab('prof')"` : '';
    const cursorStyle = !isT ? 'cursor: pointer;' : '';
    const hoverTitle = !isT ? 'View My Library & Profile' : 'Admin Account';

    pip.innerHTML = `
      <div ${clickAction} class="profile-trigger" style="${cursorStyle} display: flex; align-items: center; gap: 8px;" title="${hoverTitle}">
        <span style="font-weight: 600;">👤 ${me.name.split(' ')[0]}</span>
        <span style="font-size: 0.7rem; background: var(--violet); color: white; padding: 2px 8px; border-radius: 12px; font-weight: bold; letter-spacing: 0.05em;">${isT ? 'ADMIN' : 'STUDENT'}</span>
      </div>
    `;
  }

  const tabs = isT
    // 🟢 NEW: Added {id:'studs',l:'👥 Students'} to the teacher tabs
    ? [{id:'dash',l:'📊 Dashboard'},{id:'inv',l:'📚 Inventory'},{id:'logs',l:'📋 Logs'},{id:'studs',l:'👥 Students'},{id:'budget',l:'💰 Budget'}]
    : [{id:'dash',l:'🏠 Home'},{id:'cat',l:'📖 Catalog'},{id:'com',l:'🌍 Community'}];

  const navHTML = tabs.map(t=>`<button class="nav-item" data-t="${t.id}" onclick="goTab('${t.id}')">${t.l}</button>`).join('');
  document.getElementById('hdrNav').innerHTML = navHTML;
  document.getElementById('mobNav').innerHTML = navHTML;
  goTab(tabs[0].id);
  
  // 🟢 NEW: Run the notification engine when the app loads
  checkNotifications();
}

function goTab(t) {
  tab = t;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('on', b.dataset.t===t));
  document.getElementById('mobNav').classList.remove('open');
  document.getElementById('ham').classList.remove('open');
  render(t);
}

function toggleMob() {
  document.getElementById('mobNav').classList.toggle('open');
  document.getElementById('ham').classList.toggle('open');
}

/* ============ RENDER ============ */
/* ============ RENDER ============ */
function render(t) {
  if (me.role === 'teacher') {
    if (t==='dash')   renderTDash();
    else if (t==='inv') renderInv();
    else if (t==='logs') renderLogs();
    else if (t==='studs') renderStuds(); // 🟢 NEW: Route for Student Management
    else if (t==='budget') renderBudget();
    else if (t==='com') renderCom();
  } else {
    if (t==='dash')   renderSDash();
    else if (t==='cat') renderCat();
    else if (t==='prof') renderProf(); // 🟢 NEW: Students can access profile via header click
    else if (t==='com') renderCom();
  }
  
  // 🟢 NEW: Check notifications whenever we render/refresh
  checkNotifications();
}

/* ---------- helpers ---------- */
function avail(bkId) {
  const bk = books.find(b=>b.id===bkId);
  if (!bk) return 0;
  return Math.max(0, bk.c - records.filter(r=>r.bk===bkId && !r.returned).length);
}
function myActive() { return records.filter(r=>r.uid===me.id && !r.returned); }
function fineFor(r) { 
  // Calculate based on returned date OR today if still borrowed
  const end = r.returned ? new Date(r.returned) : new Date();
  const d = Math.floor((end - new Date(r.due)) / 86400000); 
  return d > 0 ? d * 2 : 0; 
}

/* ============ RECOMMENDATION ENGINE ============ */
function getRecommendations() {
  // 1. Get all books the student has ever borrowed
  const myHistory = records.filter(r => r.uid === me.id);
  const readBookIds = myHistory.map(r => r.bk);

  // If they have no history, just return some random available books as a fallback
  if (myHistory.length === 0) {
    return books.filter(b => avail(b.id) > 0).slice(0, 4);
  }

  // 2. Tally up the genres they read
  const genreCounts = {};
  myHistory.forEach(r => {
    const bk = books.find(b => b.id === r.bk);
    if (bk) genreCounts[bk.g] = (genreCounts[bk.g] || 0) + 1;
  });

  // 3. Find their #1 favorite genre
  const topGenre = Object.keys(genreCounts).sort((a, b) => genreCounts[b] - genreCounts[a])[0];

  // 4. Find books in that top genre that they HAVEN'T read yet
  const primaryRecs = books.filter(b => b.g === topGenre && !readBookIds.includes(b.id) && avail(b.id) > 0);

  // 5. If we don't have enough books in their favorite genre, backfill with other available books
  if (primaryRecs.length < 4) {
    const extraBooks = books.filter(b => !readBookIds.includes(b.id) && b.g !== topGenre && avail(b.id) > 0);
    primaryRecs.push(...extraBooks.slice(0, 4 - primaryRecs.length));
  }

  // Return exactly 4 recommendations
  return primaryRecs.slice(0, 4);
}

/* ============ STUDENT DASH ============ */
function renderSDash() {
  const bor = myActive().length;
  const od = myActive().filter(r=>new Date(r.due)<new Date()).length;
  const hist = records.filter(r=>r.uid===me.id && r.returned).length;
  const av = books.reduce((s,b)=>s+avail(b.id),0);
  
  // 🟢 NEW: Fetch smart recommendations
  const recommendedBooks = getRecommendations();
  // Determine their favorite genre to show in the UI (if they have history)
  let favGenreText = "Handpicked for you";
  if (hist > 0) {
    const myHistory = records.filter(r => r.uid === me.id);
    const gCounts = {};
    myHistory.forEach(r => { const bk = books.find(b => b.id === r.bk); if(bk) gCounts[bk.g] = (gCounts[bk.g] || 0) + 1; });
    const top = Object.keys(gCounts).sort((a,b)=>gCounts[b]-gCounts[a])[0];
    if (top) favGenreText = `Because you love ${top}`;
  }

  setBody(`
    <div class="pg-head" style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 14px;">
      <div>
        <h1 class="pg-title">Good to see you, <em>${me.name.split(' ')[0]}</em> 📚</h1>
        <p class="pg-sub">${new Date().toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</p>
      </div>
      <button class="btn-prim" onclick="openScanner()" style="background: linear-gradient(135deg, #f43f5e, #e11d48); box-shadow: 0 4px 15px rgba(244, 63, 94, 0.3);">📷 Self-Checkout</button>
    </div>
    
    <div class="stat-row">
      <div class="stat"><div class="stat-ico">📖</div><div class="stat-val">${bor}</div><div class="stat-lbl">Borrowed</div></div>
      <div class="stat"><div class="stat-ico">⏰</div><div class="stat-val">${od}</div><div class="stat-lbl">Overdue</div></div>
      <div class="stat"><div class="stat-ico">✅</div><div class="stat-val">${hist}</div><div class="stat-lbl">Returned</div></div>
      <div class="stat"><div class="stat-ico">🗂️</div><div class="stat-val">${av}</div><div class="stat-lbl">Available</div></div>
    </div>

    <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 18px;">
      <h2 class="sec-h" style="margin-bottom: 0;">🎯 Recommended for You</h2>
      <span style="font-size: 0.85rem; color: var(--violet-light); background: var(--violet-pale); padding: 4px 10px; border-radius: 20px;">${favGenreText}</span>
    </div>
    <div class="book-grid" id="recGrid" style="margin-bottom: 36px;"></div>

    <h2 class="sec-h">Recently Added to Library</h2>
    <div class="book-grid" id="recentGrid"></div>`);
    
  // Populate the Recommendation Grid
  const recGrid = document.getElementById('recGrid');
  if (recommendedBooks.length > 0) {
    recommendedBooks.forEach((b,i)=>{ const c=mkCard(b,i); if(c) recGrid.appendChild(c); });
  } else {
    recGrid.innerHTML = '<div class="empty" style="grid-column:1/-1; padding: 20px;"><p>Read some books to get recommendations!</p></div>';
  }

  // Populate the Recently Added Grid
  const rGrid = document.getElementById('recentGrid');
  [...books].reverse().slice(0,4).forEach((b,i)=>{ const c=mkCard(b,i); if(c) rGrid.appendChild(c); });
}

/* ============ CATALOG ============ */
function renderCat() {
  setBody(`
    <div class="pg-head"><h1 class="pg-title">Book <em>Catalog</em></h1>
    <p class="pg-sub">${books.length} titles in the collection</p></div>
    <div class="search-bar">
      <div class="srch-wrap"><span class="srch-ico">🔍</span>
      <input class="srch-input" id="si" placeholder="Search title or author…" oninput="filterCat()"></div>
      <select class="flt-sel" id="gi" onchange="filterCat()"><option value="">All Genres</option>${genres().map(g=>`<option>${g}</option>`).join('')}</select>
      <select class="flt-sel" id="ai" onchange="filterCat()"><option value="">All Status</option><option value="a">Available</option><option value="b">Borrowed</option></select>
    </div>
    <div class="book-grid" id="catGrid"></div>`);
  filterCat();
}
function genres() { return [...new Set(books.map(b=>b.g))]; }
function filterCat() {
  const q=(document.getElementById('si')?.value||'').toLowerCase();
  const g=document.getElementById('gi')?.value||'';
  const a=document.getElementById('ai')?.value||'';
  const f=books.filter(b=>{
    const mq=!q||b.t.toLowerCase().includes(q)||b.a.toLowerCase().includes(q);
    const mg=!g||b.g===g;
    const av=avail(b.id);
    const ma=!a||(a==='a'?av>0:av===0);
    return mq&&mg&&ma;
  });
  const gr=document.getElementById('catGrid');
  gr.innerHTML='';
  if(!f.length){gr.innerHTML='<div class="empty" style="grid-column:1/-1"><div class="empty-ico">📭</div><p>No books found</p></div>';return;}
  f.forEach((b,i)=>{const c=mkCard(b,i);if(c)gr.appendChild(c);});
}

/* ============ COMMUNITY ============ */
function renderCom() {
  setBody(`
    <div class="pg-head"><h1 class="pg-title"><em>Community</em></h1>
    <p class="pg-sub">Connect with other readers and share your thoughts</p></div>
    <div style="text-align:center; padding:60px 20px; color:var(--text-muted);">
      <p style="font-size:1.2rem; margin-bottom:20px;">🚀 Coming Soon</p>
      <p>Community features are under development.</p>
      <p style="font-size:0.9rem; margin-top:20px;">Check back soon for discussion forums, book clubs, and reader recommendations!</p>
    </div>
  `);
}

/* ============ GAMIFICATION & BADGES ============ */
function getEarnedBadges() {
  const myHistory = records.filter(r => r.uid === me.id);
  const returnedHistory = myHistory.filter(r => r.returned);
  let badges = [];

  // 1. The Starter Badge
  if (myHistory.length >= 1) {
    badges.push({ icon: '🌱', name: 'Seedling Reader', desc: 'Borrowed your first book!' });
  }

  // 2. The Power Reader Badge
  if (myHistory.length >= 5) {
    badges.push({ icon: '🔥', name: 'On Fire', desc: 'Borrowed 5 or more books.' });
  }
  
  // 3. The Punctuality Badge
  const onTimeReturns = returnedHistory.filter(r => new Date(r.returned) <= new Date(r.due));
  if (onTimeReturns.length >= 1) {
    badges.push({ icon: '⏱️', name: 'Punctual', desc: 'Returned a book before the due date.' });
  }

  // 4. Genre-Specific Badges
  const sciFiCount = myHistory.filter(r => {
      const bk = books.find(b => b.id === r.bk);
      return bk && bk.g === 'Sci-Fi';
  }).length;
  if (sciFiCount >= 2) {
      badges.push({ icon: '🚀', name: 'Sci-Fi Explorer', desc: 'Read multiple Sci-Fi books.' });
  }

  const historyCount = myHistory.filter(r => {
      const bk = books.find(b => b.id === r.bk);
      return bk && bk.g === 'History';
  }).length;
  if (historyCount >= 2) {
      badges.push({ icon: '🏛️', name: 'Time Traveler', desc: 'Read multiple History books.' });
  }

  return badges;
}

/* ============ PROFILE ============ */
function renderProf() {
  const bor = myActive();
  const hist = records.filter(r=>r.uid===me.id && r.returned);
  
  let calcFine = 0;
  records.filter(r => r.uid === me.id).forEach(r => calcFine += fineFor(r));
  let fine = calcFine - (me.paidFines || 0);

  let borHTML = bor.length ? bor.map(r=>{
    const bk=books.find(b=>b.id===r.bk);
    const d=Math.floor((new Date(r.due)-Date.now())/86400000);
    let bc,bt;
    if(d<0){bc='due-late';bt=`${Math.abs(d)}d overdue`;}
    else if(d<=3){bc='due-warn';bt=`Due in ${d}d`;}
    else{bc='due-ok';bt=`Due ${new Date(r.due).toLocaleDateString()}`;}
    return `<div class="borrow-item">
      <div><div class="bi-ttl">${bk?bk.t:'Unknown'}</div><div class="bi-auth">${bk?bk.a:''}</div></div>
      <span class="due-badge ${bc}">${bt}</span></div>`;
  }).join('') : '<div class="empty" style="padding: 20px;"><p>No books currently borrowed.</p></div>';

  let histHTML = hist.length ? hist.slice(-6).reverse().map(r=>{
    const bk=books.find(b=>b.id===r.bk);
    return `<div class="tl-item"><div class="tl-ttl">${bk?bk.t:r.bk}</div>
    <div class="tl-meta">Returned ${new Date(r.returned).toLocaleDateString()}</div></div>`;
  }).join('') : '<p style="color:var(--text-muted);font-size:.875rem">No reading history yet.</p>';

  const myWishlist = wishlist.filter(w => w.uid === me.id);
  let wishHTML = myWishlist.length ? myWishlist.map(w => {
    const bk = books.find(b => b.id === w.bk);
    if(!bk) return '';
    return `<div class="borrow-item" style="border-color: rgba(244,63,94,0.3);">
      <div><div class="bi-ttl">${bk.t}</div><div class="bi-auth">${bk.a}</div></div>
      <button class="btn-ghost" style="padding:4px 8px; font-size:0.75rem;" onclick="toggleWishlist('${bk.id}')">❌ Remove</button>
    </div>`;
  }).join('') : '<p style="color:var(--text-muted);font-size:.875rem">No books in your wishlist yet.</p>';

  // 🟢 NEW: Generate HTML for earned badges
  const earnedBadges = getEarnedBadges();
  const badgesHTML = earnedBadges.length ? earnedBadges.map(b => `
    <div class="achievement-badge" title="${b.desc}">
      <div class="ach-icon">${b.icon}</div>
      <div class="ach-name">${b.name}</div>
    </div>
  `).join('') : '<p style="color:var(--text-muted);font-size:.85rem">Borrow and return books to earn your first badges!</p>';

  setBody(`
    <div class="pg-head"><h1 class="pg-title">My <em>Library Card</em></h1></div>
    <div class="lib-card">
      <div class="lc-top"><div class="avatar">👤</div>
      <div><div class="lc-name">${me.name}</div><div class="lc-id">ID: ${me.id.toUpperCase()} · Student Member</div></div></div>
      <div class="lc-stats">
        <div><div class="lc-stat-v">${bor.length}</div><div class="lc-stat-l">Borrowed</div></div>
        <div><div class="lc-stat-v">${6-bor.length}</div><div class="lc-stat-l">Remaining</div></div>
        <div><div class="lc-stat-v">${hist.length}</div><div class="lc-stat-l">Returned</div></div>
      </div>
    </div>
    
    ${fine > 0 ? `<div class="fine-box" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:14px;">
      <div><div class="fine-lbl">⚠️ Outstanding Fine</div><div class="fine-amt">₹${fine}.00</div><div class="fine-note">₹2 per day per overdue book</div></div>
      <button class="btn-prim" style="background:linear-gradient(135deg, #f43f5e, #e11d48); box-shadow:0 4px 22px rgba(244,63,94,0.3);" onclick="payFines()">💳 Pay Now</button>
    </div>` : ''}
    
    <h2 class="sec-h" style="color: var(--violet-light);">🏆 Achievements</h2>
    <div class="badges-wrap">${badgesHTML}</div>

    <h2 class="sec-h" style="color: #fb7185;">❤️ My Wishlist</h2>
    <div class="borrow-list" style="margin-bottom: 28px;">${wishHTML}</div>

    <h2 class="sec-h">Borrowed Books (${bor.length}/6)</h2>
    <div class="borrow-list">${borHTML}</div>
    
    <h2 class="sec-h">Reading History</h2>
    <div class="timeline">${histHTML}</div>`);
}

/* ============ FINE PAYMENT ============ */
function payFines() {
  toast('Securely processing payment...', 'inf');
  
  // Fake a loading delay for realism
  setTimeout(() => {
    let calcFine = 0;
    records.filter(r => r.uid === me.id).forEach(r => calcFine += fineFor(r));
    
    // Save the paid amount to the user's profile
    me.paidFines = calcFine;
    save();
    
    toast('Payment Successful! Fines cleared. 🎉', 'ok');
    render(tab); // Refresh screen to show ₹0
  }, 1200);
}

/* ============ TEACHER DASH ============ */
function renderTDash() {
  const total=books.reduce((s,b)=>s+b.c,0);
  const issued=records.filter(r=>!r.returned).length;
  const od=records.filter(r=>!r.returned&&new Date(r.due)<new Date()).length;
  const studs=[...new Set(records.filter(r=>!r.returned).map(r=>r.uid))].length;
  
  setBody(`
    <div class="pg-head"><h1 class="pg-title">Admin <em>Dashboard</em> ⚡</h1>
    <p class="pg-sub">Library at a glance</p></div>
    
    <div class="stat-row">
      <div class="stat"><div class="stat-ico">📚</div><div class="stat-val">${books.length}</div><div class="stat-lbl">Titles</div></div>
      <div class="stat"><div class="stat-ico">📤</div><div class="stat-val">${issued}</div><div class="stat-lbl">Issued</div></div>
      <div class="stat"><div class="stat-ico">⚠️</div><div class="stat-val">${od}</div><div class="stat-lbl">Overdue</div></div>
      <div class="stat"><div class="stat-ico">👥</div><div class="stat-val">${studs}</div><div class="stat-lbl">Borrowers</div></div>
    </div>

    <h2 class="sec-h">Library Analytics</h2>
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 24px;">
      <div class="pcard" style="margin-bottom: 0;">
        <h3 style="font-size: 1.1rem; margin-bottom: 14px; color: var(--text-muted);">Collection by Genre</h3>
        <div style="height: 220px;"><canvas id="genreChart"></canvas></div>
      </div>
      <div class="pcard" style="margin-bottom: 0;">
        <h3 style="font-size: 1.1rem; margin-bottom: 14px; color: var(--text-muted);">Current Log Status</h3>
        <div style="height: 220px;"><canvas id="activityChart"></canvas></div>
      </div>
    </div>

    <h2 class="sec-h">Recent Issuances</h2>
    <div class="pcard"><div class="tbl-wrap"><table>
      <thead><tr><th>Book</th><th>Student</th><th>Due Date</th><th>Status</th></tr></thead>
      <tbody>${records.filter(r=>!r.returned).slice(-6).reverse().map(r=>{
        const bk=books.find(b=>b.id===r.bk),u=users.find(u=>u.id===r.uid);
        const late=new Date(r.due)<new Date();
        return `<tr><td>${bk?bk.t:'?'}</td><td>${u?u.name:'?'}</td><td>${new Date(r.due).toLocaleDateString()}</td>
        <td><span class="bk-badge ${late?'badge-taken':'badge-avail'}">${late?'Overdue':'Active'}</span></td></tr>`;
      }).join('')||'<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:24px">No active records</td></tr>'}</tbody>
    </table></div></div>`);

  // 🟢 NEW: Trigger the chart rendering after the HTML is injected into the page
  setTimeout(initCharts, 100); 
}

/* ============ VISUAL ANALYTICS ============ */
// Store chart instances globally so we can destroy them before re-drawing (prevents overlapping glitches)
let genreChartInst = null;
let activityChartInst = null;

function initCharts() {
  // --- 1. Genre Doughnut Chart ---
  const genreCounts = {};
  books.forEach(b => { genreCounts[b.g] = (genreCounts[b.g] || 0) + 1; });
  
  const ctxGenre = document.getElementById('genreChart');
  if (ctxGenre) {
    if (genreChartInst) genreChartInst.destroy();
    genreChartInst = new Chart(ctxGenre, {
      type: 'doughnut',
      data: {
        labels: Object.keys(genreCounts),
        datasets: [{
          data: Object.values(genreCounts),
          backgroundColor: ['#7c3aed', '#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6'],
          borderWidth: 0,
          hoverOffset: 6
        }]
      },
      options: { 
        responsive: true, 
        maintainAspectRatio: false, 
        plugins: { legend: { position: 'right', labels: { color: '#f1eeff', font: { family: 'DM Sans' } } } } 
      }
    });
  }

  // --- 2. Activity Bar Chart ---
  let active = 0, returned = 0, overdue = 0;
  records.forEach(r => {
    if (r.returned) returned++;
    else if (new Date(r.due) < new Date()) overdue++;
    else active++;
  });

  const ctxActivity = document.getElementById('activityChart');
  if (ctxActivity) {
    if (activityChartInst) activityChartInst.destroy();
    activityChartInst = new Chart(ctxActivity, {
      type: 'bar',
      data: {
        labels: ['Active Borrows', 'Returned', 'Overdue'],
        datasets: [{
          data: [active, returned, overdue],
          backgroundColor: ['#0ea5e9', '#10b981', '#f43f5e'],
          borderRadius: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, ticks: { color: '#f1eeff', stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.05)' } },
          x: { ticks: { color: '#f1eeff', font: { family: 'DM Sans' } }, grid: { display: false } }
        },
        plugins: { legend: { display: false } } // Hide legend since labels explain it
      }
    });
  }
}

/* ============ USER MANAGEMENT (TEACHERS ONLY) ============ */
function renderStuds() {
  const studentList = users.filter(u => u.role === 'student');

  let tableHTML = studentList.map(u => {
    // Calculate active borrows and fines for this specific student
    const activeBorrows = records.filter(r => r.uid === u.id && !r.returned);
    let totalFine = 0;
    activeBorrows.forEach(r => totalFine += fineFor(r));

    const isBlocked = u.blocked === true;
    const badge = isBlocked ? '<span class="bk-badge badge-taken">Blocked</span>' : '<span class="bk-badge badge-avail">Active</span>';
    const actionBtn = isBlocked
      ? `<button class="btn-prim" style="padding: 5px 10px;" onclick="toggleBlock('${u.id}')">🔓 Unblock</button>`
      : `<button class="btn-del" style="padding: 5px 10px;" onclick="toggleBlock('${u.id}')">🚫 Block</button>`;

    return `<tr>
      <td><div style="font-weight:600">${u.name}</div><div style="font-size:0.75rem;color:var(--text-muted)">ID: ${u.id.toUpperCase()}</div></td>
      <td>${activeBorrows.length} / 6</td>
      <td style="color:${totalFine > 0 ? '#fb7185' : 'inherit'}">₹${totalFine}</td>
      <td>${badge}</td>
      <td>${actionBtn}</td>
    </tr>`;
  }).join('');

  setBody(`
    <div class="pg-head">
      <h1 class="pg-title">Student <em>Management</em></h1>
      <p class="pg-sub">Manage library members and account statuses.</p>
    </div>
    <div class="pcard">
      <div class="tbl-wrap">
        <table>
          <thead>
            <tr><th>Student</th><th>Active Borrows</th><th>Total Fines</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>${tableHTML}</tbody>
        </table>
      </div>
    </div>
  `);
}

function toggleBlock(uid) {
  const user = users.find(u => u.id === uid);
  if (user) {
    user.blocked = !user.blocked; // Flip the blocked status
    save();
    toast(user.blocked ? `${user.name} has been blocked.` : `${user.name} is now unblocked.`, user.blocked ? 'err' : 'ok');
    render(tab); // Refresh the screen
  }
}

/* ============ INVENTORY ============ */
/* ============ INVENTORY ============ */
function renderInv() {
  setBody(`
    <div class="pg-head"><h1 class="pg-title">Book <em>Inventory</em></h1></div>
    
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 24px;">
      
      <div class="pcard" id="bookFrm" style="margin-bottom: 0;">
        <h2 class="sec-h" id="frmHd" style="font-size:1.3rem;margin-bottom:16px">➕ Add New Book</h2>
        <div class="form-g">
          <div class="fg"><label class="fl">Title</label><input class="finput" id="fT" placeholder="Book title"></div>
          <div class="fg"><label class="fl">Author</label><input class="finput" id="fA" placeholder="Author name"></div>
          <div class="fg"><label class="fl">Genre</label>
            <select class="finput" id="fG">${['Fiction','Non-Fiction','Sci-Fi','Fantasy','History','Classic','Psychology','Self-Help','Dystopia','Biography','Science','Technology'].map(g=>`<option>${g}</option>`).join('')}</select>
          </div>
          <div class="fg"><label class="fl">Copies</label><input class="finput" id="fC" type="number" min="1" max="20" value="1"></div>
          <div class="fg"><label class="fl">Emoji</label><input class="finput" id="fE" placeholder="📖" maxlength="2" value="📖"></div>
        </div>
        <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn-prim" onclick="saveBook()">💾 Save Book</button>
          <button class="btn-ghost" id="frmCancel" style="display:none" onclick="cancelEdit()">✕ Cancel</button>
        </div>
      </div>

      <div class="pcard" style="margin-bottom: 0;">
        <h2 class="sec-h" style="font-size:1.3rem;margin-bottom:8px">📥 Bulk Import (CSV)</h2>
        <p style="color:var(--text-muted); font-size:0.85rem; margin-bottom: 16px;">Instantly upload multiple books. Ensure your CSV has headers: <strong>Title, Author, Genre, Copies</strong>.</p>
        
        <div class="fg" style="margin-bottom: 18px;">
          <input type="file" id="csvImportFile" accept=".csv" class="finput" style="padding: 10px; cursor: pointer;">
        </div>
        
        <div style="display:flex; gap:10px; flex-wrap:wrap">
          <button class="btn-prim" onclick="processCSVImport()" style="background:linear-gradient(135deg, #10b981, #059669); box-shadow:0 4px 22px rgba(16,185,129,0.3);">📤 Upload Data</button>
          <button class="btn-ghost" onclick="downloadCSVTemplate()">📄 Get Template</button>
        </div>
      </div>
    </div>

    <div class="search-bar">
      <div class="srch-wrap"><span class="srch-ico">🔍</span>
      <input class="srch-input" id="invSi" placeholder="Search inventory…" oninput="filterInv()"></div>
      <select class="flt-sel" id="invGi" onchange="filterInv()"><option value="">All Genres</option>${genres().map(g=>`<option>${g}</option>`).join('')}</select>
    </div>
    <div class="book-grid" id="invGrid"></div>`);
  filterInv();
}
function filterInv() {
  const q=(document.getElementById('invSi')?.value||'').toLowerCase();
  const g=document.getElementById('invGi')?.value||'';
  const f=books.filter(b=>(!q||b.t.toLowerCase().includes(q)||b.a.toLowerCase().includes(q))&&(!g||b.g===g));
  const gr=document.getElementById('invGrid');
  gr.innerHTML='';
  f.forEach((b,i)=>{const c=mkCard(b,i);if(c)gr.appendChild(c);});
}

/* ============ BULK CSV IMPORT ============ */

// 1. Give users a sample file so they know how to format their data
function downloadCSVTemplate() {
  const csv = "Title,Author,Genre,Copies\nThe Hobbit,J.R.R. Tolkien,Fantasy,3\nSapiens,Yuval Noah Harari,History,5\nSteve Jobs,Walter Isaacson,Biography,2";
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.setAttribute('href', url);
  a.setAttribute('download', 'Bibliotheca_Import_Template.csv');
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// 2. Process the uploaded file
function processCSVImport() {
  const fileInput = document.getElementById('csvImportFile');
  
  if (!fileInput.files.length) {
    toast('Please select a .csv file first.', 'err');
    return;
  }

  const file = fileInput.files[0];
  const reader = new FileReader();

  // What to do when the file is finished loading
  reader.onload = function(e) {
    const text = e.target.result;
    // Split into rows, remove empty lines
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    if (lines.length < 2) {
      toast('File is empty or missing data rows.', 'err');
      return;
    }

    let addedCount = 0;
    // Color palettes for auto-generating covers
    const palette = [['#1e3a5f','#4a90d9'],['#1a4731','#2ecc71'],['#2d1b4e','#8e44ad'],['#5c3a1e','#c9852c'],['#3d1a1a','#e76f51'],['#1c1c1c','#cc0000']];
    const emojis = ['📖','📚','📙','📘','📗','📕','✨','🌌','🚀'];

    // Loop through rows (skip line 0, which is the header row)
    for (let i = 1; i < lines.length; i++) {
      // Smart split: splits by commas but ignores commas inside quotes
      const cols = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
      const cleanCols = cols.map(val => val.replace(/^"|"$/g, '').trim()); // Strip quotes

      // Ensure we at least have Title and Author
      if (cleanCols.length >= 2 && cleanCols[0] !== '') {
        const t = cleanCols[0];
        const a = cleanCols[1];
        const g = cleanCols[2] || 'Fiction';
        const c = parseInt(cleanCols[3]) || 1;

        // Auto-assign aesthetics
        const [cf, ct] = palette[Math.floor(Math.random() * palette.length)];
        const e = emojis[Math.floor(Math.random() * emojis.length)];

        // Push to our local database
        books.push({ id: 'b' + Date.now() + i, t, a, g, c, e, cf, ct, ratings: [] });
        addedCount++;
      }
    }

    if (addedCount > 0) {
      save(); // Save to localStorage
      toast(`Success! Imported ${addedCount} new books. 🎉`, 'ok');
      render(tab); // Refresh the UI to show the new books
    } else {
      toast('No valid book data found in the CSV.', 'err');
    }
  };

  // Trigger the actual reading of the file
  reader.readAsText(file);
}

function saveBook() {
  const t=document.getElementById('fT').value.trim();
  const a=document.getElementById('fA').value.trim();
  const g=document.getElementById('fG').value;
  const c=parseInt(document.getElementById('fC').value)||1;
  const e=document.getElementById('fE').value||'📖';
  if(!t||!a){toast('Title & author required','err');return;}
  const palette=[['#1e3a5f','#4a90d9'],['#1a4731','#2ecc71'],['#2d1b4e','#8e44ad'],['#5c3a1e','#c9852c'],['#3d1a1a','#e76f51'],['#1c1c1c','#cc0000']];
  const [cf,ct]=palette[Math.floor(Math.random()*palette.length)];
  if(editId) {
    const bk=books.find(b=>b.id===editId);
    if(bk){bk.t=t;bk.a=a;bk.g=g;bk.c=c;bk.e=e;}
    editId=null;toast('Book updated!','ok');
  } else {
    books.push({id:'b'+Date.now(),t,a,g,c,e,cf,ct});
    toast(`"${t}" added to catalog!`,'ok');
  }
  save();
  ['fT','fA','fE'].forEach(id=>{const el=document.getElementById(id);if(el)el.value=id==='fE'?'📖':'';});
  const fc=document.getElementById('fC');if(fc)fc.value='1';
  document.getElementById('frmHd').textContent='➕ Add New Book';
  document.getElementById('frmCancel').style.display='none';
  filterInv();
}
function openEdit(id) {
  editId=id;
  const bk=books.find(b=>b.id===id);
  if(!bk)return;
  if(tab!=='inv'){goTab('inv');setTimeout(()=>openEdit(id),400);return;}
  document.getElementById('fT').value=bk.t;
  document.getElementById('fA').value=bk.a;
  document.getElementById('fG').value=bk.g;
  document.getElementById('fC').value=bk.c;
  document.getElementById('fE').value=bk.e;
  document.getElementById('frmHd').textContent='✏️ Edit Book';
  document.getElementById('frmCancel').style.display='inline-flex';
  document.getElementById('bookFrm').scrollIntoView({behavior:'smooth'});
}
function cancelEdit() {
  editId=null;
  ['fT','fA','fE'].forEach(id=>{const el=document.getElementById(id);if(el)el.value=id==='fE'?'📖':'';});
  const fc=document.getElementById('fC');if(fc)fc.value='1';
  document.getElementById('frmHd').textContent='➕ Add New Book';
  document.getElementById('frmCancel').style.display='none';
}
function confirmDel(id) {
  const bk=books.find(b=>b.id===id);
  showModal('Delete Book',`Delete "${bk?bk.t:'this book'}"? This cannot be undone.`,()=>{
    books=books.filter(b=>b.id!==id);
    records=records.filter(r=>r.bk!==id);
    save();toast('Book deleted','inf');render(tab);
  });
}

/* ============ LOGS ============ */
/* ============ LOGS ============ */
function renderLogs() {
  logsPage=1;
  setBody(`
    <div class="pg-head" style="display:flex; justify-content:space-between; align-items:flex-end; flex-wrap:wrap; gap:14px;">
      <div>
        <h1 class="pg-title">Issuance <em>Logs</em></h1>
        <p class="pg-sub">${records.filter(r=>!r.returned).length} books currently issued</p>
      </div>
      <button class="btn-ghost" onclick="exportLogsCSV()">📥 Export to CSV</button>
    </div>
    
    <div class="pcard">
      <div class="search-bar" style="margin-bottom:14px">
        <div class="srch-wrap"><span class="srch-ico">🔍</span>
        <input class="srch-input" id="ls" placeholder="Search book or student…" oninput="drawTable()"></div>
        <select class="flt-sel" id="lf" onchange="drawTable()"><option value="">All Records</option><option value="a">Active</option><option value="o">Overdue</option><option value="r">Returned</option></select>
      </div>
      <div class="tbl-wrap" id="tblWrap"></div>
      <div class="pagi" id="pagi"></div>
    </div>`);
  drawTable();
}
function getLogs() {
  const q=(document.getElementById('ls')?.value||'').toLowerCase();
  const f=document.getElementById('lf')?.value||'';
  return records.filter(r=>{
    const bk=books.find(b=>b.id===r.bk),u=users.find(u=>u.id===r.uid);
    const mq=!q||(bk&&bk.t.toLowerCase().includes(q))||(u&&u.name.toLowerCase().includes(q));
    const ov=!r.returned&&new Date(r.due)<new Date();
    const ms=!f||(f==='a'&&!r.returned&&!ov)||(f==='o'&&ov)||(f==='r'&&r.returned);
    return mq&&ms;
  }).sort((a,b)=>{
    let va=a[logsSort.col],vb=b[logsSort.col];
    if(typeof va==='string'){va=va.toLowerCase();vb=vb.toLowerCase();}
    return logsSort.asc?(va>vb?1:-1):(va<vb?1:-1);
  });
}
function drawTable() {
  const all=getLogs(),tot=all.length,pages=Math.max(1,Math.ceil(tot/PER));
  logsPage=Math.min(logsPage,pages);
  const pg=all.slice((logsPage-1)*PER,logsPage*PER);
  const arrow=c=>logsSort.col===c?(logsSort.asc?' ↑':' ↓'):'';
  const sf=c=>`onclick="logsSort={col:'${c}',asc:logsSort.col==='${c}'?!logsSort.asc:true};drawTable()"`;
  document.getElementById('tblWrap').innerHTML=`<table>
    <thead><tr>
      <th ${sf('bk')}>Book${arrow('bk')}</th>
      <th ${sf('uid')}>Student${arrow('uid')}</th>
      <th ${sf('issued')}>Issued${arrow('issued')}</th>
      <th ${sf('due')}>Due${arrow('due')}</th>
      <th>Status</th>
    </tr></thead>
    <tbody>${pg.map(r=>{
      const bk=books.find(b=>b.id===r.bk),u=users.find(u=>u.id===r.uid);
      const ov=!r.returned&&new Date(r.due)<new Date();
      const badge=r.returned?'<span class="bk-badge badge-avail">Returned</span>':ov?'<span class="bk-badge badge-taken">Overdue</span>':'<span class="bk-badge badge-mine">Active</span>';
      return `<tr><td>${bk?bk.t:r.bk}</td><td>${u?u.name:r.uid}</td><td>${new Date(r.issued).toLocaleDateString()}</td><td>${new Date(r.due).toLocaleDateString()}</td><td>${badge}</td></tr>`;
    }).join('')||'<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:24px">No records</td></tr>'}</tbody>
  </table>`;
  const p=document.getElementById('pagi');p.innerHTML='';
  if(pages>1){
    const mkBtn=(l,fn,a=false)=>{const b=document.createElement('button');b.className='pg-btn'+(a?' on':'');b.textContent=l;b.onclick=fn;p.appendChild(b);};
    mkBtn('←',()=>{if(logsPage>1){logsPage--;drawTable();}});
    for(let i=1;i<=pages;i++) mkBtn(i,(pg=>()=>{logsPage=pg;drawTable();})(i),i===logsPage);
    mkBtn('→',()=>{if(logsPage<pages){logsPage++;drawTable();}});
  }
}

/* ============ CSV EXPORT ============ */
function exportLogsCSV() {
  // 1. Create the CSV headers
  let csv = "Book Title,Student Name,Issued Date,Due Date,Returned Date,Status\n";

  // 2. Loop through all borrowing records to create rows
  records.forEach(r => {
    const bk = books.find(b => b.id === r.bk);
    const u = users.find(u => u.id === r.uid);
    
    // We wrap text in quotes so commas in book titles don't break the columns
    const title = bk ? `"${bk.t.replace(/"/g, '""')}"` : r.bk; 
    const student = u ? `"${u.name}"` : r.uid;
    const issued = new Date(r.issued).toLocaleDateString();
    const due = new Date(r.due).toLocaleDateString();
    const returned = r.returned ? new Date(r.returned).toLocaleDateString() : 'Not Returned';
    
    const ov = !r.returned && new Date(r.due) < new Date();
    const status = r.returned ? 'Returned' : (ov ? 'Overdue' : 'Active');

    // Add the row to our CSV string
    csv += `${title},${student},${issued},${due},${returned},${status}\n`;
  });

  // 3. Create a hidden download link and click it programmatically
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.setAttribute('href', url);
  a.setAttribute('download', `Library_Logs_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(a);
  a.click();
  
  // 4. Clean up
  a.remove();
  toast('CSV Exported Successfully!', 'ok');
}

/* ============ BUDGET ============ */
function renderBudget() {
  const pct=Math.round(budget.spent/budget.total*100);
  const rem=budget.total-budget.spent;
  const R=70,circ=2*Math.PI*R,offset=circ*(1-pct/100);
  setBody(`
    <div class="pg-head"><h1 class="pg-title">Budget <em>Overview</em></h1></div>
    <div class="pcard">
      <h2 class="sec-h" style="font-size:1.3rem;margin-bottom:22px">Library Budget</h2>
      <div class="budget-g">
        <div style="text-align:center">
          <div class="donut-wrap">
            <svg class="donut-svg" viewBox="0 0 160 160">
              <circle class="d-bg" cx="80" cy="80" r="${R}"/>
              <circle class="d-prog" id="dp" cx="80" cy="80" r="${R}" stroke-dasharray="${circ}" stroke-dashoffset="${circ}"/>
            </svg>
            <div class="donut-ctr"><div class="d-pct">${pct}%</div><div class="d-lbl">spent</div></div>
          </div>
        </div>
        <div>
          <div class="brow"><span class="blbl">Total Budget</span><span class="bval">₹${budget.total.toLocaleString()}</span></div>
          <div class="brow"><span class="blbl">Spent</span><span class="bval" style="color:#fb7185">₹${budget.spent.toLocaleString()}</span></div>
          <div class="brow"><span class="blbl">Remaining</span><span class="bval" style="color:#34d399">₹${rem.toLocaleString()}</span></div>
          <div class="brow"><span class="blbl">Utilization</span><span class="bval">${pct}%</span></div>
        </div>
      </div>
    </div>
    <div class="pcard">
      <h2 class="sec-h" style="font-size:1.3rem;margin-bottom:18px">📦 Procurement</h2>
      <div class="form-g">
        <div class="fg"><label class="fl">Book Title</label><input class="finput" id="oT" placeholder="Title to order"></div>
        <div class="fg"><label class="fl">Quantity</label><input class="finput" id="oQ" type="number" min="1" value="2"></div>
        <div class="fg"><label class="fl">Price per Copy (₹)</label><input class="finput" id="oP" type="number" min="100" value="500"></div>
      </div>
      <button class="btn-prim" style="margin-top:14px" onclick="placeOrder()">🛒 Place Order</button>
    </div>`);
  setTimeout(()=>{ const dp=document.getElementById('dp'); if(dp) dp.style.strokeDashoffset=offset; },150);
}
function placeOrder() {
  const t=document.getElementById('oT').value.trim();
  const q=parseInt(document.getElementById('oQ').value)||1;
  const p=parseInt(document.getElementById('oP').value)||500;
  if(!t){toast('Enter book title','err');return;}
  const cost=q*p,rem=budget.total-budget.spent;
  if(cost>rem){toast(`Insufficient budget! Need ₹${cost.toLocaleString()}, have ₹${rem.toLocaleString()}`,'err');return;}
  budget.spent+=cost;
  const ex=books.find(b=>b.t.toLowerCase()===t.toLowerCase());
  if(ex) ex.c+=q;
  else {
    const pl=[['#1e3a5f','#4a90d9'],['#2d1b4e','#8e44ad'],['#1a4731','#2ecc71']];
    const [cf,ct]=pl[Math.floor(Math.random()*pl.length)];
    books.push({id:'b'+Date.now(),t,a:'New Acquisition',g:'Non-Fiction',c:q,e:'📦',cf,ct});
  }
  save();toast(`Order placed! ₹${cost.toLocaleString()} spent`,'ok');renderBudget();
}

/* ============ BOOK CARD ============ */
function mkCard(bk, idx) {
  const av=avail(bk.id);
  const myRec=records.find(r=>r.bk===bk.id&&r.uid===me.id&&!r.returned);
  const borCount=myActive().length;
  const isT=me.role==='teacher';
  let badge,actions;
  const inWishlist = wishlist.some(w => w.uid === me.id && w.bk === bk.id);
  // Only students get the heart button
  const heartBtn = isT ? '' : `<button class="btn-ghost" style="padding:7px; flex:none;" onclick="toggleWishlist('${bk.id}')">${inWishlist ? '❤️' : '🤍'}</button>`;

  // Determine badges and actions
  if(myRec) {
    badge = '<span class="bk-badge badge-mine">📚 Yours</span>';
    actions = isT 
      ? `<button class="btn-edit" onclick="openEdit('${bk.id}')">✏️ Edit</button><button class="btn-del" onclick="confirmDel('${bk.id}')">🗑️</button>`
      : heartBtn; // 🟢 REMOVED: Student Return Button
  } else if(av > 0) {
    badge = `<span class="bk-badge badge-avail">✅ ${av}</span>`;
    actions = isT 
      ? `<button class="btn-edit" onclick="openEdit('${bk.id}')">✏️ Edit</button><button class="btn-del" onclick="confirmDel('${bk.id}')">🗑️</button>`
      : heartBtn; // 🟢 REMOVED: Student Borrow Button
  } else {
    badge = '<span class="bk-badge badge-taken">❌ Out</span>';
    actions = isT 
      ? `<button class="btn-edit" onclick="openEdit('${bk.id}')">✏️ Edit</button><button class="btn-del" onclick="confirmDel('${bk.id}')">🗑️</button>`
      : heartBtn;
  }
  const d = document.createElement('div');
  d.className = 'bk-card';
  d.style.animationDelay = `${idx * 0.055}s`;
  d.style.cursor = 'pointer'; // 🟢 NEW: Make it look clickable
  
  // 🟢 NEW: Open details IF they didn't click a button inside the card
  d.onclick = (e) => {
    if(!e.target.closest('button')) openDetails(bk.id);
  };
  
  // 🟢 NEW: Calculate average rating
  const avg = bk.ratings && bk.ratings.length ? (bk.ratings.reduce((a,b)=>a+b,0)/bk.ratings.length).toFixed(1) : 'New';
  const ratingBadge = `<span style="font-size:0.7rem; background:rgba(251,191,36,0.12); color:#fbbf24; padding:2px 6px; border-radius:6px; margin-left:6px;">⭐ ${avg}</span>`;

  d.innerHTML=`
    <div class="bk-cover"><div class="bk-art" style="--cf:${bk.cf};--ct:${bk.ct}"><span>${bk.e}</span></div>${badge}</div>
    <div class="bk-info">
      <div class="bk-ttl">${bk.t}</div>
      <div class="bk-auth">${bk.a} ${ratingBadge}</div>
      <span class="bk-genre">${bk.g}</span>
      <div class="bk-actions">${actions}</div>
    </div>`;
  return d;
}

/* ============ REVIEWS ============ */
let reviewBkId = null;
let currentRating = 0;

function openReview(id) {
  const bk = books.find(b => b.id === id);
  if(!bk) return;
  reviewBkId = id;
  currentRating = 0;
  document.getElementById('reviewBkTitle').textContent = bk.t;
  updateStars();
  document.getElementById('submitReviewBtn').style.display = 'none';
  document.getElementById('reviewModalBg').classList.add('open');
}

function setRating(r) {
  currentRating = r;
  updateStars();
  document.getElementById('submitReviewBtn').style.display = 'inline-block';
}

function updateStars() {
  const stars = document.getElementById('starContainer').children;
  for(let i=0; i<5; i++) {
    stars[i].textContent = i < currentRating ? '★' : '☆';
    stars[i].style.color = i < currentRating ? '#fbbf24' : 'var(--text-muted)';
  }
}

function closeReview() {
  document.getElementById('reviewModalBg').classList.remove('open');
  reviewBkId = null;
}

function submitReview() {
  const bk = books.find(b => b.id === reviewBkId);
  if(bk && currentRating > 0) {
    if(!bk.ratings) bk.ratings = [];
    bk.ratings.push(currentRating);
    save();
    toast('Thank you for your review! ⭐', 'ok');
    render(tab); // Refresh the catalog to show the new average
  }
  closeReview();
}

/* ============ BOOK DETAILS MODAL ============ */
function openDetails(id) {
  currentDetailId = id; // Track which book is currently open
  const bk = books.find(b => b.id === id);
  if(!bk) return;
  
  const av = avail(id);
  const avgRating = bk.ratings && bk.ratings.length ? (bk.ratings.reduce((a,b)=>a+b,0)/bk.ratings.length).toFixed(1) : 'No reviews yet';
  
  // Generate fake metadata if the book doesn't have it saved
  const year = bk.year || Math.floor(Math.random() * (2023 - 1920) + 1920);
  const isbn = bk.isbn || '978-' + Math.floor(Math.random() * 9000000000 + 1000000000);
  const synopsis = bk.syn || `A fascinating dive into the world of ${bk.g.toLowerCase()}. This compelling work by ${bk.a} has captivated readers worldwide, offering unique perspectives and an unforgettable journey. Experience why this title remains a highly recommended staple in our library collection.`;

  // Populate the UI
  document.getElementById('detCover').style.background = `linear-gradient(145deg, ${bk.cf}, ${bk.ct})`;
  document.getElementById('detCover').innerHTML = `<span>${bk.e}</span>`;
  document.getElementById('detTitle').textContent = bk.t;
  document.getElementById('detAuthor').textContent = `By ${bk.a}`;
  document.getElementById('detGenre').textContent = bk.g;
  document.getElementById('detSynopsis').textContent = synopsis;
  document.getElementById('detYear').textContent = year;
  document.getElementById('detISBN').textContent = isbn;
  document.getElementById('detCopies').textContent = bk.c;
  
  const statusEl = document.getElementById('detStatus');
  statusEl.textContent = av > 0 ? `${av} Available` : 'Currently Out';
  statusEl.style.color = av > 0 ? '#10b981' : '#f43f5e';
  
  document.getElementById('detRating').textContent = avgRating !== 'No reviews yet' ? `⭐ ${avgRating} / 5` : avgRating;

  // Show the modal
  document.getElementById('detailsModalBg').classList.add('open');
}

function closeDetails() {
  document.getElementById('detailsModalBg').classList.remove('open');
}

/* ============ VIRTUAL LIBRARY MAP ============ */
function openMap() {
  // Grab the book that is currently open in the details modal
  const bk = books.find(b => b.id === currentDetailId);
  if (!bk) return;

  // If this book doesn't have a location yet, randomly assign it one and save it
  if (!bk.aisle || !bk.shelf) {
    bk.aisle = Math.floor(Math.random() * 5) + 1; // Random aisle 1 through 5
    const shelfLetters = ['A', 'B', 'C', 'D'];
    bk.shelf = shelfLetters[Math.floor(Math.random() * shelfLetters.length)]; // Random shelf A-D
    save(); 
  }

  // Update the text to guide the user
  document.getElementById('mapStatusText').innerHTML = `Navigating to <strong>${bk.t}</strong>...<br>Head to <span style="color: #10b981; font-weight: bold; font-size: 1.1rem;">Aisle ${bk.aisle}, Shelf ${bk.shelf}</span>`;

  // Draw the 2D Grid
  const grid = document.getElementById('libraryGrid');
  let gridHTML = '';
  const shelvesList = ['A', 'B', 'C', 'D'];

  // Loop through 5 Aisles
  for (let i = 1; i <= 5; i++) {
    gridHTML += `<div class="map-aisle"><div class="map-aisle-label">Aisle ${i}</div>`;
    
    // Loop through 4 Shelves per aisle
    for (let j = 0; j < shelvesList.length; j++) {
      const currentShelf = shelvesList[j];
      
      // Is this the shelf the user is looking for?
      const isTarget = (bk.aisle === i && bk.shelf === currentShelf);
      const pulseClass = isTarget ? 'target-pulse' : '';
      
      gridHTML += `<div class="map-shelf ${pulseClass}">${currentShelf}</div>`;
    }
    gridHTML += `</div>`; // Close Aisle
  }
  
  // Add the front desk at the bottom
  gridHTML += `<div class="map-desk">Front Desk & Checkout</div>`;
  grid.innerHTML = gridHTML;

  // Open the Map Modal
  document.getElementById('mapModalBg').classList.add('open');
}

function closeMap() {
  document.getElementById('mapModalBg').classList.remove('open');
}

/* ============ QUICK CHECKOUT SCANNER ============ */
function openScanner() {
  document.getElementById('scanInput').value = '';
  document.getElementById('scanStep1').style.display = 'block';
  document.getElementById('scanStep2').style.display = 'none';
  document.getElementById('scannerModalBg').classList.add('open');
  setTimeout(() => document.getElementById('scanInput').focus(), 100);
}

function processScan() {
  const bookId = document.getElementById('scanInput').value.trim().toLowerCase();
  if (!bookId) return;

  // Stop blocked students immediately
  if (me.blocked) {
    toast('Your account is blocked. Please contact Admin.', 'err');
    return;
  }

  const bk = books.find(b => b.id.toLowerCase() === bookId || (b.isbn && b.isbn === bookId));
  
  if (!bk) {
    toast('Barcode not recognized in database.', 'err');
    return;
  }

  // Check if ANYONE currently has this book
  const activeRecord = records.find(r => r.bk === bk.id && !r.returned);

  if (activeRecord) {
    // 🔙 SELF-RETURN LOGIC: Check if the logged-in student is the one holding it
    if (activeRecord.uid === me.id) {
      activeRecord.returned = new Date().toISOString();
      save();
      toast(`✅ RETURNED: "${bk.t}" has been checked back in!`, 'ok');
      closeScanner();
      render(tab);
      checkNotifications();
      // Optionally trigger the review modal after a short delay
      setTimeout(() => openReview(bk.id), 500); 
    } else {
      // Someone else has it!
      toast('❌ This book is currently checked out by another student.', 'err');
    }
  } else {
    // 📤 SELF-CHECKOUT LOGIC: The book is available
    if (avail(bk.id) < 1) {
       toast('No copies of this book are available.', 'err');
       return;
    }
    
    scannedBookTemp = bk;
    document.getElementById('scanStep1').style.display = 'none';
    document.getElementById('scanStep2').style.display = 'block';
    document.getElementById('scanBookTitle').textContent = `📖 ${bk.t}`;
  }
}

// 🟢 NEW: Student-specific checkout confirmation
function confirmStudentBorrow() {
  if (!scannedBookTemp) return;

  // Verify the student hasn't hit their 6 book limit
  const studentActive = records.filter(r => r.uid === me.id && !r.returned).length;
  if (studentActive >= 6) {
    toast('Checkout failed: You have reached your 6 book limit.', 'err');
    return;
  }

  const due = new Date();
  due.setDate(due.getDate() + 14); // 14 day borrow period

  records.push({
    id: 'r' + Date.now(),
    bk: scannedBookTemp.id,
    uid: me.id, // Automatically assigns to the logged-in student
    issued: new Date().toISOString(),
    due: due.toISOString(),
    returned: null
  });

  save();
  toast(`✅ BORROWED: "${scannedBookTemp.t}" is now in your library!`, 'ok');
  closeScanner();
  render(tab);
  checkNotifications();
}

function closeScanner() {
  document.getElementById('scannerModalBg').classList.remove('open');
}

/* ============ WISHLIST ============ */
function toggleWishlist(id) {
  const existingIndex = wishlist.findIndex(w => w.uid === me.id && w.bk === id);
  if (existingIndex > -1) {
    wishlist.splice(existingIndex, 1); // Remove it
    toast('Removed from wishlist', 'inf');
  } else {
    wishlist.push({ uid: me.id, bk: id }); // Add it
    toast('Added to wishlist ❤️', 'ok');
  }
  save();
  render(tab); // Refresh the screen instantly
}

/* ============ UI HELPERS ============ */
function setBody(html) { document.getElementById('appBody').innerHTML=`<div class="panel on">${html}</div>`; }
function toast(msg,type='inf') {
  const w=document.getElementById('toastWrap');
  const t=document.createElement('div');
  t.className=`toast ${type}`;t.textContent=msg;
  w.appendChild(t);
  setTimeout(()=>{t.style.animation='toastOut .4s ease forwards';setTimeout(()=>t.remove(),400);},3400);
}
function showModal(title,body,fn) {
  document.getElementById('mTitle').textContent=title;
  document.getElementById('mBody').textContent=body;
  document.getElementById('mConfirm').onclick=()=>{fn();closeModal();};
  document.getElementById('modalBg').classList.add('open');
}
function closeModal(){document.getElementById('modalBg').classList.remove('open');}
function addRipple(e,btn) {
  const r=btn.getBoundingClientRect();
  const el=document.createElement('span');
  el.className='ripple-el';
  const s=Math.max(r.width,r.height);
  el.style.cssText=`width:${s}px;height:${s}px;left:${e.clientX-r.left-s/2}px;top:${e.clientY-r.top-s/2}px`;
  btn.appendChild(el);setTimeout(()=>el.remove(),700);
}
document.addEventListener('click',e=>{
  const btn=e.target.closest('button');
  if(btn&&!btn.closest('.modal-bg')&&!btn.classList.contains('ham')) addRipple(e,btn);
});
document.getElementById('modalBg').addEventListener('click',e=>{if(e.target===document.getElementById('modalBg'))closeModal();});

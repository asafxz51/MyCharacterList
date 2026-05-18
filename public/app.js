let state = {
    user: null, lists: [], activeListId: null, tempSearchItem: null, editingIndex: -1, pendingDeleteIndex: null, pendingDeleteIndex: null,
    pendingDeleteListId: null, isReordering: false, isRenamingList: false
};

let logsAutoRefreshInterval = null;
let visibleNotifsLimit = 5;
let currentNotifsData = [];
let visibleIndexCommentsLimit = 10;

async function init() {
    // שלב 0: "Ping" מהיר לשרת כדי להעיר אותו מה-Cold Start מיד
    fetch('/api/auth/check');

    // שלב 1: הרצת בדיקת לוגין וטעינת ליסטים במקביל! (חוסך המון זמן)
    Promise.all([
        checkLoginStatus(),
        fetchLists()
    ]).then(() => {
        console.log("Site initialized");
    });

    setupEvents();

    // קריאת טאבים מהכתובת (נשאר אותו דבר)
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab === 'community') forceOpenTab('users');
    else if (tab === 'leaderboard') forceOpenTab('leaderboard');
    else if (tab === 'admin') openAdminPanel();
}

function getOptimizedImg(url, width = 300, height = null) {
    // 1. הגנה: אם אין URL, או שזה בסיס 64, או שזה פלייסהולדר - אל תיגע
    if (!url || url.includes('data:image') || url.includes('placehold.co') || url.includes('placeholder')) return url;

    // 2. מניעת כפילות: אם הלינק כבר מכיל את הפרוקסי של wsrv.nl, תחזיר אותו כמו שהוא
    if (url.includes('wsrv.nl')) return url;

    // 3. רשימת אתרים שחוסמים פרוקסי או שהם כבר אופטימליים
    const bypassDomains = [
        'myanimelist.net',
        'anilist.co',
        'tmdb.org',
        'igdb.com',
        'zerochan.net',
        'pixiv.net',
        'i0.wp.com',
        'discordapp.com',
        'pinimg.com',
        'fbcdn.net',
        'i2.wp.com',
        'i1.wp.com'
    ];

    const shouldBypass = bypassDomains.some(domain => url.includes(domain));

    if (shouldBypass) {
        return url; // מחזיר את הלינק המקורי ללא שינוי
    }

    // 4. אופטימיזציה לכל השאר (Custom Links)
    // הוספנו את הפרמטר &n=-1 שעוזר לעקוף חלק מהחסימות של אתרים חיצוניים
    let optimizedUrl = `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${width}&output=webp&n=-1`;
    if (height) optimizedUrl += `&h=${height}&fit=cover`;

    return optimizedUrl;
}

async function checkLoginStatus() {
    const userChip = document.getElementById('userDisplay');
    const nameLabel = document.getElementById('usernameLabel');
    const authBtn = document.getElementById('authBtnNav');
    const adminBtn = document.getElementById('adminBtn');
    const menuBtn = document.getElementById('mobileMenuBtn');
    const createBtn = document.getElementById('createListBtn');
    const listHeader = document.querySelector('.list-header');

    try {
        const res = await fetch('/api/auth/check');
        if (res.ok) {
            const data = await res.json();
            state.user = data.username;
            state.userId = data._id;
            state.role = data.role;


            const notifArea = document.getElementById('notifArea');
            if (notifArea) {
                notifArea.classList.remove('hidden');
                notifArea.style.display = 'inline-block'; // וידוא תצוגה
            }

            if (menuBtn) menuBtn.classList.remove('hidden');

            if (!sessionStorage.getItem('entryLogged')) {
                fetch('/api/auth/ping', { method: 'POST' });
                sessionStorage.setItem('entryLogged', 'true');
            }

            // if (nameLabel) nameLabel.textContent = data.username;
            // if (userChip) userChip.classList.remove('hidden');
            // document.getElementById('myProfileLink').onclick = () => {
            //     window.location.href = `/profile.html?user=${data.username}`;
            // };


            if (authBtn) {
                authBtn.textContent = "Logout";
                authBtn.style.display = 'inline-block';
            }

            if (data.role === 'admin' && adminBtn) adminBtn.classList.remove('hidden');
            const sidebarProfileBtn = document.getElementById('sidebarProfileBtn');
            if (sidebarProfileBtn) {
                sidebarProfileBtn.classList.remove('hidden');
                sidebarProfileBtn.onclick = () => window.location.href = `/profile.html?user=${data.username}`;
            }

            if (document.querySelector('.sidebar')) document.querySelector('.sidebar').style.display = 'flex';
            if (createBtn) createBtn.style.display = 'block';
            if (listHeader) listHeader.style.display = 'flex';

            if (document.getElementById('notifArea')) {
                document.getElementById('notifArea').classList.remove('hidden');
            }

            if (document.getElementById('shareBtn')) document.getElementById('shareBtn').classList.remove('hidden');

            fetchNotifications();
            setInterval(fetchNotifications, 30000);
            fetchLists();

        } else {
            if (userChip) userChip.classList.add('hidden');
            if (adminBtn) adminBtn.classList.add('hidden');
            showLoggedOutState();
        }
    } catch (e) {
        console.error("Login check failed:", e);
        showLoggedOutState();
    }
}

async function showLoggedOutState() {
    const authBtn = document.getElementById('authBtnNav');

    // 1. הסתרת כל מה ששייך למשתמש מחובר (סיידבאר, כותרות ופקדים)
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.style.display = 'none';

    const listHeader = document.querySelector('.list-header');
    if (listHeader) listHeader.style.display = 'none';

    const commentsSec = document.getElementById('indexCommentsSection');
    if (commentsSec) commentsSec.classList.add('hidden');

    const authModal = document.getElementById('authModal');

    // 2. איפוס כפתור הלוגין בנאב
    if (authBtn) {
        authBtn.textContent = "Login";
        authBtn.style.display = 'inline-block';
    }

    // 3. הזרקת דף הנחיתה לתוך הגריד הראשי
    const grid = document.getElementById('characterGrid');
    grid.innerHTML = `
        <div style="grid-column: 1/-1; padding-bottom: 50px;">
            
            <!-- 1. Hero Section -->
            <div style="text-align: center; padding: 60px 20px;">
                <h1 class="hero-title">MyCharacterList</h1>
                <p class="hero-subtitle">Your ultimate hub to rank, share, and discover characters!</p>
                <p style="font-size: 1.1rem; color: var(--text-muted); margin-bottom: 40px;">Create a new account or log in to start</p>
                <button onclick="document.getElementById('authModal').classList.remove('hidden')" class="btn-primary" style="padding: 15px 45px; font-size: 1.2rem; border-radius: 30px; width: auto; box-shadow: 0 4px 15px rgba(187, 134, 252, 0.3);">
                    <i class="fas fa-sign-in-alt" style="margin-right: 8px;"></i> Login / Register
                </button>
            </div>

            <!-- 2. Community Showcase -->
            <div style="text-align: center; margin-top: 20px;">
                <h3 style="font-size: 1.8rem; margin-bottom: 25px; color: var(--text-main);"><i class="fas fa-compass" style="color: var(--accent);"></i> Explore Community Lists</h3>
                <div id="randomListsContainer" class="random-lists-grid">
                    <p style="color:var(--text-muted);"><i class="fas fa-spinner fa-spin"></i> Loading community lists...</p>
                </div>
                 <div style="margin-top: 30px;">
                    <button onclick="openCommModalFromLanding()" style="background: none; border: 1px solid var(--accent); color: var(--accent); padding: 10px 25px; border-radius: 20px; cursor: pointer; font-weight: bold; transition: 0.2s;" onmouseover="this.style.background='rgba(187, 134, 252, 0.1)'" onmouseout="this.style.background='transparent'">
                        See more of our commuinity...
                    </button>
                </div>
            </div>

            <!-- 3. About Section -->
            <div style="margin-top: 80px; background: var(--card-bg); padding: 50px 20px; border-radius: 20px; border: 1px solid var(--border); text-align: center;">
                <h2 style="font-size: 2.2rem; color: var(--accent); margin-bottom: 25px;">What is MyCharacterList?</h2>
                <p style="font-size: 1.15rem; line-height: 1.8; color: var(--text-muted); max-width: 800px; margin: 0 auto 40px auto; word-break: break-word;">
                    MyCharacterList is the ultimate platform to build your own tier lists and rankings for your favorite characters across Anime, Video Games, Movies, Visual Novels, and Books. Join our growing community, share your opinions, discover new media, and see who makes it to the top of the Global Leaderboard!
                </p>
                
                <img src="homepage_preview.png" alt="homepage_preview" style="width: 100%; max-width: 900px; border-radius: 12px; box-shadow: 0 8px 25px rgba(0,0,0,0.6); border: 1px solid var(--border);">
            </div>

        </div>
    `;

    // 4. משיכת רשימות אקראיות
    try {
        const res = await fetch('/api/public/random-lists');
        const container = document.getElementById('randomListsContainer');
        if (res.ok) {
            const lists = await res.json();
            if (lists.length === 0) {
                container.innerHTML = '<p style="color:var(--text-muted);">No public lists yet.</p>';
            } else {
                container.innerHTML = lists.map(l => `
                    <div class="landing-list-card" onclick="window.location.href='/share.html?id=${l._id}'">
                        <img src="${l.thumbnail}" onerror="this.src='https://placehold.co/200x300/252525/bb86fc?text=No+Image'">
                        <div class="landing-list-info">
                            <h4>${l.name}</h4>
                            <span><i class="fas fa-layer-group"></i> ${l.itemCount} Items</span>
                        </div>
                    </div>
                `).join('');
            }
        }
    } catch (e) {
        console.log("Failed to load random lists");
    }
}

// פונקציה לפתיחת/סגירת התפריט
function toggleNotifDropdown(e) {
    if (e) e.stopPropagation();
    const drop = document.getElementById('notifDropdown');
    if (!drop) return;

    const isHidden = drop.classList.contains('hidden');

    if (isHidden) {
        // --- התיקון כאן: מאתחלים ל-5 בכל פעם שפותחים את התפריט ---
        visibleNotifsLimit = 5;
        renderNotifDropdownUI(); // מעדכנים את התצוגה שתציג רק 5

        drop.classList.remove('hidden');

        // סימון כנקרא
        fetch('/api/notifications/read', { method: 'POST' });
        const badge = document.getElementById('notifBadge');
        if (badge) badge.classList.add('hidden');
    } else {
        drop.classList.add('hidden');
    }
}

const notifBtn = document.getElementById('notifBtn');
if (notifBtn) {
    notifBtn.addEventListener('click', toggleNotifDropdown);
}

window.addEventListener('click', (e) => {
    const drop = document.getElementById('notifDropdown');
    const notifBtn = document.getElementById('notifBtn');

    // אם לחצנו מחוץ לתפריט ומחוץ לכפתור הפעמון
    if (drop && !drop.contains(e.target) && !e.target.closest('#notifBtn')) {
        if (!drop.classList.contains('hidden')) {
            drop.classList.add('hidden');
            // מאתחלים ל-5 כשהתפריט נסגר
            visibleNotifsLimit = 5;
        }
    }
});

async function fetchNotifications() {
    const user = (typeof state !== 'undefined' && state.user) || loggedInUser;
    if (!user) return;

    try {
        const res = await fetch('/api/notifications');
        if (!res.ok) return;
        currentNotifsData = await res.json();
        renderNotifDropdownUI();
    } catch (e) { console.log("Notif fetch failed"); }
}

function renderNotifDropdownUI() {
    const dropdown = document.getElementById('notifDropdown');
    const badge = document.getElementById('notifBadge');
    if (!dropdown) return;

    // עדכון המונה האדום
    const unreadCount = currentNotifsData.filter(n => !n.read).length;
    if (badge) {
        badge.textContent = unreadCount;
        unreadCount > 0 ? badge.classList.remove('hidden') : badge.classList.add('hidden');
    }

    dropdown.innerHTML = '';

    if (currentNotifsData.length === 0) {
        dropdown.innerHTML = '<div style="padding:15px; text-align:center; color:#888;">No notifications</div>';
        return;
    }

    // מפת הודעות מלאה
    const msgMap = {
        'like': `liked your list`,
        'comment': `commented on your list`,
        'follow': `started following you`,
        'reply': `replied to your comment`,
        'comment_like': `liked your comment`
    };

    const notifsToShow = currentNotifsData.slice(0, visibleNotifsLimit);

    notifsToShow.forEach(n => {
        const div = document.createElement('div');
        div.style = `padding: 12px; border-bottom: 1px solid var(--border); font-size: 0.85rem; cursor: pointer; background: ${n.read ? 'transparent' : 'rgba(187, 134, 252, 0.08)'}`;

        const actionText = msgMap[n.type] || 'interacted with you';
        const listNameText = n.listName ? `: <b>${n.listName}</b>` : '';

        div.innerHTML = `
            <div><b>${n.fromUser}</b> ${actionText}${listNameText}</div>
            <div style="font-size:0.7rem; color:#666; margin-top:4px;">${new Date(n.timestamp).toLocaleString('he-IL')}</div>
        `;

        div.onclick = () => {
            if (n.listId) window.location.href = `/share.html?id=${n.listId}`;
        };
        dropdown.appendChild(div);
    });

    if (currentNotifsData.length > visibleNotifsLimit) {
        const loadMoreDiv = document.createElement('div');
        loadMoreDiv.style = "padding: 10px; text-align: center; color: var(--accent); cursor: pointer; font-size: 0.85rem; font-weight: bold; border-top: 1px solid var(--border);";
        loadMoreDiv.innerHTML = 'Show more...';
        loadMoreDiv.onclick = (e) => {
            e.stopPropagation();
            visibleNotifsLimit += 5;
            renderNotifDropdownUI();
        };
        dropdown.appendChild(loadMoreDiv);
    }
}


async function fetchLists() {
    const res = await fetch('/api/lists');
    state.lists = await res.json();

    const params = new URLSearchParams(window.location.search);
    const requestedId = params.get('id');

    if (requestedId && state.lists.some(l => l._id === requestedId)) {
        state.activeListId = requestedId;
    } else if (state.lists.length > 0 && !state.activeListId) {
        state.activeListId = state.lists[0]._id;
    }

    renderSidebar();

    if (state.activeListId) {
        window.selectList(state.activeListId);
    } else {
        // אם אין רשימה (למשל משתמש חדש), ננקה את המסך מה-Loading
        document.getElementById('characterGrid').innerHTML = '';
    }
}

async function createList(name) {
    const rType = document.getElementById('rankingTypeSelect').value;
    const isPrivate = document.getElementById('isPrivateInput').checked;
    const isFreeOrder = document.getElementById('isFreeOrderInput').checked;
    const allowComments = document.getElementById('allowCommentsInput').checked;
    const listDesc = document.getElementById('listDescriptionInput').value;

    const payload = {
        name: name,
        listDescription: listDesc,
        rankingType: rType,
        isPrivate: isPrivate,
        isFreeOrder: isFreeOrder,
        allowComments: allowComments,
        items: new Array() // הנה הטריק שעוקף את הבאג
    };

    const res = await fetch('/api/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    const newList = await res.json();
    state.lists.push(newList);
    state.activeListId = newList._id;
    renderSidebar();
    renderCurrentList();
    closeModal('listModal');
}

async function deleteList(id) {
    await fetch(`/api/lists/${id}`, { method: 'DELETE' });
    state.lists = state.lists.filter(l => l._id !== id);
    if (state.activeListId === id) state.activeListId = state.lists[0]?._id || null;
    renderSidebar();
    renderCurrentList();
}

document.getElementById('confirmDeleteListBtn').addEventListener('click', async () => {
    if (state.pendingDeleteListId) {
        await deleteList(state.pendingDeleteListId);
        state.pendingDeleteListId = null;
        closeModal('deleteListModal');
    }
});


async function updateCurrentList(forceSort = false, logAction = null, logDetails = null) {
    const list = state.lists.find(l => l._id === state.activeListId);
    if (!list) return;

    if (forceSort && !list.isFreeOrder) {
        list.items.sort((a, b) => b.rating - a.rating);
    }

    try {
        const response = await fetch('/api/lists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...list,
                logAction,
                logDetails
            })
        });

        renderCurrentList();
    } catch (e) { console.error(e); }
}

function renderSidebar() {
    const nav = document.getElementById('listNav');
    nav.innerHTML = '';

    state.lists.forEach((list, index) => {
        const li = document.createElement('li');
        li.className = list._id === state.activeListId ? 'active' : '';

        li.onclick = () => {
            selectList(list._id);
        };

        li.draggable = true;
        li.dataset.index = index;

        li.addEventListener('dragstart', handleSidebarDragStart);
        li.addEventListener('dragover', handleSidebarDragOver);
        li.addEventListener('drop', handleSidebarDrop);
        li.addEventListener('dragend', handleSidebarDragEnd);

        const lockIcon = list.isPrivate ? '<i class="fas fa-lock" style="font-size:0.8rem; margin-right:8px; color:#aaa;"></i>' : '';
        li.innerHTML = `
            <span>${lockIcon}${list.name}</span>
        `;

        const delBtn = document.createElement('button');
        delBtn.className = 'delete-list-btn';
        delBtn.innerHTML = '<i class="fas fa-trash"></i>';

        delBtn.onclick = (e) => {
            e.stopPropagation();
            state.pendingDeleteListId = list._id;
            document.getElementById('deleteListModal').classList.remove('hidden');
        };

        li.appendChild(delBtn);
        nav.appendChild(li);
    });
}

window.selectList = async function (id) {
    state.activeListId = id;
    renderSidebar();

    // מציג Loading קטן בזמן שהדמויות יורדות
    document.getElementById('characterGrid').innerHTML = '<p style="text-align:center; padding:50px; color:#888;">Loading characters...</p>';

    try {
        const res = await fetch(`/api/lists/${id}`);
        const fullList = await res.json();

        // מעדכנים את הרשימה בזיכרון המקומי עם הדמויות החדשות שהגיעו
        const index = state.lists.findIndex(l => l._id === id);
        if (index !== -1) {
            state.lists[index] = fullList;
        }

        renderCurrentList();
    } catch (e) { console.error("Error fetching list content"); }

    if (window.innerWidth <= 768) closeMobileMenu();
};

function toggleReorderMode() {
    state.isReordering = !state.isReordering;

    const reorderBtn = document.getElementById('reorderBtn');
    const saveBtn = document.getElementById('saveOrderBtn');
    const grid = document.getElementById('characterGrid');

    if (state.isReordering) {
        reorderBtn.classList.add('hidden');
        saveBtn.classList.remove('hidden');
        grid.classList.add('reorder-mode');
        // Disable filtering/search while reordering to avoid bugs
        document.getElementById('filterSelect').disabled = true;
        document.getElementById('searchInput').disabled = true;
    } else {
        reorderBtn.classList.remove('hidden');
        saveBtn.classList.add('hidden');
        grid.classList.remove('reorder-mode');
        document.getElementById('filterSelect').disabled = false;
        document.getElementById('searchInput').disabled = false;
    }

    renderCurrentList();
}

async function saveOrder() {
    toggleReorderMode();

    const list = state.lists.find(l => l._id === state.activeListId);
    await updateCurrentList(false);
}

let dragSrcEl = null;

function handleDragStart(e) {
    this.style.opacity = '0.4';
    dragSrcEl = this;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.innerHTML);
    e.dataTransfer.setData('index', this.dataset.index);
}

function handleDragOver(e) {
    if (e.preventDefault) e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleDragEnter(e) {
    this.classList.add('over');
}

function handleDragLeave(e) {
    this.classList.remove('over');
}

function handleDrop(e) {
    if (e.stopPropagation) e.stopPropagation();

    if (dragSrcEl !== this) {
        const list = state.lists.find(l => l._id === state.activeListId);

        const fromIndex = parseInt(dragSrcEl.dataset.index);
        const toIndex = parseInt(this.dataset.index);

        const itemToMove = list.items[fromIndex];
        list.items.splice(fromIndex, 1);
        list.items.splice(toIndex, 0, itemToMove);


        renderCurrentList();
    }
    return false;
}

function handleDragEnd(e) {
    this.style.opacity = '1';
    document.querySelectorAll('.char-card').forEach(item => {
        item.classList.remove('over');
    });
}

function renderCurrentList() {
    const grid = document.getElementById('characterGrid');
    const header = document.querySelector('.list-header');
    const likesArea = document.getElementById('indexLikesCount');
    const likesNum = document.getElementById('indexLikesNumber');
    const commentsSec = document.getElementById('indexCommentsSection');

    grid.innerHTML = '';

    // --- מצב שבו המשתמש מחובר אבל אין לו אף רשימה ---
    if (state.user && state.lists.length === 0) {
        if (header) header.style.display = 'none';
        if (commentsSec) commentsSec.classList.add('hidden'); // מסתיר תגובות
        if (likesArea) likesArea.classList.add('hidden');   // מסתיר לייקים

        grid.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 80px 20px; max-width: 500px; margin: 60px auto; background: var(--card-bg); border-radius: 12px; border: 1px solid var(--border); box-shadow: 0 4px 20px rgba(0,0,0,0.4);">
                <i class="fas fa-layer-group" style="font-size: 4rem; color: var(--accent); margin-bottom: 25px; display: block; opacity: 0.8;"></i>
                <h2 style="margin-bottom: 15px; color: var(--text-main); font-size: 2rem;">Start Your Collection</h2>
                <p style="color: var(--text-muted); margin-bottom: 35px; line-height: 1.8; font-size: 1.15rem;">
                    It looks like you haven't created any lists yet.<br>
                    Create your first list now to start ranking your favorite characters!
                </p>
                <button onclick="document.getElementById('createListBtn').click()" class="btn-primary" style="width: auto; padding: 14px 40px; border-radius: 30px; font-weight: bold; font-size: 1.1rem; box-shadow: 0 4px 10px rgba(187, 134, 252, 0.3);">
                    <i class="fas fa-plus" style="margin-right: 10px;"></i> Create My First List
                </button>
            </div>
        `;
        return;
    }

    // --- מצב רגיל (יש רשימות) ---
    const list = state.lists.find(l => l._id === state.activeListId);
    // הגנה: אם הרשימה קיימת אבל הדמויות שלה עוד לא נטענו מהשרת
    if (!list || !list.items) {
        grid.innerHTML = '<p style="text-align:center; padding:50px; color:#888;"><i class="fas fa-spinner fa-spin"></i> Fetching characters...</p>';
        return;
    }
    if (!list) {
        if (header) header.style.display = 'none';
        if (commentsSec) commentsSec.classList.add('hidden');
        if (likesArea) likesArea.classList.add('hidden');
        return;
    }

    // הצגת הפקדים
    if (header) header.style.display = 'flex';
    document.getElementById('currentListTitle').textContent = list.name;
    const descEl = document.getElementById('currentListDescription');
    if (descEl) {
        if (list.listDescription && list.listDescription.trim() !== '') {
            descEl.textContent = list.listDescription;
            descEl.style.display = 'block';
        } else {
            descEl.style.display = 'none';
        }
    }
    const editTitleBtn = document.getElementById('editListTitleBtn');
    if (editTitleBtn) editTitleBtn.classList.remove('hidden');

    // --- 1. עדכון מונה הלייקים (Chip) ליד הכותרת ---
    if (likesArea && likesNum) {
        const count = list.likes ? list.likes.length : 0;
        likesNum.textContent = count;
        // נציג את הצ'יפ רק אם יש לייקים
        if (count > 0) likesArea.classList.remove('hidden');
        else likesArea.classList.add('hidden');
    }

    // --- 2. הצגת/הסתרת אזור התגובות באינדקס ---
    if (commentsSec) {
        if (list.allowComments !== false) {
            commentsSec.classList.remove('hidden');
            // מאפסים את מגבלת התגובות כשעוברים ליסט ומרנדרים
            visibleIndexCommentsLimit = 10;
            renderIndexComments(list.comments, list.userId);
        } else {
            commentsSec.classList.add('hidden');
        }
    }

    // --- לוגיקת פילטור משולבת ---
    const category = document.getElementById('filterSelect').value;
    const search = document.getElementById('listFilterInput').value.toLowerCase();

    let displayItems = list.items.map((item, index) => ({ ...item, originalIndex: index }));

    displayItems = displayItems.filter(item => {
        const matchesCategory = (category === 'all' || item.sourceType === category);
        const matchesSearch = (
            item.characterName.toLowerCase().includes(search) ||
            item.sourceTitle.toLowerCase().includes(search)
        );
        return matchesCategory && matchesSearch;
    });

    if (!list.isFreeOrder) {
        displayItems.sort((a, b) => b.rating - a.rating);
    }

    if (displayItems.length === 0) {
        grid.innerHTML = '<p style="grid-column: 1/-1; text-align:center; color:#888; padding: 40px;">No characters found.</p>';
        return;
    }

    displayItems.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'char-card';
        div.dataset.index = item.originalIndex;

        let rankClass = (index === 0) ? 'rank-1' : (index === 1) ? 'rank-2' : (index === 2) ? 'rank-3' : 'rank-other';
        const displayRating = getRatingDisplay(item.rating, list.rankingType || 'numbers');
        const ratingHtml = item.rating === 0 ? '' : `<div class="char-rating">${displayRating}</div>`;

        let validImg = item.image && !item.image.includes('via.placeholder.com')
            ? item.image
            : 'https://placehold.co/200x300/252525/bb86fc?text=No+Image';

        // --- הנה השינוי המרכזי: יוצרים את המקור רק אם הוא קיים ---
        const sourceHtml = (item.sourceTitle && item.sourceTitle.trim() !== "")
            ? `<div class="source-row" style="margin-bottom: 5px;">
                 <span class="source-title" title="${item.sourceTitle}">${item.sourceTitle}</span>
               </div>`
            : "";

        const notesIconHtml = (item.notes && item.notes.trim() !== '') ? `
            <div class="note-tooltip-container">
                <i class="fas fa-sticky-note note-icon"></i>
                <div class="note-tooltip">${item.notes}</div>
            </div>
        ` : '<div></div>';

        div.innerHTML = `
            <div class="rank-badge ${rankClass}">#${index + 1}</div>
            ${ratingHtml}
           <img src="${getOptimizedImg(validImg, 400)}" 
     data-original="${validImg}"
     loading="lazy" 
     class="char-img" 
     onerror="if(this.src.includes('wsrv.nl')){ this.src=this.dataset.original; } else { this.src='https://placehold.co/200x300/252525/bb86fc?text=No+Image'; }"
>
            <div class="char-info" style="display: flex; flex-direction: column;">
                <div class="char-name" style="margin-bottom: 5px;">${item.characterName}</div>
                
                <!-- כאן נכנס המקור (אם קיים) -->
                ${sourceHtml}

                <div class="card-bottom-bar" style="margin-top: auto; display: flex; justify-content: space-between; align-items: center; width: 100%;">
                    <!-- אייקון הערות נשאר הכי שמאלי -->
                    ${notesIconHtml}
                    
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <!-- כפתורי עריכה/מחיקה עברו לאמצע -->
                        <div class="card-actions" style="margin: 0; display: flex; gap: 4px;">
                            <button class="icon-btn edit-btn" onclick="editItem(${item.originalIndex})"><i class="fas fa-edit"></i></button>
                            <button class="icon-btn delete-btn" onclick="removeItem(${item.originalIndex})"><i class="fas fa-trash"></i></button>
                        </div>

                        <!-- ה-Type המעוצב הוא עכשיו הכי ימני -->
                        <span class="red-type">${item.sourceType === 'TV Show' ? 'TV' : item.sourceType}</span>
                    </div>
                </div>
            </div>
        `;

        if (state.isReordering) {
            div.setAttribute('draggable', 'true');
            div.addEventListener('dragstart', handleDragStart);
            div.addEventListener('dragover', handleDragOver);
            div.addEventListener('drop', handleDrop);
            div.addEventListener('dragend', handleDragEnd);
        }
        grid.appendChild(div);
    });
}

// אל תשכח להוסיף את המאזינים בסוף הקוד ב-setupEvents או בסוף הקובץ:
const listFilterInput = document.getElementById('listFilterInput');
if (listFilterInput) listFilterInput.addEventListener('input', renderCurrentList);

const filterSelect = document.getElementById('filterSelect');
if (filterSelect) filterSelect.addEventListener('change', renderCurrentList);

window.editItem = function (index) {
    const modal = document.getElementById('charModal');
    if (modal) modal.style.display = 'flex';
    state.tempSearchItem = null;
    const list = state.lists.find(l => l._id === state.activeListId);
    const item = list.items[index];
    const isLetters = list.rankingType === 'letters';

    state.editingIndex = index;

    document.getElementById('modalImg').src = item.image;
    document.getElementById('modalImg').classList.remove('hidden');
    document.getElementById('charNameInput').value = item.characterName;
    document.getElementById('customImgInput').value = item.image;
    document.getElementById('ratingInput').value = item.rating;


    document.getElementById('sourceTitleInput').value = item.sourceTitle;
    document.getElementById('sourceTypeInput').value = normalizeType(item.sourceType);

    document.getElementById('castSelector').innerHTML = '';
    document.getElementById('saveCharBtn').textContent = "Update Character";
    document.getElementById('charModal').classList.remove('hidden');
    document.getElementById('charNotesInput').value = item.notes || '';

    if (isLetters) {
        document.getElementById('ratingLetterInput').value = item.rating;
        document.getElementById('ratingInput').classList.add('hidden');
        document.getElementById('ratingLetterInput').classList.remove('hidden');
    } else {
        document.getElementById('ratingInput').value = item.rating;
        document.getElementById('ratingInput').classList.remove('hidden');
        document.getElementById('ratingLetterInput').classList.add('hidden');
    }
}

window.removeItem = function (index) {
    state.pendingDeleteIndex = index;
    document.getElementById('deleteModal').classList.remove('hidden');
}

document.getElementById('confirmDeleteBtn').addEventListener('click', () => {
    if (state.pendingDeleteIndex === null) return;

    const list = state.lists.find(l => l._id === state.activeListId);
    if (!list) return;

    const itemToDelete = list.items[state.pendingDeleteIndex];
    const charName = itemToDelete.characterName;
    const listName = list.name;

    list.items.splice(state.pendingDeleteIndex, 1);

    updateCurrentList(
        false,
        "Delete Character",
        `Removed "${charName}" from list: "${listName}"`
    );

    state.pendingDeleteIndex = null;
    closeModal('deleteModal');
});


let debounce;
document.getElementById('searchInput').addEventListener('input', (e) => {
    clearTimeout(debounce);
    const q = e.target.value;
    if (q.length < 3) return document.getElementById('searchResults').classList.add('hidden');
    debounce = setTimeout(() => doSearch(q), 800);
});

async function doSearch(query) {
    const resultsDiv = document.getElementById('searchResults');
    resultsDiv.classList.remove('hidden');
    resultsDiv.innerHTML = '<div class="search-item">Searching...</div>';
    const safeFetch = (url) => fetch(url).then(r => r.ok ? r.json() : []).catch(() => []);

    const [anime, igdb, tmdb, persons, fandom, rawg, books] = await Promise.all([
        safeFetch(`/api/search/jikan?query=${query}`),
        safeFetch(`/api/search/igdb?query=${query}`),
        safeFetch(`/api/search/tmdb?query=${query}`),
        safeFetch(`/api/search/tmdb/person?query=${query}`),
        safeFetch(`/api/search/fandom?query=${query}`),
        safeFetch(`/api/search/rawg?query=${query}`),
        safeFetch(`/api/search/books?query=${query}`)
    ]);


    let combined = [...anime, ...igdb, ...tmdb, ...persons, ...fandom, ...rawg, ...books];


    combined.sort((a, b) => {
        const q = query.toLowerCase();
        const titleA = a.title.toLowerCase();
        const titleB = b.title.toLowerCase();

        if (titleA === q && titleB !== q) return -1;
        if (titleB === q && titleA !== q) return 1;

        const startA = titleA.startsWith(q);
        const startB = titleB.startsWith(q);
        if (startA && !startB) return -1;
        if (startB && !startA) return 1;

        const hasA = titleA.includes(q);
        const hasB = titleB.includes(q);
        if (hasA && !hasB) return -1;
        if (hasB && !hasA) return 1;

        return 0;
    });

    resultsDiv.innerHTML = '';

    if (combined.length === 0) {
        resultsDiv.innerHTML = '<div class="search-item">No results.</div>';
        return;
    }

    const typeMap = {
        'character': 'Animanga',
        'game_character': 'Game',
        'wiki_character': 'TV/Movie',
        'actor': 'Actor',
        'movie': 'Movie',
        'tv': 'TV Show',
        'book': 'Book',
        'manga': 'Manga'
    };

    combined.forEach(item => {
        const div = document.createElement('div');
        div.className = 'search-item';

        const displayType = typeMap[item.type] || item.type;

        let subText = item.sourceTitle ? item.sourceTitle : displayType;

        if (item.type === 'movie' || item.type === 'tv') {
            subText = `${displayType} • ${item.year}`;
        }

        div.innerHTML = `
            <img src="${item.image || 'https://via.placeholder.com/50'}" style="width:30px">
            <div>
                <strong>${item.title}</strong>
                <br>
                <small class="red-type">${subText}</small>
            </div>
        `;
        div.onclick = () => openCharModal(item);
        resultsDiv.appendChild(div);
    });
}

async function openCharModal(item) {
    const modal = document.getElementById('charModal');
    if (modal) modal.style.display = 'flex';

    state.tempSearchItem = item;
    state.editingIndex = -1;

    const resultsDiv = document.getElementById('searchResults');
    if (resultsDiv) resultsDiv.classList.add('hidden');

    const searchInp = document.getElementById('searchInput');
    if (searchInp) searchInp.value = '';

    document.getElementById('modalImg').src = item.image || 'https://placehold.co/200x300/252525/bb86fc?text=No+Image';
    document.getElementById('modalImg').classList.remove('hidden');
    document.getElementById('customImgInput').value = '';
    document.getElementById('saveCharBtn').textContent = "Add to List";
    document.getElementById('charNotesInput').value = item.notes || '';

    // מילוי שם הדמות
    document.getElementById('charNameInput').value = item.title || item.characterName || '';

    const list = state.lists.find(l => l._id === state.activeListId);
    const isLetters = list && list.rankingType === 'letters';
    const numInput = document.getElementById('ratingInput');
    const letInput = document.getElementById('ratingLetterInput');
    const titleInput = document.getElementById('sourceTitleInput');
    const typeInput = document.getElementById('sourceTypeInput');
    const castDiv = document.getElementById('castSelector');
    if (castDiv) castDiv.innerHTML = '';

    if (isLetters) {
        numInput.classList.add('hidden');
        letInput.classList.remove('hidden');
        letInput.value = item.rating || "0";
    } else {
        numInput.classList.remove('hidden');
        letInput.classList.add('hidden');
        numInput.value = item.rating || 0;
    }

    // --- התיקון הקריטי: אם המידע כבר קיים (מהלידרבורד או עריכה), לא עושים Fetch ---
    if (item.sourceTitle) {
        titleInput.value = item.sourceTitle;
        typeInput.value = normalizeType(item.type || item.sourceType);
    }
    // רק אם זה חיפוש גולמי (בלי סורס), הולכים להביא פרטים מה-API
    else if (item.type === 'character') {
        titleInput.value = "Fetching info...";
        try {
            const res = await fetch(`/api/jikan/details/${item.id}`);
            const data = await res.json();
            titleInput.value = data.sourceTitle || "";
            typeInput.value = data.sourceType || "Anime";
        } catch (e) { titleInput.value = ""; }
    }
    else if (item.type === 'game_character') {
        titleInput.value = "Fetching game...";
        try {
            const res = await fetch(`/api/igdb/details/${item.id}`);
            const data = await res.json();
            titleInput.value = data.sourceTitle || "";
            typeInput.value = "Game";
        } catch (e) { titleInput.value = ""; }
    }
    else {
        titleInput.value = "";
        typeInput.value = normalizeType(item.type);
    }

    document.getElementById('charModal').classList.remove('hidden');
}

function openCustomCharModal() {
    const modal = document.getElementById('charModal');
    if (modal) modal.style.display = 'flex';
    if (!state.activeListId) return alert("Please select a list first");

    state.tempSearchItem = null;
    state.editingIndex = -1;

    document.getElementById('searchResults').classList.add('hidden');
    document.getElementById('searchInput').value = '';

    document.getElementById('modalImg').classList.add('hidden');
    document.getElementById('charNameInput').value = '';
    document.getElementById('sourceTitleInput').value = '';
    document.getElementById('customImgInput').value = '';
    document.getElementById('castSelector').innerHTML = '';

    document.getElementById('sourceTypeInput').value = 'Other';
    document.getElementById('saveCharBtn').textContent = "Add Custom Character";
    document.getElementById('charNotesInput').value = '';

    const list = state.lists.find(l => l._id === state.activeListId);
    const isLetters = list && list.rankingType === 'letters';

    if (isLetters) {
        document.getElementById('ratingInput').classList.add('hidden');
        document.getElementById('ratingLetterInput').classList.remove('hidden');
        document.getElementById('ratingLetterInput').value = "0";
    } else {
        document.getElementById('ratingInput').classList.remove('hidden');
        document.getElementById('ratingLetterInput').classList.add('hidden');
        document.getElementById('ratingInput').value = 0;
    }

    document.getElementById('charModal').classList.remove('hidden');
}

document.getElementById('saveCharBtn').addEventListener('click', () => {
    if (!state.activeListId) return alert("Select a list first");

    const name = document.getElementById('charNameInput').value;
    const customImg = document.getElementById('customImgInput').value;
    const sourceTitle = document.getElementById('sourceTitleInput').value;
    const sourceType = document.getElementById('sourceTypeInput').value;

    if (!name) return alert("Character Name required");

    const list = state.lists.find(l => l._id === state.activeListId);
    const isLetters = list.rankingType === 'letters';

    let ratingVal;
    if (isLetters) {
        ratingVal = parseInt(document.getElementById('ratingLetterInput').value);
    } else {
        ratingVal = parseFloat(document.getElementById('ratingInput').value);
        ratingVal = Math.round(ratingVal * 100) / 100;
    }

    if (ratingVal > 10) ratingVal = 10;
    if (ratingVal < 0) ratingVal = 0;

    let finalImage = customImg || state.tempSearchItem?.image || 'https://placehold.co/200x300/252525/bb86fc?text=No+Image';

    // --- הזיהוי האוטומטי: בודק מאיזה סוג חיפוש הגיעה התוצאה ---
    let detectedEntity = 'character'; // ברירת מחדל: דמות
    if (state.tempSearchItem && state.tempSearchItem.type) {
        const mediaTypes = ['movie', 'tv', 'anime', 'manga', 'game', 'book'];
        if (mediaTypes.includes(state.tempSearchItem.type)) {
            detectedEntity = 'series';
        }
    }

    // --- התיקון למניעת דליפת מזהים (שומר על המזהה המקורי בעריכה) ---
    let finalApiId = state.tempSearchItem ? String(state.tempSearchItem.id) : null;
    if (state.editingIndex > -1) {
        finalApiId = list.items[state.editingIndex].apiId || finalApiId;
    }

    const actionType = state.editingIndex > -1 ? "Edit Character" : "Add Character";
    const charDetails = `${name} (Source: ${sourceTitle})`;
    const notesVal = document.getElementById('charNotesInput').value;

    // יצירת האובייקט שיישמר ב-Database
    const itemData = {
        characterName: name,
        sourceTitle: sourceTitle,
        sourceType: sourceType,
        rating: ratingVal,
        image: finalImage,
        notes: notesVal,
        apiId: finalApiId,
        entityType: detectedEntity
    };

    if (state.editingIndex > -1) {
        itemData.entityType = list.items[state.editingIndex].entityType || detectedEntity;
        Object.assign(list.items[state.editingIndex], itemData);
        state.editingIndex = -1; // חשוב: איפוס הזיכרון!
    } else {
        list.items.push(itemData);
    }

    updateCurrentList(true, actionType, charDetails);
    closeModal('charModal');
});

function normalizeType(apiType) {
    if (!apiType) return 'Other';
    const lower = apiType.toLowerCase();
    if (lower === 'tv' || lower === 'tv show') return 'TV Show';
    if (lower === 'movie') return 'Movie';
    if (lower === 'game') return 'Game';
    if (lower === 'book') return 'Book';
    if (lower === 'anime' || lower === 'character') return 'Anime';
    if (lower === 'manga') return 'Manga';
    if (lower === 'vn') return 'VN';
    if (lower === 'comic') return 'Comic';


    return 'Other';
}

let isRegisterMode = false;
const authBtnNav = document.getElementById('authBtnNav');
if (authBtnNav) {
    authBtnNav.addEventListener('click', async () => {
        if (state.user) {
            await fetch('/api/auth/logout', { method: 'POST' });
            sessionStorage.removeItem('entryLogged');
            window.location.reload();
        } else {
            document.getElementById('authModal').classList.remove('hidden');
        }
    });
}

// פונקציית שליחה מאוחדת
async function handleAuthAction() {
    const u = document.getElementById('authUsername').value;
    const p = document.getElementById('authPassword').value;

    // מונע שליחה אם השדות ריקים
    if (!u || !p) return;

    const url = isRegisterMode ? '/api/auth/register' : '/api/auth/login';

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: u, password: p })
        });

        if (res.ok) {
            isRegisterMode ? (alert("Registered!"), isRegisterMode = false, updateAuthUI()) : window.location.reload();
        } else {
            const errorData = await res.json();
            alert(errorData.error);
        }
    } catch (e) {
        console.error("Auth error:", e);
    }
}

// חיבור הכפתור לפונקציה החדשה
document.getElementById('authSubmitBtn').onclick = (e) => {
    e.preventDefault(); // מונע מהדפדפן לשלוח פעמיים
    handleAuthAction();
};

document.getElementById('authSwitch').addEventListener('click', () => { isRegisterMode = !isRegisterMode; updateAuthUI(); });
function updateAuthUI() {
    const t = document.getElementById('authTitle'),
        b = document.getElementById('authSubmitBtn'),
        s = document.getElementById('authSwitch');

    t.textContent = isRegisterMode ? "Register" : "Login";
    b.textContent = isRegisterMode ? "Register" : "Login";

    s.innerHTML = isRegisterMode
        ? 'Have an account? <span style="color: var(--accent); font-weight: bold;">Login.</span>'
        : 'New here? <span style="color: var(--accent); font-weight: bold;">Register.</span>';
}

document.getElementById('shareBtn').addEventListener('click', () => {
    if (!state.activeListId) return alert("Select a list");
    const url = `${window.location.origin}/share.html?id=${state.activeListId}`;
    navigator.clipboard.writeText(url);
    alert("Copied: " + url);
});

// כפתור יצירת רשימה
document.getElementById('createListBtn').addEventListener('click', () => {
    state.isRenamingList = false;

    document.getElementById('listModalTitle').textContent = "Create New List";
    document.getElementById('newListName').value = '';

    document.getElementById('isPrivateInput').checked = false;
    document.getElementById('isFreeOrderInput').checked = false;
    document.getElementById('rankingTypeSelect').disabled = false;
    document.getElementById('rankingTypeSelect').value = 'numbers';

    document.getElementById('duplicateListBtn').classList.add('hidden');
    document.getElementById('saveListBtn').textContent = "Create";
    document.getElementById('listModal').classList.remove('hidden');

    document.getElementById('newListName').value = '';
    document.getElementById('listDescriptionInput').value = '';
});

document.getElementById('editListTitleBtn').addEventListener('click', () => {
    const list = state.lists.find(l => l._id === state.activeListId);
    if (!list) return;

    state.isRenamingList = true;

    document.getElementById('listModalTitle').textContent = "List Settings";
    document.getElementById('newListName').value = list.name;
    document.getElementById('isPrivateInput').checked = list.isPrivate || false;
    document.getElementById('isFreeOrderInput').checked = list.isFreeOrder || false;

    document.getElementById('allowCommentsInput').checked = list.allowComments !== false;

    document.getElementById('rankingTypeSelect').value = list.rankingType || 'numbers';
    document.getElementById('rankingTypeSelect').disabled = false;

    document.getElementById('duplicateListBtn').classList.remove('hidden');
    document.getElementById('saveListBtn').textContent = "Save Changes";
    document.getElementById('listModal').classList.remove('hidden');

    document.getElementById('newListName').value = list.name;
    document.getElementById('listDescriptionInput').value = list.listDescription || '';
});

document.getElementById('saveListBtn').addEventListener('click', async () => {
    try {
        const name = document.getElementById('newListName').value;
        const rType = document.getElementById('rankingTypeSelect').value;
        const isPrivate = document.getElementById('isPrivateInput').checked;
        const isFreeOrder = document.getElementById('isFreeOrderInput').checked;
        const allowComments = document.getElementById('allowCommentsInput').checked;

        if (!name) {
            alert("Please enter a list name.");
            return;
        }

        if (state.isRenamingList) {
            const list = state.lists.find(l => l._id === state.activeListId);
            if (!list) return;

            list.name = name;
            list.rankingType = rType;
            list.isPrivate = isPrivate;
            list.isFreeOrder = isFreeOrder;
            list.allowComments = allowComments;
            list.listDescription = document.getElementById('listDescriptionInput').value;

            await updateCurrentList(true, "Update List Settings", `Changed settings for: ${name}`);

            renderSidebar();
            renderCurrentList();
        } else {
            await createList(name);
        }

        closeModal('listModal');

    } catch (error) {
        console.error("Error saving list:", error);
        alert("An error occurred while saving the list.");
    }
});

// כפתור השכפול (Duplicate)
document.getElementById('duplicateListBtn').addEventListener('click', async () => {
    if (!state.activeListId) return;
    try {
        const res = await fetch(`/api/lists/${state.activeListId}/duplicate`, { method: 'POST' });
        const newList = await res.json();

        state.lists.push(newList);
        state.activeListId = newList._id; // מעביר אותך לרשימה החדשה אוטומטית

        renderSidebar();
        renderCurrentList();
        closeModal('listModal');
    } catch (err) {
        console.error(err);
    }
});

document.querySelectorAll('.close-modal').forEach(b => b.onclick = (e) => e.target.closest('.modal').classList.add('hidden'));

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.add('hidden');
    }

    if (id === 'adminModal' && typeof logsAutoRefreshInterval !== 'undefined' && logsAutoRefreshInterval) {
        clearInterval(logsAutoRefreshInterval);
        logsAutoRefreshInterval = null;
        console.log("Admin closed: Logs auto-refresh stopped.");
    }
}

document.querySelectorAll('.close-modal').forEach(btn => {
    btn.onclick = (e) => {
        const modal = e.target.closest('.modal');
        if (modal) {
            closeModal(modal.id);
        }
    };
});

function setupEvents() {
    const reorderBtn = document.getElementById('reorderBtn');
    if (reorderBtn) reorderBtn.addEventListener('click', toggleReorderMode);

    const saveOrderBtn = document.getElementById('saveOrderBtn');
    if (saveOrderBtn) saveOrderBtn.addEventListener('click', saveOrder);

    const addCustomCharBtn = document.getElementById('addCustomCharBtn');
    if (addCustomCharBtn) addCustomCharBtn.addEventListener('click', openCustomCharModal);

    const refreshLogsBtn = document.getElementById('refreshLogsBtn');
    if (refreshLogsBtn) {
        refreshLogsBtn.addEventListener('click', () => {
            loadAdminLogs(false);
        });
    }

    // --- לוגיקת המובייל המדויקת ---
    const menuBtn = document.getElementById('mobileMenuBtn');
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('mobileOverlay');

    if (menuBtn && sidebar && overlay) {
        menuBtn.onclick = (e) => {
            e.stopPropagation();
            sidebar.classList.add('open');
            overlay.classList.remove('hidden');
        };

        overlay.onclick = () => {
            sidebar.classList.remove('open');
            overlay.classList.add('hidden');
        };
    }
}

// תחליף את פונקציית הבחירה כדי שהתפריט ייסגר מיד אחרי שלחצת על ליסט בטלפון
window.selectList = async function (id) {
    if (!id) return;
    state.activeListId = id;
    renderSidebar(); // מעדכן את הסימון הסגול בסיידבאר

    // מציג Loading בגריד
    const grid = document.getElementById('characterGrid');
    if (grid) grid.innerHTML = '<p style="text-align:center; padding:50px; color:#888;"><i class="fas fa-spinner fa-spin"></i> Loading characters...</p>';

    try {
        const res = await fetch(`/api/lists/${id}`);
        if (!res.ok) throw new Error("Failed to fetch");

        const fullList = await res.json();

        // מעדכנים את הרשימה הספציפית בתוך המערך הגלובלי
        const index = state.lists.findIndex(l => l._id === id);
        if (index !== -1) {
            state.lists[index] = fullList;
        }

        // עכשיו כשיש נתונים - מרנדרים את הכל!
        renderCurrentList();

    } catch (e) {
        console.error("Error fetching list content:", e);
        if (grid) grid.innerHTML = '<p style="text-align:center; color:red;">Error loading list characters.</p>';
    }

    if (window.innerWidth <= 768) closeMobileMenu();
};

function closeMobileMenu() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('mobileOverlay');

    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
}

// --- 1. פונקציונליות הצגת/הסתרת סיסמה ---
const togglePassword = document.getElementById('togglePassword');
const passwordInput = document.getElementById('authPassword');

if (togglePassword && passwordInput) {
    togglePassword.addEventListener('click', function () {
        // מחליף בין סוג password לסוג text
        const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        passwordInput.setAttribute('type', type);

        // מחליף את האייקון (עין פתוחה/סגורה)
        this.classList.toggle('fa-eye');
        this.classList.toggle('fa-eye-slash');
    });
}

// --- 2. לחיצה על Enter להתחברות ---
// אנחנו מאזינים לכל המודאל, כך שאנטר בשדה השם או הסיסמה יעבוד
document.getElementById('authModal').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const submitBtn = document.getElementById('authSubmitBtn');
        if (submitBtn) submitBtn.click();
    }
});

// --- אופציה להתחברות באמצעות מקש Enter ---
// האזנה למקש Enter רק בתוך שדות הטקסט של ההתחברות
const authInputs = [document.getElementById('authUsername'), document.getElementById('authPassword')];

authInputs.forEach(input => {
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); // עוצר את הדפדפן מלבצע פעולה טבעית
                e.stopImmediatePropagation(); // עוצר אירועים אחרים מלהתפתח
                handleAuthAction(); // קורא לפונקציה ישירות במקום לעשות .click()
            }
        });
    }
});

document.getElementById('filterSelect').addEventListener('change', renderCurrentList);


let currentCommTab = 'users';

// פתיחת מודאל הקהילה
// פתיחת מודאל הקהילה
const communityBtn = document.getElementById('communityBtn');
if (communityBtn) {
    communityBtn.onclick = () => {
        window.forceOpenTab('users');
    };
}

// כפתור לידרבורד ישיר מהסיידבאר
const openLeaderboardBtn = document.getElementById('openLeaderboardBtn');
if (openLeaderboardBtn) {
    openLeaderboardBtn.onclick = () => {
        window.forceOpenTab('leaderboard');
    };
}

document.getElementById('closeCommModal').onclick = () => document.getElementById('communityModal').classList.add('hidden');

// כפתור חזור (מתוך צפייה ברשימות של מישהו)
document.getElementById('commBackBtn').onclick = () => {
    document.getElementById('commTabsContainer').classList.remove('hidden');
    document.getElementById('commBackBtn').classList.add('hidden');
    switchCommTab(currentCommTab);
};

// מעבר בין טאבים
document.getElementById('tabUsers').onclick = () => switchCommTab('users');
document.getElementById('tabLeaderboard').onclick = () => switchCommTab('leaderboard');

function switchCommTab(tab) {
    currentCommTab = tab;
    const btnUsers = document.getElementById('tabUsers');
    const btnLeaderboard = document.getElementById('tabLeaderboard');
    const commControls = document.getElementById('commControls');
    const sortControls = document.getElementById('leaderboardSortControls'); // תפסנו את הפילטר
    const grid = document.getElementById('communityGrid');
    const title = document.getElementById('communityTitle');

    if (tab === 'users') {
        btnUsers.className = 'btn-primary active-tab';
        btnLeaderboard.className = 'btn-primary inactive-tab';
        if (commControls) commControls.style.display = 'block';
        if (sortControls) sortControls.style.display = 'none'; // מסתירים את המיון בטאב משתמשים

        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(150px, 1fr))';
        title.textContent = "Community";
        loadCommunityUsers();
    } else {
        btnUsers.className = 'btn-primary inactive-tab';
        btnLeaderboard.className = 'btn-primary active-tab';
        if (commControls) commControls.style.display = 'none';
        if (sortControls) sortControls.style.display = 'flex'; // מציגים את המיון בטאב לידרבורד!

        grid.style.display = 'block';
        title.innerHTML = '<i class="fas fa-trophy" style="color:gold;"></i> Global Leaderboard';
        loadLeaderboard();
    }
}

// חיפוש בקהילה
let userSearchDebounce;
document.getElementById('userSearchInput').addEventListener('input', (e) => {
    clearTimeout(userSearchDebounce);
    userSearchDebounce = setTimeout(() => { loadCommunityUsers(); }, 500);
});

// טעינת משתמשים (הטאב הראשון)
async function loadCommunityUsers() {
    const grid = document.getElementById('communityGrid');
    grid.innerHTML = '<p style="text-align:center; grid-column: 1/-1;">Loading users...</p>';

    try {
        const query = document.getElementById('userSearchInput')?.value || '';
        const res = await fetch(`/api/users?search=${query}&t=${Date.now()}`);
        const users = await res.json();
        if (currentCommTab !== 'users') return;



        users.sort((a, b) => {
            if (a.isFollowing === b.isFollowing) return 0;
            return a.isFollowing ? -1 : 1; // אמת (עוקב) קופץ למעלה
        });

        grid.innerHTML = users.length ? '' : '<p style="grid-column: 1/-1; text-align:center;">No users found.</p>';

        users.forEach(u => {
            const div = document.createElement('div');
            div.className = 'user-card';

            const userImg = (u.avatar && u.avatar.trim() !== "") ?
                `<img src="${getOptimizedImg(u.avatar, 100, 100)}" 
          data-original="${u.avatar}"
          onerror="if(this.src.includes('wsrv.nl')){ this.src=this.dataset.original; } else { this.style.display='none'; this.nextElementSibling.style.display='inline-block'; }"
          style="width: 55px; height: 55px; border-radius: 50%; object-fit: cover; border: 2px solid var(--accent); margin-bottom: 10px;">` :
                `<i class="fas fa-user-circle user-icon" style="font-size: 55px; margin-bottom: 10px;"></i>`;

            // בדיקת התחברות חסינה גם לאינדקס (state.user) וגם לשייר (loggedInUser)
            const isUserLoggedIn = (typeof state !== 'undefined' && state.user) || (typeof loggedInUser !== 'undefined' && loggedInUser);
            let starHtml = isUserLoggedIn ? `
                <button class="follow-btn" onclick="toggleFollow(event, '${u._id}')">
                    <i class="${u.isFollowing ? 'fas fa-star active' : 'far fa-star'}"></i>
                </button>` : '';

            div.innerHTML = `
                ${starHtml}
                ${userImg}
                <div style="font-weight:bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 5px;">${u.username}</div>
            `;

            div.onclick = (e) => {
                if (!e.target.closest('.follow-btn')) window.location.href = `/profile.html?user=${u.username}`;
            };
            grid.appendChild(div);
        });
    } catch (e) { grid.innerHTML = '<p style="grid-column: 1/-1;">Error loading.</p>'; }
}

let globalLeaderboardData = new Array(); // שומר את הנתונים בזיכרון כדי שהחלון יוכל לקרוא אותם

async function loadLeaderboard() {
    const grid = document.getElementById('communityGrid');
    grid.innerHTML = '<p style="text-align: center; padding: 40px; font-size: 1.1rem; color: var(--text-muted);">Calculating global rankings...</p>';

    try {
        const sortMethod = document.getElementById('leaderboardSortSelect') ? document.getElementById('leaderboardSortSelect').value : 'rating';
        const res = await fetch(`/api/leaderboard?sort=${sortMethod}`);
        const data = await res.json();

        // הגנה קריטית! מוודא שקיבלנו רשימה ולא הודעת שגיאה מהשרת
        if (!Array.isArray(data)) {
            grid.innerHTML = '<p style="text-align: center; color: #ff4444; padding: 20px;">Failed to load leaderboard. Server is busy.</p>';
            return;
        }

        grid.innerHTML = '';

        if (data.length === 0) {
            grid.innerHTML = '<p style="text-align: center; padding: 40px; color: #888;">No characters ranked yet.</p>';
            return;
        }

        const mainAdminBtn = document.getElementById('adminBtn');
        const isCurrentUserAdmin =
            (typeof currentUserData !== 'undefined' && currentUserData?.role === 'admin') ||
            (typeof state !== 'undefined' && state.role === 'admin') ||
            (mainAdminBtn && !mainAdminBtn.classList.contains('hidden'));

        data.forEach((item, index) => {
            const div = document.createElement('div');
            div.className = 'leaderboard-row';

            let rankClass = 'lb-rank-other';
            let rankText = `#${index + 1}`;

            if (index === 0) { rankClass = 'lb-rank-1'; rankText = '<i class="fas fa-crown" style="margin-right: 4px;"></i>1'; }
            else if (index === 1) { rankClass = 'lb-rank-2'; }
            else if (index === 2) { rankClass = 'lb-rank-3'; }

            const formattedScore = parseFloat(item.avgRating.toFixed(1));
            const displayType = item.sourceType === 'TV Show' ? 'TV' : (item.sourceType || 'Other');

            let validImg = item.image && !item.image.includes('via.placeholder.com')
                ? item.image
                : 'https://placehold.co/60x60/252525/bb86fc?text=?';

            let adminGearHtml = '';
            if (isCurrentUserAdmin) {
                const safeName = item.characterName ? item.characterName.replace(/'/g, "\\'") : '';
                const safeSource = item.sourceTitle ? item.sourceTitle.replace(/'/g, "\\'") : '';
                adminGearHtml = `<button onclick="openGlobalEdit('${item._id}', '${safeName}', '${safeSource}', '${item.sourceType}', '${item.image}')" style="background:none; border:none; color: var(--accent); cursor: pointer; font-size: 1.1rem; margin-left: 10px;" title="Admin Edit"><i class="fas fa-cog"></i></button>`;
            }

            const isUserLoggedIn = (typeof state !== 'undefined' && state.user) || (typeof loggedInUser !== 'undefined' && loggedInUser);
            const quickAddBtn = isUserLoggedIn ? `<button class="lb-add-btn" onclick="openQuickAddSelector('${item._id}', '${item.characterName.replace(/'/g, "\\'")}', '${item.sourceTitle.replace(/'/g, "\\'")}', '${item.sourceType}', '${item.image}')"  title="Add to my list"><i class="fas fa-plus"></i></button>` : '';

            div.innerHTML = `
                <div class="leaderboard-rank ${rankClass}">${rankText}</div>
                   <div class="leaderboard-img-container">
        ${quickAddBtn}
        <img src="${getOptimizedImg(validImg, 100, 100)}" 
     data-original="${validImg}"
     class="leaderboard-img" 
     onerror="if(this.src.includes('wsrv.nl')){ this.src=this.dataset.original; } else { this.src='https://placehold.co/60x60/252525/bb86fc?text=?'; }"
>
    </div>
                
                <div class="leaderboard-content-wrapper">
                    <div class="leaderboard-info">
                        <div class="leaderboard-name">${item.characterName}</div>
                        <div class="leaderboard-source">
                            <span class="leaderboard-source-text" title="${item.sourceTitle}">${item.sourceTitle}</span>
                            <span style="color:var(--accent); font-size:0.75rem; margin-left:5px; font-weight:bold; flex-shrink: 0;">• ${displayType}</span>
                        </div>
                    </div>
                    
                    <div class="leaderboard-stats">
                        <div class="leaderboard-score">
                            <span style="color: #FFD700; font-weight: 900; font-size: 1.1rem; display: flex; align-items: center;">
                                <i class="fas fa-star" style="font-size:0.8rem; margin-right:5px;"></i> ${formattedScore}
                            </span>
                            
                            <!-- לחיצה שפותחת את החלון ושולחת בקשה לשרת -->
                            <span onclick="openVotersModal('${item._id}', '${item.characterName.replace(/'/g, "\\'")}')" style="cursor: pointer; color: var(--text-muted); font-size: 0.8rem; border-left: 1px solid rgba(255,255,255,0.15); margin-left: 10px; padding-left: 10px; display: flex; align-items: center; transition: 0.2s;" onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--text-muted)'" title="View who ranked this">
                                <i class="fas fa-users" style="margin-right:4px;"></i> ${item.rankedByCount}
                            </span>
                            ${adminGearHtml}
                        </div>
                    </div>
                </div>
            `;
            grid.appendChild(div);
        });

    } catch (e) {
        console.error("Leaderboard error:", e);
        grid.innerHTML = '<p style="text-align: center; color: #ff4444; padding: 20px;">Failed to load leaderboard.</p>';
    }
}

// פונקציית טעינה עצלה למצביעים (כולל לחיצה על משתמשים)
window.openVotersModal = async function (charId, charName) {
    const modal = document.getElementById('votersModal');
    if (modal) modal.style.display = 'flex';
    document.getElementById('votersModalTitle').innerHTML = `<i class="fas fa-users"></i> Ranked By (${charName})`;
    const listDiv = document.getElementById('votersList');

    listDiv.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-muted);"><i class="fas fa-spinner fa-spin"></i> Loading users...</div>';
    document.getElementById('votersModal').classList.remove('hidden');

    try {
        const res = await fetch(`/api/leaderboard/voters/${charId}`);
        const voters = await res.json();

        listDiv.innerHTML = '';

        if (!voters || voters.length === 0) {
            listDiv.innerHTML = '<div style="text-align:center; color:#888;">No users found.</div>';
            return;
        }

        voters.forEach(v => {
            const avatarHtml = (v.avatar && v.avatar.trim() !== "") ?
                `<img src="${getOptimizedImg(v.avatar, 80, 80)}" 
          data-original="${v.avatar}"
          onerror="if(this.src.includes('wsrv.nl')){ this.src=this.dataset.original; } else { this.style.display='none'; this.nextElementSibling.style.display='inline-block'; }"
          style="width: 35px; height: 35px; border-radius: 50%; object-fit: cover; border: 2px solid var(--accent);">
     <i class="fas fa-user-circle" style="font-size: 35px; color: var(--text-muted); display: none;"></i>` :
                `<i class="fas fa-user-circle" style="font-size: 35px; color: var(--text-muted);"></i>`;

            const isClickable = v.userId ? true : false;
            const cursorStyle = isClickable ? 'cursor: pointer;' : '';
            const clickAction = isClickable ? `onclick="window.location.href='/profile.html?user=${v.username.replace(/'/g, "\\'")}'"` : '';

            // תוספת לאדמין: סימון מנעול אם ההצבעה היא מרשימה פרטית
            const privateTag = v.isPrivateVote ? `<span style="color:#c3c3c3 font-size:0.7rem; margin-left:8px; padding:1px 4px; border-radius:4px;"><i class="fas fa-lock"></i></span>` : '';

            listDiv.innerHTML += `
                <div style="display: flex; align-items: center; justify-content: space-between; background: var(--bg-color); padding: 10px; border-radius: 8px; border: 1px solid var(--border);">
                    <div style="display: flex; align-items: center; gap: 10px; ${cursorStyle}" ${clickAction}>
                        ${avatarHtml}
                        <span style="font-weight: bold; color: var(--text-main);">${v.username}${privateTag}</span>
                    </div>
                    <div style="color: #FFD700; font-weight: bold; font-size: 1.1rem; display: flex; align-items: center;">
                        ${v.rating} <i class="fas fa-star" style="font-size: 0.8rem; margin-left: 4px;"></i>
                    </div>
                </div>
            `;
        });
    } catch (e) {
        listDiv.innerHTML = '<div style="color:#ff4444; text-align:center;">Error loading voters.</div>';
    }
}

// פתיחת הפרופיל של מישהו
async function showUserLists(userId, username, avatar) {
    const grid = document.getElementById('communityGrid');
    const commControls = document.getElementById('commControls');
    const sortControls = document.getElementById('leaderboardSortControls');
    const tabsContainer = document.getElementById('commTabsContainer');
    const backBtn = document.getElementById('commBackBtn');
    const title = document.getElementById('communityTitle');

    // מסתיר טאבים, חיפוש, ומיון כשצופים במשתמש ספציפי
    if (tabsContainer) tabsContainer.classList.add('hidden');
    if (commControls) commControls.style.display = 'none';
    if (sortControls) sortControls.style.display = 'none';
    if (backBtn) backBtn.classList.remove('hidden');

    // --- התיקון הקריטי: מכריחים את החלון לחזור למצב קוביות (Grid) ---
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(150px, 1fr))';
    grid.style.gap = '15px';

    // לוגיקת האווטאר המוגדל
    let displayAvatar = avatar;
    if ((!displayAvatar || displayAvatar === "") && typeof state !== 'undefined' && state.userId === userId) {
        displayAvatar = document.getElementById('navAvatar')?.src;
    }

    const isImage = displayAvatar && (displayAvatar.startsWith('http') || displayAvatar.startsWith('data:image'));
    const headerAvatarHtml = isImage ?
        `<img src="${displayAvatar}" style="width: 100px; height: 100px; border-radius: 50%; object-fit: cover; border: 3px solid var(--accent); margin-bottom: 15px; display: block; background: var(--bg-color); padding: 2px;">` :
        `<i class="fas fa-user-circle" style="font-size: 100px; margin-bottom: 15px; color: var(--text-muted); display: block;"></i>`;

    title.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; margin-bottom: 10px;">
            ${headerAvatarHtml}
            <div style="font-size: 1.5rem; font-weight: bold; color: var(--text-main);">${username}'s Lists</div>
        </div>
    `;

    grid.innerHTML = '<p style="text-align:center; padding: 20px; grid-column: 1/-1;">Loading lists...</p>';

    try {
        const res = await fetch(`/api/users/${userId}/lists`);
        const lists = await res.json();
        grid.innerHTML = '';

        if (!lists || lists.length === 0) {
            grid.innerHTML = '<p style="grid-column: 1/-1; text-align:center; padding: 20px; color: var(--text-muted);">This user has no public lists.</p>';
            return;
        }

        lists.forEach(list => {
            const div = document.createElement('div');
            div.className = 'comm-list-card';

            // עיצוב משופר: מונע שמות רשימות ארוכים מלשבור את הקובייה
            div.innerHTML = `
                <h4 style="color:var(--accent); margin-bottom: 5px; font-size: 1.1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${list.name}">${list.name}</h4>
                <p style="color:var(--text-muted); font-size: 0.9rem;">${list.items ? list.items.length : 0} items</p>
            `;

            div.onclick = () => window.open(`/share.html?id=${list._id}`, '_blank');
            grid.appendChild(div);
        });
    } catch (e) {
        grid.innerHTML = '<p style="text-align:center; grid-column: 1/-1;">Error loading lists.</p>';
    }
}

window.toggleFollow = async function (e, userId) {
    e.stopPropagation();
    const btn = e.currentTarget.querySelector('i');
    const wasFollowing = btn.classList.contains('fas');
    btn.className = wasFollowing ? 'far fa-star' : 'fas fa-star active';
    try {
        await fetch(`/api/users/follow/${userId}`, { method: 'POST' });
        loadCommunityUsers();
    } catch (err) { }
};

function getRatingDisplay(rating, type) {
    if (rating === 0) return 'No Grade';
    if (type !== 'letters') return rating + '/10';

    if (rating >= 10) return 'SSS';
    if (rating >= 9) return 'SS';
    if (rating >= 8) return 'S';
    if (rating >= 7) return 'A';
    if (rating >= 6) return 'B';
    if (rating >= 5) return 'C';
    if (rating >= 4) return 'D';
    if (rating >= 3) return 'E';
    return 'F';
}

let sidebarDragSrc = null;

function handleSidebarDragStart(e) {
    this.style.opacity = '0.4';
    sidebarDragSrc = this;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.innerHTML);
}

function handleSidebarDragOver(e) {
    if (e.preventDefault) e.preventDefault();
    return false;
}

async function handleSidebarDrop(e) {
    if (e.stopPropagation) e.stopPropagation();

    if (sidebarDragSrc !== this) {
        const fromIndex = parseInt(sidebarDragSrc.dataset.index);
        const toIndex = parseInt(this.dataset.index);

        const itemToMove = state.lists[fromIndex];
        state.lists.splice(fromIndex, 1);
        state.lists.splice(toIndex, 0, itemToMove);

        renderSidebar();

        const orderedIds = state.lists.map(l => l._id);
        try {
            await fetch('/api/lists/reorder', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderedIds })
            });
        } catch (err) {
            console.error("Failed to save order", err);
        }
    }
    return false;
}

function handleSidebarDragEnd(e) {
    this.style.opacity = '1';
}

// --- ADMIN LOGIC ---
const adminBtn = document.getElementById('adminBtn');
if (adminBtn) {
    adminBtn.addEventListener('click', () => {
        const modal = document.getElementById('adminModal');
        if (modal) {
            modal.style.display = 'flex'; // <--- התיקון פה
            modal.classList.remove('hidden');
            switchAdminTab('users');
        }
    });
}

document.getElementById('adminTabUsers').onclick = () => switchAdminTab('users');
document.getElementById('adminBackToUsersBtn').onclick = () => switchAdminTab('users');
document.getElementById('adminTabLogs').onclick = () => switchAdminTab('logs');

function switchAdminTab(tab) {
    document.getElementById('adminUsersSection').classList.add('hidden');
    document.getElementById('adminListsSection').classList.add('hidden');
    document.getElementById('adminLogsSection').classList.add('hidden');

    document.getElementById('adminTabUsers').className = 'btn-primary inactive-tab';
    document.getElementById('adminTabLogs').className = 'btn-primary inactive-tab';

    if (logsAutoRefreshInterval) {
        clearInterval(logsAutoRefreshInterval);
        logsAutoRefreshInterval = null;
    }

    if (tab === 'users') {
        document.getElementById('adminUsersSection').classList.remove('hidden');
        document.getElementById('adminTabUsers').className = 'btn-primary active-tab';
        loadAdminUsers();
    } else if (tab === 'logs') {
        document.getElementById('adminLogsSection').classList.remove('hidden');
        document.getElementById('adminTabLogs').className = 'btn-primary active-tab';
        loadAdminLogs();

        logsAutoRefreshInterval = setInterval(() => {
            loadAdminLogs(true);
        }, 5000);
    }
}

async function loadAdminLogs(silent = false) {
    const list = document.getElementById('adminLogsList');
    if (!silent) list.innerHTML = '<div style="text-align:center; padding:20px;">Updating...</div>';

    try {
        const res = await fetch('/api/admin/logs');
        const logs = await res.json();
        const html = logs.map(log => {
            const date = new Date(log.timestamp).toLocaleString('he-IL');
            let actionColor = "var(--accent)";
            if (log.action.includes("Delete")) actionColor = "#ff4444";
            if (log.action.includes("Create")) actionColor = "#4CAF50";
            if (log.action.includes("Login")) actionColor = "#2196F3";

            return `
                <div style="padding: 8px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; gap: 10px; background: var(--card-bg);">
                    <span style="color: #888; min-width: 140px;">${date}</span>
                    <span style="font-weight: bold; min-width: 100px;">${log.username}</span>
                    <span style="color: ${actionColor}; font-weight: bold; min-width: 120px;">${log.action}</span>
                    <span style="flex: 1; color: var(--text-muted);">${log.details}</span>
                </div>
            `;
        }).join('');
        list.innerHTML = html;
    } catch (e) {
        if (!silent) list.innerHTML = 'Error loading logs.';
    }
}

async function loadAdminUsers() {
    const grid = document.getElementById('adminUsersGrid');
    grid.innerHTML = 'Loading users...';
    const res = await fetch('/api/admin/users');
    const users = await res.json();
    grid.innerHTML = '';

    users.forEach(u => {
        const div = document.createElement('div');
        div.style = "display:flex; justify-content:space-between; align-items:center; padding:10px; background:var(--bg-color); border:1px solid var(--border); border-radius:4px; flex-wrap:wrap; gap:10px;";
        div.innerHTML = `
            <span><strong>${u.username}</strong> (${u.role})</span>
            <div style="display:flex; gap:5px;">
                <button onclick="adminManageLists('${u._id}', '${u.username}')" class="btn-primary" style="width:auto; padding:5px 10px; background:#2196F3;">Lists</button>
                <button onclick="adminResetPass('${u._id}')" class="btn-primary" style="width:auto; padding:5px 10px; background:orange;">New Pass</button>
                <button onclick="adminDeleteUser('${u._id}')" class="btn-primary" style="width:auto; padding:5px 10px; background:red;">Delete</button>
            </div>
        `;
        grid.appendChild(div);
    });
}

window.adminManageLists = async function (userId, username) {
    const adminUsersSection = document.getElementById('adminUsersSection');
    const adminListsSection = document.getElementById('adminListsSection');
    const adminUserListsTitle = document.getElementById('adminUserListsTitle');
    const grid = document.getElementById('adminListsGrid');

    if (adminUsersSection) adminUsersSection.classList.add('hidden');
    if (adminListsSection) adminListsSection.classList.remove('hidden');
    if (adminUserListsTitle) adminUserListsTitle.textContent = `Lists owned by: ${username}`;

    grid.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted);">Fetching lists...</div>';

    try {
        const res = await fetch(`/api/admin/users/${userId}/lists`);
        if (!res.ok) throw new Error("Failed to fetch lists");
        const lists = await res.json();

        grid.innerHTML = '';
        if (!lists || lists.length === 0) {
            grid.innerHTML = '<p style="padding:20px; color:#888;">This user has no lists yet.</p>';
            return;
        }

        lists.forEach(l => {
            const div = document.createElement('div');
            div.style = "display:flex; justify-content:space-between; align-items:center; padding:12px; background:var(--card-bg); border:1px solid var(--border); border-radius:8px; margin-bottom:8px;";

            const privacyIcon = l.isPrivate ? '<i class="fas fa-lock" style="margin-right:8px; font-size:0.8rem; color:#888;"></i>' : '';
            const itemsCount = l.items ? l.items.length : 0;

            div.innerHTML = `
                <div style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    ${privacyIcon}<strong style="color:var(--accent);">${l.name}</strong> 
                </div>
                <div style="display:flex; gap:8px; flex-shrink: 0; margin-left: 10px;">
                    <button onclick="window.open('/share.html?id=${l._id}', '_blank')" class="btn-primary" style="width:auto; padding:5px 12px; font-size:0.8rem; background:#4CAF50;">View</button>
                    <button onclick="adminDeleteList('${l._id}', '${userId}', '${username}')" class="btn-primary" style="width:auto; padding:5px 12px; font-size:0.8rem; background:#ff4444;">Delete</button>
                </div>
            `;
            grid.appendChild(div);
        });
    } catch (e) {
        console.error("Admin Manage Lists Error:", e);
        grid.innerHTML = '<p style="color:red; padding:20px;">Error loading user lists.</p>';
    }
}

window.adminResetPass = async function (id) {
    const newPass = prompt("Enter new password for this user (Min 3 characters):");
    if (!newPass) return;

    const res = await fetch(`/api/admin/users/${id}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: newPass })
    });

    if (res.ok) alert("Password changed successfully!");
    else alert("Error changing password.");
}

window.adminDeleteUser = async function (id) {
    if (!confirm("DELETE USER AND ALL THEIR LISTS? This cannot be undone.")) return;
    await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
    loadAdminUsers();
}

window.adminDeleteList = async function (listId, userId, username) {
    if (!confirm("Delete this list?")) return;
    await fetch(`/api/admin/lists/${listId}`, { method: 'DELETE' });
    adminManageLists(userId, username);
}

function renderIndexComments(comments, ownerId) {
    const listArea = document.getElementById('indexCommentsList');
    if (!listArea) return;
    listArea.innerHTML = '';
    const safeComments = Array.isArray(comments) ? comments : [];

    if (safeComments.length === 0) {
        listArea.innerHTML = '<p style="text-align:center; color:#888; padding:20px;">No comments yet.</p>';
        return;
    }

    const sorted = [...safeComments].reverse();
    const toDisplay = sorted.slice(0, visibleIndexCommentsLimit);

    toDisplay.forEach(c => {
        const div = document.createElement('div');
        div.style = "padding:15px; background:var(--card-bg); border-radius:12px; border:1px solid var(--border); position:relative; margin-bottom:20px;";

        const adminTag = c.role === 'admin' ? '<span style="color:#FFD700; font-weight:bold; font-size:0.75rem; margin-left:5px;">(Admin)</span>' : '';
        const hasLikedC = c.likes && state.userId && c.likes.map(id => id.toString()).includes(state.userId.toString());
        const heartClass = hasLikedC ? 'fas' : 'far';
        const likeColor = hasLikedC ? '#ff4444' : '#888';

        // עיצוב אווטאר ראשי (42px + מסגרת)
        const avatarHtml = (c.avatar && c.avatar.trim() !== "") ?
            `<img src="${c.avatar}" style="width: 42px; height: 42px; border-radius: 50%; object-fit: cover; border: 2px solid var(--accent); padding: 2px; margin-right: 12px; background: var(--bg-color); flex-shrink: 0;">` :
            `<i class="fas fa-user-circle" style="font-size: 38px; margin-right: 12px; color: var(--text-muted); flex-shrink: 0;"></i>`;

        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
                <div style="display:flex; align-items:center; cursor:pointer;" onclick="window.location.href='/profile.html?user=${c.username}'">
                    ${avatarHtml}
                    <b style="color:var(--accent); font-weight:bold; font-size: 1rem;">${c.username}${adminTag}</b>
                </div>
                <div style="display:flex; gap:12px; align-items:center;">
                    <button onclick="likeCommentIndex('${c._id}')" style="background:none; border:none; color:${likeColor}; cursor:pointer; font-size:0.95rem;">
                        <i class="${heartClass} fa-heart"></i> ${c.likes?.length || 0}
                    </button>
                    <button onclick="toggleReplyBoxIndex('${c._id}', '${c.username}')" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:0.95rem;">
                        <i class="fas fa-reply"></i>
                    </button>
                    <button onclick="deleteIndexComment('${c._id}')" style="color:#ff4444; background:none; border:none; cursor:pointer;"><i class="fas fa-trash"></i></button>
                </div>
            </div>
            <div style="color:var(--text-main); margin-bottom:12px; line-height:1.5; padding-left: 54px;">${c.text}</div>
            
            <div style="margin-left: 54px; border-left: 2px solid var(--border); padding-left: 15px;">
                ${c.replies ? c.replies.map(r => {
            const hasLikedR = r.likes && state.userId && r.likes.map(id => id.toString()).includes(state.userId.toString());

            // --- הוספת תג אדמין מוזהב בריפליי (חדש) ---
            const rAdminTag = r.role === 'admin' ? '<span style="color:#FFD700; font-weight:bold; font-size:0.75rem; margin-left:5px;">(Admin)</span>' : '';

            const rAvatar = (r.avatar && r.avatar.trim() !== "") ? `<img src="${r.avatar}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; border: 2px solid var(--accent); padding: 1px; margin-right: 10px; background: var(--bg-color); flex-shrink: 0;">` : `<i class="fas fa-user-circle" style="font-size: 28px; margin-right: 10px; color: var(--text-muted); flex-shrink: 0;"></i>`;

            return `
    <div style="margin-bottom:10px; font-size:0.85rem; background: rgba(255,255,255,0.02); padding: 8px; border-radius: 6px; position:relative;">
        <div style="display:flex; align-items:center; margin-bottom:8px;">
            ${rAvatar}
            <b style="color:var(--accent); cursor:pointer;" onclick="window.location.href='/profile.html?user=${r.username}'"">${r.username}${rAdminTag}</b> 
            ${r.replyingTo ? `<span style="color:var(--text-muted); font-size:0.7rem; margin-left:5px;">replied to @${r.replyingTo}</span>` : ''}
        </div>
        <p style="margin:5px 0; color:var(--text-main); padding-left: 42px;">${r.text}</p>
        <div style="display:flex; gap:15px; margin-left: 42px; margin-top: 5px;">
             <button onclick="likeReplyIndex('${c._id}', '${r._id}')" style="background:none; border:none; color:${hasLikedR ? '#ff4444' : '#666'}; cursor:pointer; font-size:0.75rem; padding:0;">
                <i class="${hasLikedR ? 'fas' : 'far'} fa-heart"></i> ${r.likes?.length || 0}
             </button>
             <button onclick="toggleReplyBoxIndex('${c._id}', '${r.username}')" style="background:none; border:none; color:var(--accent); font-size:0.7rem; cursor:pointer; padding:0;">Reply</button>
             <button onclick="deleteReplyIndex('${c._id}', '${r._id}')" style="background:none; border:none; color:#ff4444; cursor:pointer; font-size:0.7rem;"><i class="fas fa-trash"></i></button>
        </div>
    </div>`;
        }).join('') : ''}
            </div>

            <div id="index-reply-box-${c._id}" class="hidden" style="margin-top:15px; margin-left:54px; display:flex; gap:10px;">
                <input type="text" id="index-reply-input-${c._id}" style="flex:1; background:var(--bg-color); border:1px solid var(--border); color:white; padding:10px; border-radius:8px; font-size:0.9rem;">
                <button onclick="sendReplyIndex('${c._id}')" class="btn-primary" style="width:auto; padding:0 20px; font-size:0.85rem; height:42px;">Post</button>
            </div>
        `;
        listArea.appendChild(div);
    });
}

// לחיצה על "שלח תגובה" באינדקס
document.getElementById('submitIndexComment').onclick = async () => {
    const input = document.getElementById('indexCommentText');
    const text = input.value.trim();
    if (!text || !state.activeListId) return;

    const res = await fetch(`/api/lists/${state.activeListId}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
    });
    if (res.ok) {
        const data = await res.json();
        // מעדכנים את הזיכרון הלוקאלי
        const currentList = state.lists.find(l => l._id === state.activeListId);
        currentList.comments = data;
        input.value = '';
        renderIndexComments(data, currentList.userId);
    } else {
        const err = await res.json();
        alert(err.error);
    }
};

window.deleteIndexComment = async function (commentId) {
    if (!confirm("Delete this community comment?")) return;
    const res = await fetch(`/api/lists/${state.activeListId}/comments/${commentId}`, { method: 'DELETE' });
    if (res.ok) {
        const currentList = state.lists.find(l => l._id === state.activeListId);
        currentList.comments = currentList.comments.filter(c => c._id !== commentId);
        renderIndexComments(currentList.comments, currentList.userId);
    }
};

document.getElementById('loadMoreIndexCommentsBtn').onclick = () => {
    visibleIndexCommentsLimit += 10;
    const list = state.lists.find(l => l._id === state.activeListId);
    renderIndexComments(list.comments, list.userId);
};

// Toggle פתיחה של תיבת ריפליי ושמירת שם המשתמש לו עונים
window.toggleReplyBoxIndex = function (cid, username) {
    const box = document.getElementById(`index-reply-box-${cid}`);
    const input = document.getElementById(`index-reply-input-${cid}`);
    if (!box || !input) return;

    box.classList.toggle('hidden');
    if (!box.classList.contains('hidden')) {
        input.placeholder = `Replying to @${username}...`;
        input.dataset.replyToUser = username;
        input.focus();
    }
};

// שליחת הריפליי מהאינדקס לשרת
window.sendReplyIndex = async function (cid) {
    const input = document.getElementById(`index-reply-input-${cid}`);
    if (!input) return;

    const text = input.value.trim();
    const replyingTo = input.dataset.replyToUser;

    if (!text || !state.activeListId) return;

    try {
        const res = await fetch(`/api/lists/${state.activeListId}/comments/${cid}/reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, replyingTo })
        });

        const data = await res.json();

        if (!res.ok) {
            alert(data.error || "Error posting reply");
            return;
        }

        // עדכון הזיכרון המקומי
        const currentList = state.lists.find(l => l._id === state.activeListId);
        currentList.comments = data;

        renderIndexComments(data, currentList.userId);
    } catch (e) {
        console.error("Reply Index Error:", e);
    }
};

window.likeCommentIndex = async function (commentId) {
    if (!state.activeListId) return;
    try {
        const res = await fetch(`/api/lists/${state.activeListId}/comments/${commentId}/like`, {
            method: 'POST'
        });

        if (res.ok) {
            const updatedComments = await res.json();
            const currentList = state.lists.find(l => l._id === state.activeListId);
            if (currentList) currentList.comments = updatedComments;

            renderIndexComments(updatedComments, state.userId);
        }
    } catch (e) {
        console.error("Main comment like error:", e);
    }
};

window.likeReplyIndex = async function (commentId, replyId) {
    if (!state.activeListId) return;
    try {
        const res = await fetch(`/api/lists/${state.activeListId}/comments/${commentId}/replies/${replyId}/like`, { method: 'POST' });
        if (res.ok) {
            const data = await res.json();
            const currentList = state.lists.find(l => l._id === state.activeListId);
            currentList.comments = data;
            renderIndexComments(data, currentList.userId);
        }
    } catch (e) { console.error(e); }
};

window.deleteReplyIndex = async function (commentId, replyId) {
    if (!confirm("Delete this reply?")) return;
    try {
        const res = await fetch(`/api/lists/${state.activeListId}/comments/${commentId}/replies/${replyId}`, { method: 'DELETE' });
        if (res.ok) {
            const data = await res.json();
            const currentList = state.lists.find(l => l._id === state.activeListId);
            currentList.comments = data;
            renderIndexComments(data, currentList.userId);
        }
    } catch (err) { console.error(err); }
};


const DEFAULT_AVATAR = "https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y";

function openProfileModal() {
    const navAvatar = document.getElementById('navAvatar');
    const previewImg = document.getElementById('profilePreviewImg');

    // אם כבר יש למשתמש תמונה בנאב, נציג אותה ב-Preview
    if (navAvatar && navAvatar.src && !navAvatar.classList.contains('hidden')) {
        previewImg.src = navAvatar.src;
    } else {
        previewImg.src = DEFAULT_AVATAR; // אחרת נראה פלייסהולדר נקי
    }

    document.getElementById('avatarUrlInput').value = '';
    document.getElementById('profileModal').classList.remove('hidden');
}

// עדכון ה-Preview ברגע שמדביקים URL
document.getElementById('avatarUrlInput').addEventListener('input', (e) => {
    const url = e.target.value.trim();
    document.getElementById('profilePreviewImg').src = url || DEFAULT_AVATAR;
});

// עדכון ה-Preview כשבוחרים קובץ
document.getElementById('avatarFileInput').onchange = function (e) {
    const file = e.target.files[0];
    if (file) {
        if (file.size > 1024 * 1024) return alert("File too large (Max 1MB)");
        const reader = new FileReader();
        reader.onload = (ev) => {
            document.getElementById('profilePreviewImg').src = ev.target.result;
            document.getElementById('avatarUrlInput').value = '';
        };
        reader.readAsDataURL(file);
    }
};

// שמירה סופית מול השרת
document.getElementById('saveAvatarBtn').onclick = async () => {
    const btn = document.getElementById('saveAvatarBtn');
    const avatarData = document.getElementById('profilePreviewImg').src;

    if (!avatarData || avatarData.includes('placeholder')) {
        return alert("Please choose a picture first");
    }

    // נטרול הכפתור בזמן השליחה כדי למנוע כפילויות
    btn.disabled = true;
    btn.textContent = "Saving...";

    try {
        const res = await fetch('/api/users/avatar', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ avatar: avatarData })
        });

        if (res.ok) {
            // השרת עכשיו יחזיר תשובה מהירה מאוד
            alert("Profile Picture Updated Successfully!");
            window.location.reload();
        } else {
            const err = await res.json();
            alert("Failed to update: " + (err.error || "Unknown error"));
        }
    } catch (e) {
        console.error(e);
        alert("Server timeout - but don't worry, your image is being processed! Refresh in a few seconds.");
    } finally {
        btn.disabled = false;
        btn.textContent = "Save Changes";
    }
};

// פתיחת מודאל הלידרבורד
const leaderboardBtn = document.getElementById('leaderboardBtn');
if (leaderboardBtn) {
    leaderboardBtn.addEventListener('click', async () => {
        const modal = document.getElementById('leaderboardModal');
        const grid = document.getElementById('leaderboardGrid');

        modal.classList.remove('hidden');
        grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; padding: 40px; font-size: 1.2rem;">Calculating global rankings...</p>';

        try {
            const sortMethod = document.getElementById('leaderboardSortSelect') ? document.getElementById('leaderboardSortSelect').value : 'rating';
            const res = await fetch(`/api/leaderboard?sort=${sortMethod}`);
            const data = await res.json();

            grid.innerHTML = '';

            if (data.length === 0) {
                grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #888;">No characters ranked yet.</p>';
                return;
            }

            data.forEach((item, index) => {
                const div = document.createElement('div');
                div.className = 'char-card';

                // עיצוב כתר לטופ 3
                let rankClass = 'rank-other';
                if (index === 0) rankClass = 'rank-1';
                else if (index === 1) rankClass = 'rank-2';
                else if (index === 2) rankClass = 'rank-3';

                // מעגלים את הציון למיקום אחד אחרי הנקודה (למשל 9.4)
                const formattedScore = item.avgRating.toFixed(1);

                div.innerHTML = `
                    <div class="rank-badge ${rankClass}">#${index + 1}</div>
                    <div class="char-rating" style="background: rgba(0,0,0,0.85);">${formattedScore}/10</div>
                    <img src="${item.image || 'https://via.placeholder.com/200'}" class="char-img">
                    <div class="char-info" style="padding: 12px; text-align: center;">
                        <div class="char-name" style="font-size: 1rem;">${item.characterName}</div>
                        <div class="source-title" style="margin-bottom: 5px; font-size: 0.8rem;">${item.sourceTitle}</div>
                        <div style="font-size: 0.75rem; color: var(--accent); background: rgba(187, 134, 252, 0.1); padding: 4px; border-radius: 4px; display: inline-block; width: 100%;">
                            <i class="fas fa-users"></i> Ranked by ${item.rankedByCount}
                        </div>
                    </div>
                `;
                grid.appendChild(div);
            });

        } catch (e) {
            console.error("Leaderboard error:", e);
            grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: red;">Failed to load leaderboard.</p>';
        }
    });
}

// --- פונקציות עריכת לידרבורד לאדמין ---

window.openGlobalEdit = function (id, name, source, type, img) {
    document.getElementById('adminEditCharId').value = id;
    document.getElementById('adminEditCharName').value = name;
    document.getElementById('adminEditCharSource').value = source;
    document.getElementById('adminEditCharType').value = type;
    document.getElementById('adminEditCharImage').value = img;

    // ניקוי אוטומטי של צ'קבוקס ההסתרה בכל פתיחה
    document.getElementById('adminEditIsHidden').checked = false;

    document.getElementById('adminCharEditModal').classList.remove('hidden');
};

window.saveGlobalCharacter = async function () {
    const id = document.getElementById('adminEditCharId').value;
    const name = document.getElementById('adminEditCharName').value;
    const source = document.getElementById('adminEditCharSource').value;
    const type = document.getElementById('adminEditCharType').value;
    const img = document.getElementById('adminEditCharImage').value;
    const isHidden = document.getElementById('adminEditIsHidden').checked;

    if (!name || !source) return alert("Name and Source are required");

    try {
        const res = await fetch('/api/admin/character/global-edit', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldCharId: id, characterName: name, sourceTitle: source, sourceType: type, image: img, isHidden: isHidden })
        });

        if (res.ok) {
            alert("Leaderboard display updated successfully!");
            document.getElementById('adminCharEditModal').classList.add('hidden');
            loadLeaderboard();
        } else {
            alert("Error saving character.");
        }
    } catch (e) {
        console.error(e);
        alert("Server Error");
    }
};

// --- סגירת מודאלים בלחיצה על הרקע (מחוץ לחלון) ---
window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.classList.add('hidden');
        e.target.style.display = 'none'; // <--- סגירה מוחלטת

        if (e.target.id === 'adminModal' && typeof logsAutoRefreshInterval !== 'undefined' && logsAutoRefreshInterval) {
            clearInterval(logsAutoRefreshInterval);
            logsAutoRefreshInterval = null;
        }
    }
});

window.openCommModalFromLanding = function () {
    const modal = document.getElementById('communityModal');
    if (modal) {
        modal.classList.remove('hidden');
        // מוודא שהטאבים והחיפוש מוצגים נכון
        const tabs = document.getElementById('commTabsContainer');
        const backBtn = document.getElementById('commBackBtn');
        if (tabs) tabs.classList.remove('hidden');
        if (backBtn) backBtn.classList.add('hidden');

        // טוען את המשתמשים
        if (typeof switchCommTab === 'function') {
            switchCommTab('users');
        }
    }
};

window.forceOpenTab = function (tabName) {
    const modal = document.getElementById('communityModal');
    if (modal) {
        modal.style.display = 'flex';
        modal.classList.remove('hidden');
    }

    currentCommTab = tabName;

    if (typeof switchCommTab === 'function') {
        switchCommTab(tabName);
    }
};

window.openQuickAddSelector = async function (apiId, name, source, type, image) {
    const modal = document.getElementById('quickAddModal');
    if (modal) modal.style.display = 'flex';
    const optionsContainer = document.getElementById('quickAddListOptions');
    const charNameLabel = document.getElementById('quickAddCharName');

    charNameLabel.textContent = name;
    optionsContainer.innerHTML = '<p style="text-align:center; color:#888;">Loading your lists...</p>';
    modal.classList.remove('hidden');

    try {
        const res = await fetch('/api/lists');
        const lists = await res.json();

        if (lists.length === 0) {
            optionsContainer.innerHTML = '<p style="text-align:center; padding:10px;">You have no lists! Create one first.</p>';
            return;
        }

        optionsContainer.innerHTML = '';
        lists.forEach(list => {
            const btn = document.createElement('div');
            btn.className = 'quick-add-option';
            const lockIcon = list.isPrivate ? 'fa-lock' : 'fa-list';

            btn.innerHTML = `
                <i class="fas ${lockIcon}"></i>
                <span style="flex:1;">${list.name}</span>
                <small style="color:#777;">${list.items.length} items</small>
            `;

            btn.onclick = () => {
                // 1. מעדכנים את ה-ID הפעיל לליסט שנבחר (כדי שהשמירה תדע לאן ללכת)
                state.activeListId = list._id;

                // 2. מעדכנים את הסיידבאר והכותרת (רק אם אנחנו בדף הבית)
                if (typeof renderSidebar === 'function') renderSidebar();
                if (typeof renderCurrentList === 'function') {
                    // עדכון כותרת זמני כדי שהמשתמש יראה לאיזה ליסט הוא מוסיף
                    const titleEl = document.getElementById('currentListTitle');
                    if (titleEl) titleEl.textContent = list.name;
                }

                // 3. מכינים אובייקט דמוי "תוצאת חיפוש" עבור המודאל של הדמות
                const tempItem = {
                    id: apiId,
                    title: name,
                    image: image,
                    type: type, // למשל 'character' או 'game_character'
                    sourceTitle: source
                };

                // 4. סוגרים את מודאל בחירת הליסט ופותחים את מודאל עריכת הדמות
                modal.classList.add('hidden'); // סוגר את חלון בחירת הליסט

                // אנחנו מנסים לסגור את שני המזהים האפשריים (לידרבורד או קומיוניטי)
                ['leaderboardModal', 'communityModal'].forEach(id => {
                    const m = document.getElementById(id);
                    if (m) {
                        m.classList.add('hidden');
                        m.style.display = 'none'; // מכריח סגירה גם אם ה-CSS מתנגד
                    }
                });

                // פתיחת מודאל הדמות
                if (typeof openCharModal === 'function') {
                    openCharModal(tempItem);
                } else {
                    window.location.href = `/?id=${list._id}`;
                }

            };
            optionsContainer.appendChild(btn);
        });

    } catch (e) {
        optionsContainer.innerHTML = '<p style="color:red; text-align:center;">Please login to add characters.</p>';
    }
};

// בדיקה אם המשתמש הגיע מ-Quick Add מדף אחר
// בדיקה אם המשתמש הגיע מ-Quick Add מדף אחר (גרסה מתוקנת)
const urlParamsForQuickAdd = new URLSearchParams(window.location.search);
const quickAddAction = urlParamsForQuickAdd.get('action');
const pendingData = sessionStorage.getItem('pendingQuickAdd');

if (quickAddAction === 'quickAdd' && pendingData) {
    try {
        const data = JSON.parse(pendingData);
        sessionStorage.removeItem('pendingQuickAdd'); // מנקים מיד

        // הגדרת הליסט הפעיל לזה שנבחר ב-Quick Add
        if (data.targetListId) {
            state.activeListId = data.targetListId;
        }

        // מייצרים אובייקט דמוי תוצאת חיפוש עבור המודאל
        const tempItem = {
            id: data.apiId,
            title: data.name,
            image: data.image,
            type: data.type,
            sourceTitle: data.source
        };

        // פותחים את מודאל העריכה - נותנים לטעינת הרשימות שנייה לסיים
        setTimeout(() => {
            if (typeof openCharModal === 'function') {
                openCharModal(tempItem);
            }
        }, 500);

    } catch (e) {
        console.error("Quick Add Parse Error", e);
    }
}


init();
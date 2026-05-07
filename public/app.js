let state = {
    user: null, lists: [], activeListId: null, tempSearchItem: null, editingIndex: -1, pendingDeleteIndex: null, pendingDeleteIndex: null,
    pendingDeleteListId: null, isReordering: false, isRenamingList: false
};

let logsAutoRefreshInterval = null;
let visibleNotifsLimit = 5;
let currentNotifsData = [];

async function init() {
    await checkLoginStatus();
    setupEvents();
}

async function checkLoginStatus() {
    // אלמנטים של הנאב-בר
    const userChip = document.getElementById('userDisplay');
    const nameLabel = document.getElementById('usernameLabel');
    const authBtn = document.getElementById('authBtnNav');
    const adminBtn = document.getElementById('adminBtn');
    const menuBtn = document.getElementById('mobileMenuBtn');


    // אלמנטים של מבנה הדף
    const createBtn = document.getElementById('createListBtn');
    const listHeader = document.querySelector('.list-header');

    try {
        const res = await fetch('/api/auth/check');
        if (res.ok) {
            const data = await res.json();
            state.user = data.username;
            if (menuBtn) menuBtn.classList.remove('hidden'); // מציג כפתור אם מחובר

            // --- 1. רישום כניסה לאתר (לוג סשן - פעם אחת) ---
            if (!sessionStorage.getItem('entryLogged')) {
                fetch('/api/auth/ping', { method: 'POST' });
                sessionStorage.setItem('entryLogged', 'true');
            }

            // --- 2. עדכון תצוגת משתמש (User Icon + Name) ---
            if (nameLabel) nameLabel.textContent = data.username;
            if (userChip) userChip.classList.remove('hidden');

            // שינוי כפתור ל-"Logout"
            if (authBtn) {
                authBtn.textContent = "Logout";
                authBtn.style.display = 'inline-block';
            }

            // הצגת כפתור אדמין אם המשתמש הוא אדמין
            if (data.role === 'admin' && adminBtn) {
                adminBtn.classList.remove('hidden');
            }

            // הצגת מבנה האתר (סרגל צד וכותרת)
            if (document.querySelector('.sidebar')) document.querySelector('.sidebar').style.display = 'flex';
            if (createBtn) createBtn.style.display = 'block';
            if (listHeader) listHeader.style.display = 'flex';

            if (document.getElementById('notifArea')) {
                document.getElementById('notifArea').classList.remove('hidden');
            }

            // --- 3. הפעלת מערכות נתונים ---
            fetchNotifications(); // טעינת התראות ראשונה
            setInterval(fetchNotifications, 30000); // בדיקה כל 30 שניות

            fetchLists(); // טעינת הרשימות של המשתמש

        } else {
            // במקרה שהמשתמש מנותק
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
    const menuBtn = document.getElementById('mobileMenuBtn');
    if (menuBtn) menuBtn.classList.add('hidden');

    // --- מצב מנותק ---
    document.getElementById('userDisplay').style.display = 'none'; // מעלים את ה-"Hi"
    authBtn.textContent = "Login"; // מוודא שכתוב לוגין
    authBtn.style.display = 'inline-block'; // משאיר את הכפתור גלוי וזמין ללחיצה!

    // מסתיר את שאר האתר
    document.querySelector('.sidebar').style.display = 'none';
    document.querySelector('.list-header').style.display = 'none';
    document.getElementById('listNav').innerHTML = '';

    // מסך הפתיחה
    let title = "Welcome";
    let text = "Please log in.";
    try {
        const res = await fetch('/api/settings/welcome');
        const data = await res.json();
        title = data.welcomeTitle;
        text = data.welcomeText.replace(/\n/g, '<br>');
    } catch (e) { }

    if (document.getElementById('notifArea')) {
        document.getElementById('notifArea').classList.add('hidden');
    }

    document.getElementById('characterGrid').innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px; max-width: 600px; margin: 40px auto; background: var(--card-bg); border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); border: 1px solid var(--border);">
            <i class="fas fa-star" style="font-size: 4rem; color: var(--accent); margin-bottom: 20px;"></i>
            <h2 style="margin-bottom: 15px; font-size: 2.2rem; color: var(--text-main);">${title}</h2>
            <p style="color: var(--text-muted); margin-bottom: 30px; font-size: 1.1rem; line-height: 1.6;">${text}</p>
            <button onclick="document.getElementById('authModal').classList.remove('hidden')" class="btn-primary" style="width: auto; padding: 12px 30px; font-size: 1.1rem; border-radius: 30px;">
                <i class="fas fa-sign-in-alt" style="margin-right: 8px;"></i> Login or Register to Start
            </button>
        </div>
    `;
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
    if (!state.user) return;
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

    // מונה התראות שלא נקראו
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

    // חיתוך המערך לפי המגבלה (5, 10 וכו')
    const notifsToShow = currentNotifsData.slice(0, visibleNotifsLimit);

    notifsToShow.forEach(n => {
        const div = document.createElement('div');
        div.style = `padding: 12px; border-bottom: 1px solid var(--border); font-size: 0.85rem; cursor: pointer; background: ${n.read ? 'transparent' : 'rgba(187, 134, 252, 0.05)'}`;
        const msg = n.type === 'like' ? `<b>${n.fromUser}</b> liked your list` : `<b>${n.fromUser}</b> commented`;
        div.innerHTML = `<div>${msg}: <b>${n.listName}</b></div><div style="font-size:0.7rem; color:#666; margin-top:4px;">${new Date(n.timestamp).toLocaleString('he-IL')}</div>`;
        div.onclick = () => window.location.href = `/share.html?id=${n.listId}`;
        dropdown.appendChild(div);
    });

    if (currentNotifsData.length > visibleNotifsLimit) {
        const loadMoreDiv = document.createElement('div');
        loadMoreDiv.style = "padding: 10px; text-align: center; color: var(--accent); cursor: pointer; font-size: 0.8rem; font-weight: bold;";
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
    if (state.lists.length > 0 && !state.activeListId) state.activeListId = state.lists[0]._id;
    renderSidebar();
    renderCurrentList();
}

async function createList(name) {
    const rType = document.getElementById('rankingTypeSelect').value;
    const isPrivate = document.getElementById('isPrivateInput').checked;
    const isFreeOrder = document.getElementById('isFreeOrderInput').checked;


    const res = await fetch('/api/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, rankingType: rType, isPrivate, isFreeOrder: isFreeOrder, items: [] })
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

window.selectList = function (id) {
    state.activeListId = id;
    renderSidebar();
    renderCurrentList();
    if (window.innerWidth <= 768) closeMobileMenu();
}

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
    const header = document.querySelector('.list-header'); // תופסים את כל שורת הפקדים
    grid.innerHTML = '';

    // --- מצב שבו המשתמש מחובר אבל אין לו אף רשימה ---
    if (state.user && state.lists.length === 0) {
        if (header) header.style.display = 'none'; // העלמת כל שורת הכלים (חיפוש, פילטר, כפתורים)

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
    if (!list) {
        if (header) header.style.display = 'none'; // אם מסיבה כלשהי אין ליסט פעיל, נסתיר את ההדר
        return;
    }

    // הצגת ההדר חזרה כשיש ליסט
    if (header) header.style.display = 'flex';

    document.getElementById('currentListTitle').textContent = list.name;
    const editTitleBtn = document.getElementById('editListTitleBtn');
    if (editTitleBtn) editTitleBtn.classList.remove('hidden');

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

        div.innerHTML = `
            <div class="rank-badge ${rankClass}">#${index + 1}</div>
            ${ratingHtml}
            <img src="${item.image}" class="char-img">
            <div class="char-info">
                <div class="char-name">${item.characterName}</div>
                <div class="source-row">
                    <span class="source-title" title="${item.sourceTitle}">${item.sourceTitle}</span>
                    <span class="red-type">${item.sourceType === 'TV Show' ? 'TV' : item.sourceType}</span>
                </div>
                <div class="card-actions">
                    <button class="icon-btn edit-btn" onclick="editItem(${item.originalIndex})"><i class="fas fa-edit"></i></button>
                    <button class="icon-btn delete-btn" onclick="removeItem(${item.originalIndex})"><i class="fas fa-trash"></i></button>
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
document.getElementById('listFilterInput').addEventListener('input', renderCurrentList);
document.getElementById('filterSelect').addEventListener('change', renderCurrentList);

window.editItem = function (index) {
    const list = state.lists.find(l => l._id === state.activeListId);
    const item = list.items[index];
    const isLetters = list.rankingType === 'letters';

    state.editingIndex = index;

    document.getElementById('modalImg').src = item.image;
    document.getElementById('charNameInput').value = item.characterName;
    document.getElementById('customImgInput').value = item.image;
    document.getElementById('ratingInput').value = item.rating;


    document.getElementById('sourceTitleInput').value = item.sourceTitle;
    document.getElementById('sourceTypeInput').value = normalizeType(item.sourceType);

    document.getElementById('castSelector').innerHTML = '';
    document.getElementById('saveCharBtn').textContent = "Update Character";
    document.getElementById('charModal').classList.remove('hidden');

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
    state.tempSearchItem = item;
    state.editingIndex = -1;
    document.getElementById('searchResults').classList.add('hidden');
    document.getElementById('searchInput').value = '';

    document.getElementById('modalImg').src = item.image || 'https://via.placeholder.com/200';
    document.getElementById('customImgInput').value = '';
    document.getElementById('ratingInput').value = 5;
    document.getElementById('saveCharBtn').textContent = "Add to List";

    if (item.type === 'character' || item.type === 'game_character') {
        document.getElementById('charNameInput').value = item.title;
    } else {
        document.getElementById('charNameInput').value = '';
    }

    const list = state.lists.find(l => l._id === state.activeListId);
    const isLetters = list && list.rankingType === 'letters';

    const numInput = document.getElementById('ratingInput');
    const letInput = document.getElementById('ratingLetterInput');
    const titleInput = document.getElementById('sourceTitleInput');
    const typeInput = document.getElementById('sourceTypeInput');
    const castDiv = document.getElementById('castSelector');
    castDiv.innerHTML = '';

    if (isLetters) {
        numInput.classList.add('hidden');
        letInput.classList.remove('hidden');
        // If editing, set the value
        letInput.value = (item && item.rating) ? item.rating : "10";
    } else {
        numInput.classList.remove('hidden');
        letInput.classList.add('hidden');
        numInput.value = (item && item.rating) ? item.rating : 5;
    }

    if (item.type === 'character') {
        titleInput.value = "Fetching info...";
        typeInput.value = 'Anime';
        try {
            const res = await fetch(`/api/jikan/details/${item.id}`);
            const data = await res.json();
            titleInput.value = data.sourceTitle || "";
            typeInput.value = data.sourceType || "Anime";
        } catch (e) { titleInput.value = ""; }
    }
    else if (item.type === 'game_character') {
        titleInput.value = "Fetching game...";
        typeInput.value = 'Game';

        try {
            const res = await fetch(`/api/igdb/details/${item.id}`);
            const data = await res.json();
            titleInput.value = data.sourceTitle || "";
        } catch (e) {
            titleInput.value = "";
            titleInput.placeholder = "Type game name...";
        }
    }

    else if (item.type === 'wiki_character') {
        document.getElementById('charNameInput').value = item.title;

        if (item.sourceTitle && item.sourceTitle.length > 0) {
            document.getElementById('sourceTitleInput').value = item.sourceTitle;
        } else {
            document.getElementById('sourceTitleInput').value = "";
            document.getElementById('sourceTitleInput').placeholder = "Type Source (e.g. Breaking Bad)";
        }
        document.getElementById('sourceTypeInput').value = "TV Show";
    }

    else {
        titleInput.value = item.title;
        typeInput.value = normalizeType(item.type);
    }

    if (item.type === 'movie' || item.type === 'tv') {
        castDiv.innerHTML = '<p>Loading Cast...</p>';
        try {
            const res = await fetch(`/api/tmdb/credits?type=${item.type}&id=${item.id}`);
            const cast = await res.json();
            if (cast.length > 0) {
                castDiv.innerHTML = '<p>Select Character:</p><div class="cast-grid"></div>';
                const grid = castDiv.querySelector('.cast-grid');
                cast.forEach(c => {
                    if (!c.image) return;
                    const img = document.createElement('img');
                    img.src = c.image;
                    img.title = c.characterName;
                    img.onclick = () => {
                        document.getElementById('charNameInput').value = c.characterName;
                        document.getElementById('modalImg').src = c.image;
                        document.getElementById('customImgInput').value = c.image;
                    };
                    grid.appendChild(img);
                });
            } else { castDiv.innerHTML = ''; }
        } catch (e) { castDiv.innerHTML = ''; }
    }

    document.getElementById('charModal').classList.remove('hidden');
}

function openCustomCharModal() {
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

    const list = state.lists.find(l => l._id === state.activeListId);
    const isLetters = list && list.rankingType === 'letters';

    if (isLetters) {
        document.getElementById('ratingInput').classList.add('hidden');
        document.getElementById('ratingLetterInput').classList.remove('hidden');
        document.getElementById('ratingLetterInput').value = "10";
    } else {
        document.getElementById('ratingInput').classList.remove('hidden');
        document.getElementById('ratingLetterInput').classList.add('hidden');
        document.getElementById('ratingInput').value = 5;
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
    if (!sourceTitle) return alert("Source Title required");

    const list = state.lists.find(l => l._id === state.activeListId);
    const isLetters = list.rankingType === 'letters';

    let ratingVal;
    if (isLetters) {
        ratingVal = parseInt(document.getElementById('ratingLetterInput').value);
    } else {
        ratingVal = parseFloat(document.getElementById('ratingInput').value);
    }

    let finalImage = customImg || state.tempSearchItem?.image || 'https://via.placeholder.com/200x300';

    const actionType = state.editingIndex > -1 ? "Edit Character" : "Add Character";
    const charDetails = `${name} (Source: ${sourceTitle})`;

    const itemData = {
        characterName: name,
        sourceTitle: sourceTitle,
        sourceType: sourceType,
        rating: ratingVal,
        image: finalImage
    };

    if (state.editingIndex > -1) {
        Object.assign(list.items[state.editingIndex], itemData);
        state.editingIndex = -1;
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
document.getElementById('authBtnNav').addEventListener('click', async () => {
    if (state.user) {
        await fetch('/api/auth/logout', { method: 'POST' });

        sessionStorage.removeItem('entryLogged');

        window.location.reload();
    }
    else {
        document.getElementById('authModal').classList.remove('hidden');
    }
});

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
    const t = document.getElementById('authTitle'), b = document.getElementById('authSubmitBtn'), s = document.getElementById('authSwitch');
    t.textContent = isRegisterMode ? "Register" : "Login"; b.textContent = isRegisterMode ? "Register" : "Login";
    s.textContent = isRegisterMode ? "Have an account? Login." : "Need an account? Register.";
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
});

document.getElementById('editListTitleBtn').addEventListener('click', () => {
    const list = state.lists.find(l => l._id === state.activeListId);
    if (!list) return;

    state.isRenamingList = true;

    document.getElementById('listModalTitle').textContent = "List Settings";
    document.getElementById('newListName').value = list.name;
    document.getElementById('isPrivateInput').checked = list.isPrivate || false;
    document.getElementById('isFreeOrderInput').checked = list.isFreeOrder || false;
    document.getElementById('rankingTypeSelect').value = list.rankingType || 'numbers';
    document.getElementById('rankingTypeSelect').disabled = false;

    document.getElementById('duplicateListBtn').classList.remove('hidden');
    document.getElementById('saveListBtn').textContent = "Save Changes";
    document.getElementById('listModal').classList.remove('hidden');
});

document.getElementById('saveListBtn').addEventListener('click', async () => {
    try {
        const name = document.getElementById('newListName').value;
        const rType = document.getElementById('rankingTypeSelect').value;
        const isPrivate = document.getElementById('isPrivateInput').checked;
        const isFreeOrder = document.getElementById('isFreeOrderInput').checked;

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
    document.getElementById('themeToggle').onclick = () => {
        document.body.classList.toggle('light-theme');
    };

    document.getElementById('reorderBtn').addEventListener('click', toggleReorderMode);
    document.getElementById('saveOrderBtn').addEventListener('click', saveOrder);
    document.getElementById('addCustomCharBtn').addEventListener('click', openCustomCharModal);

    document.getElementById('refreshLogsBtn').addEventListener('click', () => {
        loadAdminLogs(false);
    });

    // --- לוגיקת המובייל המדויקת ---
    const menuBtn = document.getElementById('mobileMenuBtn');
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('mobileOverlay');

    if (menuBtn) {
        menuBtn.onclick = (e) => {
            e.stopPropagation(); // מונע בעיות של אירועים כפולים
            sidebar.classList.add('open');
            overlay.classList.remove('hidden');
        };
    }

    if (overlay) {
        overlay.onclick = () => {
            sidebar.classList.remove('open');
            overlay.classList.add('hidden');
        };
    }
}

// תחליף את פונקציית הבחירה כדי שהתפריט ייסגר מיד אחרי שלחצת על ליסט בטלפון
window.selectList = function (id) {
    state.activeListId = id;
    renderSidebar();
    renderCurrentList();

    // סגירה אוטומטית של תפריט צד במובייל לאחר בחירת רשימה
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('mobileOverlay');
    if (window.innerWidth <= 768) {
        if (sidebar) sidebar.classList.remove('open');
        if (overlay) overlay.classList.add('hidden');
    }
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


let commState = { view: 'all', search: '' };

document.getElementById('communityBtn').addEventListener('click', () => {
    commState = { view: 'all', search: '' };
    document.getElementById('userSearchInput').value = '';
    loadCommunityUsers();
});

document.getElementById('commBackBtn').addEventListener('click', loadCommunityUsers);


// Search Listener (Debounced)
let userSearchDebounce;
document.getElementById('userSearchInput').addEventListener('input', (e) => {
    clearTimeout(userSearchDebounce);
    userSearchDebounce = setTimeout(() => {
        commState.search = e.target.value;
        loadCommunityUsers();
    }, 500);
});

function switchCommTab(view) {
    commState.view = view;

    const btnAll = document.getElementById('tabAllUsers');
    const btnSaved = document.getElementById('tabSavedUsers');

    if (view === 'all') {
        btnAll.classList.add('active-tab');
        btnAll.classList.remove('inactive-tab');

        btnSaved.classList.remove('active-tab');
        btnSaved.classList.add('inactive-tab');
    } else {
        btnAll.classList.remove('active-tab');
        btnAll.classList.add('inactive-tab');

        btnSaved.classList.add('active-tab');
        btnSaved.classList.remove('inactive-tab');
    }

    document.getElementById('userSearchInput').value = '';
    commState.search = '';

    loadCommunityUsers();
}


async function loadCommunityUsers() {
    const grid = document.getElementById('communityGrid');
    const controls = document.getElementById('commControls');
    const backBtn = document.getElementById('commBackBtn');
    const title = document.getElementById('communityTitle');

    document.getElementById('communityModal').classList.remove('hidden');
    controls.classList.remove('hidden');
    backBtn.classList.add('hidden');
    title.textContent = "Community";

    grid.innerHTML = '<p style="text-align:center; grid-column: 1/-1;">Loading...</p>';

    try {
        // שולחים בקשה רגילה, השרת כבר ימיין ויסנן עבורנו
        const res = await fetch(`/api/users?search=${commState.search}`);
        const users = await res.json();

        grid.innerHTML = '';
        if (users.length === 0) {
            grid.innerHTML = '<p style="grid-column: 1/-1; text-align:center; color: var(--text-muted);">No users with public lists found.</p>';
            return;
        }

        users.forEach(u => {
            const div = document.createElement('div');
            div.className = 'user-card';

            let starHtml = '';
            if (state.user) {
                const starClass = u.isFollowing ? 'fas fa-star active' : 'far fa-star';
                starHtml = `
                    <button class="follow-btn" onclick="toggleFollow(event, '${u._id}')">
                        <i class="${starClass}"></i>
                    </button>
                `;
            }

            div.innerHTML = `
                ${starHtml}
                <i class="fas fa-user-circle user-icon"></i>
                <div title="${u.username}">${u.username}</div>
            `;

            div.onclick = (e) => {
                if (!e.target.closest('.follow-btn')) showUserLists(u._id, u.username);
            };

            grid.appendChild(div);
        });

    } catch (e) {
        console.error(e);
        grid.innerHTML = '<p style="text-align:center; grid-column: 1/-1;">Error loading users.</p>';
    }
}

// Toggle Follow
window.toggleFollow = async function (e, userId) {
    e.stopPropagation();
    const btn = e.currentTarget.querySelector('i');

    // שינוי ויזואלי מהיר
    const wasFollowing = btn.classList.contains('fas');
    btn.className = wasFollowing ? 'far fa-star' : 'fas fa-star active';

    try {
        await fetch(`/api/users/follow/${userId}`, { method: 'POST' });

        // רענון הרשימה כדי שהמיון (מעקב למעלה) יתעדכן
        loadCommunityUsers();
    } catch (err) {
        console.error("Follow error", err);
    }
}

async function showUserLists(userId, username) {
    const grid = document.getElementById('communityGrid');
    const controls = document.getElementById('commControls');
    const backBtn = document.getElementById('commBackBtn');
    const title = document.getElementById('communityTitle');

    controls.classList.add('hidden'); // Hide Search/Tabs
    backBtn.classList.remove('hidden');
    title.textContent = `${username}'s Lists`;
    grid.innerHTML = '<p>Loading lists...</p>';

    try {
        const res = await fetch(`/api/users/${userId}/lists`);
        const lists = await res.json();
        grid.innerHTML = '';

        if (lists.length === 0) {
            grid.innerHTML = '<p style="grid-column: 1/-1; text-align:center;">No public lists.</p>';
            return;
        }

        lists.forEach(list => {
            const div = document.createElement('div');
            div.className = 'comm-list-card';
            div.innerHTML = `
                <h4 style="color:var(--accent);">${list.name}</h4>
                <p style="color:var(--text-muted);">${list.items.length} items</p>
            `;
            div.onclick = () => window.open(`/share.html?id=${list._id}`, '_blank');
            grid.appendChild(div);
        });
    } catch (e) { grid.innerHTML = '<p>Error.</p>'; }
}

function getRatingDisplay(rating, type) {
    if (rating === 0) return 'No Grade'
    if (type !== 'letters') return rating + '/10';

    if (rating >= 13) return 'SSS';
    if (rating >= 12) return 'SS';
    if (rating >= 11) return 'S';
    if (rating >= 10) return 'A';
    if (rating >= 9) return 'B';
    if (rating >= 8) return 'C';
    if (rating >= 7) return 'D';
    if (rating >= 6) return 'E';
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
    adminBtn.addEventListener('click', async () => {
        document.getElementById('adminModal').classList.remove('hidden');
        switchAdminTab('settings');

        // טעינת טקסט נוכחי
        const res = await fetch('/api/settings/welcome');
        const data = await res.json();
        document.getElementById('adminWelcomeTitle').value = data.welcomeTitle || '';
        document.getElementById('adminWelcomeText').value = data.welcomeText || '';
    });
}

document.getElementById('adminSaveSettingsBtn').addEventListener('click', async () => {
    const title = document.getElementById('adminWelcomeTitle').value;
    const text = document.getElementById('adminWelcomeText').value;
    await fetch('/api/admin/settings/welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, text })
    });
    alert("Welcome screen updated!");
});

// --- ADMIN LOGIC ---

// (הקוד של כפתור השמירה של ה-Settings נשאר אותו דבר, מתחילים לעדכן מהטאבים:)

document.getElementById('adminTabSettings').onclick = () => switchAdminTab('settings');
document.getElementById('adminTabUsers').onclick = () => switchAdminTab('users');
// הוספת חזרה לרשימת המשתמשים
document.getElementById('adminBackToUsersBtn').onclick = () => switchAdminTab('users');
document.getElementById('adminTabLogs').onclick = () => switchAdminTab('logs');


function switchAdminTab(tab) {
    document.getElementById('adminSettingsSection').classList.add('hidden');
    document.getElementById('adminUsersSection').classList.add('hidden');
    document.getElementById('adminListsSection').classList.add('hidden');
    document.getElementById('adminLogsSection').classList.add('hidden');

    document.getElementById('adminTabSettings').className = 'btn-primary inactive-tab';
    document.getElementById('adminTabUsers').className = 'btn-primary inactive-tab';
    document.getElementById('adminTabLogs').className = 'btn-primary inactive-tab';

    if (logsAutoRefreshInterval) {
        clearInterval(logsAutoRefreshInterval);
        logsAutoRefreshInterval = null;
    }

    if (tab === 'settings') {
        document.getElementById('adminSettingsSection').classList.remove('hidden');
        document.getElementById('adminTabSettings').className = 'btn-primary active-tab';
    } else if (tab === 'users') {
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

    // מציגים Loading רק אם זה לא רענון שקט
    if (!silent) {
        list.innerHTML = '<div style="text-align:center; padding:20px;">Updating...</div>';
    }

    try {
        const res = await fetch('/api/admin/logs');
        const logs = await res.json();

        // יצירת ה-HTML של כל הלוגים
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
    // 1. מעבר תצוגה בסשן האדמין
    const adminUsersSection = document.getElementById('adminUsersSection');
    const adminListsSection = document.getElementById('adminListsSection');
    const adminUserListsTitle = document.getElementById('adminUserListsTitle');
    const grid = document.getElementById('adminListsGrid');

    if (adminUsersSection) adminUsersSection.classList.add('hidden');
    if (adminListsSection) adminListsSection.classList.remove('hidden');
    if (adminUserListsTitle) adminUserListsTitle.textContent = `Lists owned by: ${username}`;

    // 2. ניקוי הגריד והצגת Loading
    grid.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted);">Fetching lists...</div>';

    try {
        const res = await fetch(`/api/admin/users/${userId}/lists`);

        if (!res.ok) throw new Error("Failed to fetch lists");

        const lists = await res.json();

        // 3. ניקוי ה-Loading
        grid.innerHTML = '';

        if (!lists || lists.length === 0) {
            grid.innerHTML = '<p style="padding:20px; color:#888;">This user has no lists yet.</p>';
            return;
        }

        // 4. רינדור הליסטים
        lists.forEach(l => {
            const div = document.createElement('div');
            // עיצוב שורה לכל ליסט באדמין
            div.style = "display:flex; justify-content:space-between; align-items:center; padding:12px; background:var(--card-bg); border:1px solid var(--border); border-radius:8px; margin-bottom:8px;";

            const privacyIcon = l.isPrivate ? '<i class="fas fa-lock" style="margin-right:8px; font-size:0.8rem; color:#888;"></i>' : '';
            const itemsCount = l.items ? l.items.length : 0;

            div.innerHTML = `
                <div>
                    ${privacyIcon}<strong style="color:var(--accent);">${l.name}</strong> 
                    <span style="font-size:0.8rem; color:var(--text-muted); margin-left:10px;">(${itemsCount} characters)</span>
                </div>
                <div style="display:flex; gap:8px;">
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
    // שואל את האדמין לסיסמה החדשה
    const newPass = prompt("Enter new password for this user (Min 3 characters):");
    if (!newPass) return; // אם לחץ ביטול או השאיר ריק

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



init();
let state = {
    user: null, lists: [], activeListId: null, tempSearchItem: null, editingIndex: -1, pendingDeleteIndex: null, pendingDeleteIndex: null,
    pendingDeleteListId: null, isReordering: false, isRenamingList: false
};

let logsAutoRefreshInterval = null;

async function init() {
    await checkLoginStatus();
    setupEvents();
}

async function checkLoginStatus() {
    const createBtn = document.getElementById('createListBtn');
    const listHeader = document.querySelector('.list-header');
    const adminBtn = document.getElementById('adminBtn');
    const authBtn = document.getElementById('authBtnNav');

    try {
        const res = await fetch('/api/auth/check');
        if (res.ok) {
            const data = await res.json();
            state.user = data.username;

            // --- מצב מחובר ---
            document.getElementById('userDisplay').textContent = `Hi, ${state.user}`;
            document.getElementById('userDisplay').style.display = 'inline'; // מציג את השם
            authBtn.textContent = "Logout"; // משנה טקסט להתנתקות

            document.querySelector('.sidebar').style.display = 'flex';
            createBtn.style.display = 'block';
            listHeader.style.display = 'flex';

            if (data.role === 'admin' && adminBtn) adminBtn.classList.remove('hidden');
            else if (adminBtn) adminBtn.classList.add('hidden');

            fetchLists();
        } else {
            if (adminBtn) adminBtn.classList.add('hidden');
            showLoggedOutState();
        }
    } catch (e) {
        showLoggedOutState();
    }
}

async function showLoggedOutState() {
    const authBtn = document.getElementById('authBtnNav');

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
    grid.innerHTML = '';
    const list = state.lists.find(l => l._id === state.activeListId);

    const editTitleBtn = document.getElementById('editListTitleBtn');
    if (!list) {
        if (editTitleBtn) editTitleBtn.classList.add('hidden');
        return;
    }
    if (editTitleBtn) editTitleBtn.classList.remove('hidden');
    document.getElementById('currentListTitle').textContent = list.name;

    const filterType = document.getElementById('filterSelect').value;

    let displayItems = list.items.map((item, index) => ({ ...item, originalIndex: index }));

    if (filterType !== 'all') {
        displayItems = displayItems.filter(item => item.sourceType === filterType);
    }

    if (!list.isFreeOrder) {
        displayItems.sort((a, b) => b.rating - a.rating);
    }

    if (displayItems.length === 0) {
        grid.innerHTML = '<p style="grid-column: 1/-1; text-align:center; color:#888;">No characters found for this category.</p>';
        return;
    }

    displayItems.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'char-card';
        div.dataset.index = item.originalIndex;

        let rankClass = 'rank-other';
        if (index === 0) rankClass = 'rank-1';
        if (index === 1) rankClass = 'rank-2';
        if (index === 2) rankClass = 'rank-3';

        const listType = list.rankingType || 'numbers';
        const displayRating = getRatingDisplay(item.rating, listType);
        const ratingHtml = item.rating === 0 ? '' : `<div class="char-rating">${displayRating}</div>`;


        let displayType = item.sourceType;
        if (displayType === 'TV Show') displayType = 'TV';

        div.innerHTML = `
            <div class="rank-badge ${rankClass}">#${index + 1}</div>
               ${ratingHtml}
            <img src="${item.image}" class="char-img">
            <div class="char-info">
                <div class="char-name">${item.characterName}</div>
                <div class="source-row">
                    <span class="source-title" title="${item.sourceTitle}">${item.sourceTitle}</span>
                    <span class="red-type">${displayType}</span>
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
    if (state.user) { await fetch('/api/auth/logout', { method: 'POST' }); window.location.reload(); }
    else { document.getElementById('authModal').classList.remove('hidden'); }
});

document.getElementById('authSubmitBtn').addEventListener('click', async () => {
    const u = document.getElementById('authUsername').value, p = document.getElementById('authPassword').value;
    const url = isRegisterMode ? '/api/auth/register' : '/api/auth/login';
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
    if (res.ok) { isRegisterMode ? (alert("Registered!"), isRegisterMode = false, updateAuthUI()) : window.location.reload(); }
    else { alert((await res.json()).error); }
});

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
        loadAdminLogs(false); // רענון ידני תמיד יראה "Loading"
    });


    const menuBtn = document.getElementById('mobileMenuBtn');
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('mobileOverlay');

    if (menuBtn) {
        menuBtn.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            overlay.classList.toggle('active');
        });
    }

    if (overlay) {
        overlay.addEventListener('click', closeMobileMenu);
    }
}

function closeMobileMenu() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('mobileOverlay');

    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
}

document.getElementById('filterSelect').addEventListener('change', renderCurrentList);


let commState = { view: 'all', search: '' };

document.getElementById('communityBtn').addEventListener('click', () => {
    commState = { view: 'all', search: '' };
    document.getElementById('userSearchInput').value = '';
    loadCommunityUsers();
});

document.getElementById('commBackBtn').addEventListener('click', loadCommunityUsers);

// Tabs
document.getElementById('tabAllUsers').addEventListener('click', () => switchCommTab('all'));
document.getElementById('tabSavedUsers').addEventListener('click', () => switchCommTab('saved'));

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
    const commTabs = document.getElementById('commTabs'); // תפסנו את הטאבים

    document.getElementById('communityModal').classList.remove('hidden');
    controls.classList.remove('hidden');
    backBtn.classList.add('hidden');
    title.textContent = commState.view === 'all' ? "Community Users" : "Following";

    // --- הסתרת הטאבים לאורחים ---
    if (!state.user) {
        commTabs.style.display = 'none';
    } else {
        commTabs.style.display = 'flex';
    }

    grid.innerHTML = '<p style="text-align:center;">Loading...</p>';

    try {
        const onlyFollowing = commState.view === 'saved';
        const res = await fetch(`/api/users?search=${commState.search}&onlyFollowing=${onlyFollowing}`);
        const users = await res.json();

        grid.innerHTML = '';
        if (users.length === 0) {
            grid.innerHTML = '<p style="grid-column: 1/-1; text-align:center;">No users found.</p>';
            return;
        }

        users.forEach(u => {
            if (u.isMe) return;

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
                <div style="font-weight:bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 5px;">${u.username}</div>
            `;

            div.onclick = (e) => {
                if (!e.target.closest('.follow-btn')) showUserLists(u._id, u.username);
            };

            grid.appendChild(div);
        });

    } catch (e) {
        console.error(e);
        grid.innerHTML = '<p style="text-align:center;">Error loading users.</p>';
    }
}

// Toggle Follow
window.toggleFollow = async function (e, userId) {
    e.stopPropagation(); // Don't open the user's lists
    const btn = e.currentTarget.querySelector('i');

    // UI Update immediately (Optimistic)
    const isFollowing = btn.classList.contains('fas');
    if (isFollowing) {
        btn.className = 'far fa-star'; // Unfollow visually
    } else {
        btn.className = 'fas fa-star active'; // Follow visually
    }

    try {
        await fetch(`/api/users/follow/${userId}`, { method: 'POST' });
        // If we are in "Following" tab and we unfollow, reload to remove item
        if (commState.view === 'saved' && isFollowing) {
            loadCommunityUsers();
        }
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
    // מחליף תצוגה מ"משתמשים" ל"רשימות"
    document.getElementById('adminUsersSection').classList.add('hidden');
    document.getElementById('adminListsSection').classList.remove('hidden');
    document.getElementById('adminUserListsTitle').textContent = `Lists owned by: ${username}`;

    const grid = document.getElementById('adminListsGrid');
    grid.innerHTML = 'Loading...';

    const res = await fetch(`/api/admin/users/${userId}/lists`);
    const lists = await res.json();
    grid.innerHTML = '';

    if (lists.length === 0) {
        grid.innerHTML = '<p>This user has no lists.</p>';
        return;
    }

    lists.forEach(l => {
        const div = document.createElement('div');
        div.style = "display:flex; justify-content:space-between; align-items:center; padding:10px; background:var(--bg-color); border:1px solid var(--border); border-radius:4px;";
        const privacyIcon = l.isPrivate ? "🔒 " : "";
        div.innerHTML = `
            <span>${privacyIcon}<strong>${l.name}</strong> (${l.items.length} items)</span>
            <div style="display:flex; gap:5px;">
                <button onclick="window.open('/share.html?id=${l._id}', '_blank')" class="btn-primary" style="width:auto; padding:5px 10px;">View</button>
                <button onclick="adminDeleteList('${l._id}', '${userId}', '${username}')" class="btn-primary" style="width:auto; padding:5px 10px; background:red;">Delete</button>
            </div>
        `;
        grid.appendChild(div);
    });
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
let state = {
    user: null, lists: [], activeListId: null, tempSearchItem: null, editingIndex: -1, pendingDeleteIndex: null, pendingDeleteIndex: null,
    pendingDeleteListId: null, isReordering: false, isRenamingList: false };

async function init() {
 await checkLoginStatus();
 setupEvents();
}

async function checkLoginStatus() {
    const createBtn = document.getElementById('createListBtn');

    try {
        const res = await fetch('/api/auth/check');
        if (res.ok) {
            const data = await res.json();
            state.user = data.username;
            document.getElementById('userDisplay').textContent = `Hi, ${state.user}`;
            document.getElementById('authBtnNav').textContent = "Logout";

            createBtn.style.display = 'block';

            fetchLists();
        } else {
            document.getElementById('authBtnNav').textContent = "Login";
            document.getElementById('characterGrid').innerHTML = '<p style="padding:20px; color:var(--text-main); text-align:center;">Please Login to view and manage lists.</p>';

            createBtn.style.display = 'none';
        }
    } catch (e) {
        console.error(e);
        createBtn.style.display = 'none';
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
 const res = await fetch('/api/lists', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: name, items: [] })
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


async function updateCurrentList() {
 const list = state.lists.find(l => l._id === state.activeListId);
 if (!list) return;
 await fetch('/api/lists', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(list)
 });
 renderCurrentList();
}

function renderSidebar() {
    const nav = document.getElementById('listNav');
    nav.innerHTML = '';
    state.lists.forEach(list => {
        const li = document.createElement('li');
        li.className = list._id === state.activeListId ? 'active' : '';
        li.innerHTML = `<span>${list.name}</span>`;

        li.onclick = () => {
            state.activeListId = list._id;
            renderSidebar();
            renderCurrentList();

            if (window.innerWidth <= 768) closeMobileMenu();
        };

        const delBtn = document.createElement('button');
        delBtn.className = 'delete-list-btn';
        delBtn.innerHTML = '<i class="fas fa-trash"></i>';
        delBtn.onclick = (e) => { e.stopPropagation(); deleteList(list._id); };
        delBtn.onclick = (e) => {
            e.stopPropagation();
            state.pendingDeleteListId = list._id; 
            document.getElementById('deleteListModal').classList.remove('hidden'); 
        };
        li.appendChild(delBtn);
        nav.appendChild(li);
 });
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
    await updateCurrentList();
    alert("Order Saved!");
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

    displayItems.sort((a, b) => b.rating - a.rating);

    if (displayItems.length === 0) {
        grid.innerHTML = '<p style="grid-column: 1/-1; text-align:center; color:#888;">No characters found.</p>';
        return;
    }

    displayItems.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'char-card';
        div.dataset.index = item.originalIndex; // Store real index for drag logic

        let rankClass = 'rank-other';
        if (index === 0) rankClass = 'rank-1';
        if (index === 1) rankClass = 'rank-2';
        if (index === 2) rankClass = 'rank-3';

        div.innerHTML = `
            <div class="rank-badge ${rankClass}">#${index + 1}</div>
            <div class="char-rating">${item.rating}</div>
            <img src="${item.image}" class="char-img">
            <div class="char-info">
                <div class="char-name">${item.characterName}</div>
                <div class="source-row">
                    <span class="source-title" title="${item.sourceTitle}">${item.sourceTitle}</span>
                    <span class="red-type">${item.sourceType}</span>
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
}

window.removeItem = function (index) {
    state.pendingDeleteIndex = index; 
    document.getElementById('deleteModal').classList.remove('hidden'); 
}

document.getElementById('confirmDeleteBtn').addEventListener('click', () => {
    if (state.pendingDeleteIndex === null) return;
    const list = state.lists.find(l => l._id === state.activeListId);
    list.items.splice(state.pendingDeleteIndex, 1);
    updateCurrentList();
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

 const titleInput = document.getElementById('sourceTitleInput');
 const typeInput = document.getElementById('sourceTypeInput');
 const castDiv = document.getElementById('castSelector');
 castDiv.innerHTML = '';

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

document.getElementById('saveCharBtn').addEventListener('click', () => {
 if (!state.activeListId) return alert("Select a list first");
 const name = document.getElementById('charNameInput').value;
 const customImg = document.getElementById('customImgInput').value;
 const rating = document.getElementById('ratingInput').value;

 // Read new inputs
 const sourceTitle = document.getElementById('sourceTitleInput').value;
 const sourceType = document.getElementById('sourceTypeInput').value;

 if (!name) return alert("Character Name required");
 if (!sourceTitle) return alert("Source Title required");

 const list = state.lists.find(l => l._id === state.activeListId);

 const itemData = {
  characterName: name,
  sourceTitle: sourceTitle,
  sourceType: sourceType,
  rating: rating,
  image: customImg ? customImg : (state.tempSearchItem?.image || 'https://via.placeholder.com/200')
 };

 if (state.editingIndex > -1) {
  Object.assign(list.items[state.editingIndex], itemData);
  state.editingIndex = -1;
 } else {
  list.items.push(itemData);
 }
 updateCurrentList();
 closeModal('charModal');
});

function normalizeType(apiType) {
 if (!apiType) return 'Other';
 const lower = apiType.toLowerCase();
 if (lower === 'tv') return 'TV Show';
 if (lower === 'movie') return 'Movie';
 if (lower === 'game') return 'Game';
 if (lower === 'book') return 'Book';
 if (lower === 'anime' || lower === 'character') return 'Anime';
 if (lower === 'manga') return 'Manga';
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

document.getElementById('createListBtn').addEventListener('click', () => {
    state.isRenamingList = false; 

    document.getElementById('listModalTitle').textContent = "Create New List";
    document.getElementById('newListName').value = '';
    document.getElementById('saveListBtn').textContent = "Create";

    document.getElementById('listModal').classList.remove('hidden');
});

document.getElementById('editListTitleBtn').addEventListener('click', () => {
    const list = state.lists.find(l => l._id === state.activeListId);
    if (!list) return;

    state.isRenamingList = true; 

    document.getElementById('listModalTitle').textContent = "Rename List";
    document.getElementById('newListName').value = list.name;
    document.getElementById('saveListBtn').textContent = "Save Name";

    document.getElementById('listModal').classList.remove('hidden');
    document.getElementById('newListName').focus();
});

document.getElementById('saveListBtn').addEventListener('click', async () => {
    const name = document.getElementById('newListName').value;
    if (!name) return;

    if (state.isRenamingList) {
        const list = state.lists.find(l => l._id === state.activeListId);
        list.name = name; 

        await updateCurrentList(); 

        renderSidebar();     
        renderCurrentList();  
    } else {
        createList(name);
    }

    closeModal('listModal');
});

document.querySelectorAll('.close-modal').forEach(b => b.onclick = (e) => e.target.closest('.modal').classList.add('hidden'));
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
document.getElementById('themeToggle').onclick = () => document.body.classList.toggle('light-theme');

function setupEvents() {
    document.getElementById('themeToggle').onclick = () => {
        document.body.classList.toggle('light-theme');
    };

    document.getElementById('reorderBtn').addEventListener('click', toggleReorderMode);
    document.getElementById('saveOrderBtn').addEventListener('click', saveOrder);


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

init();

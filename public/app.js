let state = { user: null, lists: [], activeListId: null, tempSearchItem: null, editingIndex: -1 };

// --- INIT ---
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

// --- LISTS ---
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
 if (!confirm("Delete list?")) return;
 await fetch(`/api/lists/${id}`, { method: 'DELETE' });
 state.lists = state.lists.filter(l => l._id !== id);
 if (state.activeListId === id) state.activeListId = state.lists[0]?._id || null;
 renderSidebar();
 renderCurrentList();
}

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

// --- RENDER ---
function renderSidebar() {
 const nav = document.getElementById('listNav');
 nav.innerHTML = '';
 state.lists.forEach(list => {
  const li = document.createElement('li');
  li.className = list._id === state.activeListId ? 'active' : '';
  li.innerHTML = `<span>${list.name}</span>`;
  li.onclick = () => { state.activeListId = list._id; renderSidebar(); renderCurrentList(); };
  const delBtn = document.createElement('button');
  delBtn.className = 'delete-list-btn';
  delBtn.innerHTML = '<i class="fas fa-trash"></i>';
  delBtn.onclick = (e) => { e.stopPropagation(); deleteList(list._id); };
  li.appendChild(delBtn);
  nav.appendChild(li);
 });
}

function renderCurrentList() {
 const grid = document.getElementById('characterGrid');
 grid.innerHTML = '';
 const list = state.lists.find(l => l._id === state.activeListId);

 if (!list) return;
 document.getElementById('currentListTitle').textContent = list.name;

 // --- 1. FILTER LOGIC ---
 const filterType = document.getElementById('filterSelect').value;

 // Start with all items
 let displayItems = list.items;

 // If a specific type is selected, filter the array
 if (filterType !== 'all') {
  displayItems = list.items.filter(item => item.sourceType === filterType);
 }

 // --- 2. SORT LOGIC (Always by Rating) ---
 displayItems.sort((a, b) => b.rating - a.rating);

 // --- 3. RENDER ---
 if (displayItems.length === 0) {
  grid.innerHTML = '<p style="grid-column: 1/-1; text-align:center; color:#888;">No characters found for this category.</p>';
  return;
 }

 displayItems.forEach((item) => {
  // IMPORTANT: We need the index from the ORIGINAL list to edit/delete correctly
  const realIndex = list.items.indexOf(item);

  const div = document.createElement('div');
  div.className = 'char-card';
  div.innerHTML = `
            <div class="char-rating">${item.rating}</div>
            <img src="${item.image}" class="char-img">
            <div class="char-info">
                <div class="char-name">${item.characterName}</div>
                
                <div class="source-row">
                    <span class="source-title" title="${item.sourceTitle}">${item.sourceTitle}</span>
                    <span class="red-type">${item.sourceType}</span>
                </div>

                <div class="card-actions">
                    <!-- Use realIndex here so we delete the right person -->
                    <button class="icon-btn edit-btn" onclick="editItem(${realIndex})"><i class="fas fa-edit"></i></button>
                    <button class="icon-btn delete-btn" onclick="removeItem(${realIndex})"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `;
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

 // Pre-fill Source Inputs
 document.getElementById('sourceTitleInput').value = item.sourceTitle;
 document.getElementById('sourceTypeInput').value = normalizeType(item.sourceType);

 document.getElementById('castSelector').innerHTML = '';
 document.getElementById('saveCharBtn').textContent = "Update Character";
 document.getElementById('charModal').classList.remove('hidden');
}

window.removeItem = function (index) {
 const list = state.lists.find(l => l._id === state.activeListId);
 list.items.splice(index, 1);
 updateCurrentList();
}

// --- SEARCH ---
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

 // 1. Combine all results
 let combined = [...anime, ...igdb, ...tmdb, ...persons, ...fandom, ...rawg, ...books];

 // 2. NEW: SORT BY RELEVANCE
 // This moves "Walter White" to the top and pushes "Waiter" to the bottom
 combined.sort((a, b) => {
  const q = query.toLowerCase();
  const titleA = a.title.toLowerCase();
  const titleB = b.title.toLowerCase();

  // Priority 1: Exact Match (e.g. "Walter White" == "Walter White")
  if (titleA === q && titleB !== q) return -1;
  if (titleB === q && titleA !== q) return 1;

  // Priority 2: Starts With (e.g. "Walter White..." vs "The Walter...")
  const startA = titleA.startsWith(q);
  const startB = titleB.startsWith(q);
  if (startA && !startB) return -1;
  if (startB && !startA) return 1;

  // Priority 3: Contains the word (e.g. "Mr. Walter White")
  const hasA = titleA.includes(q);
  const hasB = titleB.includes(q);
  if (hasA && !hasB) return -1;
  if (hasB && !hasA) return 1;

  return 0; // If both are equal quality, keep original order
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

  // Show Source Title if available, otherwise Show Type
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

 // --- 2. LOGIC: ANIME CHARACTERS ---
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
 // --- 3. LOGIC: GAME CHARACTERS (NEW!) ---
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

// --- AUTH / UI ---
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
document.getElementById('createListBtn').addEventListener('click', () => document.getElementById('listModal').classList.remove('hidden'));
document.getElementById('saveListBtn').addEventListener('click', () => { const n = document.getElementById('newListName').value; if (n) createList(n); });
document.querySelectorAll('.close-modal').forEach(b => b.onclick = (e) => e.target.closest('.modal').classList.add('hidden'));
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
document.getElementById('themeToggle').onclick = () => document.body.classList.toggle('light-theme');
function setupEvents() { /* Helpers */ }

document.getElementById('filterSelect').addEventListener('change', renderCurrentList);

init();

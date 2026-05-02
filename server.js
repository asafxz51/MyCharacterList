const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const User = require('./models/User');
const List = require('./models/List');
const Settings = require('./models/Settings');
const Log = require('./models/Log');


const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());
app.use(cors());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;


let isConnected = false;

const connectDB = async () => {
  if (isConnected) return;
  try {
    await mongoose.connect(process.env.MONGO_URI);
    isConnected = true;
    console.log("MongoDB Connected");
  } catch (err) {
    console.error("MongoDB Connection Error:", err);
  }
};

app.use(async (req, res, next) => {
  await connectDB();
  next();
});
let lastRequestTime = 0;
const checkRateLimit = (req, res, next) => {
  const now = Date.now();
  if (now - lastRequestTime < 200) return res.status(429).json({ error: 'Too fast' });
  lastRequestTime = now;
  next();
};

const verifyToken = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Access Denied' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) { res.status(400).json({ error: 'Invalid Token' }); }
};

const verifyAdmin = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (user.role !== 'admin') return res.status(403).json({ error: 'Access Denied: Admins Only' });
    next();
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
};

const optionalToken = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return next(); // אין טוקן? תמשיך כאורח
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) { next(); }
};

async function saveLog(user, action, details) {
  try {
    const log = new Log({
      userId: user ? user._id : null,
      username: user ? user.username : 'Guest',
      action,
      details
    });
    await log.save();
  } catch (e) { console.error("Log error:", e); }
}

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and Password are required' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashedPassword });
    await user.save();

    await saveLog(user, "User Registered", `New user: ${username}`);
    res.json({ message: 'User created' });
  } catch (err) {
    console.error("Registration Error:", err);

    if (err.code === 11000) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    if (err.name === 'ValidationError') {
      return res.status(400).json({ error: err.message });
    }

    res.status(500).json({ error: 'Server Error: ' + err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const user = await User.findOne({ username: req.body.username });
  if (!user || !(await bcrypt.compare(req.body.password, user.password))) {
    return res.status(400).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ _id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

  await saveLog(user, "User Login", "Logged into the system");

  res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 })
    .json({ message: 'Logged in', username: user.username });
});

app.post('/api/auth/logout', (req, res) => res.clearCookie('token').json({ message: 'Logged out' }));

app.get('/api/auth/check', verifyToken, async (req, res) => {
  const user = await User.findById(req.user._id);
  res.json({ username: user.username, role: user.role });
});

// --- SETTINGS (Public) ---
app.get('/api/settings/welcome', async (req, res) => {
  try {
    let settings = await Settings.findOne({ key: 'global' });
    if (!settings) settings = await Settings.create({}); // יוצר ברירת מחדל אם אין
    res.json(settings);
  } catch (e) { res.json({ welcomeTitle: 'Welcome', welcomeText: 'Please log in.' }); }
});

// --- ADMIN ROUTES ---
app.post('/api/admin/settings/welcome', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { title, text } = req.body;
    await Settings.findOneAndUpdate({ key: 'global' }, { welcomeTitle: title, welcomeText: text }, { upsert: true });
    res.json({ message: 'Settings Updated' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/users', verifyToken, verifyAdmin, async (req, res) => {
  const users = await User.find({}, '-password'); // מביא את כולם חוץ מהסיסמאות
  res.json(users);
});

app.delete('/api/lists/:id', verifyToken, async (req, res) => {
  try {
    const list = await List.findOne({ _id: req.params.id, userId: req.user._id });

    if (!list) {
      return res.status(404).json({ error: 'List not found' });
    }

    const user = await User.findById(req.user._id);

    await saveLog(user, "Delete List", `Deleted list: "${list.name}"`);

    await List.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/users/:id/reset', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 3) return res.status(400).json({ error: 'Password too short' });

    const hashed = await bcrypt.hash(newPassword, 10);
    await User.findByIdAndUpdate(req.params.id, { password: hashed });
    res.json({ message: 'Password updated' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


app.get('/api/admin/users/:id/lists', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const lists = await List.find({ userId: req.params.id });
    res.json(lists);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/lists/:id', verifyToken, verifyAdmin, async (req, res) => {
  await List.findByIdAndDelete(req.params.id);
  res.json({ message: 'List deleted' });
});

app.get('/api/users', optionalToken, async (req, res) => {
  try {
    const { search, onlyFollowing } = req.query;

    if (onlyFollowing === 'true' && !req.user) {
      return res.status(401).json({ error: 'Please login to view followed users' });
    }

    let query = {};
    if (search) query.username = { $regex: search, $options: 'i' };

    let currentUser = null;
    if (req.user) {
      currentUser = await User.findById(req.user._id);
      if (onlyFollowing === 'true') {
        query._id = { $in: currentUser.following };
      }
    }

    const users = await User.find(query, 'username');
    const usersWithStatus = users.map(u => ({
      _id: u._id,
      username: u.username,
      isFollowing: currentUser ? currentUser.following.includes(u._id) : false,
      isMe: currentUser ? u._id.equals(currentUser._id) : false
    }));

    res.json(usersWithStatus);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/users/follow/:id', verifyToken, async (req, res) => {
  try {
    const targetId = req.params.id;
    const currentUser = await User.findById(req.user._id);

    if (currentUser.following.includes(targetId)) {
      // Unfollow
      currentUser.following.pull(targetId);
    } else {
      // Follow
      currentUser.following.push(targetId);
    }

    await currentUser.save();
    res.json({ following: currentUser.following });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/users/:userId/lists', async (req, res) => {
  try {
    const lists = await List.find({
      userId: req.params.userId,
      isPrivate: { $ne: true }
    });
    res.json(lists);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/lists', verifyToken, async (req, res) => {
  const lists = await List.find({ userId: req.user._id }).sort({ order: 1 });
  res.json(lists);
});

app.put('/api/lists/reorder', verifyToken, async (req, res) => {
  try {
    const { orderedIds } = req.body;

    const updates = orderedIds.map((id, index) => {
      return List.updateOne({ _id: id, userId: req.user._id }, { order: index });
    });

    await Promise.all(updates);
    res.json({ message: 'Order updated' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/lists', verifyToken, async (req, res) => {
  try {
    // הוספנו logAction ו-logDetails שנקבל מהפרונטאנד
    const { _id, name, items, rankingType, isPrivate, isFreeOrder, logAction, logDetails } = req.body;
    const user = await User.findById(req.user._id);

    // קביעת סוג הלוג: אם הפרונטאנד שלח פעולה ספציפית, נשתמש בה. אחרת, ברירת מחדל.
    const finalAction = logAction || (_id ? "Update List" : "Create List");
    const finalDetails = logDetails || `List name: ${name}`;

    await saveLog(user, finalAction, finalDetails);

    if (_id) {
      await List.findByIdAndUpdate(_id, { name, items, isPrivate, rankingType, isFreeOrder });
      res.json({ _id, name, items, rankingType, isPrivate, isFreeOrder });
    } else {
      const newList = new List({
        userId: req.user._id,
        name,
        items: items || [],
        rankingType: rankingType || 'numbers',
        isPrivate: isPrivate || false,
        isFreeOrder: isFreeOrder || false
      });
      await newList.save();
      res.json(newList);
    }
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
});

app.post('/api/lists/:id/duplicate', verifyToken, async (req, res) => {
  try {
    const originalList = await List.findOne({ _id: req.params.id, userId: req.user._id });
    if (!originalList) return res.status(404).json({ error: 'List not found' });

    const newList = new List({
      userId: req.user._id,
      name: originalList.name + " (Copy)",
      rankingType: originalList.rankingType,
      isPrivate: originalList.isPrivate,
      items: originalList.items
    });

    await newList.save();

    const user = await User.findById(req.user._id);
    await saveLog(user, "Duplicate List", `Duplicated "${originalList.name}" into "${newList.name}"`);

    res.json(newList);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/lists/:id', verifyToken, async (req, res) => {
  await List.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
  await saveLog(user, "Delete List", `List ID: ${req.params.id}`);
  res.json({ message: 'Deleted' });
});


app.delete('/api/users/me', verifyToken, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.user._id);
    res.json({ message: "Account deleted successfully" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/logs', verifyToken, verifyAdmin, async (req, res) => {
  const logs = await Log.find().sort({ timestamp: -1 }).limit(200); 
  res.json(logs);
});

app.get('/api/share/:id', async (req, res) => {
  try {
    const list = await List.findById(req.params.id);
    const user = await User.findById(list.userId);
    res.json({ ...list.toObject(), author: user ? user.username : 'Unknown' });
  } catch (err) { res.status(404).json({ error: 'Not found' }); }
});


app.get('/api/tmdb/credits', checkRateLimit, async (req, res) => {
  try {
    const { type, id } = req.query;
    if (!type || !id) return res.json([]);
    const r = await axios.get(`https://api.themoviedb.org/3/${type}/${id}/credits`, {
      params: { api_key: process.env.TMDB_API_KEY }
    });
    const cast = r.data.cast.slice(0, 15).map(c => ({
      characterName: c.character,
      actorName: c.name,
      image: c.profile_path ? `https://image.tmdb.org/t/p/w200${c.profile_path}` : null
    }));
    res.json(cast);
  } catch (e) { res.json([]); }
});

app.get('/api/search/jikan', async (req, res) => {
  try {
    await new Promise(r => setTimeout(r, 500));
    const r = await axios.get(`https://api.jikan.moe/v4/characters`, { params: { q: req.query.query, limit: 15 } });
    res.json(r.data.data.map(i => ({
      id: i.mal_id, title: i.name, image: i.images?.jpg?.image_url, type: 'character', description: 'Anime Character'
    })));
  } catch (e) { res.json([]); }
});

app.get('/api/jikan/details/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`Fetching Jikan Details for ID: ${id}...`);

    const response = await axios.get(`https://api.jikan.moe/v4/characters/${id}/full`);
    const data = response.data.data;

    let sourceTitle = '';
    let sourceType = 'Anime';

    if (data.anime && data.anime.length > 0) {
      sourceTitle = data.anime[0]?.anime?.title;
      sourceType = 'Anime';
    }

    else if (data.manga && data.manga.length > 0) {
      sourceTitle = data.manga[0]?.manga?.title;
      sourceType = 'Manga';
    }

    if (!sourceTitle) {
      sourceTitle = '';
    }

    console.log(`Success: ${sourceTitle} (${sourceType})`);
    res.json({ sourceTitle, sourceType });

  } catch (e) {
    console.error("Jikan Error:", e.message);
    res.json({ sourceTitle: '', sourceType: 'Anime' });
  }
});

app.get('/api/image-proxy', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).send('No URL');

    const response = await axios.get(url, { responseType: 'arraybuffer' });

    res.set('Content-Type', 'image/jpeg');
    res.send(response.data);
  } catch (e) {
    res.status(404).send('Image not found');
  }
});

app.get('/api/search/fandom', async (req, res) => {
  try {
    const { query } = req.query;

    const searchWiki = async (subdomain) => {
      const apiUrl = `https://${subdomain}.fandom.com/api.php`;

      const searchRes = await axios.get(apiUrl, {
        params: { action: 'query', list: 'search', srsearch: query, srlimit: 4, format: 'json' }
      });
      if (!searchRes.data.query) return [];
      const pageIds = searchRes.data.query.search.map(i => i.pageid).join('|');
      if (!pageIds) return [];

      const detailsRes = await axios.get(apiUrl, {
        params: {
          action: 'query',
          pageids: pageIds,
          prop: 'pageimages|extracts|categories',
          pithumbsize: 600,
          exchars: 200,
          exintro: true,
          explaintext: true,
          cllimit: 20,
          format: 'json'
        }
      });

      const pages = detailsRes.data.query.pages;

      return Object.values(pages).map(p => {
        let detectedSource = "";

        if (p.categories) {
          const validCats = p.categories.filter(c =>
            !c.title.includes("Males") &&
            !c.title.includes("Females") &&
            !c.title.includes("Articles") &&
            !c.title.includes("living") &&
            !c.title.includes("deceased")
          );

          const bestCat = validCats.find(c =>
            c.title.match(/(Characters|Villains|Heroes|Antagonists|Protagonists)/i)
          );

          if (bestCat) {
            detectedSource = bestCat.title
              .replace("Category:", "")
              .replace(/ Characters/i, "")
              .replace(/ Villains/i, "")
              .replace(/ Heroes/i, "")
              .replace(/ Antagonists/i, "")
              .replace(/ Protagonists/i, "")
              .trim();
          }
        }

        let rawImageUrl = p.thumbnail ? p.thumbnail.source : (p.original ? p.original.source : null);
        let proxyUrl = null;

        if (rawImageUrl) {
          proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(rawImageUrl)}`;
        }

        return {
          id: p.pageid,
          title: p.title,
          image: proxyUrl,
          type: 'wiki_character',
          sourceTitle: detectedSource,
          description: p.extract || '',
          wiki: subdomain
        };
      });
    };

    const [heroes, villains] = await Promise.all([
      searchWiki('heroes'),
      searchWiki('villains')
    ]);

    res.json([...heroes, ...villains]);
  } catch (e) {
    console.error("Fandom Error:", e.message);
    res.json([]);
  }
});

let igdbToken = null;
let tokenExpiresAt = 0;

async function getIgdbToken() {
  if (igdbToken && Date.now() < tokenExpiresAt) return igdbToken;

  try {
    const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
      params: {
        client_id: process.env.TWITCH_CLIENT_ID,
        client_secret: process.env.TWITCH_SECRET,
        grant_type: 'client_credentials'
      }
    });
    igdbToken = response.data.access_token;
    tokenExpiresAt = Date.now() + (response.data.expires_in * 1000);
    return igdbToken;
  } catch (e) {
    console.error("Twitch Token Error:", e.message);
    return null;
  }
}

app.get('/api/search/igdb', async (req, res) => {
  try {
    const token = await getIgdbToken();
    if (!token) return res.json([]);

    // IGDB uses a weird text-based query format
    const response = await axios.post('https://api.igdb.com/v4/characters',
      `search "${req.query.query}"; fields name, mug_shot.image_id; limit 10;`,
      {
        headers: {
          'Client-ID': process.env.TWITCH_CLIENT_ID,
          'Authorization': `Bearer ${token}`
        }
      }
    );

    const results = response.data.map(item => ({
      id: item.id,
      title: item.name,
      image: item.mug_shot ? `https://images.igdb.com/igdb/image/upload/t_720p/${item.mug_shot.image_id}.jpg` : null,
      type: 'game_character',
      description: 'Video Game Character'
    }));

    res.json(results);
  } catch (e) {
    console.error("IGDB Search Error:", e.message);
    res.json([]);
  }
});

app.get('/api/igdb/details/:id', async (req, res) => {
  try {
    const token = await getIgdbToken();
    const { id } = req.params;

    const response = await axios.post('https://api.igdb.com/v4/characters',
      `where id = ${id}; fields name, games.name;`,
      {
        headers: {
          'Client-ID': process.env.TWITCH_CLIENT_ID,
          'Authorization': `Bearer ${token}`
        }
      }
    );


    const data = response.data[0];
    let sourceTitle = '';

    if (data.games && data.games.length > 0) {
      sourceTitle = data.games[0].name;
    }

    res.json({ sourceTitle, sourceType: 'Game' });

  } catch (e) {
    console.error("IGDB Details Error:", e.message);
    res.json({ sourceTitle: '', sourceType: 'Game' });
  }
});

if (process.env.NODE_ENV !== 'production') {
  connectDB();
  app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
}

const serverless = require('serverless-http');
module.exports = app;
module.exports.handler = serverless(app);
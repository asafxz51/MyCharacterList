const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

// Models
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

// Database Connection
let isConnected = false;
const connectDB = async () => {
  if (isConnected) return;
  try {
    await mongoose.connect(process.env.MONGO_URI);
    isConnected = true;
    console.log("MongoDB Connected");
  } catch (err) { console.error("MongoDB Error:", err); }
};

app.use(async (req, res, next) => { await connectDB(); next(); });

// Middlewares
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
    if (user.role !== 'admin') return res.status(403).json({ error: 'Admins Only' });
    next();
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
};

const optionalToken = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return next();
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); } catch (err) { next(); }
};

// Logging Helper
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

// --- AUTH ROUTES ---

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing data' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashedPassword });
    await user.save();
    await saveLog(user, "User Registered", `New user: ${username}`);
    res.json({ message: 'User created' });
  } catch (err) { res.status(400).json({ error: "Username taken or invalid" }); }
});

app.post('/api/auth/login', async (req, res) => {
  const user = await User.findOne({ username: req.body.username });
  if (!user || !(await bcrypt.compare(req.body.password, user.password))) {
    return res.status(400).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ _id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
  await saveLog(user, "User Login", "Logged into the system");
  res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 }).json({ message: 'Logged in', username: user.username });
});

app.post('/api/auth/logout', (req, res) => res.clearCookie('token').json({ message: 'Logged out' }));

app.get('/api/auth/check', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.json({ _id: user._id, username: user.username, role: user.role });
  } catch (e) { res.status(401).json({ error: "Unauthorized" }); }
});

app.post('/api/auth/ping', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (user) await saveLog(user, "Site Entry", "User accessed site (Session)");
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- LISTS & CHARACTERS ---

app.get('/api/lists', verifyToken, async (req, res) => {
  const lists = await List.find({ userId: req.user._id }).sort({ order: 1 });
  res.json(lists);
});

app.post('/api/lists', verifyToken, async (req, res) => {
  try {
    const { _id, name, items, rankingType, isPrivate, isFreeOrder, logAction, logDetails, allowComments } = req.body;
    const user = await User.findById(req.user._id);

    await saveLog(user, logAction || (_id ? "Update List" : "Create List"), logDetails || `List: ${name}`);

    if (_id) {
      const updated = await List.findByIdAndUpdate(_id, { name, items, isPrivate, rankingType, isFreeOrder, allowComments }, { new: true });
      res.json(updated);
    } else {
      const newList = new List({ userId: req.user._id, name, items: items || [], rankingType: rankingType || 'numbers', isPrivate, isFreeOrder, allowComments: true });
      await newList.save();
      res.json(newList);
    }
  } catch (error) { res.status(500).json({ error: "Server error" }); }
});

app.delete('/api/lists/:id', verifyToken, async (req, res) => {
  try {
    const list = await List.findOne({ _id: req.params.id, userId: req.user._id });
    if (!list) return res.status(404).send("Not found");
    const user = await User.findById(req.user._id);
    await saveLog(user, "Delete List", `Deleted list: "${list.name}"`);
    await List.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (e) { res.status(500).send(e.message); }
});

app.put('/api/lists/reorder', verifyToken, async (req, res) => {
  const { orderedIds } = req.body;
  const updates = orderedIds.map((id, index) => List.updateOne({ _id: id, userId: req.user._id }, { order: index }));
  await Promise.all(updates);
  res.json({ success: true });
});

app.post('/api/lists/:id/duplicate', verifyToken, async (req, res) => {
  const original = await List.findOne({ _id: req.params.id, userId: req.user._id });
  const newList = new List({ userId: req.user._id, name: original.name + " (Copy)", items: original.items, rankingType: original.rankingType, isPrivate: original.isPrivate });
  await newList.save();
  const user = await User.findById(req.user._id);
  await saveLog(user, "Duplicate List", `From: ${original.name}`);
  res.json(newList);
});



// --- INTERACTIONS (LIKES/COMMENTS) ---

app.post('/api/lists/:id/like', verifyToken, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);
    const user = await User.findById(req.user._id);
    const owner = await User.findById(list.userId);

    const index = list.likes.indexOf(user._id);
    let isLiked = false;

    if (index === -1) {
      list.likes.push(user._id);
      isLiked = true;

      // הגבלת ספאם נוטיפקציות:
      // נבדוק אם כבר קיימת התראה מסוג לייק מהמשתמש הזה על הליסט הזה ב-24 שעות האחרונות
      const recentNotif = owner.notifications.find(n =>
        n.type === 'like' &&
        n.fromUser === user.username &&
        n.listId.toString() === list._id.toString()
      );

      if (owner && list.userId.toString() !== user._id.toString() && !recentNotif) {
        owner.notifications.unshift({ type: 'like', fromUser: user.username, listId: list._id, listName: list.name });
        await owner.save();
      }
      await saveLog(user, "Like List", `List: ${list.name}`);
    } else {
      list.likes.splice(index, 1);
      await saveLog(user, "Unlike List", `List: ${list.name}`);
    }
    await list.save();
    res.json({ likesCount: list.likes.length, isLiked });
  } catch (e) { res.status(500).send(e.message); }
});

app.post('/api/lists/:id/comment', verifyToken, async (req, res) => {
  try {
    const { text } = req.body;
    const list = await List.findById(req.params.id);
    if (!list) return res.status(404).json({ error: "List not found" });
    if (!list.allowComments) return res.status(403).json({ error: "Comments are disabled for this list." });

    const user = await User.findById(req.user._id);

    // --- בדיקת הגבלת 10 דקות (Spam Protection) ---
    // מוצאים את כל התגובות של המשתמש הספציפי ברשימה הזו
    const userComments = list.comments.filter(c => c.userId && c.userId.toString() === user._id.toString());

    if (userComments.length > 0) {
      // התגובה האחרונה שהמשתמש שלח
      const lastComment = userComments[userComments.length - 1];
      const now = new Date();
      const lastTime = new Date(lastComment.timestamp);
      const diffInMinutes = (now - lastTime) / (1000 * 60);

      if (diffInMinutes < 10) {
        const waitTime = Math.ceil(10 - diffInMinutes);
        return res.status(429).json({
          error: `You are commenting too fast. Please wait ${waitTime} more minutes.`
        });
      }
    }

    const owner = await User.findById(list.userId);
    list.comments.push({ userId: user._id, username: user.username, text });
    await list.save();

    if (owner && list.userId.toString() !== user._id.toString()) {
      owner.notifications.unshift({
        type: 'comment',
        fromUser: user.username,
        listId: list._id,
        listName: list.name,
        commentText: text
      });
      await owner.save();
    }

    await saveLog(user, "Comment Added", `On list: ${list.name}`);
    res.json(list.comments);
  } catch (e) {
    res.status(500).json({ error: "Server Error" });
  }
});

app.delete('/api/lists/:listId/comments/:commentId', verifyToken, async (req, res) => {
  try {
    const list = await List.findById(req.params.listId);
    const user = await User.findById(req.user._id);
    const comment = list.comments.id(req.params.commentId);

    if (!comment) return res.status(404).send("Comment not found");

    // בדיקת הרשאות מורחבת:
    // מותר למחוק אם: אתה האדמין OR אתה בעל הרשימה OR אתה זה שכתב את התגובה
    const isAdmin = user.role === 'admin';
    const isListOwner = list.userId.toString() === user._id.toString();
    const isCommentAuthor = comment.userId.toString() === user._id.toString();

    if (!isAdmin && !isListOwner && !isCommentAuthor) {
      return res.status(403).json({ error: "You can only delete your own comments or comments on your lists" });
    }

    list.comments.pull(req.params.commentId);
    await list.save();
    await saveLog(user, "Comment Deleted", `From list: ${list.name}`);
    res.json({ success: true });
  } catch (e) { res.status(500).send(e.message); }
});

// --- NOTIFICATIONS ---

app.get('/api/notifications', verifyToken, async (req, res) => {
  const user = await User.findById(req.user._id);
  res.json(user.notifications || []);
});

app.post('/api/notifications/read', verifyToken, async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { $set: { "notifications.$[].read": true } });
  res.json({ success: true });
});

// --- COMMUNITY ---

app.get('/api/users', optionalToken, async (req, res) => {
  const { search } = req.query;
  const validUsers = await List.distinct('userId', { isPrivate: { $ne: true }, items: { $exists: true, $not: { $size: 0 } } });
  let query = { _id: { $in: validUsers } };
  if (search) query.username = { $regex: search, $options: 'i' };

  let currentUser = req.user ? await User.findById(req.user._id) : null;
  const users = await User.find(query, 'username');

  let result = users.map(u => ({
    _id: u._id, username: u.username,
    isFollowing: currentUser ? currentUser.following.includes(u._id) : false,
    isMe: currentUser ? u._id.equals(currentUser._id) : false
  })).filter(u => !u.isMe);

  result.sort((a, b) => (a.isFollowing === b.isFollowing ? 0 : a.isFollowing ? -1 : 1));
  res.json(result);
});

app.post('/api/users/follow/:id', verifyToken, async (req, res) => {
  const target = req.params.id;
  const user = await User.findById(req.user._id);
  const index = user.following.indexOf(target);
  index === -1 ? user.following.push(target) : user.following.splice(index, 1);
  await user.save();
  res.json(user.following);
});

app.get('/api/users/:userId/lists', async (req, res) => {
  const lists = await List.find({ userId: req.params.userId, isPrivate: { $ne: true } });
  res.json(lists);
});

// --- ADMIN ---

app.get('/api/admin/users', verifyToken, verifyAdmin, async (req, res) => {
  const users = await User.find({}, '-password');
  res.json(users);
});

app.delete('/api/admin/users/:id', verifyToken, verifyAdmin, async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  await List.deleteMany({ userId: req.params.id });
  res.json({ success: true });
});

app.post('/api/admin/users/:id/reset', verifyToken, verifyAdmin, async (req, res) => {
  const hashedPassword = await bcrypt.hash(req.body.newPassword, 10);
  await User.findByIdAndUpdate(req.params.id, { password: hashedPassword });
  res.json({ success: true });
});

app.get('/api/admin/logs', verifyToken, verifyAdmin, async (req, res) => {
  const logs = await Log.find().sort({ timestamp: -1 }).limit(200);
  res.json(logs);
});

app.get('/api/admin/users/:id/lists', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const lists = await List.find({ userId: req.params.id });
    res.json(lists);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- SEARCH & EXTERNAL APIS ---

app.get('/api/search/jikan', async (req, res) => {
  try {
    const r = await axios.get(`https://api.jikan.moe/v4/characters`, { params: { q: req.query.query, limit: 15 } });
    res.json(r.data.data.map(i => ({ id: i.mal_id, title: i.name, image: i.images?.jpg?.image_url, type: 'character' })));
  } catch (e) { res.json([]); }
});

app.get('/api/jikan/details/:id', async (req, res) => {
  try {
    const r = await axios.get(`https://api.jikan.moe/v4/characters/${req.params.id}/full`);
    const data = r.data.data;
    let sourceTitle = data.anime?.length > 0 ? data.anime[0]?.anime?.title : (data.manga?.length > 0 ? data.manga[0]?.manga?.title : '');
    res.json({ sourceTitle, sourceType: data.anime?.length > 0 ? 'Anime' : 'Manga' });
  } catch (e) { res.json({ sourceTitle: '', sourceType: 'Anime' }); }
});

app.get('/api/tmdb/credits', async (req, res) => {
  try {
    const { type, id } = req.query;
    const r = await axios.get(`https://api.themoviedb.org/3/${type}/${id}/credits`, { params: { api_key: process.env.TMDB_API_KEY } });
    const cast = r.data.cast.slice(0, 15).map(c => ({ characterName: c.character, actorName: c.name, image: c.profile_path ? `https://image.tmdb.org/t/p/w200${c.profile_path}` : null }));
    res.json(cast);
  } catch (e) { res.json([]); }
});

app.get('/api/image-proxy', async (req, res) => {
  try {
    const response = await axios.get(req.query.url, { responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
    res.set('Content-Type', 'image/jpeg'); res.send(response.data);
  } catch (e) { res.status(404).send('Image not found'); }
});

// --- SETTINGS ---
app.get('/api/settings/welcome', async (req, res) => {
  const s = await Settings.findOne({ key: 'global' });
  res.json(s || { welcomeTitle: 'Welcome', welcomeText: 'Hello!' });
});

app.post('/api/admin/settings/welcome', verifyToken, verifyAdmin, async (req, res) => {
  await Settings.findOneAndUpdate({ key: 'global' }, { welcomeTitle: req.body.title, welcomeText: req.body.text }, { upsert: true });
  res.json({ success: true });
});

app.get('/api/share/:id', async (req, res) => {
  try {
    const list = await List.findById(req.params.id);
    if (!list) return res.status(404).json({ error: 'Not found' });
    const user = await User.findById(list.userId);

    // יצירת אובייקט עם הגנות על שדות של רשימות ישנות
    const listObj = list.toObject();
    const dataToSend = {
      ...listObj,
      author: user ? user.username : 'Unknown',
      likes: listObj.likes || [],
      comments: listObj.comments || [],
      allowComments: listObj.allowComments !== undefined ? listObj.allowComments : true
    };

    res.json(dataToSend);
  } catch (err) {
    console.error("Share list error:", err);
    res.status(404).json({ error: 'Not found' });
  }
});

// Netlify & Production setup
if (process.env.NODE_ENV !== 'production') {
  connectDB();
  app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
}

const serverless = require('serverless-http');
module.exports = app;
module.exports.handler = serverless(app);